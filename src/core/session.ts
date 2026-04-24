import { base64url, jwtVerify, SignJWT } from 'jose'
import type { ResolvedConfig } from './config'
import type { Session } from './types'

async function sessionKey(secret: string): Promise<Uint8Array> {
  const hashed = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return new Uint8Array(hashed)
}

export async function packSession(session: Session, config: ResolvedConfig): Promise<string> {
  if (!config.sessionSecret) {
    throw new Error('sessionSecret is required to pack sessions')
  }
  const key = await sessionKey(config.sessionSecret)
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(session.exp)
    .sign(key)
}

export async function unpackSession(
  cookie: string,
  config: ResolvedConfig,
): Promise<Session | null> {
  if (!config.sessionSecret) return null
  try {
    const key = await sessionKey(config.sessionSecret)
    const { payload } = await jwtVerify(cookie, key)
    return payload as unknown as Session
  } catch {
    return null
  }
}

export { base64url }
