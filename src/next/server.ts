import { cookies, headers } from 'next/headers'
import { resolveConfig, type AuthConfig } from '../core/config'
import { unpackSession } from '../core/session'
import type { Session } from '../core/types'

export async function getUser(options: AuthConfig): Promise<Session | null> {
  const config = resolveConfig(options)
  const cookieStore = await cookies()
  const cookie = cookieStore.get(config.sessionCookieName)?.value
  if (!cookie) return null
  return await unpackSession(cookie, config)
}

export async function requireUser(options: AuthConfig): Promise<Session> {
  const user = await getUser(options)
  if (!user) throw new Error('not_authenticated')
  return user
}

export async function getUserFromHeaders(): Promise<Pick<Session, 'email' | 'sub'> | null> {
  const h = await headers()
  const email = h.get('x-vikingo-user-email')
  const sub = h.get('x-vikingo-user-sub')
  if (!email || !sub) return null
  return { email, sub }
}
