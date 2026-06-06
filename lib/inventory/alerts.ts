import 'server-only'
import { prisma } from '@/lib/prisma'
import { getInTransit, stockViewFrom } from '@/lib/inventory/stock'
import { sendTelegramMessage } from '@/lib/telegram/client'
import { lowStockMessage } from '@/lib/telegram/messages'

/**
 * Checks a product's available stock against its minimum and, if at/below the
 * threshold, sends a Telegram low-stock alert. Safe to call after any stock change.
 */
export async function checkLowStock(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) return

  const view = stockViewFrom(product, await getInTransit(productId))
  if (view.available <= product.minStock) {
    await sendTelegramMessage(
      lowStockMessage({
        productName: product.name,
        currentStock: view.available,
        minStock: product.minStock,
      })
    )
  }
}
