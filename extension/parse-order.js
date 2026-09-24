// Reads an Amazon "Order Details" page straight from the DOM — no AI. Returns
// the same shape the CRM's import form uses (`ParsedOrder` in
// lib/imports/amazon-order.ts), with each item's ASIN taken from its link.
//
// Amazon serves more than one layout of this page, so every field is looked
// up the same way: the specific markup first (data-component attributes, the
// long-lived yohtmlc-* classes), then the printed labels ("Order placed",
// "Item(s) Subtotal", "Qty:"), which change far less often than the markup.
// The CRM re-adds the lines and flags any total that doesn't match, so a field
// read wrong shows up on review instead of being imported silently.

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- called from content.js, loaded after it
function meliappParseOrder(doc, url) {
  const ASIN_IN_URL = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/
  const ORDER_NUMBER = /\b\d{3}-\d{7}-\d{7}\b/
  const MONEY = /(-|\()?\s*(?:US)?\$\s?([\d,]+\.\d{2})/
  const GENERIC_LINK =
    /^(buy it again|view your item|write a (product )?review|track package|return or replace|get product support|share gift receipt|ask product question|comprar de nuevo|ver tu art)/i
  // Carousels of other products ("Customers also bought", "Buy it again") live
  // on the same page and link to /dp/ too.
  const NOT_THE_ORDER =
    '[id*="carousel" i], [class*="carousel" i], [id*="recommend" i], [class*="recommend" i], [id*="p13n" i], [class*="p13n" i], [id*="rhf" i], [id*="sims" i]'
  const MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  }

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const textOf = (el) => (el ? el.innerText || el.textContent || '' : '')
  const round2 = (n) => Math.round(n * 100) / 100

  /** "$1,234.50" → 1234.5; "-$5.99" / "($5.99)" → -5.99; null when there is no amount. */
  function money(s) {
    const m = (s || '').match(MONEY)
    if (!m) return null
    const n = Number(m[2].replace(/,/g, ''))
    return m[1] ? -n : n
  }

  /** "September 20, 2026" / "20 September 2026" → "2026-09-20". */
  function isoDate(s) {
    const t = clean(s)
    let m = t.match(/([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/)
    let month, day, year
    if (m) [, month, day, year] = m
    else if ((m = t.match(/(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/))) [, day, month, year] = m
    else return null
    const mm = MONTHS[month.slice(0, 3).toLowerCase()]
    if (!mm) return null
    return `${year}-${String(mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  const lines = textOf(doc.body)
    .split('\n')
    .map(clean)
    .filter(Boolean)

  /**
   * The amount printed next to a label: on the label's own line, or on the
   * next line when label and value sit in separate columns.
   */
  function amountAfter(label) {
    let total = null
    for (let i = 0; i < lines.length; i++) {
      if (!label.test(lines[i])) continue
      const here = money(lines[i].replace(label, ''))
      const value = here != null ? here : money(lines[i + 1] || '')
      if (value != null) total = round2((total || 0) + value)
    }
    return total
  }

  /* ── Order header ─────────────────────────────────────────────────────── */

  let orderNumber = null
  try {
    orderNumber = (new URL(url).searchParams.get('orderID') || '').match(ORDER_NUMBER)?.[0] || null
  } catch {
    /* not a URL — fall through to the page */
  }
  if (!orderNumber) {
    const el = doc.querySelector('[data-component="orderId"], .order-date-invoice-item bdi, bdi')
    orderNumber = textOf(el).match(ORDER_NUMBER)?.[0] || textOf(doc.body).match(ORDER_NUMBER)?.[0] || null
  }

  let purchasedAt = isoDate(textOf(doc.querySelector('[data-component="orderDate"]')))
  if (!purchasedAt) {
    const i = lines.findIndex((l) => /order placed|ordered on/i.test(l))
    if (i >= 0) purchasedAt = isoDate(lines[i].replace(/.*?(order placed|ordered on):?/i, '')) || isoDate(lines[i + 1])
  }

  /* ── Order summary ────────────────────────────────────────────────────── */

  const itemsSubtotal = amountAfter(/^item\(s\) subtotal:?/i)
  const grossShipping = amountAfter(/^shipping (&|and) handling:?/i)
  // "Free Shipping: -$5.99" cancels the S&H line above it.
  const freeShipping = amountAfter(/^free shipping:?/i)
  const tax = amountAfter(/^(estimated tax to be collected|tax collected|estimated tax|sales tax|tax):?/i)
  const grandTotal = amountAfter(/^(grand total|order total):?/i)
  // Promotions and coupons are not split across the items: the CRM flags the
  // grand total as off, and the unit prices get adjusted on review.
  const discount = amountAfter(/^(promotion applied|your coupon savings|subscribe & save|discount|gift card amount):?/i)
  const shipping = grossShipping == null ? null : round2(Math.max(0, grossShipping + (freeShipping || 0)))

  /* ── Items ────────────────────────────────────────────────────────────── */

  const titleSelectors = [
    '[data-component="itemTitle"] a',
    '.yohtmlc-product-title a',
    'a.yohtmlc-product-title',
    'a[href*="/dp/"]',
    'a[href*="/gp/product/"]',
  ]

  /** Title links, one per item: the product link whose text is the listing title. */
  function titleLinks() {
    for (const selector of titleSelectors) {
      const found = [...doc.querySelectorAll(selector)].filter((a) => {
        if (!ASIN_IN_URL.test(a.getAttribute('href') || '')) return false
        if (a.closest(NOT_THE_ORDER)) return false
        const t = clean(textOf(a))
        return t.length >= 3 && !GENERIC_LINK.test(t)
      })
      if (found.length) return found
    }
    return []
  }

  const links = titleLinks()
  const asinOf = (a) => (a.getAttribute('href') || '').match(ASIN_IN_URL)[1]
  const hasOtherItem = (el, asin) =>
    links.some((other) => asinOf(other) !== asin && el.contains(other))

  function unitPriceIn(el) {
    const priced = el.querySelector(
      '[data-component="unitPrice"] .a-offscreen, .a-price .a-offscreen, .yohtmlc-item .a-color-price, .a-color-price'
    )
    const fromMarkup = money(textOf(priced))
    if (fromMarkup != null && fromMarkup > 0) return fromMarkup
    for (const line of textOf(el).split('\n')) {
      const v = money(line)
      if (v != null && v > 0) return v
    }
    return null
  }

  function quantityIn(el) {
    const badge = el.querySelector(
      '.product-image__qty, .item-view-qty, [data-component="quantity"], .od-item-view-qty'
    )
    const fromBadge = parseInt(clean(textOf(badge)).replace(/\D/g, ''), 10)
    if (fromBadge > 0) return fromBadge
    const m = textOf(el).match(/\b(?:qty|quantity)\s*:?\s*(\d+)/i)
    return m ? parseInt(m[1], 10) : 1
  }

  function sellerIn(el) {
    const m = textOf(el).match(/sold by:?\s*([^\n]+)/i)
    return m ? clean(m[1]).replace(/\s*(return|supplied by).*$/i, '') || null : null
  }

  /** "DJI Mic Mini (1 TX + 1 RX), Ultralight, Detail-Rich Audio" → "DJI Mic Mini (1 TX + 1 RX)". */
  function shortName(title) {
    const cut = title.split(/\s*(?:,|\s[-–—|]\s)\s*/)[0] || title
    return (cut.length >= 8 ? cut : title).slice(0, 60).trim()
  }

  const items = []
  const problems = []
  const seen = new Set()
  for (const a of links) {
    const asin = asinOf(a)
    // The price column: the smallest block around the title that has a price
    // and no other item in it.
    let block = a.parentElement
    while (block && block !== doc.body && unitPriceIn(block) == null) {
      if (hasOtherItem(block.parentElement || block, asin)) break
      block = block.parentElement
    }
    // The whole row: widen past the thumbnail (quantity badge) while it's
    // still only this item.
    let row = block
    for (let i = 0; i < 4 && row && row.parentElement && row.parentElement !== doc.body; i++) {
      if (hasOtherItem(row.parentElement, asin)) break
      row = row.parentElement
    }
    if (!block || seen.has(block)) continue
    seen.add(block)

    const fullTitle = clean(textOf(a)).slice(0, 500)
    const unitPrice = unitPriceIn(block)
    if (unitPrice == null) problems.push(`sin precio: ${shortName(fullTitle)}`)
    items.push({
      name: shortName(fullTitle),
      fullTitle,
      quantity: quantityIn(row),
      unitPrice,
      seller: sellerIn(row),
      asin,
    })
  }

  if (!orderNumber) problems.push('sin número de orden')
  if (items.length === 0) problems.push('no encontré productos')

  return {
    order: {
      orderNumber,
      purchasedAt,
      itemsSubtotal,
      tax,
      shipping,
      grandTotal,
      currency: 'USD',
      items,
    },
    discount,
    problems,
  }
}
