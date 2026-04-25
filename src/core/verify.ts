import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { ResolvedConfig } from './config'
import type { Session } from './types'

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getJwks(authServer: string) {
  let jwks = jwksCache.get(authServer)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${authServer}/jwks.json`))
    jwksCache.set(authServer, jwks)
  }
  return jwks
}

export async function verifyAuthJwt(token: string, config: ResolvedConfig): Promise<Session> {
  const { payload } = await jwtVerify(token, getJwks(config.authServer), {
    issuer: config.issuer,
    audience: config.appId,
  })

  const sub = payload.sub
  const email = payload.email
  const name = payload.name
  const hd = payload.hd
  if (typeof sub !== 'string' || typeof email !== 'string' || typeof name !== 'string' || typeof hd !== 'string') {
    throw new Error('invalid_token_claims')
  }

  const guest = payload.guest === true
  const invitedBy = typeof payload.invited_by === 'string' ? payload.invited_by : undefined

  const session: Session = {
    sub,
    email,
    name,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    hd,
    iat: payload.iat ?? 0,
    exp: payload.exp ?? 0,
  }
  if (guest) {
    session.guest = true
    if (invitedBy) session.invitedBy = invitedBy
  }
  return session
}
