'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { BatchStatus, Prisma, PurchaseStatus, ShipmentStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'
import { applyPurchase, recomputeAverageCost, statusOnArrival } from '@/lib/inventory/stock'
import { allocateOrder } from '@/lib/inventory/landed'
import { SHIPMENT_TO_BATCH_STATUS } from '@/lib/inventory/shipment-costing'
import { sendTelegramMessage } from '@/lib/telegram/client'
import { MAX_BULK_ORDERS } from '@/lib/imports/bulk-orders'
import type { ActionResult } from '@/actions/products'

const lineSchema = z
  .object({
    mode: z.enum(['existing', 'new']),
    productId: z.string().optional(),
    sku: z.string().trim().optional(),
    name: z.string().trim().min(1, 'Product name is required'),
    quantity: z.coerce.number().int().positive('Quantity must be positive'),
    unitPrice: z.coerce.number().positive('Unit price must be positive'),
  })
  .refine((l) => (l.mode === 'existing' ? !!l.productId : !!l.sku), {
    message: 'Each line needs a product (or a SKU to create one)',
  })

const importSchema = z.object({
  orderNumber: z.string().trim().optional().or(z.literal('')),
  supplier: z.string().trim().optional().or(z.literal('')),
  purchasedAt: z.string().optional(),
  /** When the whole order arrived, if it already did. Partial arrivals are registered per line afterwards. */
  arrivedAt: z.string().optional(),
  tax: z.coerce.number().min(0).default(0),
  shipping: z.coerce.number().min(0).default(0),
  /** Box these lines travel in. Its freight is applied later, on arrival. */
  shipmentId: z.string().optional().or(z.literal('')),
  lines: z.array(lineSchema).min(1, 'Add at least one line'),
})

export type ImportPayload = z.infer<typeof importSchema>

type Tx = Prisma.TransactionClient
type ImportData = z.infer<typeof importSchema>

/** What an order's lines look like once validated, before anything is written. */
interface PreparedOrder {
  data: ImportData
  supplier: string
  purchasedAt: Date
  arrivedAt: Date | null
  shipmentId: string | null
  batchStatus: BatchStatus
}

/**
 * Validates the dates and the target shipment, and settles the status the
 * batches start in. Pure reads, so it runs before the transaction opens.
 */
async function prepareOrder(data: ImportData): Promise<PreparedOrder | string> {
  const purchasedAt = data.purchasedAt ? new Date(data.purchasedAt) : new Date()
  if (Number.isNaN(purchasedAt.getTime())) return 'Invalid purchase date'
  const arrivedAt = data.arrivedAt ? new Date(data.arrivedAt) : null
  if (arrivedAt && Number.isNaN(arrivedAt.getTime())) return 'Invalid arrival date'

  const shipmentId = data.shipmentId || null
  let batchStatus: BatchStatus = BatchStatus.PURCHASED
  if (shipmentId) {
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } })
    if (!shipment) return 'Shipment not found'
    if (shipment.status === ShipmentStatus.COSTED) {
      return 'That shipment is already costed — pick an open one'
    }
    batchStatus = SHIPMENT_TO_BATCH_STATUS[shipment.status]
  }
  if (arrivedAt) batchStatus = statusOnArrival(batchStatus, !!shipmentId)

  return {
    data,
    supplier: data.supplier || 'Amazon',
    purchasedAt,
    arrivedAt,
    shipmentId,
    batchStatus,
  }
}

/**
 * Writes one supplier order: the `PurchaseOrder` header (when numbered), then a
 * purchase + batch per line through the stock pipeline.
 *
 * `createdSkus` lets several orders in one bulk import share a new product: the
 * first line with a new SKU creates it, later lines with the same SKU restock it
 * instead of tripping over "SKU already exists".
 */
async function recordOrder(
  tx: Tx,
  { data, supplier, purchasedAt, arrivedAt, shipmentId, batchStatus }: PreparedOrder,
  createdSkus: Map<string, string>
) {
  const { orderNumber, lines, tax, shipping } = data

  // Authoritative cost breakdown — recomputed server-side, never trusted from the client.
  const allocated = allocateOrder(
    lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })),
    { tax, shipping }
  )

  // Re-importing an order number adds to it rather than forking a second
  // group: each import allocated its own extras over its own lines, so the
  // per-line costs already booked stay untouched and the header just sums.
  const order = orderNumber
    ? await tx.purchaseOrder.upsert({
        where: { supplier_orderNumber: { supplier, orderNumber } },
        create: { orderNumber, supplier, taxUsd: tax, shippingUsd: shipping, purchasedAt },
        update: { taxUsd: { increment: tax }, shippingUsd: { increment: shipping } },
      })
    : null

  for (const [i, line] of lines.entries()) {
    let productId = line.productId
    const { taxUsd, shippingUsd, totalUsd, unitCostUsd } = allocated[i]

    if (line.mode === 'new') {
      const sku = line.sku!.trim()
      const already = createdSkus.get(sku.toUpperCase())
      if (already) {
        productId = already
      } else {
        const existing = await tx.product.findUnique({ where: { sku } })
        if (existing) {
          throw new Error(`SKU "${sku}" already exists — map that line to it instead`)
        }
        const created = await tx.product.create({ data: { sku, name: line.name } })
        createdSkus.set(sku.toUpperCase(), created.id)
        productId = created.id
      }
    } else {
      const product = await tx.product.findUnique({ where: { id: productId } })
      if (!product) throw new Error('A selected product no longer exists')
    }

    const purchase = await tx.purchase.create({
      data: {
        productId: productId!,
        orderId: order?.id,
        quantity: line.quantity,
        unitPriceUsd: line.unitPrice,
        taxUsd,
        shippingUsd,
        unitCostUsd,
        // The line was billed goods + tax + shipping; spreading that over
        // the units and multiplying back can drift a cent, so the billed
        // figure is what gets stored.
        totalCostUsd: totalUsd,
        supplier,
        status: batchStatus as unknown as PurchaseStatus,
        purchasedAt,
        arrivedAt,
      },
    })
    await tx.inventoryBatch.create({
      data: {
        productId: productId!,
        purchaseId: purchase.id,
        shipmentId,
        quantity: line.quantity,
        remainingQuantity: line.quantity,
        // Freight is still unknown, so landed cost == goods cost for now.
        goodsUnitCostUsd: unitCostUsd,
        unitCostUsd,
        status: batchStatus,
        purchasedAt,
      },
    })
    await applyPurchase(tx, {
      productId: productId!,
      quantity: line.quantity,
      referenceId: purchase.id,
    })
    await recomputeAverageCost(tx, productId!)
  }
}

function revalidateImport(shipmentIds: (string | null)[]) {
  revalidatePath('/purchases')
  revalidatePath('/inventory')
  revalidatePath('/products')
  revalidatePath('/shipments')
  for (const id of new Set(shipmentIds)) {
    if (id) revalidatePath(`/shipments/${id}`)
  }
}

/**
 * Bulk-imports manually-entered purchases. The supplier's own tax + shipping are
 * allocated across lines (by value) into each line's per-unit cost, then a
 * product is created (when new) and a purchase + batch recorded through the
 * stock pipeline.
 *
 * Given an order number the lines are also grouped under a `PurchaseOrder`, so
 * the basket that was actually paid for stays one thing on the purchases page
 * and its tax/shipping can be shown line by line.
 *
 * That covers everything knowable at purchase time. The USA → Argentina freight
 * is not — it arrives with the box — so lines can be dropped into a shipment
 * here and re-costed later by `costShipment`.
 */
export async function importPurchases(payload: ImportPayload): Promise<ActionResult> {
  await requireUser()
  const parsed = importSchema.safeParse(payload)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const prepared = await prepareOrder(parsed.data)
  if (typeof prepared === 'string') return { ok: false, error: prepared }

  try {
    await prisma.$transaction((tx) => recordOrder(tx, prepared, new Map()))
  } catch (err) {
    console.error('[purchase import] failed:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not import purchases',
    }
  }

  const { lines, orderNumber } = parsed.data
  const units = lines.reduce((n, l) => n + l.quantity, 0)
  await sendTelegramMessage(
    `🛒 Imported ${lines.length} product${lines.length === 1 ? '' : 's'} (${units} units)` +
      (orderNumber ? ` from order ${orderNumber}` : '')
  )

  revalidateImport([prepared.shipmentId])
  return { ok: true }
}

const bulkSchema = z
  .array(importSchema)
  .min(1, 'Add at least one order')
  .max(MAX_BULK_ORDERS, `At most ${MAX_BULK_ORDERS} orders per import`)

export type BulkImportPayload = z.infer<typeof bulkSchema>

/**
 * Imports many supplier orders at once — the JSON bulk path. All or nothing:
 * the orders are written in one transaction, so a bad line leaves nothing
 * half-imported to clean up, and the same JSON can simply be fixed and re-sent.
 *
 * Unlike the single import, an order number that already exists is refused
 * rather than added to: a bulk paste is far more likely to be the same file
 * sent twice than a deliberate top-up, and doubling stock silently is worse
 * than an error.
 */
export async function importPurchasesBulk(payload: BulkImportPayload): Promise<ActionResult> {
  await requireUser()
  const parsed = bulkSchema.safeParse(payload)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const [orderIndex] = issue?.path ?? []
    const where = typeof orderIndex === 'number' ? `Order ${orderIndex + 1}: ` : ''
    return { ok: false, error: where + (issue?.message ?? 'Invalid input') }
  }

  const prepared: PreparedOrder[] = []
  for (const [i, data] of parsed.data.entries()) {
    const order = await prepareOrder(data)
    if (typeof order === 'string') return { ok: false, error: `Order ${i + 1}: ${order}` }
    prepared.push(order)
  }

  const keys = prepared
    .filter((p) => p.data.orderNumber)
    .map((p) => ({ supplier: p.supplier, orderNumber: p.data.orderNumber! }))
  const seen = new Set<string>()
  for (const k of keys) {
    const key = `${k.supplier}|${k.orderNumber}`
    if (seen.has(key)) return { ok: false, error: `Order ${k.orderNumber} appears twice` }
    seen.add(key)
  }
  if (keys.length > 0) {
    const existing = await prisma.purchaseOrder.findMany({
      where: { OR: keys },
      select: { orderNumber: true },
    })
    if (existing.length > 0) {
      return {
        ok: false,
        error: `Already imported: ${existing.map((o) => o.orderNumber).join(', ')}`,
      }
    }
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        const createdSkus = new Map<string, string>()
        for (const order of prepared) await recordOrder(tx, order, createdSkus)
      },
      // One round-trip per line adds up over a hundred orders; the default 5s
      // would roll back a perfectly good import.
      { timeout: 120_000, maxWait: 10_000 }
    )
  } catch (err) {
    console.error('[purchase bulk import] failed:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not import purchases',
    }
  }

  const lines = prepared.flatMap((p) => p.data.lines)
  const units = lines.reduce((n, l) => n + l.quantity, 0)
  await sendTelegramMessage(
    `🛒 Bulk-imported ${prepared.length} order${prepared.length === 1 ? '' : 's'}: ` +
      `${lines.length} line${lines.length === 1 ? '' : 's'} (${units} units)`
  )

  revalidateImport(prepared.map((p) => p.shipmentId))
  return { ok: true }
}
