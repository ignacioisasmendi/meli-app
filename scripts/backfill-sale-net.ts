import { PrismaClient, type MercadoLibreAccount } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

/**
 * Re-books existing sales on what ML actually paid out.
 *
 * Sales used to store `payments[].shipping_cost` — what the BUYER paid, 0 on
 * free shipping — and no taxes, so their profit ran on more than ML pays out.
 * For each sale this reads the Mercado Pago payout (fee, shipping, taxes,
 * `net_received_amount`) and the pack id (the "Venta #"), then recomputes profit
 * at the USD/ARS rate the sale was originally booked at. That rate isn't stored,
 * but it falls out of the old figures:
 * `profit + cost = netReceivedArs / rate`.
 *
 * Reversals scale with the profit they backed out, so a half-returned sale stays
 * half-returned.
 *
 * Usage: npx tsx --env-file=.env scripts/backfill-sale-net.ts [--apply]
 * Without --apply it only prints what would change.
 */

const ML_API_BASE = 'https://api.mercadolibre.com'
const MP_API_BASE = 'https://api.mercadopago.com'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const tokens = new Map<string, string>()

/** Access token per account, refreshed once if it's expired. */
async function tokenFor(account: MercadoLibreAccount): Promise<string> {
  const cached = tokens.get(account.id)
  if (cached) return cached
  let token = account.accessToken
  if (account.expiresAt.getTime() - Date.now() < 10 * 60 * 1000) {
    const res = await fetch(`${ML_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.ML_CLIENT_ID!,
        client_secret: process.env.ML_CLIENT_SECRET!,
        refresh_token: account.refreshToken,
      }),
    })
    if (!res.ok) throw new Error(`token refresh failed for ${account.nickname}: ${res.status}`)
    const data = (await res.json()) as {
      access_token: string
      refresh_token: string
      expires_in: number
    }
    await prisma.mercadoLibreAccount.update({
      where: { id: account.id },
      data: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
      },
    })
    token = data.access_token
  }
  tokens.set(account.id, token)
  return token
}

async function get<T>(token: string, path: string, base = ML_API_BASE): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`GET ${path} failed (${res.status})`)
  return res.json() as Promise<T>
}

/** Mirrors `getOrderPayout` + `saleNumberOf` in lib/mercadolibre/client.ts. */
async function readOrder(token: string, mlOrderId: string) {
  const order = await get<{
    id: number
    pack_id?: number | null
    payments?: Array<{ id?: number; status?: string }>
  }>(token, `/orders/${mlOrderId}`)
  const saleNumber = String(order.pack_id ?? order.id)

  const payout = { feeArs: 0, shippingArs: 0, taxArs: 0, netReceivedArs: 0 }
  const approved = (order.payments ?? []).filter((p) => p.status === 'approved' && p.id)
  if (approved.length === 0) throw new Error('no approved payment')
  for (const { id } of approved) {
    const payment = await get<{
      transaction_details?: { net_received_amount?: number | null }
      charges_details?: Array<{
        type: string
        accounts?: { from?: string }
        amounts?: { original?: number }
      }>
    }>(token, `/v1/payments/${id}`, MP_API_BASE)
    const net = payment.transaction_details?.net_received_amount
    if (typeof net !== 'number') throw new Error(`payment ${id} has no net_received_amount`)
    payout.netReceivedArs += net
    for (const charge of payment.charges_details ?? []) {
      if (charge.accounts?.from && charge.accounts.from !== 'collector') continue
      const amount = charge.amounts?.original ?? 0
      if (charge.type === 'fee') payout.feeArs += amount
      else if (charge.type === 'shipping') payout.shippingArs += amount
      else if (charge.type === 'tax') payout.taxArs += amount
    }
  }
  return { saleNumber, ...payout }
}

async function fallbackRate(): Promise<number> {
  const setting = await prisma.setting.findUnique({ where: { key: 'usdArsRate' } })
  const rate = Number(setting?.value ?? process.env.USD_ARS_RATE)
  if (!(rate > 0)) throw new Error('No usdArsRate setting or USD_ARS_RATE env to fall back on')
  return rate
}

async function main() {
  const apply = process.argv.includes('--apply')
  const defaultRate = await fallbackRate()
  const sales = await prisma.sale.findMany({ include: { account: true }, orderBy: { soldAt: 'asc' } })

  let changed = 0
  let failed = 0
  for (const sale of sales) {
    let fresh: Awaited<ReturnType<typeof readOrder>>
    try {
      fresh = await readOrder(await tokenFor(sale.account), sale.mlOrderId)
    } catch (err) {
      failed++
      console.warn(`✗ ${sale.mlOrderId}: ${err instanceof Error ? err.message : err}`)
      continue
    }

    // `netReceivedArs` is whatever the stored profit was computed from — the
    // migration seeds it with the old formula — so the rate comes out right on a
    // re-run too.
    const oldRevenueUsd = sale.profitUsd + sale.costUsd
    const rate =
      oldRevenueUsd > 0 && sale.netReceivedArs > 0
        ? sale.netReceivedArs / oldRevenueUsd
        : defaultRate

    const profitUsd = fresh.netReceivedArs / rate - sale.costUsd
    const profitDelta = profitUsd - sale.profitUsd
    const reversedFraction = sale.quantity > 0 ? sale.returnedQuantity / sale.quantity : 0

    if (
      fresh.saleNumber === sale.saleNumber &&
      Math.abs(fresh.netReceivedArs - sale.netReceivedArs) < 0.01 &&
      Math.abs(fresh.feeArs - sale.feeArs) < 0.01 &&
      Math.abs(fresh.shippingArs - sale.shippingArs) < 0.01 &&
      Math.abs(fresh.taxArs - sale.taxArs) < 0.01
    ) {
      continue
    }
    changed++
    console.log(
      `${sale.mlOrderId} → venta #${fresh.saleNumber} | recibido ${sale.netReceivedArs.toFixed(2)} → ${fresh.netReceivedArs.toFixed(2)} ARS ` +
        `(comisión ${fresh.feeArs.toFixed(2)}, envío ${fresh.shippingArs.toFixed(2)}, impuestos ${fresh.taxArs.toFixed(2)}) | ` +
        `profit ${sale.profitUsd.toFixed(2)} → ${profitUsd.toFixed(2)} USD (rate ${rate.toFixed(2)})`
    )

    if (apply) {
      await prisma.sale.update({
        where: { id: sale.id },
        data: {
          saleNumber: fresh.saleNumber,
          feeArs: fresh.feeArs,
          shippingArs: fresh.shippingArs,
          taxArs: fresh.taxArs,
          netReceivedArs: fresh.netReceivedArs,
          profitUsd,
          reversedProfitUsd: { increment: profitDelta * reversedFraction },
        },
      })
    }
  }

  console.log(
    `\n${sales.length} sales, ${changed} ${apply ? 'updated' : 'would change'}, ${failed} failed.` +
      (apply ? '' : ' Re-run with --apply to write.')
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
