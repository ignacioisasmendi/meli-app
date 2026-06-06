import { prisma } from '@/lib/prisma'

const USD_ARS_RATE_KEY = 'usdArsRate'

/**
 * Current USD/ARS rate. Reads the `Setting` override first, falling back to the
 * USD_ARS_RATE env var, then a sane default. Used by all profit calculations.
 */
export async function getUsdArsRate(): Promise<number> {
  const setting = await prisma.setting.findUnique({ where: { key: USD_ARS_RATE_KEY } })
  if (setting) {
    const parsed = Number(setting.value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  const envRate = Number(process.env.USD_ARS_RATE)
  return Number.isFinite(envRate) && envRate > 0 ? envRate : 1000
}

export async function setUsdArsRate(rate: number): Promise<void> {
  await prisma.setting.upsert({
    where: { key: USD_ARS_RATE_KEY },
    update: { value: String(rate) },
    create: { key: USD_ARS_RATE_KEY, value: String(rate) },
  })
}
