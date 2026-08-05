'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { syncAccountListings } from '@/lib/mercadolibre/sync'
import type { ActionResult } from '@/actions/products'

export async function disconnectAccount(id: string): Promise<ActionResult> {
  await requireUser()
  await prisma.mercadoLibreAccount.update({ where: { id }, data: { isActive: false } })
  revalidatePath('/accounts')
  return { ok: true }
}

export async function syncListings(accountId: string): Promise<ActionResult> {
  await requireUser()
  const account = await prisma.mercadoLibreAccount.findUnique({ where: { id: accountId } })
  if (!account || !account.isActive) return { ok: false, error: 'Account not connected' }
  try {
    const count = await syncAccountListings(account)
    revalidatePath('/accounts')
    // A sync also backfills product images, so the catalog is stale too.
    revalidatePath('/products')
    return { ok: true, count } as ActionResult & { count: number }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Sync failed' }
  }
}

export async function linkListing(
  listingId: string,
  productId: string | null
): Promise<ActionResult> {
  await requireUser()
  await prisma.mlListing.update({ where: { id: listingId }, data: { productId } })
  revalidatePath('/accounts')
  return { ok: true }
}
