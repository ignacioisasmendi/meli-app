import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { auth0 } from '@/lib/auth0'

export async function middleware(request: NextRequest) {
  const authRes = await auth0.middleware(request)
  const { pathname } = request.nextUrl

  // Auth routes (/auth/login, /auth/callback, ...) are auto-mounted by the SDK.
  if (pathname.startsWith('/auth')) {
    return authRes
  }

  // ML webhooks and cron jobs authenticate themselves — no user session required.
  if (
    pathname.startsWith('/api/webhooks') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/api/mercadolibre/callback')
  ) {
    return authRes
  }

  // Everything else is protected: require a session, else redirect to login.
  const session = await auth0.getSession(request)
  if (!session) {
    const { origin } = new URL(request.url)
    return NextResponse.redirect(`${origin}/auth/login`)
  }

  return authRes
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
