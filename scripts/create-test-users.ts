import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Creates Mercado Libre *test users* (https://developers.mercadolibre.com.ar/es_ar/realiza-pruebas).
 *
 * ML has no sandbox — you test against production with disposable test users
 * that can only buy/sell/ask among themselves. This script borrows a valid
 * access token from a connected account in the DB (refreshing it if needed),
 * creates one or more test users, and appends their credentials to
 * `ml-test-users.json` at the repo root (git-ignored — contains passwords).
 *
 * Usage:
 *   tsx --env-file=.env scripts/create-test-users.ts [count] [site_id]
 *   tsx --env-file=.env scripts/create-test-users.ts 2 MLA   # default
 *
 * The first created user is labelled "seller", the rest "buyer".
 * Limit: up to 10 test users per real ML account.
 */

const ML_API_BASE = 'https://api.mercadolibre.com'
const REFRESH_SKEW_MS = 10 * 60 * 1000
const OUT_FILE = resolve(process.cwd(), 'ml-test-users.json')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

interface TestUserResponse {
  id: number
  nickname: string
  password: string
  email?: string
  site_status: string
}

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch(`${ML_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.ML_CLIENT_ID!,
      client_secret: process.env.ML_CLIENT_SECRET!,
      refresh_token: refreshToken,
    }).toString(),
  })
  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  }
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>
}

async function getToken(): Promise<{ token: string; nickname: string }> {
  const account = await prisma.mercadoLibreAccount.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!account) {
    throw new Error('No active MercadoLibreAccount found — connect one via /api/mercadolibre/connect first.')
  }

  if (account.expiresAt.getTime() - Date.now() >= REFRESH_SKEW_MS) {
    return { token: account.accessToken, nickname: account.nickname }
  }

  console.log(`Token for ${account.nickname} is expiring — refreshing…`)
  const fresh = await refreshAccessToken(account.refreshToken)
  await prisma.mercadoLibreAccount.update({
    where: { id: account.id },
    data: {
      accessToken: fresh.access_token,
      refreshToken: fresh.refresh_token,
      expiresAt: new Date(Date.now() + fresh.expires_in * 1000),
    },
  })
  return { token: fresh.access_token, nickname: account.nickname }
}

async function createTestUser(token: string, siteId: string): Promise<TestUserResponse> {
  const res = await fetch(`${ML_API_BASE}/users/test_user`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ site_id: siteId }),
  })
  if (!res.ok) {
    throw new Error(`test_user creation failed (${res.status}): ${(await res.text()).slice(0, 400)}`)
  }
  return res.json() as Promise<TestUserResponse>
}

async function main() {
  const count = Number(process.argv[2]) || 2
  const siteId = process.argv[3] || 'MLA'

  const { token, nickname } = await getToken()
  console.log(`Using token from connected account "${nickname}" to create ${count} test user(s) on ${siteId}.\n`)

  const existing: unknown[] = existsSync(OUT_FILE)
    ? JSON.parse(readFileSync(OUT_FILE, 'utf8'))
    : []

  const created: Array<TestUserResponse & { role: string; siteId: string; createdAt: string }> = []
  for (let i = 0; i < count; i++) {
    const role = i === 0 ? 'seller' : 'buyer'
    const user = await createTestUser(token, siteId)
    const record = { ...user, role, siteId, createdAt: new Date().toISOString() }
    created.push(record)
    console.log(`✓ ${role}: ${user.nickname}  (id ${user.id})  password: ${user.password}`)
  }

  writeFileSync(OUT_FILE, JSON.stringify([...existing, ...created], null, 2) + '\n')
  console.log(`\nSaved ${created.length} test user(s) to ${OUT_FILE}`)
  console.log('Reminder: log in at mercadolibre.com.ar with these nicknames; email codes = last 4–6 digits of the user id.')
}

main()
  .catch((err) => {
    console.error('Error:', err.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
