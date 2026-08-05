import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { WebhookStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { processOrder, processClaim } from '@/lib/mercadolibre/sync'

export const dynamic = 'force-dynamic'

interface MlNotification {
  resource: string
  user_id: number
  topic: string
  application_id?: number
  attempts?: number
  /// When ML generated this notification. Constant across its delivery retries,
  /// distinct per state change — so it's the right thing to dedupe on.
  sent?: string
  received?: string
}

/**
 * Receives ML webhook notifications. Responds 200 immediately and processes the
 * event asynchronously via `after()` so ML doesn't time out and retry.
 */
export async function POST(request: NextRequest) {
  let body: MlNotification
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { resource, topic, user_id } = body
  if (!resource || !topic) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  }

  // Idempotent event log keyed by (topic, resource, sent).
  //
  // Keying on (topic, resource) alone was wrong: ML re-notifies the SAME resource
  // on every state change, so once an order's first notification was processed,
  // its later cancellation notification collided with that row and was silently
  // dropped as a duplicate. `sent` is stable across ML's retries of one
  // notification but differs per state change, which is exactly the seam we want.
  const sentAt = parseTimestamp(body.sent)
  const dedupeKey = `${topic}|${resource}|${body.sent ?? body.received ?? 'none'}`
  const event = await prisma.webhookEvent.upsert({
    where: { dedupeKey },
    update: { mlUserId: user_id ? String(user_id) : undefined },
    create: {
      dedupeKey,
      topic,
      resource,
      sentAt,
      mlUserId: user_id ? String(user_id) : null,
      payload: body as object,
    },
  })

  if (event.status === WebhookStatus.PROCESSED) {
    return NextResponse.json({ ok: true, deduped: true })
  }

  after(async () => {
    try {
      const result = await handleNotification(topic, resource, user_id)
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: result, processedAt: new Date() },
      })
    } catch (err) {
      console.error('[ml webhook] processing error:', err)
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: WebhookStatus.FAILED,
          error: err instanceof Error ? err.message.slice(0, 500) : String(err),
        },
      })
    }
  })

  return NextResponse.json({ ok: true })
}

async function handleNotification(
  topic: string,
  resource: string,
  userId: number
): Promise<WebhookStatus> {
  const account = await prisma.mercadoLibreAccount.findFirst({
    where: { mlUserId: String(userId), isActive: true },
  })
  if (!account) return WebhookStatus.SKIPPED

  switch (topic) {
    case 'orders_v2':
    case 'orders': {
      const orderId = resource.split('/').pop()!
      const result = await processOrder(account, orderId)
      return result.status === 'created' ||
        result.status === 'cancelled' ||
        result.reason === 'duplicate'
        ? WebhookStatus.PROCESSED
        : WebhookStatus.SKIPPED
    }
    // Post-purchase: returns, refunds and after-the-fact cancellations. A
    // delivered order that gets returned never changes order status, so this is
    // the only notification that reveals it.
    case 'claims':
    case 'post_purchase': {
      const claimId = resource.split('/').pop()!
      const result = await processClaim(account, claimId)
      return result.status === 'reversed' ? WebhookStatus.PROCESSED : WebhookStatus.SKIPPED
    }
    // items / shipments / questions: logged for now (handled in later iterations).
    default:
      return WebhookStatus.SKIPPED
  }
}

/** ISO timestamp from an ML payload, or null when absent/unparseable. */
function parseTimestamp(value?: string): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
