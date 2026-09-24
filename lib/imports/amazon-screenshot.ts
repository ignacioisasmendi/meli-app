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
import { normalizeOrder, type ParsedOrder, type Screenshot } from '@/lib/imports/amazon-order'
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
  errors: { tooLong: string; unreadable: string }
): Promise<ParsedOrder> {
  if (!process.env.ANTHROPIC_API_KEY) throw new MissingAnthropicKeyError()

  const client = new Anthropic()

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 8000,
    system,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: ORDER_SCHEMA },
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

/** Reads an order from the visible text of its "Order Details" page. */
export async function parseAmazonOrderText(pageText: string, url?: string): Promise<ParsedOrder> {
  const text = pageText.trim().slice(0, MAX_PAGE_TEXT_CHARS)
  if (!text) throw new Error('The page had no text to read')

  return extractOrder(
    TEXT_EXTRACTION_SYSTEM_PROMPT,
    [
      {
        type: 'text',
        text: `Extract the order from this page${url ? ` (${url})` : ''}.\n\n<page>\n${text}\n</page>`,
      },
    ],
    {
      tooLong: 'That order was too long to read in one pass',
      unreadable: 'Could not read an order from that page',
    }
  )
}
