/**
 * Fuzzy matching between a name read off a supplier screenshot and the existing
 * catalog, so a re-order maps onto the product it restocks instead of creating a
 * near-duplicate. Deliberately conservative: an unsure match is worse than none,
 * because the user only has to pick from a dropdown to fix a miss.
 */

export interface ProductCandidate {
  id: string
  name: string
  sku: string
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const tokenize = (s: string) => normalize(s).split(' ').filter((t) => t.length > 1)

/** Share of the product's own words that appear in the scanned name. */
function score(itemTokens: Set<string>, product: ProductCandidate): number {
  const productTokens = tokenize(product.name)
  if (productTokens.length < 2) return 0
  const hits = productTokens.filter((t) => itemTokens.has(t)).length
  return hits / productTokens.length
}

/** Best existing product for a scanned item name, or null when unsure. */
export function matchProduct(
  itemName: string,
  products: ProductCandidate[]
): ProductCandidate | null {
  const itemTokens = new Set(tokenize(itemName))
  if (itemTokens.size === 0) return null

  // An exact SKU printed in the listing title is unambiguous.
  const bySku = products.find((p) => p.sku && itemTokens.has(normalize(p.sku)))
  if (bySku) return bySku

  let best: ProductCandidate | null = null
  let bestScore = 0
  for (const product of products) {
    const s = score(itemTokens, product)
    if (s > bestScore) {
      best = product
      bestScore = s
    }
  }
  return bestScore >= 0.7 ? best : null
}

/** A readable SKU guess for a new product, unique against `taken`. */
export function suggestSku(itemName: string, taken: Set<string>): string {
  const base =
    tokenize(itemName).slice(0, 3).join('-').toUpperCase().slice(0, 24).replace(/-+$/, '') || 'ITEM'

  let candidate = base
  for (let n = 2; taken.has(candidate); n++) candidate = `${base}-${n}`
  return candidate
}
