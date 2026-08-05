import { formatArs, formatUsd } from '@/lib/utils'

/** Telegram message templates. Each returns a Markdown string. */

export function newSaleMessage(params: {
  productName: string
  quantity: number
  accountNickname: string
  priceArs: number
  remainingStock: number
}): string {
  return [
    '🛒 *New Sale*',
    '',
    `*Product:* ${params.productName}`,
    `*Quantity:* ${params.quantity}`,
    `*Account:* ${params.accountNickname}`,
    `*Price:* ${formatArs(params.priceArs)}`,
    `*Remaining Stock:* ${params.remainingStock}`,
  ].join('\n')
}

export function unmappedSaleMessage(params: {
  listingTitle: string
  accountNickname: string
  priceArs: number
  mlItemId: string
}): string {
  return [
    '⚠️ *Sale of an unmapped listing*',
    '',
    `*Listing:* ${params.listingTitle}`,
    `*Account:* ${params.accountNickname}`,
    `*Price:* ${formatArs(params.priceArs)}`,
    `*Item:* ${params.mlItemId}`,
    '',
    '_Map it to a product to record stock & profit._',
  ].join('\n')
}

export function saleCancelledMessage(params: {
  productName: string
  quantity: number
  accountNickname: string
  refundedArs: number
  reason?: string
  restocked: boolean
}): string {
  return [
    '🚫 *Sale Cancelled*',
    '',
    `*Product:* ${params.productName}`,
    `*Quantity:* ${params.quantity}`,
    `*Account:* ${params.accountNickname}`,
    `*Refunded:* ${formatArs(params.refundedArs)}`,
    ...(params.reason ? [`*Reason:* ${params.reason}`] : []),
    '',
    params.restocked
      ? '_Never shipped — stock returned to available._'
      : '_Stock unchanged._',
  ].join('\n')
}

export function returnOpenedMessage(params: {
  productName: string
  quantity: number
  accountNickname: string
  refundedArs: number
  claimType: string
  reason?: string
  goodsComingBack: boolean
}): string {
  return [
    params.goodsComingBack ? '↩️ *Return Opened*' : '💸 *Refund (no return)*',
    '',
    `*Product:* ${params.productName}`,
    `*Quantity:* ${params.quantity}`,
    `*Account:* ${params.accountNickname}`,
    `*Refunded:* ${formatArs(params.refundedArs)}`,
    `*Claim:* ${params.claimType}`,
    ...(params.reason ? [`*Reason:* ${params.reason}`] : []),
    '',
    params.goodsComingBack
      ? '_Revenue reversed. Confirm receipt in Sales to restock._'
      : '_Revenue reversed and the unit is gone — booked as a loss._',
  ].join('\n')
}

export function returnReceivedMessage(params: {
  productName: string
  quantity: number
  resellable: boolean
  availableStock: number
}): string {
  return [
    params.resellable ? '📥 *Return Received*' : '🗑️ *Return Written Off*',
    '',
    `*Product:* ${params.productName}`,
    `*Quantity:* ${params.quantity}`,
    ...(params.resellable ? [`*Available Stock:* ${params.availableStock}`] : []),
    '',
    params.resellable
      ? '_Back on the shelf at its original batch cost._'
      : '_Not resellable — cost written off._',
  ].join('\n')
}

export function lowStockMessage(params: {
  productName: string
  currentStock: number
  minStock: number
}): string {
  return [
    '⚠️ *Low Stock*',
    '',
    `*Product:* ${params.productName}`,
    `*Current Stock:* ${params.currentStock}`,
    `*Minimum Stock:* ${params.minStock}`,
  ].join('\n')
}

export function purchaseRegisteredMessage(params: {
  productName: string
  quantity: number
  unitCostUsd: number
  totalCostUsd: number
}): string {
  return [
    '📦 *Purchase Registered*',
    '',
    `*Product:* ${params.productName}`,
    `*Quantity:* ${params.quantity}`,
    `*Unit Cost:* ${formatUsd(params.unitCostUsd)}`,
    `*Total:* ${formatUsd(params.totalCostUsd)}`,
  ].join('\n')
}

export function shipmentCostedMessage(params: {
  code: string
  totalBillUsd: number
  batchCount: number
  productCount: number
}): string {
  return [
    '✈️ *Shipment Costed*',
    '',
    `*Shipment:* ${params.code}`,
    `*Freight + customs:* ${formatUsd(params.totalBillUsd)}`,
    `*Spread over:* ${params.batchCount} batch${params.batchCount === 1 ? '' : 'es'} · ${params.productCount} product${params.productCount === 1 ? '' : 's'}`,
    '',
    '_Landed costs updated — stock is now available._',
  ].join('\n')
}

export function dailySummaryMessage(params: {
  sales: number
  revenueArs: number
  profitArs: number
  bestSeller: string | null
}): string {
  return [
    '📊 *Daily Summary*',
    '',
    `*Sales:* ${params.sales}`,
    `*Revenue:* ${formatArs(params.revenueArs)}`,
    `*Profit:* ${formatArs(params.profitArs)}`,
    `*Best Seller:* ${params.bestSeller ?? '—'}`,
  ].join('\n')
}
