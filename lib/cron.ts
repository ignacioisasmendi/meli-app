import 'server-only'
import type { NextRequest } from 'next/server'
import { JobStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Validates the cron shared secret. Accepts either
 *   Authorization: Bearer <CRON_SECRET>
 * or ?secret=<CRON_SECRET> (handy for some schedulers).
 */
export function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization')
  if (header === `Bearer ${secret}`) return true
  return request.nextUrl.searchParams.get('secret') === secret
}

/** Wraps a job body in a JobRun record for observability. */
export async function runJob<T>(
  name: string,
  fn: () => Promise<{ detail?: string; result: T }>
): Promise<T> {
  const job = await prisma.jobRun.create({ data: { name } })
  try {
    const { detail, result } = await fn()
    await prisma.jobRun.update({
      where: { id: job.id },
      data: { status: JobStatus.SUCCESS, detail, finishedAt: new Date() },
    })
    return result
  } catch (err) {
    await prisma.jobRun.update({
      where: { id: job.id },
      data: {
        status: JobStatus.FAILED,
        detail: err instanceof Error ? err.message.slice(0, 500) : String(err),
        finishedAt: new Date(),
      },
    })
    throw err
  }
}
