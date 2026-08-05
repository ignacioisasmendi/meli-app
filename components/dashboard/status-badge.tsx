import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** Visual style per purchase/batch/sale status. */
const STATUS_STYLES: Record<string, string> = {
  PURCHASED: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  IN_USA: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  IN_TRANSIT: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  CUSTOMS: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  WAREHOUSE: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300',
  AVAILABLE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  // Sale statuses.
  CONFIRMED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  CANCELLED: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  RETURN_PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  RETURNED: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  REFUNDED: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
}

const LABELS: Record<string, string> = {
  PURCHASED: 'Purchased',
  IN_USA: 'In USA',
  IN_TRANSIT: 'In transit',
  CUSTOMS: 'Customs',
  WAREHOUSE: 'Warehouse',
  AVAILABLE: 'Available',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  RETURN_PENDING: 'Return pending',
  RETURNED: 'Returned',
  REFUNDED: 'Refunded',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn('border-transparent font-medium', STATUS_STYLES[status])}
    >
      {LABELS[status] ?? status}
    </Badge>
  )
}
