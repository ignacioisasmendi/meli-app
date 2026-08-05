/**
 * Shape of an Amazon order read off a screenshot, the checks that decide
 * whether a human should look twice before importing it, and a tolerant reader
 * for JSON pasted in from claude.ai. No Anthropic SDK here, so the client can
 * import it freely — the API extraction lives in `amazon-screenshot.ts`.
 */

import { z } from 'zod'

export interface ParsedOrderItem {
  /** Short catalog-style name (brand + model + variant). */
  name: string
  /** Full listing title exactly as shown, for reference. */
  fullTitle: string
  quantity: number
  /** Price for ONE unit, before tax and shipping. */
  unitPrice: number
  seller: string | null
}

export interface ParsedOrder {
  orderNumber: string | null
  /** ISO `YYYY-MM-DD`, from "Order placed". */
  purchasedAt: string | null
  /** "Item(s) Subtotal" as printed — used to cross-check quantities. */
  itemsSubtotal: number | null
  tax: number | null
  shipping: number | null
  grandTotal: number | null
  /** ISO currency code of the amounts on screen. */
  currency: string
  items: ParsedOrderItem[]
}

export const MAX_SCREENSHOTS = 6
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024

export const SUPPORTED_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const

export type ScreenshotMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number]

export interface Screenshot {
  mediaType: ScreenshotMediaType
  /** Raw base64, no data: prefix. */
  data: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Clamps extracted values into the shapes the import form expects. */
export function normalizeOrder(order: ParsedOrder): ParsedOrder {
  return {
    ...order,
    currency: (order.currency || 'USD').toUpperCase(),
    orderNumber: order.orderNumber?.trim() || null,
    purchasedAt: /^\d{4}-\d{2}-\d{2}$/.test(order.purchasedAt ?? '') ? order.purchasedAt : null,
    tax: order.tax != null ? Math.max(0, round2(order.tax)) : null,
    shipping: order.shipping != null ? Math.max(0, round2(order.shipping)) : null,
    items: (order.items ?? [])
      .filter((i) => i.name?.trim() && i.unitPrice > 0)
      .map((i) => ({
        ...i,
        name: i.name.trim(),
        fullTitle: i.fullTitle?.trim() || i.name.trim(),
        quantity: Math.max(1, Math.round(i.quantity || 1)),
        unitPrice: round2(i.unitPrice),
        seller: i.seller?.trim() || null,
      })),
  }
}

/**
 * Cross-checks the extracted lines against the totals printed on the
 * screenshot. Anything returned here is worth a human's eyes before importing.
 */
export function reconcileOrder(order: ParsedOrder): string[] {
  const warnings: string[] = []

  if (order.items.length === 0) {
    warnings.push('No items were found on that screenshot')
    return warnings
  }

  const lineSum = round2(order.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0))
  if (order.itemsSubtotal != null && Math.abs(lineSum - order.itemsSubtotal) > 0.02) {
    warnings.push(
      `Items add up to $${lineSum.toFixed(2)} but the order subtotal reads $${order.itemsSubtotal.toFixed(2)} — check the quantities`
    )
  }

  if (order.grandTotal != null) {
    const computed = round2(lineSum + (order.tax ?? 0) + (order.shipping ?? 0))
    if (Math.abs(computed - order.grandTotal) > 0.02) {
      warnings.push(
        `Items + tax + shipping is $${computed.toFixed(2)} but the grand total reads $${order.grandTotal.toFixed(2)}`
      )
    }
  }

  if (order.currency !== 'USD') {
    warnings.push(`Amounts look like ${order.currency}, but purchases are recorded in USD`)
  }

  return warnings
}

/* ── Reading JSON pasted back from claude.ai ─────────────────────────────── */

/** "US$1,234.50" / "45.00" / 45 → 45. Left untouched if it isn't number-ish. */
function toNumber(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const cleaned = value.replace(/[^0-9.-]/g, '')
  const n = Number(cleaned)
  return cleaned && Number.isFinite(n) ? n : value
}

/** Accepts "2026-07-28" or anything Date understands ("July 28, 2026"). */
function toIsoDate(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Optional money: anything unreadable degrades to null rather than failing. */
const optionalMoney = z.preprocess(toNumber, z.number().min(0).nullable()).catch(null)
const optionalText = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() || null : (v ?? null)),
  z.string().nullable()
).catch(null)

const pastedOrderSchema = z.object({
  orderNumber: optionalText,
  purchasedAt: z
    .preprocess(toIsoDate, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable())
    .catch(null),
  itemsSubtotal: optionalMoney,
  tax: optionalMoney,
  shipping: optionalMoney,
  grandTotal: optionalMoney,
  currency: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string()).catch('USD'),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'every item needs a "name"'),
        fullTitle: z.string().trim().optional().catch(undefined),
        quantity: z.preprocess(toNumber, z.number().min(1)).catch(1),
        unitPrice: z.preprocess(
          toNumber,
          z.number().positive('every item needs a "unitPrice" above 0')
        ),
        seller: optionalText,
      })
    )
    .min(1, 'The JSON has no "items"'),
})

/** Turns a Zod path into something that points at a row of the pasted order. */
function describeIssue(issue: z.ZodIssue): string {
  const [head, index, field] = issue.path
  if (head === 'items' && typeof index === 'number') {
    const item = `Item ${index + 1}`
    return issue.message === 'Required'
      ? `${item} is missing "${String(field)}"`
      : `${item}: ${issue.message}`
  }
  return issue.message
}

export type PasteResult = { ok: true; order: ParsedOrder } | { ok: false; error: string }

/**
 * Reads the JSON block out of whatever was pasted — claude.ai tends to wrap it
 * in a ```json fence or a sentence or two — and validates it loosely enough to
 * survive small format drift. Field-level problems are reported by name so the
 * fix is obvious.
 */
export function parsePastedOrder(text: string): PasteResult {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced ? fenced[1] : text).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return { ok: false, error: 'No JSON found — paste the whole block, including the { and }' }
  }

  let raw: unknown
  try {
    raw = JSON.parse(body.slice(start, end + 1))
  } catch {
    return { ok: false, error: "That isn't valid JSON — copy Claude's reply again, unedited" }
  }

  const parsed = pastedOrderSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: describeIssue(parsed.error.issues[0]) }
  }

  const { items, ...rest } = parsed.data
  return {
    ok: true,
    order: normalizeOrder({
      ...rest,
      items: items.map((i) => ({ ...i, fullTitle: i.fullTitle ?? i.name })),
    }),
  }
}
