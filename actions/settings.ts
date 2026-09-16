'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { requireUser } from '@/lib/session'
import { setUsdArsRate, refreshSaldoRate } from '@/lib/settings'
import type { ActionResult } from '@/actions/products'
import { LOCALES, LOCALE_COOKIE, type Locale } from '@/i18n/request'

const rateSchema = z.object({
  usdArsRate: z.coerce.number().positive('Rate must be positive'),
})

const localeSchema = z.enum(LOCALES)

/** Sets the UI language for this browser (cookie-based, no per-user record). */
export async function setLocale(locale: Locale): Promise<ActionResult> {
  await requireUser()
  const parsed = localeSchema.safeParse(locale)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid language' }
  }
  const store = await cookies()
  store.set(LOCALE_COOKIE, parsed.data, { path: '/', maxAge: 60 * 60 * 24 * 365 })
  revalidatePath('/')
  return { ok: true }
}

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
