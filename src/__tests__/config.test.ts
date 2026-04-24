import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveConfig } from '../core/config'

describe('resolveConfig', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.VIKINGO_AUTH_APP_ID
    delete process.env.VIKINGO_AUTH_CLIENT_SECRET
    delete process.env.VERCEL_GIT_REPO_SLUG
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL
    delete process.env.VERCEL_URL
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('uses explicit appId if passed', () => {
    const cfg = resolveConfig({ appId: 'my-app' })
    expect(cfg.appId).toBe('my-app')
  })

  it('falls back to VIKINGO_AUTH_APP_ID env', () => {
    process.env.VIKINGO_AUTH_APP_ID = 'from-env'
    const cfg = resolveConfig({})
    expect(cfg.appId).toBe('from-env')
  })

  it('falls back to VERCEL_GIT_REPO_SLUG', () => {
    process.env.VERCEL_GIT_REPO_SLUG = 'from-vercel'
    const cfg = resolveConfig({})
    expect(cfg.appId).toBe('from-vercel')
  })

  it('falls back to VERCEL_PROJECT_PRODUCTION_URL subdomain', () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'my-prod-app.vercel.app'
    const cfg = resolveConfig({})
    expect(cfg.appId).toBe('my-prod-app')
  })

  it('falls back to VERCEL_URL subdomain (lowest priority Vercel-style)', () => {
    process.env.VERCEL_URL = 'preview-deploy.vercel.app'
    const cfg = resolveConfig({})
    expect(cfg.appId).toBe('preview-deploy')
  })

  it('throws if no appId source available', () => {
    expect(() => resolveConfig({})).toThrow(/appId not set/)
  })

  it('priority: explicit > env > Vercel system', () => {
    process.env.VIKINGO_AUTH_APP_ID = 'env-value'
    process.env.VERCEL_GIT_REPO_SLUG = 'vercel-slug'
    const cfg = resolveConfig({ appId: 'explicit' })
    expect(cfg.appId).toBe('explicit')
  })

  it('clientSecret is undefined by default (public client model)', () => {
    const cfg = resolveConfig({ appId: 'x' })
    expect(cfg.clientSecret).toBeUndefined()
  })

  it('clientSecret from explicit option', () => {
    const cfg = resolveConfig({ appId: 'x', clientSecret: 's' })
    expect(cfg.clientSecret).toBe('s')
  })

  it('clientSecret from env var', () => {
    process.env.VIKINGO_AUTH_CLIENT_SECRET = 'env-secret'
    const cfg = resolveConfig({ appId: 'x' })
    expect(cfg.clientSecret).toBe('env-secret')
  })

  it('default authServer is vikingoauth.hu', () => {
    const cfg = resolveConfig({ appId: 'x' })
    expect(cfg.authServer).toBe('https://vikingoauth.hu')
  })

  it('default sessionCookieName is vikingo_auth', () => {
    const cfg = resolveConfig({ appId: 'x' })
    expect(cfg.sessionCookieName).toBe('vikingo_auth')
  })

  it('default syncIntervalSeconds is 300', () => {
    const cfg = resolveConfig({ appId: 'x' })
    expect(cfg.syncIntervalSeconds).toBe(300)
  })

  it('failClosedOnSyncError defaults to false', () => {
    const cfg = resolveConfig({ appId: 'x' })
    expect(cfg.failClosedOnSyncError).toBe(false)
  })

  it('respects failClosedOnSyncError override', () => {
    const cfg = resolveConfig({ appId: 'x', failClosedOnSyncError: true })
    expect(cfg.failClosedOnSyncError).toBe(true)
  })
})
