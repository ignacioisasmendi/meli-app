/**
 * Reader for the bulk purchase import: a JSON array of supplier orders pasted
 * (or loaded from a file) in one go. Dependency-free apart from Zod, so the
 * client parses and previews before anything reaches the server.
 */

import { z } from 'zod'
import { toIsoDate, toNumber } from '@/lib/imports/amazon-order'

export const MAX_BULK_ORDERS = 100

export interface BulkOrderItem {
  name: string
  /** Optional SKU: maps onto that product if it exists, else becomes the new product's SKU. */
  sku: string | null
  quantity: number
  /**
   * What ONE unit actually cost before tax and shipping: the list price less
   * this item's share of the order discount. This is what gets imported.
   */
  unitPrice: number
  /** Price for ONE unit as listed, before the discount. */
  listPrice: number
}

export interface BulkOrder {
  orderNumber: string | null
  supplier: string
  /** ISO `YYYY-MM-DD`. */
  purchasedAt: string | null
  /** ISO `YYYY-MM-DD`, when the whole order already reached the courier. */
  arrivedAt: string | null
  /** ISO `YYYY-MM-DD`, best guess of when it reaches the courier. */
  estimatedArrivalAt: string | null
  /** Order-level discount (promo, coupon, subscribe & save), already folded into `unitPrice`. */
  discount: number
  tax: number
  shipping: number
  items: BulkOrderItem[]
  /** Totals that don't add up — worth a look before importing. */
  warnings: BulkWarning[]
}

/** Structured reconciliation warning — translated at the render site. */
export type BulkWarning =
  | { code: 'subtotalMismatch'; lineSum: number; itemsSubtotal: number }
  | { code: 'grandTotalMismatch'; computed: number; grandTotal: number }
  | { code: 'unexpectedCurrency'; currency: string }

/** The shape documented on the page, ready to copy as a starting point. */
export const BULK_EXAMPLE = `[
  {
    "orderNumber": "111-1234567-1234567",
    "supplier": "Amazon",
    "purchasedAt": "2026-09-01",
    "estimatedArrivalAt": "2026-09-15",
    "discount": 0,
    "tax": 12.5,
    "shipping": 0,
    "items": [
      { "name": "DJI Mic Mini (1 TX + 1 RX)", "sku": "DJI-MIC-MINI", "quantity": 2, "unitPrice": 79 },
      { "name": "Anker 737 Power Bank", "quantity": 1, "unitPrice": 99.99 }
    ]
  }
]`

const optionalText = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() || null : typeof v === 'number' ? String(v) : null),
  z.string().nullable()
)
// A date that can't be read is an error, not "today": booking a purchase on the
// wrong day would quietly skew every report that reads it.
const optionalDate = z.preprocess(
  (v) => (v == null || v === '' ? null : (toIsoDate(v) ?? 'invalid')),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'is not a date (use YYYY-MM-DD)').nullable()
)
const money = z.preprocess(
  (v) => (v == null || v === '' ? 0 : toNumber(v)),
  z.number({ invalid_type_error: 'must be a number' }).min(0, 'cannot be negative')
)

const orderSchema = z.object({
  orderNumber: optionalText,
  supplier: optionalText.transform((s) => s ?? 'Amazon'),
  purchasedAt: optionalDate,
  arrivedAt: optionalDate,
  estimatedArrivalAt: optionalDate,
  // Accepted as 24.99 or -24.99: either way it comes off the goods.
  discount: z.preprocess((v) => {
    const n = v == null || v === '' ? 0 : toNumber(v)
    return typeof n === 'number' ? Math.abs(n) : n
  }, z.number({ invalid_type_error: 'must be a number' })),
  tax: money,
  shipping: money,
  // Only used to cross-check the lines; never imported.
  itemsSubtotal: z.preprocess(toNumber, z.number().nullable()).catch(null).default(null),
  grandTotal: z.preprocess(toNumber, z.number().nullable()).catch(null).default(null),
  currency: z
    .preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() || 'USD' : 'USD'), z.string())
    .default('USD'),
  items: z
    .array(
      z.object({
        name: z.string({ required_error: 'needs a "name"' }).trim().min(1, 'needs a "name"'),
        sku: optionalText,
        quantity: z.preprocess(
          (v) => (v == null ? 1 : toNumber(v)),
          z.number({ invalid_type_error: '"quantity" must be a number' }).int('"quantity" must be a whole number').min(1, '"quantity" must be at least 1')
        ),
        unitPrice: z.preprocess(
          toNumber,
          z
            .number({ required_error: 'needs a "unitPrice"', invalid_type_error: '"unitPrice" must be a number' })
            .positive('"unitPrice" must be above 0')
        ),
      })
    )
    .min(1, 'has no "items"'),
})

export type BulkParseResult = { ok: true; orders: BulkOrder[] } | { ok: false; error: string }

/** "orders[2].items[0].unitPrice: …" → "Order 3, item 1: …" */
function describeIssue(issue: z.ZodIssue): string {
  const [orderIndex, head, itemIndex] = issue.path
  const parts: string[] = []
  if (typeof orderIndex === 'number') parts.push(`Order ${orderIndex + 1}`)
  if (head === 'items' && typeof itemIndex === 'number') parts.push(`item ${itemIndex + 1}`)
  else if (typeof head === 'string' && head !== 'items') parts.push(`"${head}"`)
  return parts.length ? `${parts.join(', ')}: ${issue.message}` : issue.message
}

/**
 * Accepts a top-level array of orders, `{ "orders": [...] }`, or a single order
 * object, optionally wrapped in a ```json fence. Every problem is reported
 * against the order/item it sits in so the fix is obvious.
 */
export function parseBulkOrders(text: string): BulkParseResult {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced ? fenced[1] : text).trim()
  if (!body) return { ok: false, error: 'Paste some JSON first' }

  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch (err) {
    return { ok: false, error: `Invalid JSON — ${err instanceof Error ? err.message : 'parse error'}` }
  }

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    raw = Array.isArray((raw as { orders?: unknown }).orders)
      ? (raw as { orders: unknown[] }).orders
      : [raw]
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'Expected an array with at least one order' }
  }
  if (raw.length > MAX_BULK_ORDERS) {
    return { ok: false, error: `At most ${MAX_BULK_ORDERS} orders per import (got ${raw.length})` }
  }

  const parsed = z.array(orderSchema).safeParse(raw)
  if (!parsed.success) return { ok: false, error: describeIssue(parsed.error.issues[0]) }

  const orders: BulkOrder[] = []
  for (const [index, o] of parsed.data.entries()) {
    const { itemsSubtotal, grandTotal, currency, ...order } = o
    const listPrices = order.items.map((i) => round2(i.unitPrice))
    const values = order.items.map((i, n) => listPrices[n] * i.quantity)
    const lineSum = round2(values.reduce((s, v) => s + v, 0))
    const discount = round2(order.discount)
    if (discount >= lineSum) {
      return { ok: false, error: `Order ${index + 1}: "discount" is not below the items' total` }
    }

    const shares = splitByValue(discount, values)
    const items = order.items.map((i, n) => ({
      ...i,
      listPrice: listPrices[n],
      // Four decimals so price × quantity lands back on the discounted cents.
      unitPrice: round4((values[n] - shares[n]) / i.quantity),
    }))
    const tax = round2(order.tax)
    const shipping = round2(order.shipping)

    const warnings: BulkWarning[] = []
    if (itemsSubtotal != null && Math.abs(lineSum - itemsSubtotal) > 0.02) {
      warnings.push({ code: 'subtotalMismatch', lineSum, itemsSubtotal })
    }
    if (grandTotal != null) {
      const computed = round2(lineSum - discount + tax + shipping)
      if (Math.abs(computed - grandTotal) > 0.02) {
        warnings.push({ code: 'grandTotalMismatch', computed, grandTotal })
      }
    }
    if (currency !== 'USD') warnings.push({ code: 'unexpectedCurrency', currency })

    orders.push({ ...order, discount, tax, shipping, items, warnings })
  }
  return { ok: true, orders }
}

const round2 = (n: number) => Math.round(n * 100) / 100
const round4 = (n: number) => Math.round(n * 10000) / 10000

/**
 * Splits the discount across items by value, in cents, with the rounding
 * residual on the largest item so the shares add back to the discount exactly.
 */
function splitByValue(amount: number, values: number[]): number[] {
  const total = values.reduce((s, v) => s + v, 0)
  if (amount <= 0 || total <= 0) return values.map(() => 0)
  const parts = values.map((v) => round2((amount * v) / total))
  const drift = round2(amount - parts.reduce((s, p) => s + p, 0))
  if (drift !== 0) {
    const biggest = values.reduce((best, v, i) => (v > values[best] ? i : best), 0)
    parts[biggest] = round2(parts[biggest] + drift)
  }
  return parts
}
