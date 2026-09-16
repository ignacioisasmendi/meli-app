/**
 * Pure aggregation, deliberately without `server-only` — it also runs client-side
 * in the create dialog, so you can check the product/quantity summary against
 * what you're physically packing before the Full shipment is even created.
 */

export interface FullShipmentProductLine {
  productId: string
  productName: string
  sku: string
  quantity: number
}

interface LineSource {
  batches: Array<{ quantity: number; product: { id: string; name: string; sku: string } }>
}

/** Per-product totals across a set of `Shipment`s consolidated into one box. */
export function aggregateFullShipmentLines(shipments: LineSource[]): FullShipmentProductLine[] {
  const byProduct = new Map<string, FullShipmentProductLine>()
  for (const shipment of shipments) {
    for (const batch of shipment.batches) {
      const existing = byProduct.get(batch.product.id)
      if (existing) {
        existing.quantity += batch.quantity
      } else {
        byProduct.set(batch.product.id, {
          productId: batch.product.id,
          productName: batch.product.name,
          sku: batch.product.sku,
          quantity: batch.quantity,
        })
      }
    }
  }
  return [...byProduct.values()].sort((a, b) => a.productName.localeCompare(b.productName))
}
