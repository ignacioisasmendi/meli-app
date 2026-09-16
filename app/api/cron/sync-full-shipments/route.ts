import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron, runJob } from '@/lib/cron'
import { syncFullShipmentReceptions } from '@/lib/inventory/full-shipments'

export const dynamic = 'force-dynamic'

/**
 * Polls Mercado Libre for Full shipments that have been received since they
 * were sent. There's no webhook for this — schedule it (e.g. Railway cron)
 * three times a day (e.g. 09:00, 14:00, 20:00) with the CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const summary = await runJob('sync-full-shipments', async () => {
    const result = await syncFullShipmentReceptions()
    return {
      detail: `checked ${result.checked}, ${result.received} received`,
      result,
    }
  })

  return NextResponse.json({ ok: true, ...summary })
}
