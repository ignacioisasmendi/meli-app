import { NextRequest, NextResponse } from 'next/server'
import { auth0 } from '@/lib/auth0'
import { toCsv, csvResponse } from '@/lib/csv'
import {
  getInventoryReport,
  getSalesReport,
  getPurchaseReport,
  getProfitabilityReport,
} from '@/lib/reports'
import { formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/** CSV export for each report type. Protected by the Auth0 session. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  const session = await auth0.getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { type } = await params

  switch (type) {
    case 'inventory': {
      const rows = await getInventoryReport()
      const csv = toCsv(
        ['SKU', 'Product', 'Available', 'In Transit', 'Reserved', 'Value USD'],
        rows.map((r) => [r.sku, r.name, r.available, r.inTransit, r.reserved, r.valueUsd.toFixed(2)])
      )
      return csvResponse('inventory-report.csv', csv)
    }
    case 'sales': {
      const rows = await getSalesReport()
      const csv = toCsv(
        ['Date', 'Product', 'Account', 'Quantity', 'Revenue ARS', 'Profit USD'],
        rows.map((r) => [
          formatDate(r.date),
          r.product,
          r.account,
          r.quantity,
          r.revenueArs.toFixed(2),
          r.profitUsd.toFixed(2),
        ])
      )
      return csvResponse('sales-report.csv', csv)
    }
    case 'purchases': {
      const rows = await getPurchaseReport()
      const csv = toCsv(
        ['Date', 'Product', 'Quantity', 'Total Cost USD', 'Status'],
        rows.map((r) => [formatDate(r.date), r.product, r.quantity, r.totalCostUsd.toFixed(2), r.status])
      )
      return csvResponse('purchases-report.csv', csv)
    }
    case 'profitability': {
      const rows = await getProfitabilityReport()
      const csv = toCsv(
        ['Product', 'Units', 'Revenue USD', 'Cost USD', 'Profit USD', 'Margin %'],
        rows.map((r) => [
          r.product,
          r.units,
          r.revenueUsd.toFixed(2),
          r.costUsd.toFixed(2),
          r.profitUsd.toFixed(2),
          r.marginPct.toFixed(1),
        ])
      )
      return csvResponse('profitability-report.csv', csv)
    }
    default:
      return NextResponse.json({ error: 'unknown_report' }, { status: 404 })
  }
}
