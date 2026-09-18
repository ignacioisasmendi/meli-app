/**
 * Pure aggregation, deliberately without `server-only` — it also runs client-side,
 * so the per-product summary can be checked against what you're physically
 * packing.
 */

export interface FullShipmentProductLine {
  productId: string
  productName: string
  sku: string
  quantity: number
  /** Shipments the units originally landed in, for tracing a box back. */
  shipments: { id: string; code: string }[]
}

interface BatchSource {
  quantity: number
  product: { id: string; name: string; sku: string }
  shipment?: { id: string; code: string } | null
}

/** Per-product totals across the batches that went into one Full box. */
export function aggregateFullShipmentLines(batches: BatchSource[]): FullShipmentProductLine[] {
  const byProduct = new Map<string, FullShipmentProductLine>()
  for (const batch of batches) {
    let line = byProduct.get(batch.product.id)
    if (!line) {
      line = {
        productId: batch.product.id,
        productName: batch.product.name,
        sku: batch.product.sku,
        quantity: 0,
        shipments: [],
      }
      byProduct.set(batch.product.id, line)
    }
    line.quantity += batch.quantity
    if (batch.shipment && !line.shipments.some((s) => s.id === batch.shipment!.id)) {
      line.shipments.push(batch.shipment)
    }
  }
  return [...byProduct.values()].sort((a, b) => a.productName.localeCompare(b.productName))
}
