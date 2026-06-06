import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/session'
import { exchangeCodeForToken, ML_API_BASE } from '@/lib/mercadolibre/oauth'

export const dynamic = 'force-dynamic'

const ACCOUNTS_URL = (base: string, params = '') => `${base}/accounts${params}`

/** ML redirects here with `code` + `state`. We exchange, then upsert the account. */
export async function GET(request: NextRequest) {
  const base = process.env.APP_BASE_URL ?? new URL(request.url).origin
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const cookieState = request.cookies.get('ml_oauth_state')?.value

  if (searchParams.get('error')) {
    return NextResponse.redirect(ACCOUNTS_URL(base, '?error=denied'))
  }
  if (!code || !state || state !== cookieState) {
    return NextResponse.redirect(ACCOUNTS_URL(base, '?error=invalid_state'))
  }

  try {
    const user = await getCurrentUser()
    const token = await exchangeCodeForToken(code)

    // ML only returns a refresh_token when the app has the `offline_access`
    // scope and the user is authorizing fresh. Without it we can't keep the
    // account connected, so fail loudly instead of with an opaque DB error.
    if (!token.refresh_token) {
      console.error('[ml callback] no refresh_token in ML response — enable offline_access on the app and re-authorize')
      return NextResponse.redirect(ACCOUNTS_URL(base, '?error=no_refresh_token'))
    }

    const mlUserId = String(token.user_id)

    // Fetch the nickname for display.
    let nickname = mlUserId
    try {
      const meRes = await fetch(`${ML_API_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
        cache: 'no-store',
      })
      if (meRes.ok) {
        const me = await meRes.json()
        nickname = me.nickname ?? nickname
      }
    } catch {
      /* nickname is best-effort */
    }

    const expiresAt = new Date(Date.now() + token.expires_in * 1000)
    await prisma.mercadoLibreAccount.upsert({
      where: { mlUserId },
      update: {
        nickname,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt,
        isActive: true,
        userId: user.id,
      },
      create: {
        nickname,
        mlUserId,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt,
        userId: user.id,
      },
    })

    const res = NextResponse.redirect(ACCOUNTS_URL(base, '?connected=1'))
    res.cookies.delete('ml_oauth_state')
    return res
  } catch (err) {
    console.error('[ml callback] error:', err)
    return NextResponse.redirect(ACCOUNTS_URL(base, '?error=exchange_failed'))
  }
}
