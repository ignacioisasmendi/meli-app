import { NextRequest, NextResponse } from 'next/server'
import { auth0 } from '@/lib/auth0'
import {
  MAX_SCREENSHOTS,
  MAX_SCREENSHOT_BYTES,
  SUPPORTED_MEDIA_TYPES,
  reconcileOrder,
  type Screenshot,
  type ScreenshotMediaType,
} from '@/lib/imports/amazon-order'
import {
  MissingAnthropicKeyError,
  parseAmazonOrderScreenshots,
} from '@/lib/imports/amazon-screenshot'

export const dynamic = 'force-dynamic'
/** Vision + reasoning takes a few seconds; 60s is the Vercel Hobby ceiling. */
export const maxDuration = 60

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/**
 * Reads Amazon order screenshots into draft purchase lines for the import form.
 * Nothing is written here — the user reviews the result and submits the normal
 * `importPurchases` action.
 */
export async function POST(request: NextRequest) {
  const session = await auth0.getSession()
  if (!session) return bad('unauthorized', 401)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return bad('Expected an image upload')
  }

  const files = form.getAll('images').filter((f): f is File => f instanceof File)
  if (files.length === 0) return bad('Attach at least one screenshot')
  if (files.length > MAX_SCREENSHOTS) {
    return bad(`Attach at most ${MAX_SCREENSHOTS} screenshots at a time`)
  }

  const screenshots: Screenshot[] = []
  for (const file of files) {
    if (!SUPPORTED_MEDIA_TYPES.includes(file.type as ScreenshotMediaType)) {
      return bad(`${file.name || 'That file'} is not a PNG, JPEG, WebP or GIF image`)
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      return bad(`${file.name || 'That image'} is larger than 5 MB`)
    }
    screenshots.push({
      mediaType: file.type as ScreenshotMediaType,
      data: Buffer.from(await file.arrayBuffer()).toString('base64'),
    })
  }

  try {
    const order = await parseAmazonOrderScreenshots(screenshots)
    return NextResponse.json({ order, warnings: reconcileOrder(order) })
  } catch (err) {
    console.error('[screenshot import] failed:', err)
    if (err instanceof MissingAnthropicKeyError) {
      return bad('Screenshot import is not configured — ANTHROPIC_API_KEY is missing', 503)
    }
    return bad(err instanceof Error ? err.message : 'Could not read that screenshot', 502)
  }
}
