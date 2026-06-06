import { prisma } from '@/lib/prisma'
import { getZelleArsRate } from '@/lib/saldo/client'

const USD_ARS_RATE_KEY = 'usdArsRate' // manual fallback override
const SALDO_RATE_KEY = 'saldoZelleRate' // last auto-fetched Saldo→Zelle buy rate
const SALDO_RATE_DATE_KEY = 'saldoZelleRateDate' // AR date (YYYY-MM-DD) of that value
const DEFAULT_RATE = 1000

/** Today's date in Argentina, as YYYY-MM-DD (en-CA formats that way). */
function argentinaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date())
}

async function readNumber(key: string): Promise<number | null> {
  const setting = await prisma.setting.findUnique({ where: { key } })
  if (!setting) return null
  const parsed = Number(setting.value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

async function writeSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

/**
 * Current USD/ARS rate used by all profit calculations.
 *
 * Primary source is the live Saldo→Zelle buy rate (what it actually costs to buy
 * USD via Zelle), refreshed at most once per Argentina day and cached in
 * `Setting`. If the Saldo API is unavailable, falls back to the last cached
 * value, then the manual `usdArsRate` override, then `USD_ARS_RATE`, then a
 * default.
 */
export async function getUsdArsRate(): Promise<number> {
  const today = argentinaToday()

  const [cached, cachedDate] = await Promise.all([
    readNumber(SALDO_RATE_KEY),
    prisma.setting.findUnique({ where: { key: SALDO_RATE_DATE_KEY } }),
  ])
  if (cached && cachedDate?.value === today) return cached

  try {
    const { buyUsdArs } = await getZelleArsRate()
    if (Number.isFinite(buyUsdArs) && buyUsdArs > 0) {
      await Promise.all([
        writeSetting(SALDO_RATE_KEY, String(buyUsdArs)),
        writeSetting(SALDO_RATE_DATE_KEY, today),
      ])
      return buyUsdArs
    }
  } catch (err) {
    console.error('[saldo] rate refresh failed, using fallback:', err)
  }

  // Fallbacks, most-recent first.
  if (cached) return cached
  const manual = await readNumber(USD_ARS_RATE_KEY)
  if (manual) return manual
  const envRate = Number(process.env.USD_ARS_RATE)
  return Number.isFinite(envRate) && envRate > 0 ? envRate : DEFAULT_RATE
}

/** Forces a fresh fetch from Saldo and updates the daily cache. */
export async function refreshSaldoZelleRate(): Promise<number> {
  const { buyUsdArs } = await getZelleArsRate()
  await Promise.all([
    writeSetting(SALDO_RATE_KEY, String(buyUsdArs)),
    writeSetting(SALDO_RATE_DATE_KEY, argentinaToday()),
  ])
  return buyUsdArs
}

/** Manual fallback rate, used only when the Saldo API can't be reached. */
export async function setUsdArsRate(rate: number): Promise<void> {
  await writeSetting(USD_ARS_RATE_KEY, String(rate))
}
