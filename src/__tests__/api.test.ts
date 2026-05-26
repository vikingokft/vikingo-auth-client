import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveConfig } from '../core/config'
import { autoRegisterApp, buildAuthorizeUrl, exchangeCodeForToken, syncUserStatus } from '../core/api'

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

describe('autoRegisterApp', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs new app when registry returns 404', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const config = resolveConfig({ appId: 'my-app' })
    const res = await autoRegisterApp(config, 'https://a.example/auth/callback', 'tok')

    expect(res).toEqual({ alreadyRegistered: false, callbackAdded: true })
    expect(fetchMock.mock.calls).toHaveLength(2)
    const [, postInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(postInit.method).toBe('POST')
    const body = JSON.parse(postInit.body as string)
    expect(body.callback_urls).toEqual(['https://a.example/auth/callback'])
  })

  it('no-ops when callback URL is already registered', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'active',
          app_id: 'my-app',
          callback_urls: ['https://a.example/auth/callback'],
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const config = resolveConfig({ appId: 'my-app' })
    const res = await autoRegisterApp(config, 'https://a.example/auth/callback', 'tok')

    expect(res).toEqual({ alreadyRegistered: true, callbackAdded: false })
    expect(fetchMock.mock.calls).toHaveLength(1)
  })

  it('PATCHes additively when a new callback URL appears for an existing app', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'active',
            app_id: 'my-app',
            callback_urls: ['https://a.example/auth/callback'],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const config = resolveConfig({ appId: 'my-app' })
    const res = await autoRegisterApp(config, 'https://b.example/auth/callback', 'tok')

    expect(res).toEqual({ alreadyRegistered: true, callbackAdded: true })
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('https://vikingoauth.hu/register/my-app')
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body as string)
    expect(body.callback_urls).toEqual([
      'https://a.example/auth/callback',
      'https://b.example/auth/callback',
    ])
  })

  it('throws if PATCH fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ callback_urls: ['https://a/auth/callback'] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const config = resolveConfig({ appId: 'my-app' })
    await expect(autoRegisterApp(config, 'https://b/auth/callback', 'tok')).rejects.toThrow(
      /auto-register PATCH failed/,
    )
  })
})
