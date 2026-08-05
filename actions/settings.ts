'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUser } from '@/lib/session'
import { setUsdArsRate, refreshSaldoRate } from '@/lib/settings'
import type { ActionResult } from '@/actions/products'

const rateSchema = z.object({
  usdArsRate: z.coerce.number().positive('Rate must be positive'),
})

export async function updateUsdArsRate(formData: FormData): Promise<ActionResult> {
  await requireUser()
  const parsed = rateSchema.safeParse({ usdArsRate: formData.get('usdArsRate') })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  await setUsdArsRate(parsed.data.usdArsRate)
  revalidatePath('/settings')
  revalidatePath('/dashboard')
  return { ok: true }
}

/** Pulls a fresh USD/ARS rate from Saldo (buy leg) into the daily cache. */
export async function refreshRate(): Promise<ActionResult> {
  await requireUser()
  try {
    await refreshSaldoRate()
  } catch {
    return { ok: false, error: 'Could not reach Saldo. Using the last known rate.' }
  }
  revalidatePath('/settings')
  revalidatePath('/dashboard')
  return { ok: true }
}
