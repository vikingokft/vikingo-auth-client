import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveConfig } from '../core/config'
import { buildAuthorizeUrl, exchangeCodeForToken, syncUserStatus } from '../core/api'

describe('buildAuthorizeUrl', () => {
  it('constructs the right URL with app + return params', () => {
    const config = resolveConfig({ appId: 'my-app' })
    const url = buildAuthorizeUrl(config, 'https://example.com/auth/callback')
    expect(url).toContain('https://vikingoauth.hu/authorize')
    expect(url).toContain('app=my-app')
    expect(url).toContain('return=https%3A%2F%2Fexample.com%2Fauth%2Fcallback')
  })

  it('uses custom authServer if set', () => {
    const config = resolveConfig({ appId: 'x', authServer: 'https://staging.vikingoauth.hu' })
    const url = buildAuthorizeUrl(config, 'https://example.com')
    expect(url.startsWith('https://staging.vikingoauth.hu/authorize')).toBe(true)
  })
})

describe('exchangeCodeForToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sends only code + client_id when no clientSecret', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ token_type: 'Bearer', access_token: 'jwt', expires_in: 3600, user: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const config = resolveConfig({ appId: 'my-app' })
    await exchangeCodeForToken(config, 'auth-code')

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    const sent = JSON.parse(calls[0]![1].body as string)
    expect(sent.code).toBe('auth-code')
    expect(sent.client_id).toBe('my-app')
    expect(sent.client_secret).toBeUndefined()
  })

  it('includes client_secret when set', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ token_type: 'Bearer', access_token: 'jwt', expires_in: 3600, user: {} }), {
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const config = resolveConfig({ appId: 'my-app', clientSecret: 'secret-val' })
    await exchangeCodeForToken(config, 'code')

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    const sent = JSON.parse(calls[0]![1].body as string)
    expect(sent.client_secret).toBe('secret-val')
  })

  it('throws on non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad', { status: 400 })),
    )
    const config = resolveConfig({ appId: 'my-app' })
    await expect(exchangeCodeForToken(config, 'code')).rejects.toThrow(/token exchange failed/)
  })
})

describe('syncUserStatus', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns parsed status from response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'active' }), { status: 200 })),
    )
    const config = resolveConfig({ appId: 'x' })
    const status = await syncUserStatus(config, 'user-sub')
    expect(status).toBe('active')
  })

  it('parses suspended status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'suspended' }), { status: 200 })),
    )
    const config = resolveConfig({ appId: 'x' })
    expect(await syncUserStatus(config, 'sub')).toBe('suspended')
  })

  it('throws on server error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('err', { status: 502 })),
    )
    const config = resolveConfig({ appId: 'x' })
    await expect(syncUserStatus(config, 'sub')).rejects.toThrow(/sync failed/)
  })
})
