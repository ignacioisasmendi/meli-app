import 'server-only'

// Mercado Libre OAuth 2.0 (authorization code + PKCE-less server flow).
// Argentina auth domain; the API host is region-agnostic.
const AUTH_BASE = 'https://auth.mercadolibre.com.ar'
export const ML_API_BASE = 'https://api.mercadolibre.com'

export interface MlTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope: string
  user_id: number
  refresh_token: string
}

function clientId() {
  const id = process.env.ML_CLIENT_ID
  if (!id) throw new Error('ML_CLIENT_ID not set')
  return id
}

function clientSecret() {
  const secret = process.env.ML_CLIENT_SECRET
  if (!secret) throw new Error('ML_CLIENT_SECRET not set')
  return secret
}

function redirectUri() {
  const uri = process.env.ML_REDIRECT_URI
  if (!uri) throw new Error('ML_REDIRECT_URI not set')
  return uri
}

/** Builds the ML authorization URL. `state` round-trips for CSRF protection. */
export function buildAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId(),
    redirect_uri: redirectUri(),
    state,
    // `offline_access` is required for ML to return a refresh_token.
    scope: 'offline_access read write',
  })
  return `${AUTH_BASE}/authorization?${params.toString()}`
}

async function tokenRequest(body: Record<string, string>): Promise<MlTokenResponse> {
  const res = await fetch(`${ML_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`ML token request failed (${res.status}): ${text.slice(0, 300)}`)
  }
  return res.json()
}

export function exchangeCodeForToken(code: string): Promise<MlTokenResponse> {
  return tokenRequest({
    grant_type: 'authorization_code',
    client_id: clientId(),
    client_secret: clientSecret(),
    code,
    redirect_uri: redirectUri(),
  })
}

export function refreshAccessToken(refreshToken: string): Promise<MlTokenResponse> {
  return tokenRequest({
    grant_type: 'refresh_token',
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: refreshToken,
  })
}
