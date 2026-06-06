import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { buildAuthorizationUrl } from '@/lib/mercadolibre/oauth'

export const dynamic = 'force-dynamic'

/** Kicks off the ML OAuth flow: sets a CSRF state cookie and redirects to ML. */
export async function GET() {
  const state = randomBytes(16).toString('hex')
  const url = buildAuthorizationUrl(state)

  const res = NextResponse.redirect(url)
  res.cookies.set('ml_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return res
}
