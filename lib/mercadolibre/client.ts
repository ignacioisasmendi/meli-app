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
  date_created: string
  date_closed?: string
  total_amount: number
  order_items: MlOrderItem[]
  payments?: Array<{ shipping_cost?: number }>
  shipping?: { id?: number }
}

export const getOrder = (account: MercadoLibreAccount, orderId: string) =>
  mlGet<MlOrder>(account, `/orders/${orderId}`)

export const getItem = (account: MercadoLibreAccount, itemId: string) =>
  mlGet<{ id: string; title: string; seller_custom_field?: string }>(
    account,
    `/items/${itemId}`
  )

export const getShipment = (account: MercadoLibreAccount, shipmentId: string) =>
  mlGet<{ id: number; status: string }>(account, `/shipments/${shipmentId}`)

/** Page of the seller's item ids for the account. */
export const getSellerItemIds = (account: MercadoLibreAccount, offset = 0, limit = 50) =>
  mlGet<{ results: string[]; paging: { total: number } }>(
    account,
    `/users/${account.mlUserId}/items/search?offset=${offset}&limit=${limit}`
  )
