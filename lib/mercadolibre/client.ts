import 'server-only'
import type { MercadoLibreAccount } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ML_API_BASE, refreshAccessToken } from '@/lib/mercadolibre/oauth'

// Refresh when the token expires within this window.
const REFRESH_SKEW_MS = 10 * 60 * 1000

/**
 * Returns a valid access token for the account, refreshing and persisting a new
 * one if the current token is expired or about to expire.
 */
export async function getValidAccessToken(account: MercadoLibreAccount): Promise<string> {
  const aboutToExpire = account.expiresAt.getTime() - Date.now() < REFRESH_SKEW_MS
  if (!aboutToExpire) return account.accessToken

  const token = await refreshAccessToken(account.refreshToken)
  await prisma.mercadoLibreAccount.update({
    where: { id: account.id },
    data: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
    },
  })
  return token.access_token
}

/** Authenticated GET against the ML API for a given account. */
export async function mlGet<T = unknown>(
  account: MercadoLibreAccount,
  path: string
): Promise<T> {
  const accessToken = await getValidAccessToken(account)
  const res = await fetch(`${ML_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`ML GET ${path} failed (${res.status}): ${text.slice(0, 300)}`)
  }
  return res.json()
}

// ── Typed resource helpers ──────────────────────────────────────────────────

export interface MlOrderItem {
  item: { id: string; title: string; seller_sku?: string }
  quantity: number
  unit_price: number
  sale_fee?: number
}

export interface MlOrder {
  id: number
  status: string
  /// Why the order is in `status` — populated with the cancellation reason when
  /// `status === 'cancelled'`.
  status_detail?: string | { code?: string; description?: string } | null
  date_created: string
  date_closed?: string
  total_amount: number
  /// Set when the buyer checked out a cart: every order in it shares the pack,
  /// and ML shows the pack id to the seller as the sale number.
  pack_id?: number | null
  order_items: MlOrderItem[]
  payments?: Array<{ id?: number; shipping_cost?: number; status?: string }>
  shipping?: { id?: number }
}

export const getOrder = (account: MercadoLibreAccount, orderId: string) =>
  mlGet<MlOrder>(account, `/orders/${orderId}`)

/** ML reports the cancellation reason as either a bare string or an object. */
export function orderStatusDetail(order: MlOrder): string | undefined {
  const detail = order.status_detail
  if (!detail) return undefined
  if (typeof detail === 'string') return detail
  return detail.description ?? detail.code ?? undefined
}

// ── Post-purchase claims ────────────────────────────────────────────────────
//
// A return after delivery does NOT flip the order to `cancelled` — the order
// stays closed and the whole story lives in a claim. So returns have to be read
// from `/post-purchase/v1/claims`, not from order status.

/** Claim types that mean money goes back to the buyer. */
export type MlClaimType =
  | 'mediations'
  | 'return'
  | 'fulfillment'
  | 'ml_case'
  | 'cancel_sale'
  | 'cancel_purchase'
  | 'change'
  | 'service'

export interface MlClaim {
  id: number
  /// The order/shipment/payment the claim is about; pair with `resource`.
  resource_id: number
  resource: string
  status: 'opened' | 'closed' | string
  type: MlClaimType | string
  stage?: string
  /// Units under claim. Absent on older claims — treat as the whole order.
  claimed_quantity?: number | null
  /// 'partial' | 'total'
  quantity_type?: string | null
  reason_id?: string | null
  fulfilled?: boolean | null
  players?: Array<{ role?: string; user_id?: number; type?: string }>
}

export const getClaim = (account: MercadoLibreAccount, claimId: string) =>
  mlGet<MlClaim>(account, `/post-purchase/v1/claims/${claimId}`)

export interface MlExpectedResolution {
  player_role?: string
  user_id?: number
  /// 'refund' | 'product' | 'change_product' | 'return_product'
  expected_resolution?: string
  status?: string
  date_created?: string
}

/**
 * What the parties asked for. This is how we tell a refund-and-keep-it from a
 * send-it-back: `return_product` / `change_product` mean goods are coming, a
 * bare `refund` means only money moves.
 */
export const getClaimExpectedResolutions = (
  account: MercadoLibreAccount,
  claimId: string
) =>
  mlGet<MlExpectedResolution[]>(
    account,
    `/post-purchase/v1/claims/${claimId}/expected-resolutions`
  )

interface MlItemRaw {
  id: string
  title: string
  seller_custom_field?: string | null
  attributes?: Array<{ id: string; value_name?: string | null }>
  pictures?: Array<{ id?: string; secure_url?: string | null; url?: string | null }>
  secure_thumbnail?: string | null
  thumbnail?: string | null
  /// The item's id in ML's Full inventory system. Absent for items that were
  /// never enrolled in Fulfillment.
  inventory_id?: string | null
}

/**
 * Fetches an item and normalizes its seller SKU. ML exposes the SKU either in
 * the legacy `seller_custom_field` or as the `SELLER_SKU` attribute (newer
 * listings use the attribute), so we read both and prefer whichever is set.
 *
 * `imageUrl` is the listing's main picture. We take `pictures[0]` over the
 * thumbnail fields because those are ~100px and look soft on a retina screen,
 * whereas the full-size picture is downscaled cleanly by `next/image`. Always
 * the https variant — the app is served over TLS and mixed content is blocked.
 */
export async function getItem(account: MercadoLibreAccount, itemId: string) {
  const raw = await mlGet<MlItemRaw>(account, `/items/${itemId}`)
  const attrSku = raw.attributes?.find((a) => a.id === 'SELLER_SKU')?.value_name
  const picture = raw.pictures?.[0]
  return {
    id: raw.id,
    title: raw.title,
    seller_custom_field: raw.seller_custom_field ?? attrSku ?? null,
    imageUrl: toHttps(picture?.secure_url ?? picture?.url ?? raw.secure_thumbnail ?? raw.thumbnail),
    inventoryId: raw.inventory_id ?? null,
  }
}

/** ML still hands out plain-http image urls on some older listings. */
function toHttps(url: string | null | undefined): string | null {
  if (!url) return null
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url
}

export const getShipment = (account: MercadoLibreAccount, shipmentId: string) =>
  mlGet<{ id: number; status: string }>(account, `/shipments/${shipmentId}`)

/** The number ML shows the seller as "Venta #" for this order. */
export function saleNumberOf(order: MlOrder): string {
  return String(order.pack_id ?? order.id)
}

// ── Payout (Mercado Pago) ───────────────────────────────────────────────────

const MP_API_BASE = 'https://api.mercadopago.com'

interface MpPayment {
  id: number
  status: string
  transaction_amount: number
  transaction_details?: { net_received_amount?: number | null }
  charges_details?: Array<{
    type: string
    accounts?: { from?: string; to?: string }
    amounts?: { original?: number; refunded?: number }
  }>
}

export interface OrderPayout {
  /** What the buyer paid for the goods. */
  grossArs: number
  /** ML's selling fee. */
  feeArs: number
  /** Shipping charged to the seller. */
  shippingArs: number
  /** Taxes withheld (e.g. the IIBB retention). */
  taxArs: number
  /** What lands in the account, after every charge. */
  netReceivedArs: number
}

/**
 * What the seller actually receives for an order, read from its Mercado Pago
 * payments — the only place that carries every deduction:
 *
 *   transaction_amount     148617.00
 *   charges_details  fee   −23035.64   (to ml)
 *                    ship   −6790.00
 *                    tax    −7430.85   (to mp)
 *   net_received_amount    111360.51
 *
 * The order alone can't give this: its `payments[].shipping_cost` is what the
 * BUYER paid (0 on free shipping) and it knows nothing about taxes. The ML
 * access token is accepted by the MP API for the same user. Only charges the
 * seller (`collector`) pays count; a pack bills each order on its own payment,
 * so nothing has to be split.
 *
 * Returns null while no payment is approved yet — ML notifies again once it is.
 */
export async function getOrderPayout(
  account: MercadoLibreAccount,
  order: MlOrder
): Promise<OrderPayout | null> {
  const accessToken = await getValidAccessToken(account)
  const approved = (order.payments ?? []).filter((p) => p.status === 'approved' && p.id)
  if (approved.length === 0) return null

  const payout: OrderPayout = { grossArs: 0, feeArs: 0, shippingArs: 0, taxArs: 0, netReceivedArs: 0 }
  for (const { id } of approved) {
    const res = await fetch(`${MP_API_BASE}/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`MP GET payment ${id} failed (${res.status}): ${text.slice(0, 300)}`)
    }
    const payment: MpPayment = await res.json()
    const net = payment.transaction_details?.net_received_amount
    // Without it we'd be guessing the payout, which is the thing this exists to avoid.
    if (typeof net !== 'number') throw new Error(`MP payment ${id} has no net_received_amount`)

    payout.grossArs += payment.transaction_amount
    payout.netReceivedArs += net
    for (const charge of payment.charges_details ?? []) {
      if (charge.accounts?.from && charge.accounts.from !== 'collector') continue
      const amount = charge.amounts?.original ?? 0
      if (charge.type === 'fee') payout.feeArs += amount
      else if (charge.type === 'shipping') payout.shippingArs += amount
      else if (charge.type === 'tax') payout.taxArs += amount
    }
  }
  return payout
}

/** Page of the seller's item ids for the account. */
export const getSellerItemIds = (account: MercadoLibreAccount, offset = 0, limit = 50) =>
  mlGet<{ results: string[]; paging: { total: number } }>(
    account,
    `/users/${account.mlUserId}/items/search?offset=${offset}&limit=${limit}`
  )

// ── Fulfillment (Full) stock ────────────────────────────────────────────────

export interface MlFulfillmentStock {
  inventory_id: string
  total: number
  available_quantity: number
  not_available_quantity: number
  not_available_detail: Array<{ status: string; quantity: number }>
}

/** Current stock across all Full warehouses for one inventory_id. */
export const getFulfillmentStock = (account: MercadoLibreAccount, inventoryId: string) =>
  mlGet<MlFulfillmentStock>(account, `/inventories/${inventoryId}/stock/fulfillment`)

export interface MlFulfillmentOperation {
  id: number
  seller_id: number
  inventory_id: string
  date_created: string
  type: string
  external_references?: Array<{ type: string; value: string }>
}

export interface MlFulfillmentOperationsSearch {
  paging: { total: number; scroll?: string | null }
  results: MlFulfillmentOperation[]
}

/**
 * Stock operations (sales, adjustments, inbound receptions...) for one or more
 * inventory_ids. `type: 'INBOUND_RECEPTION'` is what confirms a Full shipment
 * arrived — its `external_references` then carry `{ type: 'inbound_id', value }`,
 * the same id the seller panel handed out when the inbound was created.
 *
 * ML defaults `date_from`/`date_to` to the last 15 days when omitted, so a
 * shipment sent longer ago than that must pass explicit dates.
 */
export const searchFulfillmentOperations = (
  account: MercadoLibreAccount,
  params: { inventoryIds: string[]; type?: string; dateFrom?: string; dateTo?: string }
) => {
  const qs = new URLSearchParams({
    seller_id: account.mlUserId,
    inventory_id: params.inventoryIds.join(','),
  })
  if (params.type) qs.set('type', params.type)
  if (params.dateFrom) qs.set('date_from', params.dateFrom)
  if (params.dateTo) qs.set('date_to', params.dateTo)
  return mlGet<MlFulfillmentOperationsSearch>(
    account,
    `/stock/fulfillment/operations/search?${qs}`
  )
}
