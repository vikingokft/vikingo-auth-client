import { autoRegisterApp, buildAuthorizeUrl, exchangeCodeForToken, syncUserStatus } from '../core/api'
import {
  resolveConfig,
  STATE_COOKIE_MAX_AGE,
  STATE_COOKIE_NAME,
  type AuthConfig,
  type ResolvedConfig,
} from '../core/config'
import { packSession, unpackSession } from '../core/session'
import type { Session } from '../core/types'
import { verifyAuthJwt } from '../core/verify'

// Auto-register state — lásd next/middleware.ts a részletes magyarázatért.
let autoRegisterPromise: Promise<void> | null = null

function deriveProductionCallbackUrlEdge(req: Request, callbackPath: string): string {
  const env = typeof process !== 'undefined' && process.env ? process.env : undefined
  const prod = env?.VERCEL_PROJECT_PRODUCTION_URL
  if (prod) return `https://${prod}${callbackPath}`
  const url = new URL(req.url)
  const proto = req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')
  const host = req.headers.get('host') ?? url.host
  return `${proto}://${host}${callbackPath}`
}

function tryAutoRegisterEdge(config: ResolvedConfig, callbackUrl: string): void {
  if (autoRegisterPromise) return
  const env = typeof process !== 'undefined' && process.env ? process.env : undefined
  const token = env?.VIKINGO_AUTH_REGISTRATION_TOKEN
  if (!token) return
  if (env?.VERCEL_ENV && env.VERCEL_ENV !== 'production') return
  autoRegisterPromise = autoRegisterApp(config, callbackUrl, token)
    .then((res) => {
      if (!res.alreadyRegistered) {
        console.log(`[vikingo-auth] auto-registered app ${config.appId} (${callbackUrl})`)
      }
    })
    .catch((err) => {
      console.error('[vikingo-auth] auto-register failed (will retry):', err)
      autoRegisterPromise = null
    })
}

function randomNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface VikingoEdgeAuthOptions extends AuthConfig {
  callbackPath?: string
  loginPath?: string
  logoutPath?: string
  /** Path used by the guest invite redemption flow. See next/middleware for full docs. */
  inviteCallbackPath?: string
  publicPaths?: (string | RegExp)[]
}

const DEFAULTS = {
  callbackPath: '/auth/callback',
  loginPath: '/auth/login',
  logoutPath: '/auth/logout',
  inviteCallbackPath: '/auth/invite-callback',
}

function setCookie(
  headers: Headers,
  name: string,
  value: string,
  opts: { maxAge: number; httpOnly?: boolean; secure?: boolean; sameSite?: 'Lax' | 'Strict' | 'None' },
) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=/`, `Max-Age=${opts.maxAge}`]
  if (opts.httpOnly !== false) parts.push('HttpOnly')
  if (opts.secure !== false) parts.push('Secure')
  parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`)
  headers.append('set-cookie', parts.join('; '))
}

function clearCookieHeader(headers: Headers, name: string) {
  setCookie(headers, name, '', { maxAge: 0 })
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=')
    if (i === -1) continue
    out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1))
  }
  return out
}

function redirect(to: string, extraHeaders?: Headers): Response {
  const headers = new Headers(extraHeaders)
  headers.set('location', to)
  return new Response(null, { status: 302, headers })
}

export function vikingoEdgeAuth(options: VikingoEdgeAuthOptions) {
  let cached: ResolvedConfig | null = null
  function getConfig(): ResolvedConfig {
    if (!cached) cached = resolveConfig(options)
    return cached
  }

  const callbackPath = options.callbackPath ?? DEFAULTS.callbackPath
  const loginPath = options.loginPath ?? DEFAULTS.loginPath
  const logoutPath = options.logoutPath ?? DEFAULTS.logoutPath
  const inviteCallbackPath = options.inviteCallbackPath ?? DEFAULTS.inviteCallbackPath
  const publicPaths = options.publicPaths ?? []

  function isPublic(pathname: string): boolean {
    if (
      pathname === callbackPath ||
      pathname === loginPath ||
      pathname === logoutPath ||
      pathname === inviteCallbackPath
    )
      return true
    for (const rule of publicPaths) {
      if (typeof rule === 'string' ? pathname.startsWith(rule) : rule.test(pathname)) return true
    }
    return false
  }

  function originOf(req: Request): string {
    const url = new URL(req.url)
    const proto = req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')
    const host = req.headers.get('host') ?? url.host
    return `${proto}://${host}`
  }

  async function handleLogin(req: Request, url: URL): Promise<Response> {
    const config = getConfig()
    const returnTo = url.searchParams.get('from') ?? '/'
    const callbackUrl = new URL(callbackPath, originOf(req))
    callbackUrl.searchParams.set('rt', returnTo)

    // CSRF védelem: lásd next/middleware.ts kommentje
    const clientState = randomNonce()
    callbackUrl.searchParams.set('cs', clientState)

    const headers = new Headers()
    setCookie(headers, STATE_COOKIE_NAME, clientState, { maxAge: STATE_COOKIE_MAX_AGE })
    return redirect(buildAuthorizeUrl(config, callbackUrl.toString()), headers)
  }

  async function handleCallback(req: Request, url: URL): Promise<Response> {
    const config = getConfig()
    const code = url.searchParams.get('code')
    const returnTo = url.searchParams.get('rt') ?? '/'
    const queryState = url.searchParams.get('cs')
    const cookies = parseCookies(req.headers.get('cookie'))
    const cookieState = cookies[STATE_COOKIE_NAME]

    if (!code || !queryState || !cookieState || queryState !== cookieState) {
      console.warn('[vikingo-auth] callback CSRF check failed or missing code')
      const headers = new Headers()
      clearCookieHeader(headers, STATE_COOKIE_NAME)
      return redirect(new URL(loginPath, originOf(req)).toString(), headers)
    }

    try {
      const token = await exchangeCodeForToken(config, code)
      const verified = await verifyAuthJwt(token.access_token, config)
      const session: Session = { ...verified, lastSyncedAt: Date.now() }
      const packed = await packSession(session, config)

      const dest = new URL(returnTo.startsWith('/') ? returnTo : '/', originOf(req))
      const headers = new Headers()
      setCookie(headers, config.sessionCookieName, packed, {
        maxAge: Math.max(60, session.exp - Math.floor(Date.now() / 1000)),
      })
      clearCookieHeader(headers, STATE_COOKIE_NAME)
      return redirect(dest.toString(), headers)
    } catch (err) {
      console.error('[vikingo-auth] callback error:', err)
      const headers = new Headers()
      clearCookieHeader(headers, STATE_COOKIE_NAME)
      return redirect(new URL(loginPath, originOf(req)).toString(), headers)
    }
  }

  async function handleLogout(req: Request): Promise<Response> {
    const config = getConfig()
    const headers = new Headers()
    clearCookieHeader(headers, config.sessionCookieName)
    return redirect(new URL('/', originOf(req)).toString(), headers)
  }

  // Guest invite beváltás flow. Részletes magyarázat a next/middleware.ts-ben.
  async function handleInviteCallback(req: Request, url: URL): Promise<Response> {
    const config = getConfig()
    const code = url.searchParams.get('code')
    if (!code) {
      console.warn('[vikingo-auth] invite-callback missing code')
      return redirect(new URL(loginPath, originOf(req)).toString())
    }
    try {
      const token = await exchangeCodeForToken(config, code)
      const verified = await verifyAuthJwt(token.access_token, config)
      if (!verified.guest) {
        console.warn('[vikingo-auth] invite-callback rejected: not a guest token')
        return redirect(new URL(loginPath, originOf(req)).toString())
      }
      const session: Session = { ...verified, lastSyncedAt: Date.now() }
      const packed = await packSession(session, config)

      const dest = new URL('/', originOf(req))
      const headers = new Headers()
      setCookie(headers, config.sessionCookieName, packed, {
        maxAge: Math.max(60, session.exp - Math.floor(Date.now() / 1000)),
      })
      clearCookieHeader(headers, STATE_COOKIE_NAME)
      return redirect(dest.toString(), headers)
    } catch (err) {
      console.error('[vikingo-auth] invite-callback error:', err)
      return redirect(new URL(loginPath, originOf(req)).toString())
    }
  }

  return async function middleware(req: Request): Promise<Response | undefined> {
    // Lazy auto-register — modul-szintű promise cache, fire-and-forget.
    try {
      tryAutoRegisterEdge(getConfig(), deriveProductionCallbackUrlEdge(req, callbackPath))
    } catch {
      // config error path lentebb kezeli
    }

    const url = new URL(req.url)
    const { pathname } = url

    if (pathname === loginPath) return handleLogin(req, url)
    if (pathname === callbackPath) return handleCallback(req, url)
    if (pathname === inviteCallbackPath) return handleInviteCallback(req, url)
    if (pathname === logoutPath) return handleLogout(req)

    if (isPublic(pathname)) return undefined

    let config: ResolvedConfig
    try {
      config = getConfig()
    } catch (err) {
      console.error('[vikingo-auth] config error:', err)
      return undefined
    }

    const cookies = parseCookies(req.headers.get('cookie'))
    const cookie = cookies[config.sessionCookieName]
    if (!cookie) {
      const loginUrl = new URL(loginPath, originOf(req))
      loginUrl.searchParams.set('from', pathname + url.search)
      return redirect(loginUrl.toString())
    }

    const session = await unpackSession(cookie, config)
    if (!session || session.exp * 1000 < Date.now()) {
      const loginUrl = new URL(loginPath, originOf(req))
      loginUrl.searchParams.set('from', pathname + url.search)
      const headers = new Headers()
      clearCookieHeader(headers, config.sessionCookieName)
      return redirect(loginUrl.toString(), headers)
    }

    // /sync-et hívunk vendégekre is — a worker `guest_revoked` KV alapján kirúgja
    // a sessiont, ha admin visszavonta. Az iat scoping a re-invite eseteket megoldja.
    const syncIntervalMs = config.syncIntervalSeconds * 1000
    const needsSync = !session.lastSyncedAt || Date.now() - session.lastSyncedAt > syncIntervalMs
    if (needsSync) {
      try {
        const status = await syncUserStatus(config, session.sub, session.iat)
        if (status !== 'active') {
          const loginUrl = new URL(loginPath, originOf(req))
          loginUrl.searchParams.set('reason', status)
          const headers = new Headers()
          clearCookieHeader(headers, config.sessionCookieName)
          return redirect(loginUrl.toString(), headers)
        }
      } catch (err) {
        console.error('[vikingo-auth] sync error:', err)
        if (config.failClosedOnSyncError) {
          const loginUrl = new URL(loginPath, originOf(req))
          loginUrl.searchParams.set('reason', 'sync_unavailable')
          const headers = new Headers()
          clearCookieHeader(headers, config.sessionCookieName)
          return redirect(loginUrl.toString(), headers)
        }
      }
    }

    return undefined
  }
}

export async function getSessionFromRequest(
  req: Request,
  options: VikingoEdgeAuthOptions,
): Promise<Session | null> {
  const config = resolveConfig(options)
  const cookies = parseCookies(req.headers.get('cookie'))
  const cookie = cookies[config.sessionCookieName]
  if (!cookie) return null
  return await unpackSession(cookie, config)
}
