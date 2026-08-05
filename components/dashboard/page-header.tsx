export function PageHeader({
  title,
  description,
  action,
  leading,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  /** Rendered before the title — e.g. a product thumbnail. */
  leading?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        {leading}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
