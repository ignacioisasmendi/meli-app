import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isAuthorizedCron, runJob } from '@/lib/cron'
import { getValidAccessToken } from '@/lib/mercadolibre/client'

export const dynamic = 'force-dynamic'

/**
 * Refreshes ML access tokens that expire within the next hour. Schedule this
 * (e.g. Railway cron) every ~30 min with the CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const summary = await runJob('refresh-tokens', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000)
    const accounts = await prisma.mercadoLibreAccount.findMany({
      where: { isActive: true, expiresAt: { lt: soon } },
    })

    let refreshed = 0
    const failures: string[] = []
    for (const account of accounts) {
      try {
        await getValidAccessToken(account)
        refreshed++
      } catch (err) {
        failures.push(`${account.nickname}: ${err instanceof Error ? err.message : err}`)
      }
    }

    return {
      detail: `refreshed ${refreshed}/${accounts.length}` +
        (failures.length ? `; failures: ${failures.join(' | ')}` : ''),
      result: { refreshed, total: accounts.length, failures },
    }
  })

  return NextResponse.json({ ok: true, ...summary })
}
