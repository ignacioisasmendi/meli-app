import { readFirstSheet } from '@/lib/sales-report/xlsx'

/**
 * Parser for Mercado Libre's "Ventas" export (Mi cuenta → Ventas → Descargar
 * Excel), in either of the two formats ML offers: .xlsx or .csv.
 *
 * The sheet opens with a few lines of prose, then a row of section names
 * ("Ventas", "Publicaciones", "Compradores", "Devoluciones"…) spanning the
 * header row beneath it. Several headers repeat across sections — "Estado" is
 * the sale status under Ventas and the buyer's province under Compradores — so
 * columns are looked up by `section|header`, never by position.
 *
 * Dependency-free apart from the xlsx reader, so scripts can import it too.
 */

export interface ReportRow {
  /** 1-based line in the sheet, for pointing the user at the source. */
  rowNumber: number
  /** "# de venta": the pack id for cart checkouts, the order id otherwise. */
  saleNumber: string
  soldAt: Date
  status: string
  statusDetail: string | null
  quantity: number
  unitPriceArs: number | null
  productRevenueArs: number
  /**
   * ML's selling charges. Newer exports fold taxes in ("Cargo por venta e
   * impuestos") and leave `taxArs` at 0; older ones split fee, fixed cost,
   * instalment cost and "Impuestos" into separate columns.
   */
  feeArs: number
  taxArs: number
  shippingIncomeArs: number
  /** Shipping charged to the seller, including declared-size adjustments. */
  shippingCostArs: number
  /** Discounts and anything else the export adds that isn't named above. */
  otherChargesArs: number
  /** "Anulaciones y reembolsos": negative when money went back to the buyer. */
  refundsArs: number
  /** What the sale leaves in the account after everything, refunds included. */
  totalArs: number
  mlItemId: string | null
  title: string | null
  variant: string | null
  sku: string | null
  buyerName: string | null
  /** Devoluciones → Resultado, e.g. "Apto para venta" / "No apto para venta". */
  returnResult: string | null
}

export interface ParsedReport {
  /** The seller id ML puts at the end of the file name, when it's there. */
  mlUserId: string | null
  generatedAt: Date | null
  rows: ReportRow[]
}

export class ReportParseError extends Error {}

export function parseSalesReport(fileName: string, buffer: Buffer): ParsedReport {
  const grid = /\.xlsx$/i.test(fileName)
    ? readFirstSheet(buffer)
    : parseCsv(buffer.toString('utf8').replace(/^\uFEFF/, ''))
  return parseGrid(fileName, grid)
}

export function parseGrid(fileName: string, grid: string[][]): ParsedReport {
  const headerIndex = grid.findIndex((row) => clean(row[0]) === '# de venta')
  if (headerIndex < 0) {
    throw new ReportParseError(
      'This does not look like a Mercado Libre sales report (no "# de venta" column).'
    )
  }

  const columns = new Map<string, number>()
  const sections = grid[headerIndex - 1] ?? []
  let section = ''
  grid[headerIndex].forEach((header, i) => {
    section = clean(sections[i]) || section
    const key = `${section}|${clean(header)}`
    if (!columns.has(key)) columns.set(key, i)
  })

  const col = (section: string, header: string) => {
    const i = columns.get(`${section}|${header}`)
    return (row: string[]) => (i === undefined ? '' : clean(row[i]))
  }
  const required = (section: string, header: string) => {
    if (!columns.has(`${section}|${header}`)) {
      throw new ReportParseError(`Missing column "${header}" in section "${section}".`)
    }
    return col(section, header)
  }

  const saleNumber = required('Ventas', '# de venta')
  const soldAt = required('Ventas', 'Fecha de venta')
  const status = required('Ventas', 'Estado')
  const statusDetail = col('Ventas', 'Descripción del estado')
  const quantity = required('Ventas', 'Unidades')
  const productRevenue = required('Ventas', 'Ingresos por productos (ARS)')
  const shippingIncome = col('Ventas', 'Ingresos por envío (ARS)')
  const refunds = col('Ventas', 'Anulaciones y reembolsos (ARS)')
  const total = required('Ventas', 'Total (ARS)')

  // Every money column between revenue and total is a charge; ML has renamed and
  // split these between export versions, so bucket them by name rather than
  // listing each one.
  const charges: Record<'fee' | 'tax' | 'shipping' | 'other', number[]> = {
    fee: [],
    tax: [],
    shipping: [],
    other: [],
  }
  const first = columns.get('Ventas|Ingresos por productos (ARS)')!
  const last = columns.get('Ventas|Total (ARS)')!
  for (let i = first + 1; i < last; i++) {
    const header = clean(grid[headerIndex][i]).toLowerCase()
    if (header.startsWith('ingresos por envío') || header.startsWith('anulaciones')) continue
    if (header === 'impuestos') charges.tax.push(i)
    else if (/envío|medidas/.test(header)) charges.shipping.push(i)
    else if (/descuento|bonificaci/.test(header)) charges.other.push(i)
    else charges.fee.push(i)
  }
  const sum = (indexes: number[]) => (row: string[]) =>
    indexes.reduce((acc, i) => acc + money(clean(row[i])), 0)

  const sku = col('Publicaciones', 'SKU')
  const itemId = col('Publicaciones', '# de publicación')
  const title = col('Publicaciones', 'Título de la publicación')
  const variant = col('Publicaciones', 'Variante')
  const unitPrice = col('Publicaciones', 'Precio unitario de venta de la publicación (ARS)')
  const buyer = col('Compradores', 'Comprador')
  const returnResult = col('Devoluciones', 'Resultado')

  const rows: ReportRow[] = []
  grid.slice(headerIndex + 1).forEach((cells, i) => {
    const number = saleNumber(cells)
    if (!/^\d+$/.test(number)) return
    const date = parseSpanishDateTime(soldAt(cells))
    if (!date) {
      throw new ReportParseError(`Row ${headerIndex + i + 2}: unreadable date "${soldAt(cells)}".`)
    }
    rows.push({
      rowNumber: headerIndex + i + 2,
      saleNumber: number,
      soldAt: date,
      status: status(cells),
      statusDetail: statusDetail(cells) || null,
      quantity: Math.round(money(quantity(cells))) || 1,
      unitPriceArs: optionalMoney(unitPrice(cells)),
      productRevenueArs: money(productRevenue(cells)),
      feeArs: sum(charges.fee)(cells),
      taxArs: sum(charges.tax)(cells),
      shippingIncomeArs: money(shippingIncome(cells)),
      shippingCostArs: sum(charges.shipping)(cells),
      otherChargesArs: sum(charges.other)(cells),
      refundsArs: money(refunds(cells)),
      totalArs: money(total(cells)),
      mlItemId: itemId(cells) || null,
      title: title(cells) || null,
      variant: variant(cells) || null,
      sku: sku(cells) || null,
      buyerName: buyer(cells) || null,
      returnResult: returnResult(cells) || null,
    })
  })

  const generatedLine = grid
    .slice(0, headerIndex)
    .flat()
    .find((cell) => /estado de tus ventas al/i.test(cell))

  return {
    mlUserId: fileName.match(/_(\d+)\.(?:csv|xlsx)$/i)?.[1] ?? null,
    generatedAt: generatedLine ? parseSpanishDateTime(generatedLine) : null,
    rows,
  }
}

// ── Cell helpers ────────────────────────────────────────────────────────────

const clean = (value: string | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()

/** ML writes "148617" / "-23035.64"; a hand-saved CSV may use "1.234,56". */
function optionalMoney(value: string): number | null {
  if (!value) return null
  let s = value.replace(/[$\s]/g, '')
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const money = (value: string) => optionalMoney(value) ?? 0

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

/**
 * "16 de septiembre de 2026 19:14 hs." (or "… a las 22:29 hs.") → Date.
 * ML prints Argentina time, which has no DST: always UTC-3.
 */
export function parseSpanishDateTime(value: string): Date | null {
  const m = value
    .toLowerCase()
    .match(/(\d{1,2}) de ([a-záéíóú]+) de (\d{4})(?:\D+?(\d{1,2}):(\d{2}))?/)
  if (!m) return null
  const month = MONTHS[m[2]]
  if (!month) return null
  const pad = (n: string | number) => String(n).padStart(2, '0')
  const iso = `${m[3]}-${pad(month)}-${pad(m[1])}T${pad(m[4] ?? 0)}:${m[5] ?? '00'}:00-03:00`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

/** RFC 4180: quoted fields may hold commas, doubled quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

// ── Status ──────────────────────────────────────────────────────────────────

/**
 * Where a report row says the sale ended up, in the CRM's terms. Derived at read
 * time from the stored status text, so improving the mapping re-reads old uploads.
 *
 *   ACTIVE              — the sale stands (shipping, delivered, dispute won).
 *   IN_DISPUTE          — a claim/mediation is open but no money has moved yet.
 *   CANCELLED           — cancelled before shipping.
 *   RETURN_PENDING      — refunded, goods on their way back.
 *   RETURNED_RESELLABLE — return reviewed and fit for sale.
 *   RETURNED_UNSELLABLE — return reviewed and not fit for sale.
 *   REFUNDED            — refunded and nothing is coming back.
 */
export type ReportOutcome =
  | 'ACTIVE'
  | 'IN_DISPUTE'
  | 'CANCELLED'
  | 'RETURN_PENDING'
  | 'RETURNED_RESELLABLE'
  | 'RETURNED_UNSELLABLE'
  | 'REFUNDED'

export function reportOutcome(row: {
  status: string
  returnResult: string | null
  refundsArs: number
  totalArs: number
}): ReportOutcome {
  const status = row.status.toLowerCase()
  const result = (row.returnResult ?? '').toLowerCase()

  if (status.includes('cancelad')) return 'CANCELLED'
  if (/devoluci[oó]n finalizada/.test(status)) {
    if (result.startsWith('no apto')) return 'RETURNED_UNSELLABLE'
    if (result.startsWith('apto') || status.includes('de nuevo a la venta')) {
      return 'RETURNED_RESELLABLE'
    }
    // Finished, but the report doesn't say what state the goods came back in:
    // leave it awaiting a human to confirm receipt.
    return 'RETURN_PENDING'
  }
  if (status.includes('te dimos el dinero')) return 'ACTIVE'
  if (/mediaci[oó]n|reclamo/.test(status)) {
    return status.includes('reembolso') ? 'REFUNDED' : 'IN_DISPUTE'
  }
  if (/devoluci[oó]n/.test(status)) return 'RETURN_PENDING'
  if (row.refundsArs < 0 && row.totalArs <= 0) return 'REFUNDED'
  return 'ACTIVE'
}
