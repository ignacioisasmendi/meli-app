import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { getUsdArsRate } from '../lib/settings'
import { scanCandidates, DEFAULT_BOUNDS, type CandidateInput } from '../lib/opportunities/scan'
import { ManualPriceSource, manualKey, type MlPrice } from '../lib/opportunities/price-source'
import { measureShippingTable, readShippingTable } from '../lib/opportunities/shipping-cost'
import { getFreightUsdPerKg } from '../lib/opportunities/freight-rate'
import { formatArs, formatUsd } from '../lib/utils'
import { readFileSync } from 'node:fs'

/**
 * Runs the sourcing funnel over a batch of candidates and writes the survivors
 * to `opportunity_candidates`.
 *
 * The Amazon side (price, weight) and the ML price still come from the input
 * file — see `price-source.ts` for why there is no API for the latter. Everything
 * else is computed from live data: the real sale fee from ML, the real freight
 * rate from costed shipments, the real free-shipping subsidy from our own
 * shipping history, and the real USD/ARS rate.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/scan-opportunities.ts --measure-shipping
 *   npx tsx --env-file=.env scripts/scan-opportunities.ts candidates.json
 *   npx tsx --env-file=.env scripts/scan-opportunities.ts candidates.json --dry-run
 *
 * Input file — an array of:
 *   {
 *     "asin": "B09XS7JWHH",
 *     "title": "Sony WH-1000XM5 Wireless Headphones",
 *     "brand": "Sony",
 *     "model": "WH-1000XM5",
 *     "amazonPriceUsd": 298,
 *     "amazonTaxUsd": 0,
 *     "weightGrams": 250,
 *     "mlPriceArs": 511294,
 *     "mlSoldQty": 1000,
 *     "mlPermalink": "https://articulo.mercadolibre.com.ar/MLA-...",
 *     "mlCategoryId": "MLA1051"
 *   }
 */

type InputRow = CandidateInput & {
  mlPriceArs?: number
  mlSoldQty?: number
  mlPermalink?: string
  mlCategoryId?: string
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function activeAccessToken(): Promise<string> {
  const account = await prisma.mercadoLibreAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!account) throw new Error('No active MercadoLibreAccount — connect one first')
  if (account.expiresAt.getTime() <= Date.now()) {
    throw new Error(
      `Access token for ${account.nickname} expired at ${account.expiresAt.toISOString()} — ` +
        'run the refresh-tokens cron, then retry'
    )
  }
  return account.accessToken
}

/**
 * The USD/ARS rate to score with.
 *
 * `getUsdArsRate()` reaches Saldo from the server, but the Saldo client is
 * `server-only` and can't load under tsx — so from a script the call degrades to
 * the cached Setting, then to `USD_ARS_RATE`. Scoring a scan at a stale env rate
 * would silently distort every margin, so a fallback value is refused rather
 * than used: pass `--rate=1530` to proceed deliberately.
 */
async function resolveRate(override: number | null): Promise<number> {
  if (override != null) {
    if (!(override > 0)) throw new Error(`--rate must be a positive number, got "${override}"`)
    return override
  }

  const rate = await getUsdArsRate()
  const envRate = Number(process.env.USD_ARS_RATE)
  const isFallback = rate === 1000 || (Number.isFinite(envRate) && rate === envRate)

  if (isFallback) {
    throw new Error(
      `Refusing to scan at ${rate} ARS/USD — that is the .env fallback, not a live rate.\n` +
        '  The Saldo client is server-only, so a script cannot fetch it.\n' +
        '  Pass --rate=<value> with the rate the app is actually using.'
    )
  }
  return rate
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const measure = args.includes('--measure-shipping')
  const rateArg = args.find((a) => a.startsWith('--rate='))
  const rateOverride = rateArg ? Number(rateArg.split('=')[1]) : null
  const file = args.find((a) => !a.startsWith('--'))

  const token = await activeAccessToken()

  if (measure) {
    console.log('Measuring what we pay to ship, from recent orders...\n')
    const table = await measureShippingTable(prisma, token)
    console.log(`sampled ${table.sampled} shipments\n`)
    for (const b of table.brackets) {
      const label = b.maxGrams ? `≤ ${b.maxGrams} g` : '> 25000 g'
      console.log(
        `  ${label.padEnd(12)} ${b.samples > 0 ? formatArs(b.arsPerShipment) : '—'}` +
          `  (${b.samples} sample${b.samples === 1 ? '' : 's'})`
      )
    }
    console.log('\nStored in Setting `mlSellerShippingBrackets`.')
    if (!file) return
    console.log()
  }

  if (!file) {
    console.log('Nothing to scan. Pass a candidates JSON file, or --measure-shipping.')
    return
  }

  const inputs = JSON.parse(readFileSync(file, 'utf8')) as InputRow[]
  if (!Array.isArray(inputs)) throw new Error('Input file must be a JSON array')

  // The manual price source is keyed the same way the scan dedupes.
  const prices = new Map<string, MlPrice>()
  for (const row of inputs) {
    if (!row.mlPriceArs) continue
    prices.set(manualKey(row.brand, row.model ?? row.title), {
      priceArs: row.mlPriceArs,
      soldQty: row.mlSoldQty ?? null,
      permalink: row.mlPermalink ?? null,
      categoryId: row.mlCategoryId ?? null,
    })
  }

  const [usdArsRate, freight, shippingTable] = await Promise.all([
    resolveRate(rateOverride),
    getFreightUsdPerKg(prisma),
    readShippingTable(prisma),
  ])

  console.log('Scan context')
  console.log(`  USD/ARS         ${usdArsRate}${rateOverride != null ? ' (--rate)' : ''}`)
  console.log(
    `  freight         ${formatUsd(freight.usdPerKg)}/kg  [${freight.basis}` +
      (freight.basis === 'MEASURED'
        ? `, ${freight.shipmentsUsed} shipment(s), ${freight.totalKg} kg`
        : '') +
      ']'
  )
  if (freight.shipmentsSkipped > 0) {
    console.log(
      `                  ${freight.shipmentsSkipped} costed shipment(s) skipped — a product had no weight`
    )
  }
  console.log(
    `  ML shipping     ${shippingTable ? `measured ${shippingTable.measuredAt.slice(0, 10)} (${shippingTable.sampled} samples)` : 'NOT MEASURED — run --measure-shipping'}`
  )
  console.log(
    `  bounds          ${formatArs(DEFAULT_BOUNDS.minMlPriceArs)}–${formatArs(DEFAULT_BOUNDS.maxMlPriceArs)}, min ROI ${DEFAULT_BOUNDS.minRoiPct}%`
  )
  console.log(`  candidates      ${inputs.length}\n`)

  if (dryRun) {
    console.log('--dry-run: nothing will be written.\n')
    await prisma.$disconnect()
    return
  }

  const { rows } = await scanCandidates(
    prisma,
    token,
    inputs,
    new ManualPriceSource(prices),
    { usdArsRate }
  )

  const accepted = rows.filter((r) => r.verdict === 'ACCEPTED')
  accepted.sort((a, b) => (b.margin?.roiPct ?? 0) - (a.margin?.roiPct ?? 0))

  console.log(`ACCEPTED (${accepted.length})`)
  for (const r of accepted) {
    const m = r.margin!
    console.log(`\n  ${r.input.brand} ${r.input.model ?? r.input.title}`)
    console.log(
      `    landed ${formatUsd(m.landedUsd)}  (amazon ${formatUsd(r.input.amazonPriceUsd)} + freight ${formatUsd(m.freightUsd)})`
    )
    console.log(
      `    ML ${formatArs(r.mlPriceArs!)} − fee ${formatArs(m.mlFeeArs)} → net ${formatUsd(m.netRevenueUsd)}`
    )
    console.log(
      `    profit ${formatUsd(m.netProfitUsd)}  ROI ${m.roiPct}%  break-even ${formatArs(m.breakEvenMlArs)}`
    )
    if (r.matchedProductId) console.log(`    ALREADY IN CATALOG (product ${r.matchedProductId})`)
    if (r.detail) console.log(`    note: ${r.detail}`)
  }

  const rejected = rows.filter((r) => r.verdict !== 'ACCEPTED')
  if (rejected.length > 0) {
    console.log(`\n\nREJECTED (${rejected.length})`)
    for (const r of rejected) {
      console.log(
        `  ${r.verdict.padEnd(19)} ${r.input.brand} ${r.input.model ?? r.input.title}` +
          (r.detail ? ` — ${r.detail}` : '') +
          (r.margin ? ` — ROI ${r.margin.roiPct}%` : '')
      )
    }
  }
}

main()
  .catch((err) => {
    console.error('\nScan failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
