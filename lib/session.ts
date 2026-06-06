import { auth0 } from '@/lib/auth0'
import { prisma } from '@/lib/prisma'
import type { User } from '@prisma/client'

/**
 * Returns the Auth0 session, or null if unauthenticated.
 * Pages are already protected by middleware, but server actions should re-check.
 */
export async function getSession() {
  return auth0.getSession()
}

/**
 * Returns the local User row for the current session, creating/updating it from
 * the Auth0 profile on first sight. Throws if there is no session.
 */
export async function getCurrentUser(): Promise<User> {
  const session = await auth0.getSession()
  if (!session?.user) {
    throw new Error('Not authenticated')
  }

  const { sub, email, name } = session.user
  return prisma.user.upsert({
    where: { auth0Sub: sub },
    update: { email: email ?? '', name: name ?? null },
    create: { auth0Sub: sub, email: email ?? '', name: name ?? null },
  })
}

/** Throws unless there is a valid session. Use to guard server actions. */
export async function requireUser(): Promise<User> {
  return getCurrentUser()
}
