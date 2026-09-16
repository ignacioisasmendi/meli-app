import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { computeMargin } from '../lib/opportunities/margin'
import { getSaleFee } from '../lib/opportunities/ml-fees'
import { lookupShippingCost, readShippingTable } from '../lib/opportunities/shipping-cost'
import { formatArs, formatUsd } from '../lib/utils'

/**
 * Scores products we ALREADY sell with the new margin model and compares the
 * answer against the profit the app actually recorded for those same sales.
 *
 * The goods cost is the realized FIFO COGS, so freight is already inside it and
 * the weight half of the model is bypassed — this isolates the REVENUE side,
 * which is where the new model differs: the real ML fee and the free-shipping
 * subsidy the seller absorbs.
 *
 * Usage: npx tsx --env-file=.env scripts/backtest-margin.ts --rate=1530
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const rateArg = process.argv.find((a) => a.startsWith('--rate='))
  const rate = rateArg ? Number(rateArg.split('=')[1]) : 1530

  const account = await prisma.mercadoLibreAccount.findFirst({
    where: { isActive: true },
    orderBy: { expiresAt: 'desc' },
  })
  if (!account) throw new Error('No active account')

  const shippingTable = await readShippingTable(prisma)
  const shipping = lookupShippingCost(shippingTable, 0)

  console.log(`USD/ARS ${rate}   ML shipping ${formatArs(shipping.ars)} [${shipping.basis}, ${shipping.samples} samples]\n`)

  const products = await prisma.product.findMany({
    where: { totalSold: { gt: 0 } },
    orderBy: { totalSold: 'desc' },
    select: {
      sku: true,
      name: true,
      listings: { take: 1, select: { mlItemId: true } },
      sales: {
        where: { status: 'CONFIRMED' },
        select: { salePriceArs: true, feeArs: true, quantity: true, costUsd: true, profitUsd: true },
      },
    },
  })

  let totalDelta = 0
  let totalUnits = 0

  for (const p of products) {
    const units = p.sales.reduce((a, s) => a + s.quantity, 0)
    if (units === 0) continue

    const grossArs = p.sales.reduce((a, s) => a + s.salePriceArs, 0)
    const cogsUsd = p.sales.reduce((a, s) => a + s.costUsd, 0)
    const recordedProfit = p.sales.reduce((a, s) => a + s.profitUsd, 0)

    const unitPriceArs = grossArs / units
    const unitCogsUsd = cogsUsd / units
    const recordedPerUnit = recordedProfit / units

    // Category comes from the live listing, so the fee is the real one.
    let categoryId: string | null = null
    const itemId = p.listings[0]?.mlItemId
    if (itemId) {
      const res = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
        headers: { Authorization: `Bearer ${account.accessToken}` },
      })
      if (res.ok) categoryId = (await res.json()).category_id ?? null
    }

    const fee = await getSaleFee(account.accessToken, unitPriceArs, categoryId)

    const margin = computeMargin({
      amazonPriceUsd: unitCogsUsd, // realized landed cost — freight already in it
      weightGrams: 0,
      mlPriceArs: unitPriceArs,
      usdArsRate: rate,
      freightUsdPerKg: 0,
      mlFeeRate: fee.rate,
      mlFixedFeeArs: fee.fixedFeeArs,
      mlShippingCostArs: shipping.ars,
    })

    const delta = margin.netProfitUsd - recordedPerUnit
    totalDelta += delta * units
    totalUnits += units

    console.log(`${p.sku}  (${units} units sold)`)
    console.log(
      `  sale ${formatArs(unitPriceArs)}  cogs ${formatUsd(unitCogsUsd)}  fee ${fee.rate * 100}%${fee.fromApi ? '' : ' (fallback)'}  cat ${categoryId ?? '?'}`
    )
    console.log(`  app recorded profit/unit   ${formatUsd(recordedPerUnit)}`)
    console.log(`  new model  profit/unit     ${formatUsd(margin.netProfitUsd)}`)
    console.log(
      `  difference                 ${formatUsd(delta)}  → ${formatUsd(delta * units)} across ${units} units`
    )
    console.log(`  break-even sale price      ${formatArs(margin.breakEvenMlArs)}\n`)
  }

  console.log('─'.repeat(60))
  console.log(
    `Total across ${totalUnits} units: ${formatUsd(totalDelta)} of profit the app is currently NOT accounting for.`
  )
}

main()
  .catch((e) => {
    console.error('Backtest failed:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
