import { getUsdArsRate } from '@/lib/settings'

export interface ProfitInput {
  /** What ML actually pays out: gross minus fee, shipping and taxes. */
  netReceivedArs: number
  /** Cost of goods sold, in USD (from FIFO batch consumption). */
  costUsd: number
}

export interface ProfitResult {
  profitUsd: number
  revenueUsd: number
  costUsd: number
  marginPct: number
}

/**
 * profitUsd = toUsd(netReceivedArs) − costUsd
 * The ARS→USD conversion uses the current rate (Setting override or env).
 */
export function computeProfit(input: ProfitInput, usdArsRate: number): ProfitResult {
  const revenueUsd = input.netReceivedArs / usdArsRate
  const profitUsd = revenueUsd - input.costUsd
  const marginPct = revenueUsd > 0 ? (profitUsd / revenueUsd) * 100 : 0
  return { profitUsd, revenueUsd, costUsd: input.costUsd, marginPct }
}

/** Convenience wrapper that loads the current USD/ARS rate. */
export async function computeProfitWithRate(input: ProfitInput): Promise<ProfitResult> {
  const rate = await getUsdArsRate()
  return computeProfit(input, rate)
}

export function roi(profitUsd: number, costUsd: number): number {
  return costUsd > 0 ? (profitUsd / costUsd) * 100 : 0
}
