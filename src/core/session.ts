import { base64url, jwtVerify, SignJWT } from 'jose'
import type { ResolvedConfig } from './config'
import type { Session } from './types'

const SESSION_KEY_INFO = 'vikingo-auth-session-v1'

async function deriveFromSecret(secret: string): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const masterKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'HKDF',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: encoder.encode(SESSION_KEY_INFO),
    },
    masterKey,
    256,
  )
  return new Uint8Array(bits)
}

async function sessionKey(config: ResolvedConfig): Promise<Uint8Array> {
  if (config.sessionSecret) {
    const hashed = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(config.sessionSecret))
    return new Uint8Array(hashed)
  }
  return await deriveFromSecret(config.clientSecret)
}

export async function packSession(session: Session, config: ResolvedConfig): Promise<string> {
  const key = await sessionKey(config)
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
  try {
    const key = await sessionKey(config)
    const { payload } = await jwtVerify(cookie, key)
    return payload as unknown as Session
  } catch {
    return null
  }
}

export { base64url }
