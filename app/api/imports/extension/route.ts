import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ImportDraftStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ASIN_PATTERN, normalizeOrder, reconcileOrder } from '@/lib/imports/amazon-order'
import { sendTelegramMessage } from '@/lib/telegram/client'
import { importDraftMessage } from '@/lib/telegram/messages'

export const dynamic = 'force-dynamic'

const SUPPLIER = 'Amazon'
const ORDER_NUMBER = /^\d{3}-\d{7}-\d{7}$/

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

const money = z.number().finite().nullable()

/**
 * The order as the extension read it off the page (`extension/parse-order.js`)
 * — the same shape as `ParsedOrder`, with each item's ASIN from its link.
 */
const orderSchema = z.object({
  orderNumber: z.string().regex(ORDER_NUMBER, 'Invalid order number').nullable(),
  purchasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  itemsSubtotal: money,
  tax: money,
  shipping: money,
  grandTotal: money,
  currency: z.string().max(3),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        fullTitle: z.string().trim().max(500),
        quantity: z.number().int().positive().max(10_000),
        unitPrice: z.number().positive('Every item needs a price'),
        seller: z.string().max(200).nullable(),
        asin: z.string().regex(ASIN_PATTERN).nullable(),
      })
    )
    .min(1, 'No items were found on that page')
    .max(100),
})

const payloadSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => /(^|\.)amazon\.com$/.test(new URL(u).hostname), 'Not an amazon.com page'),
  order: orderSchema,
})

/** Where the user lands to review a draft. */
function reviewUrl(request: NextRequest, draftId: string): string {
  const base = process.env.APP_BASE_URL ?? request.nextUrl.origin
  return `${base}/purchases/import?draft=${draftId}`
}

/**
 * Tells an order already dealt with apart from a new one, so pressing the
 * button twice never makes a second draft.
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
 * Receives an order the browser extension read off an Amazon "Order Details"
 * page, checks its totals and parks it as an `ImportDraft`.
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
  const { url } = parsed.data

  const order = normalizeOrder(parsed.data.order)
  if (order.orderNumber) {
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
      pageItems: order.items.map((i) => ({ asin: i.asin, title: i.fullTitle })),
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
