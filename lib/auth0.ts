import { Auth0Client } from '@auth0/nextjs-auth0/server'

export const auth0 = new Auth0Client({
  authorizationParameters: {
    scope: 'openid profile email offline_access',
  },
})

export function isAccessTokenError(error: unknown): boolean {
  return (
    error instanceof Error &&
    ['missing_refresh_token', 'expired_access_token', 'invalid_session'].includes(
      (error as { code?: string }).code ?? ''
    )
  )
}
