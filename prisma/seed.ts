import { PrismaClient, PurchaseStatus, BatchStatus, MovementType } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

/**
 * Seeds a small catalog with purchases so the app has data to explore without a
 * live Mercado Libre connection. Idempotent on product SKU.
 */
async function main() {
  const products = [
    { sku: 'TIKKINA-C', name: 'Tikkina C', brand: 'Petzl', minStock: 5 },
    { sku: 'ACTIK-CORE', name: 'Actik Core', brand: 'Petzl', minStock: 4 },
    { sku: 'NAO-RL', name: 'Nao RL', brand: 'Petzl', minStock: 3 },
  ]

  for (const p of products) {
    const product = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: p,
    })

    const hasPurchase = await prisma.purchase.findFirst({ where: { productId: product.id } })
    if (hasPurchase) continue

    // Batch 1 — landed/available
    const purchase1 = await prisma.purchase.create({
      data: {
        productId: product.id,
        quantity: 20,
        unitCostUsd: 28.39,
        totalCostUsd: 20 * 28.39,
        supplier: 'USA Supplier',
        status: PurchaseStatus.AVAILABLE,
      },
    })
    await prisma.inventoryBatch.create({
      data: {
        productId: product.id,
        purchaseId: purchase1.id,
        quantity: 20,
        remainingQuantity: 20,
        unitCostUsd: 28.39,
        status: BatchStatus.AVAILABLE,
      },
    })

    // Batch 2 — in transit
    const purchase2 = await prisma.purchase.create({
      data: {
        productId: product.id,
        quantity: 12,
        unitCostUsd: 30.0,
        totalCostUsd: 12 * 30.0,
        supplier: 'USA Supplier',
        status: PurchaseStatus.IN_TRANSIT,
      },
    })
    await prisma.inventoryBatch.create({
      data: {
        productId: product.id,
        purchaseId: purchase2.id,
        quantity: 12,
        remainingQuantity: 12,
        unitCostUsd: 30.0,
        status: BatchStatus.IN_TRANSIT,
      },
    })

    await prisma.product.update({
      where: { id: product.id },
      data: {
        totalPurchased: 32,
        currentStock: 32,
        averageCostUsd: 28.39, // only landed batch counts toward avg
      },
    })

    await prisma.inventoryMovement.createMany({
      data: [
        { productId: product.id, type: MovementType.PURCHASE, quantity: 20, referenceType: 'purchase', referenceId: purchase1.id },
        { productId: product.id, type: MovementType.PURCHASE, quantity: 12, referenceType: 'purchase', referenceId: purchase2.id },
      ],
    })
  }

  await prisma.setting.upsert({
    where: { key: 'usdArsRate' },
    update: {},
    create: { key: 'usdArsRate', value: process.env.USD_ARS_RATE ?? '1000' },
  })

  console.log('Seed complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
