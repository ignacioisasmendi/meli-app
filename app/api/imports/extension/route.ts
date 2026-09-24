import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ImportDraftStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { reconcileOrder } from '@/lib/imports/amazon-order'
import {
  MAX_PAGE_TEXT_CHARS,
  MissingAnthropicKeyError,
  parseAmazonOrderText,
} from '@/lib/imports/amazon-screenshot'
import { sendTelegramMessage } from '@/lib/telegram/client'
import { importDraftMessage } from '@/lib/telegram/messages'

export const dynamic = 'force-dynamic'
/** Reading the order takes a few seconds; 60s is the Vercel Hobby ceiling. */
export const maxDuration = 60

const SUPPLIER = 'Amazon'
const ORDER_NUMBER = /\b\d{3}-\d{7}-\d{7}\b/

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/**
 * The browser extension has no Auth0 session, so it authenticates with its own
 * shared secret. Excluded from the login redirect in `middleware.ts`.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.EXTENSION_TOKEN
  if (!secret) return false
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

const payloadSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => /(^|\.)amazon\.com$/.test(new URL(u).hostname), 'Not an amazon.com page'),
  text: z.string().min(1, 'The page had no text').max(MAX_PAGE_TEXT_CHARS * 2),
  items: z
    .array(z.object({ asin: z.string().regex(/^[A-Z0-9]{10}$/), title: z.string().max(500) }))
    .max(200)
    .default([]),
})

/** Where the user lands to review a draft. */
function reviewUrl(request: NextRequest, draftId: string): string {
  const base = process.env.APP_BASE_URL ?? request.nextUrl.origin
  return `${base}/purchases/import?draft=${draftId}`
}

/**
 * Tells an order already dealt with apart from a new one, so pressing the
 * button twice never costs a second extraction or a second draft.
 */
async function findExisting(request: NextRequest, orderNumber: string) {
  const imported = await prisma.purchaseOrder.findUnique({
    where: { supplier_orderNumber: { supplier: SUPPLIER, orderNumber } },
    select: { id: true },
  })
  if (imported) {
    const base = process.env.APP_BASE_URL ?? request.nextUrl.origin
    return NextResponse.json({
      status: 'already_imported',
      orderNumber,
      url: `${base}/purchases/orders/${imported.id}`,
    })
  }

  const draft = await prisma.importDraft.findFirst({
    where: { supplier: SUPPLIER, orderNumber, status: ImportDraftStatus.PENDING },
    select: { id: true },
  })
  if (draft) {
    return NextResponse.json({
      status: 'pending',
      orderNumber,
      draftId: draft.id,
      url: reviewUrl(request, draft.id),
    })
  }
  return null
}

/** Lets the extension's options page check the URL and token before use. */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return bad('unauthorized', 401)
  return NextResponse.json({ ok: true })
}

/**
 * Receives the text of an Amazon "Order Details" page from the browser
 * extension, reads it into purchase lines and parks them as an `ImportDraft`.
 * Nothing touches stock here — the draft pre-fills the import form, and the
 * user imports it from there.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return bad('unauthorized', 401)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return bad('Expected a JSON body')
  }
  const parsed = payloadSchema.safeParse(body)
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? 'Invalid request')
  const { url, text, items } = parsed.data

  // The order number is in the URL (and the page) — checking it first means a
  // repeat click is answered without paying for another extraction.
  const known = new URL(url).searchParams.get('orderID')?.match(ORDER_NUMBER)?.[0]
    ?? text.match(ORDER_NUMBER)?.[0]
  if (known) {
    const existing = await findExisting(request, known)
    if (existing) return existing
  }

  let order
  try {
    order = await parseAmazonOrderText(text, url, items)
  } catch (err) {
    if (err instanceof MissingAnthropicKeyError) {
      return bad('ANTHROPIC_API_KEY is not configured on the server', 503)
    }
    console.error('[extension import] extraction failed:', err)
    return bad(err instanceof Error ? err.message : 'Could not read that order', 502)
  }
  if (order.items.length === 0) return bad('No items were found on that page', 422)

  if (order.orderNumber && order.orderNumber !== known) {
    const existing = await findExisting(request, order.orderNumber)
    if (existing) return existing
  }

  const warnings = reconcileOrder(order)
  const draft = await prisma.importDraft.create({
    data: {
      source: 'extension',
      supplier: SUPPLIER,
      orderNumber: order.orderNumber,
      sourceUrl: url,
      order: order as unknown as Prisma.InputJsonValue,
      warnings: warnings as unknown as Prisma.InputJsonValue,
      pageItems: items,
    },
    select: { id: true },
  })

  const review = reviewUrl(request, draft.id)
  await sendTelegramMessage(
    importDraftMessage({
      supplier: SUPPLIER,
      orderNumber: order.orderNumber,
      itemCount: order.items.length,
      units: order.items.reduce((n, i) => n + i.quantity, 0),
      grandTotalUsd: order.grandTotal,
      warningCount: warnings.length,
      reviewUrl: review,
    })
  )

  return NextResponse.json({
    status: 'created',
    orderNumber: order.orderNumber,
    draftId: draft.id,
    itemCount: order.items.length,
    warningCount: warnings.length,
    url: review,
  })
}
