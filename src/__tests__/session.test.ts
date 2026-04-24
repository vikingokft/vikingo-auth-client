import { describe, it, expect } from 'vitest'
import { resolveConfig } from '../core/config'
import { packSession, unpackSession } from '../core/session'
import type { Session } from '../core/types'

const baseSession: Session = {
  sub: '12345',
  email: 'user@wpviking.com',
  name: 'Test User',
  hd: 'wpviking.com',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
  lastSyncedAt: Date.now(),
}

describe('session pack/unpack', () => {
  it('round-trips a session with explicit sessionSecret', async () => {
    const config = resolveConfig({ appId: 'app1', sessionSecret: 'a'.repeat(64) })
    const cookie = await packSession(baseSession, config)
    const unpacked = await unpackSession(cookie, config)
    expect(unpacked?.email).toBe(baseSession.email)
    expect(unpacked?.sub).toBe(baseSession.sub)
    expect(unpacked?.hd).toBe(baseSession.hd)
  })

  it('round-trips a session with derived key from clientSecret', async () => {
    const config = resolveConfig({ appId: 'app1', clientSecret: 'shared-secret-value' })
    const cookie = await packSession(baseSession, config)
    const unpacked = await unpackSession(cookie, config)
    expect(unpacked?.email).toBe(baseSession.email)
  })

  it('round-trips a session with derived key from appId only (public client)', async () => {
    const config = resolveConfig({ appId: 'app1' })
    const cookie = await packSession(baseSession, config)
    const unpacked = await unpackSession(cookie, config)
    expect(unpacked?.email).toBe(baseSession.email)
  })

  it('rejects a tampered cookie', async () => {
    const config = resolveConfig({ appId: 'app1' })
    const cookie = await packSession(baseSession, config)
    const tampered = cookie.slice(0, -2) + 'XX'
    const unpacked = await unpackSession(tampered, config)
    expect(unpacked).toBeNull()
  })

  it('rejects a cookie signed by another app (different derived key)', async () => {
    const config1 = resolveConfig({ appId: 'app1' })
    const config2 = resolveConfig({ appId: 'app2' })
    const cookie = await packSession(baseSession, config1)
    const unpacked = await unpackSession(cookie, config2)
    expect(unpacked).toBeNull()
  })

  it('rejects an expired cookie', async () => {
    const config = resolveConfig({ appId: 'app1' })
    const expired = { ...baseSession, exp: Math.floor(Date.now() / 1000) - 60 }
    const cookie = await packSession(expired, config)
    const unpacked = await unpackSession(cookie, config)
    expect(unpacked).toBeNull()
  })

  it('rejects malformed cookie', async () => {
    const config = resolveConfig({ appId: 'app1' })
    const unpacked = await unpackSession('not-a-jwt', config)
    expect(unpacked).toBeNull()
  })
})
