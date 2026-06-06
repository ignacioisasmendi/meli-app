import { NextRequest, NextResponse } from 'next/server'
import { startOfDay } from 'date-fns'
import { prisma } from '@/lib/prisma'
import { isAuthorizedCron, runJob } from '@/lib/cron'
import { getBestSeller } from '@/lib/metrics'
import { getUsdArsRate } from '@/lib/settings'
import { sendTelegramMessage } from '@/lib/telegram/client'
import { dailySummaryMessage } from '@/lib/telegram/messages'

export const dynamic = 'force-dynamic'

/**
 * Sends the daily summary to Telegram. Schedule once per day (e.g. 21:00) with
 * the CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const summary = await runJob('daily-summary', async () => {
    const dayStart = startOfDay(new Date())
    const [agg, bestSeller, rate] = await Promise.all([
      prisma.sale.aggregate({
        where: { soldAt: { gte: dayStart } },
        _sum: { salePriceArs: true, profitUsd: true },
        _count: { _all: true },
      }),
      getBestSeller(dayStart),
      getUsdArsRate(),
    ])

    const revenueArs = agg._sum.salePriceArs ?? 0
    const profitArs = (agg._sum.profitUsd ?? 0) * rate

    const sent = await sendTelegramMessage(
      dailySummaryMessage({
        sales: agg._count._all,
        revenueArs,
        profitArs,
        bestSeller,
      })
    )

    return {
      detail: `sales=${agg._count._all} revenueArs=${revenueArs.toFixed(0)} sent=${sent}`,
      result: { sales: agg._count._all, revenueArs, profitArs, sent },
    }
  })

  return NextResponse.json({ ok: true, ...summary })
}
