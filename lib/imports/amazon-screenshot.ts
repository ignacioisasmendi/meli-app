/**
 * Reads an Amazon "Order Details" screenshot into structured purchase lines.
 *
 * Amazon's layout is stable (order number + date at the top, an Order Summary
 * box on the right, then one row per shipment/item), but the pieces we need are
 * scattered: the price next to an item is the PER-UNIT price, while the quantity
 * only shows as a small circled badge over the thumbnail. That combination is
 * what makes plain OCR unreliable, so we hand the image to Claude with a strict
 * JSON schema and reconcile the result against the on-screen subtotal.
 */

import Anthropic from '@anthropic-ai/sdk'
import { normalizeOrder, type ParsedOrder, type Screenshot } from '@/lib/imports/amazon-order'
import { EXTRACTION_SYSTEM_PROMPT } from '@/lib/imports/amazon-prompt'

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

/**
 * Sends the screenshot(s) to Claude and returns the order it read off them.
 * Throws on API/parse failures — the caller maps those to an error response.
 */
export async function parseAmazonOrderScreenshots(
  screenshots: Screenshot[]
): Promise<ParsedOrder> {
  if (!process.env.ANTHROPIC_API_KEY) throw new MissingAnthropicKeyError()
  if (screenshots.length === 0) throw new Error('No screenshot provided')

  const client = new Anthropic()

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 8000,
    system: EXTRACTION_SYSTEM_PROMPT,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: ORDER_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: [
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
      },
    ],
  })

  if (response.stop_reason === 'max_tokens') {
    throw new Error('That order was too long to read in one pass — try fewer screenshots at a time')
  }
  if (response.stop_reason === 'refusal') {
    throw new Error('Could not read that image')
  }

  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text
  if (!text) throw new Error('No data could be read from that screenshot')

  return normalizeOrder(JSON.parse(text) as ParsedOrder)
}
