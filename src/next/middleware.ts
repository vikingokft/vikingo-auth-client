import { NextResponse, type NextRequest } from 'next/server'
import { buildAuthorizeUrl, exchangeCodeForToken } from '../core/api'
import {
  resolveConfig,
  STATE_COOKIE_MAX_AGE,
  STATE_COOKIE_NAME,
  type AuthConfig,
  type ResolvedConfig,
} from '../core/config'
import { packSession, unpackSession } from '../core/session'
import { syncUserStatus } from '../core/api'
import { verifyAuthJwt } from '../core/verify'

function randomNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface VikingoAuthOptions extends AuthConfig {
  callbackPath?: string
  loginPath?: string
  logoutPath?: string
  /**
   * Path used by the guest invite redemption flow. The auth server's `/invite/redeem`
   * endpoint redirects guests here with a `?code=...` query parameter. Unlike `callbackPath`,
   * this path does NOT require a client-side state cookie (the invite token itself is the
   * proof of identity). However, this handler ONLY accepts JWTs with `guest: true` claim —
   * normal Workspace tokens are silently rejected to prevent CSRF bypass.
   * Defaults to `/auth/invite-callback`.
   */
  inviteCallbackPath?: string
  publicPaths?: (string | RegExp)[]
}

const DEFAULTS = {
  callbackPath: '/auth/callback',
  loginPath: '/auth/login',
  logoutPath: '/auth/logout',
  inviteCallbackPath: '/auth/invite-callback',
}

export function vikingoAuth(options: VikingoAuthOptions) {
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

  function originOf(req: NextRequest): string {
    const proto = req.headers.get('x-forwarded-proto') ?? 'https'
    const host = req.headers.get('host') ?? req.nextUrl.host
    return `${proto}://${host}`
  }

  function clearCookie(res: NextResponse, config: ResolvedConfig) {
    res.cookies.set(config.sessionCookieName, '', { maxAge: 0, path: '/' })
  }

  async function handleLogin(req: NextRequest): Promise<NextResponse> {
    const config = getConfig()
    const returnTo = req.nextUrl.searchParams.get('from') ?? '/'
    const callbackUrl = new URL(callbackPath, originOf(req))
    callbackUrl.searchParams.set('rt', returnTo)

    // CSRF védelem: a kliens által generált nonce a state cookie-ba kerül; az authorize
    // szervernek nem küldjük, mert ő úgyis saját state-et generál és visszaadja a callback
    // query-jében. Mi a callback-kor a saját kliens-state cookie-t verifikáljuk a query
    // 'state' paraméterrel — ez akadályozza meg, hogy egy attacker ráirányítson minket
    // egy tetszőleges code-ra (login-CSRF).
    const clientState = randomNonce()
    callbackUrl.searchParams.set('cs', clientState)

    const res = NextResponse.redirect(buildAuthorizeUrl(config, callbackUrl.toString()))
    res.cookies.set(STATE_COOKIE_NAME, clientState, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: STATE_COOKIE_MAX_AGE,
    })
    return res
  }

  async function handleCallback(req: NextRequest): Promise<NextResponse> {
    const config = getConfig()
    const code = req.nextUrl.searchParams.get('code')
    const returnTo = req.nextUrl.searchParams.get('rt') ?? '/'
    const queryState = req.nextUrl.searchParams.get('cs')
    const cookieState = req.cookies.get(STATE_COOKIE_NAME)?.value

    if (!code || !queryState || !cookieState || queryState !== cookieState) {
      // CSRF check failure OR malformed callback → silent reject, redirect to login.
      // We deliberately don't show a detailed error: would help an attacker probe.
      console.warn('[vikingo-auth] callback CSRF check failed or missing code')
      const res = NextResponse.redirect(new URL(loginPath, originOf(req)))
      res.cookies.set(STATE_COOKIE_NAME, '', { maxAge: 0, path: '/' })
      return res
    }

    try {
      const token = await exchangeCodeForToken(config, code)
      const verified = await verifyAuthJwt(token.access_token, config)
      const session = { ...verified, lastSyncedAt: Date.now() }
      const packed = await packSession(session, config)

      const dest = new URL(returnTo.startsWith('/') ? returnTo : '/', originOf(req))
      const res = NextResponse.redirect(dest)
      res.cookies.set(config.sessionCookieName, packed, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: Math.max(60, session.exp - Math.floor(Date.now() / 1000)),
      })
      // Clear the state cookie now that login is complete
      res.cookies.set(STATE_COOKIE_NAME, '', { maxAge: 0, path: '/' })
      return res
    } catch (err) {
      console.error('[vikingo-auth] callback error:', err)
      const res = NextResponse.redirect(new URL(loginPath, originOf(req)))
      res.cookies.set(STATE_COOKIE_NAME, '', { maxAge: 0, path: '/' })
      return res
    }
  }

  async function handleLogout(req: NextRequest): Promise<NextResponse> {
    const config = getConfig()
    const res = NextResponse.redirect(new URL('/', originOf(req)))
    clearCookie(res, config)
    return res
  }

  // Guest invite beváltás flow. A vikingo-auth-server `/invite/redeem` ide redirect-el
  // egy auth code-dal. A normál `/auth/callback`-kel ellentétben:
  //  - NINCS state cookie check (a vendég soha nem volt itt korábban, így nem lehet cookie-ja)
  //  - Csak `guest: true` claim-mel rendelkező JWT-t fogadunk el — különben ez az endpoint
  //    egy CSRF bypass lenne a normál Workspace user flow-ra is.
  async function handleInviteCallback(req: NextRequest): Promise<NextResponse> {
    const config = getConfig()
    const code = req.nextUrl.searchParams.get('code')
    if (!code) {
      console.warn('[vikingo-auth] invite-callback missing code')
      return NextResponse.redirect(new URL(loginPath, originOf(req)))
    }
    try {
      const token = await exchangeCodeForToken(config, code)
      const verified = await verifyAuthJwt(token.access_token, config)
      // Guest-only gate. Ha valaki normál Workspace auth code-ot küld erre az endpoint-ra,
      // CSRF védelmet bypass-olna — ezért csak guest token-t fogadunk el.
      if (!verified.guest) {
        console.warn('[vikingo-auth] invite-callback rejected: not a guest token')
        return NextResponse.redirect(new URL(loginPath, originOf(req)))
      }
      const session = { ...verified, lastSyncedAt: Date.now() }
      const packed = await packSession(session, config)

      const dest = new URL('/', originOf(req))
      const res = NextResponse.redirect(dest)
      res.cookies.set(config.sessionCookieName, packed, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: Math.max(60, session.exp - Math.floor(Date.now() / 1000)),
      })
      // Töröljük az esetleges stale state cookie-t — a guest flow nem használ
      res.cookies.set(STATE_COOKIE_NAME, '', { maxAge: 0, path: '/' })
      return res
    } catch (err) {
      console.error('[vikingo-auth] invite-callback error:', err)
      return NextResponse.redirect(new URL(loginPath, originOf(req)))
    }
  }

  return async function middleware(req: NextRequest): Promise<NextResponse> {
    const { pathname } = req.nextUrl

    if (pathname === loginPath) return handleLogin(req)
    if (pathname === callbackPath) return handleCallback(req)
    if (pathname === inviteCallbackPath) return handleInviteCallback(req)
    if (pathname === logoutPath) return handleLogout(req)

    if (isPublic(pathname)) return NextResponse.next()

    let config: ResolvedConfig
    try {
      config = getConfig()
    } catch (err) {
      console.error('[vikingo-auth] config error:', err)
      return NextResponse.next()
    }

    const cookie = req.cookies.get(config.sessionCookieName)?.value
    if (!cookie) {
      const url = new URL(loginPath, originOf(req))
      url.searchParams.set('from', pathname + req.nextUrl.search)
      return NextResponse.redirect(url)
    }

    const session = await unpackSession(cookie, config)
    if (!session) {
      const url = new URL(loginPath, originOf(req))
      url.searchParams.set('from', pathname + req.nextUrl.search)
      const res = NextResponse.redirect(url)
      clearCookie(res, config)
      return res
    }

    if (session.exp * 1000 < Date.now()) {
      const url = new URL(loginPath, originOf(req))
      url.searchParams.set('from', pathname + req.nextUrl.search)
      const res = NextResponse.redirect(url)
      clearCookie(res, config)
      return res
    }

    const nextRes = NextResponse.next()
    nextRes.headers.set('x-vikingo-user-email', session.email)
    nextRes.headers.set('x-vikingo-user-sub', session.sub)

    // Guest session-öket nem szinkronizáljuk: a Workspace Admin SDK nem ismeri őket
    // (a `sub` formátuma `guest:<email>`, ami nem valid Google user ID). A guest
    // hozzáférés egyetlen lifecycle kontrollja a JWT lejárata + a meghívó visszavonása
    // a redeem ELŐTT.
    const syncIntervalMs = config.syncIntervalSeconds * 1000
    const needsSync = !session.guest && (!session.lastSyncedAt || Date.now() - session.lastSyncedAt > syncIntervalMs)
    if (needsSync) {
      try {
        const status = await syncUserStatus(config, session.sub)
        if (status !== 'active') {
          const url = new URL(loginPath, originOf(req))
          url.searchParams.set('reason', status)
          const res = NextResponse.redirect(url)
          clearCookie(res, config)
          return res
        }
        const refreshed = { ...session, lastSyncedAt: Date.now() }
        const packed = await packSession(refreshed, config)
        nextRes.cookies.set(config.sessionCookieName, packed, {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/',
          maxAge: Math.max(60, refreshed.exp - Math.floor(Date.now() / 1000)),
        })
      } catch (err) {
        console.error('[vikingo-auth] sync error:', err)
        if (config.failClosedOnSyncError) {
          const url = new URL(loginPath, originOf(req))
          url.searchParams.set('reason', 'sync_unavailable')
          const res = NextResponse.redirect(url)
          clearCookie(res, config)
          return res
        }
        // fail-open: allow request to proceed, log for ops visibility
      }
    }

    return nextRes
  }
}
