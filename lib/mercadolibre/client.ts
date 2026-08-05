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
  order_items: MlOrderItem[]
  payments?: Array<{ shipping_cost?: number; status?: string }>
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
  }
}

/** ML still hands out plain-http image urls on some older listings. */
function toHttps(url: string | null | undefined): string | null {
  if (!url) return null
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url
}

export const getShipment = (account: MercadoLibreAccount, shipmentId: string) =>
  mlGet<{ id: number; status: string }>(account, `/shipments/${shipmentId}`)

/** Page of the seller's item ids for the account. */
export const getSellerItemIds = (account: MercadoLibreAccount, offset = 0, limit = 50) =>
  mlGet<{ results: string[]; paging: { total: number } }>(
    account,
    `/users/${account.mlUserId}/items/search?offset=${offset}&limit=${limit}`
  )
