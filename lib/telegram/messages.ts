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
