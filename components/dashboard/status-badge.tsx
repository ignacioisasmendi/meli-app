import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** Visual style per purchase/batch status. */
const STATUS_STYLES: Record<string, string> = {
  PURCHASED: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  IN_USA: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  IN_TRANSIT: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  CUSTOMS: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  WAREHOUSE: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300',
  AVAILABLE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
}

const LABELS: Record<string, string> = {
  PURCHASED: 'Purchased',
  IN_USA: 'In USA',
  IN_TRANSIT: 'In transit',
  CUSTOMS: 'Customs',
  WAREHOUSE: 'Warehouse',
  AVAILABLE: 'Available',
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
