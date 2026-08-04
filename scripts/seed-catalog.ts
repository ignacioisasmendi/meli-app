import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

/**
 * Bulk-creates the catalog products (Petzl / DJI / Garmin / Samsung / JBL).
 *
 * Idempotent on `Product.sku`: existing products are left untouched, so it is
 * safe to re-run after adding new rows to the list below.
 *
 * NOTE: SKUs must match the ML listing's `seller_custom_field` for
 * `syncAccountListings` to auto-link a listing to a product. Three catalog
 * entries are commented out below because pre-existing rows (with stock and
 * sales history) already cover them under legacy SKUs — see the comments.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/seed-catalog.ts --dry-run   # preview only
 *   npx tsx --env-file=.env scripts/seed-catalog.ts
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const CATALOG: Array<{ name: string; brand: string }> = [
  // Petzl — headlamps & batteries
  { name: 'TIKKINA C', brand: 'Petzl' },
  { name: 'TIKKINA A', brand: 'Petzl' },
  // { name: 'TIKKINA AG', brand: 'Petzl' },  // covered by legacy SKU "TIKKINA-VERDE-300" (Tikkina Verde Agua 300)
  // { name: 'TIKKINA N', brand: 'Petzl' },   // covered by legacy SKU "1" (Tikkina Negra 300)
  { name: 'CORE', brand: 'Petzl' },
  { name: 'CORE 2', brand: 'Petzl' },
  { name: 'ACTIK CORE A', brand: 'Petzl' },
  { name: 'ACTIK CORE N', brand: 'Petzl' },
  { name: 'SWIFT RL 1100 BN', brand: 'Petzl' },
  { name: 'SWIFT RL 1100', brand: 'Petzl' },
  { name: 'SWIFT RL 1100 N', brand: 'Petzl' },
  { name: 'SWIFT RL 1500', brand: 'Petzl' },

  // DJI — audio & gimbals
  { name: 'DJI MIC MINI', brand: 'DJI' },
  // { name: 'DJI MIC MINI (1 TX + 1 RX)', brand: 'DJI' },  // covered by legacy SKU "5" (Dji Mic Mini (1 TX + 1 RX))
  { name: 'DJI MIC MINI (2 TX + 1 RX)', brand: 'DJI' },
  { name: 'DJI MIC MINI KIT', brand: 'DJI' },
  { name: 'DJI Mic Mini Adaptador', brand: 'DJI' },
  { name: 'DJI MIC 3 (1 TX + 1 RX)', brand: 'DJI' },
  { name: 'DJI Osmo Mobile 7', brand: 'DJI' },

  // Wearables
  { name: 'GALAXY WATCH 7', brand: 'Samsung' },
  { name: 'VIVOACTIVE 5 N', brand: 'Garmin' },
  { name: 'VIVOACTIVE 5 V', brand: 'Garmin' },
  { name: 'VIVOACTIVE 5 B', brand: 'Garmin' },

  // Storage & audio
  { name: 'SANDISK 1TB', brand: 'SanDisk' },
  { name: 'JBL PRO TOUR 2', brand: 'JBL' },
  { name: 'JBL VIBE BEAM 2', brand: 'JBL' },
]

/** "DJI MIC MINI (1 TX + 1 RX)" -> "DJI-MIC-MINI-1-TX-1-RX" */
function toSku(name: string) {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const rows = CATALOG.map((p) => ({ sku: toSku(p.name), ...p }))

  const duplicates = rows
    .map((r) => r.sku)
    .filter((sku, i, all) => all.indexOf(sku) !== i)
  if (duplicates.length) {
    throw new Error(`Duplicate SKUs generated from the list: ${[...new Set(duplicates)].join(', ')}`)
  }

  const existing = await prisma.product.findMany({
    where: { sku: { in: rows.map((r) => r.sku) } },
    select: { sku: true },
  })
  const existingSkus = new Set(existing.map((p) => p.sku))
  const toCreate = rows.filter((r) => !existingSkus.has(r.sku))

  for (const r of rows) {
    const mark = existingSkus.has(r.sku) ? 'skip (exists)' : dryRun ? 'would create' : 'create'
    console.log(`${mark.padEnd(14)} ${r.sku.padEnd(26)} ${r.name}`)
  }

  if (dryRun) {
    console.log(`\nDry run — ${toCreate.length} would be created, ${existingSkus.size} already exist.`)
    return
  }

  if (toCreate.length) {
    await prisma.product.createMany({ data: toCreate })
  }
  console.log(`\nDone — ${toCreate.length} created, ${existingSkus.size} already existed.`)
}

main()
  .catch((err) => {
    console.error('Error:', err.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
