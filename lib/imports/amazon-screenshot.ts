/**
 * Reads an Amazon "Order Details" screenshot into structured purchase lines.
 *
 * Amazon's layout is stable (order number + date at the top, an Order Summary
 * box on the right, then one row per shipment/item), but the pieces we need are
 * scattered: the price next to an item is the PER-UNIT price, while the quantity
 * only shows as a small circled badge over the thumbnail. That combination is
 * what makes plain OCR unreliable, so we hand the image to Claude with a strict
 * JSON schema and reconcile the result against the on-screen subtotal.
 *
 * The browser extension sends the page's text instead of a picture of it
 * (`parseAmazonOrderText`): same schema and checks, cheaper, and no OCR step.
 */

import Anthropic from '@anthropic-ai/sdk'
import {
  normalizeOrder,
  type ParsedOrder,
  type ParsedOrderItem,
  type Screenshot,
} from '@/lib/imports/amazon-order'
import {
  EXTRACTION_SYSTEM_PROMPT,
  TEXT_EXTRACTION_SYSTEM_PROMPT,
} from '@/lib/imports/amazon-prompt'

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] }
const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] }

const ORDER_SCHEMA = {
  type: 'object',
  properties: {
    orderNumber: nullableString,
    purchasedAt: nullableString,
    itemsSubtotal: nullableNumber,
    tax: nullableNumber,
    shipping: nullableNumber,
    grandTotal: nullableNumber,
    currency: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          fullTitle: { type: 'string' },
          quantity: { type: 'integer' },
          unitPrice: { type: 'number' },
          seller: nullableString,
        },
        required: ['name', 'fullTitle', 'quantity', 'unitPrice', 'seller'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'orderNumber',
    'purchasedAt',
    'itemsSubtotal',
    'tax',
    'shipping',
    'grandTotal',
    'currency',
    'items',
  ],
  additionalProperties: false,
}

/**
 * The text path's schema: same order, plus each item's ASIN, picked from the
 * product links the extension found on the page.
 */
const ORDER_WITH_ASIN_SCHEMA = (() => {
  const item = ORDER_SCHEMA.properties.items.items
  return {
    ...ORDER_SCHEMA,
    properties: {
      ...ORDER_SCHEMA.properties,
      items: {
        ...ORDER_SCHEMA.properties.items,
        items: {
          ...item,
          properties: { ...item.properties, asin: nullableString },
          required: [...item.required, 'asin'],
        },
      },
    },
  }
})()

/** A product link found on the order page by the browser extension. */
export interface PageProductLink {
  asin: string
  /** The link's text — usually the listing title, sometimes shortened. */
  title: string
}

/** Thrown when the API key is missing, so callers can show a config error. */
export class MissingAnthropicKeyError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY is not set')
    this.name = 'MissingAnthropicKeyError'
  }
}

/** Longest page text sent to Claude. An order page is a few thousand characters. */
export const MAX_PAGE_TEXT_CHARS = 60_000

/**
 * Sends one extraction request and returns the order Claude read. Throws on
 * API/parse failures — the caller maps those to an error response.
 */
async function extractOrder(
  system: string,
  content: Anthropic.ContentBlockParam[],
  errors: { tooLong: string; unreadable: string },
  schema: Record<string, unknown> = ORDER_SCHEMA
): Promise<ParsedOrder> {
  if (!process.env.ANTHROPIC_API_KEY) throw new MissingAnthropicKeyError()

  const client = new Anthropic()

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 8000,
    system,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema },
    },
    messages: [{ role: 'user', content }],
  })

  if (response.stop_reason === 'max_tokens') throw new Error(errors.tooLong)
  if (response.stop_reason === 'refusal') throw new Error(errors.unreadable)

  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text
  if (!text) throw new Error(errors.unreadable)

  return normalizeOrder(JSON.parse(text) as ParsedOrder)
}

/** Sends the screenshot(s) to Claude and returns the order it read off them. */
export async function parseAmazonOrderScreenshots(
  screenshots: Screenshot[]
): Promise<ParsedOrder> {
  if (screenshots.length === 0) throw new Error('No screenshot provided')

  return extractOrder(
    EXTRACTION_SYSTEM_PROMPT,
    [
      ...screenshots.map((s) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: s.mediaType, data: s.data },
      })),
      {
        type: 'text' as const,
        text:
          screenshots.length === 1
            ? 'Extract this order.'
            : `Extract this order. The ${screenshots.length} screenshots are parts of the same order page, in order.`,
      },
    ],
    {
      tooLong: 'That order was too long to read in one pass — try fewer screenshots at a time',
      unreadable: 'Could not read that image',
    }
  )
}

const normalizeTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Keeps an item's ASIN only if the page actually linked to it — Claude picks
 * from the list, but a made-up or mistyped id must never reach the catalog.
 * Items left without one get it when exactly one link carries their title.
 */
export function resolveItemAsins(
  items: ParsedOrderItem[],
  links: PageProductLink[]
): ParsedOrderItem[] {
  const onPage = new Set(links.map((l) => l.asin))
  return items.map((item) => {
    if (item.asin && onPage.has(item.asin)) return item

    const title = normalizeTitle(item.fullTitle || item.name)
    const candidates = new Set(
      links
        .filter((l) => {
          const text = normalizeTitle(l.title)
          // A shortened link text still has to be long enough to mean something.
          return text.length >= 15 && (title === text || title.startsWith(text))
        })
        .map((l) => l.asin)
    )
    return { ...item, asin: candidates.size === 1 ? [...candidates][0] : null }
  })
}

/**
 * Reads an order from the visible text of its "Order Details" page. With the
 * page's product links, each item also comes back with its ASIN.
 */
export async function parseAmazonOrderText(
  pageText: string,
  url?: string,
  links: PageProductLink[] = []
): Promise<ParsedOrder> {
  const text = pageText.trim().slice(0, MAX_PAGE_TEXT_CHARS)
  if (!text) throw new Error('The page had no text to read')

  const linkList = links.map((l) => `${l.asin} — ${l.title || '(no text)'}`).join('\n')

  const order = await extractOrder(
    TEXT_EXTRACTION_SYSTEM_PROMPT,
    [
      {
        type: 'text',
        text:
          `Extract the order from this page${url ? ` (${url})` : ''}.` +
          `\n\n<page>\n${text}\n</page>` +
          `\n\n<product_links>\n${linkList || '(none found)'}\n</product_links>`,
      },
    ],
    {
      tooLong: 'That order was too long to read in one pass',
      unreadable: 'Could not read an order from that page',
    },
    ORDER_WITH_ASIN_SCHEMA
  )
  return { ...order, items: resolveItemAsins(order.items, links) }
}
