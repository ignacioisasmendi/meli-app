/**
 * The scan funnel: turns raw candidate products into scored, deduped rows.
 *
 * Ordered cheapest-check-first on purpose. Dedupe and the catalog match are
 * local, the price lookup is the expensive step, and the ML fee call only
 * happens for something that already has a price — so a duplicate never costs a
 * network round trip.
 *
 * Every rejection is persisted with its reason. A candidate that failed on
 * margin last week should not be re-evaluated from scratch this week; that is
 * the part of the manual routine that wastes the most effort.
 */

import type { PrismaClient } from '@prisma/client'
import { OpportunityStatus } from '@prisma/client'
import { matchProduct, type ProductCandidate } from '@/lib/imports/match-product'
import { computeMargin, type MarginResult } from '@/lib/opportunities/margin'
import { getSaleFee } from '@/lib/opportunities/ml-fees'
import { getFreightUsdPerKg, type FreightRate } from '@/lib/opportunities/freight-rate'
import {
  lookupShippingCost,
  readShippingTable,
  type ShippingTable,
} from '@/lib/opportunities/shipping-cost'
import { manualKey, type MlPriceSource } from '@/lib/opportunities/price-source'

export interface CandidateInput {
  asin?: string
  title: string
  brand: string
  model?: string
  amazonPriceUsd: number
  amazonTaxUsd?: number
  weightGrams: number
}

/** Sale price bounds — outside these a product isn't worth the logistics. */
export interface ScanBounds {
  minMlPriceArs: number
  maxMlPriceArs: number
  /** Below this return on cost, a candidate is rejected outright. */
  minRoiPct: number
}

export const DEFAULT_BOUNDS: ScanBounds = {
  minMlPriceArs: 70_000,
  maxMlPriceArs: 900_000,
  minRoiPct: 30,
}

export type ScanVerdict =
  | 'ACCEPTED'
  | 'DUPLICATE'
  | 'NO_ML_PRICE'
  | 'PRICE_OUT_OF_RANGE'
  | 'MISSING_WEIGHT'
  | 'LOW_MARGIN'

export interface ScanRow {
  input: CandidateInput
  modelKey: string
  verdict: ScanVerdict
  detail?: string
  margin?: MarginResult
  mlPriceArs?: number
  /** Set when the candidate is something already in the catalog. */
  matchedProductId?: string
  candidateId?: string
}

export interface ScanContext {
  usdArsRate: number
  freight: FreightRate
  shippingTable: ShippingTable | null
}

export interface ScanResult {
  rows: ScanRow[]
  context: ScanContext
}

export interface ScanOptions {
  /**
   * ARS per USD. Passed in rather than read here so this module stays free of
   * `server-only` imports and runs under plain `tsx`; the app hands it
   * `getUsdArsRate()`.
   */
  usdArsRate: number
  bounds?: ScanBounds
}

/** Normalized dedupe key: brand + model, punctuation and casing removed. */
export function modelKeyFor(brand: string, model: string): string {
  return manualKey(brand, model)
}

export async function scanCandidates(
  prisma: PrismaClient,
  accessToken: string,
  inputs: CandidateInput[],
  priceSource: MlPriceSource,
  options: ScanOptions
): Promise<ScanResult> {
  const { usdArsRate, bounds = DEFAULT_BOUNDS } = options

  const [freight, shippingTable, known, catalog] = await Promise.all([
    getFreightUsdPerKg(prisma),
    readShippingTable(prisma),
    prisma.opportunityCandidate.findMany({ select: { modelKey: true } }),
    prisma.product.findMany({
      where: { archived: false },
      select: { id: true, name: true, sku: true },
    }),
  ])

  const context: ScanContext = { usdArsRate, freight, shippingTable }
  const seen = new Set(known.map((k) => k.modelKey))
  const products: ProductCandidate[] = catalog
  const rows: ScanRow[] = []

  for (const input of inputs) {
    const modelKey = modelKeyFor(input.brand, input.model ?? input.title)

    if (!modelKey) {
      rows.push({ input, modelKey, verdict: 'DUPLICATE', detail: 'empty brand/model' })
      continue
    }

    // Cheapest check first: already evaluated, in this run or a previous one.
    if (seen.has(modelKey)) {
      rows.push({ input, modelKey, verdict: 'DUPLICATE' })
      continue
    }
    seen.add(modelKey)

    if (!(input.weightGrams > 0)) {
      rows.push({ input, modelKey, verdict: 'MISSING_WEIGHT' })
      continue
    }

    const price = await priceSource.lookup({
      title: input.title,
      brand: input.brand,
      model: input.model,
    })
    if (!price || !(price.priceArs > 0)) {
      rows.push({ input, modelKey, verdict: 'NO_ML_PRICE' })
      continue
    }

    if (price.priceArs < bounds.minMlPriceArs || price.priceArs > bounds.maxMlPriceArs) {
      rows.push({
        input,
        modelKey,
        verdict: 'PRICE_OUT_OF_RANGE',
        mlPriceArs: price.priceArs,
        detail: `${Math.round(price.priceArs)} ARS outside ${bounds.minMlPriceArs}–${bounds.maxMlPriceArs}`,
      })
      continue
    }

    const fee = await getSaleFee(accessToken, price.priceArs, price.categoryId)
    const shipping = lookupShippingCost(shippingTable, input.weightGrams)

    const margin = computeMargin({
      amazonPriceUsd: input.amazonPriceUsd,
      amazonTaxUsd: input.amazonTaxUsd,
      weightGrams: input.weightGrams,
      mlPriceArs: price.priceArs,
      usdArsRate,
      freightUsdPerKg: freight.usdPerKg,
      mlFeeRate: fee.rate,
      mlFixedFeeArs: fee.fixedFeeArs,
      mlShippingCostArs: shipping.ars,
    })

    const matched = matchProduct(input.title, products)
    const accepted = margin.roiPct >= bounds.minRoiPct
    const verdict: ScanVerdict = accepted ? 'ACCEPTED' : 'LOW_MARGIN'

    const candidate = await prisma.opportunityCandidate.create({
      data: {
        asin: input.asin,
        title: input.title,
        brand: input.brand,
        model: input.model,
        modelKey,
        amazonPriceUsd: input.amazonPriceUsd,
        amazonTaxUsd: input.amazonTaxUsd ?? 0,
        weightGrams: input.weightGrams,
        mlPriceArs: price.priceArs,
        mlSoldQty: price.soldQty ?? null,
        mlPermalink: price.permalink ?? null,
        mlCategoryId: price.categoryId ?? null,
        usdArsRate,
        freightUsdPerKg: freight.usdPerKg,
        freightUsd: margin.freightUsd,
        landedUsd: margin.landedUsd,
        mlFeeRate: fee.rate,
        mlFeeArs: margin.mlFeeArs,
        mlShippingCostArs: shipping.ars,
        netProfitUsd: margin.netProfitUsd,
        roiPct: margin.roiPct,
        breakEvenMlArs: Number.isFinite(margin.breakEvenMlArs) ? margin.breakEvenMlArs : 0,
        status: accepted ? OpportunityStatus.NEW : OpportunityStatus.REJECTED,
        rejectedReason: accepted
          ? null
          : `ROI ${margin.roiPct}% below ${bounds.minRoiPct}%`,
        productId: matched?.id ?? null,
        observations: {
          create: {
            amazonPriceUsd: input.amazonPriceUsd,
            mlPriceArs: price.priceArs,
            netProfitUsd: margin.netProfitUsd,
            roiPct: margin.roiPct,
          },
        },
      },
    })

    rows.push({
      input,
      modelKey,
      verdict,
      margin,
      mlPriceArs: price.priceArs,
      matchedProductId: matched?.id,
      candidateId: candidate.id,
      detail: shipping.basis === 'UNKNOWN' ? 'shipping cost unknown — run --measure-shipping' : undefined,
    })
  }

  return { rows, context }
}
