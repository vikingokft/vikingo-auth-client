import { NextResponse, type NextRequest } from 'next/server'
import { buildAuthorizeUrl, exchangeCodeForToken } from '../core/api'
import { resolveConfig, type AuthConfig } from '../core/config'
import { packSession, unpackSession } from '../core/session'
import { syncUserStatus } from '../core/api'
import { verifyAuthJwt } from '../core/verify'

export interface VikingoAuthOptions extends AuthConfig {
  callbackPath?: string
  loginPath?: string
  logoutPath?: string
  publicPaths?: (string | RegExp)[]
}

const DEFAULTS = {
  callbackPath: '/auth/callback',
  loginPath: '/auth/login',
  logoutPath: '/auth/logout',
}

export function vikingoAuth(options: VikingoAuthOptions) {
  const config = resolveConfig(options)
  const callbackPath = options.callbackPath ?? DEFAULTS.callbackPath
  const loginPath = options.loginPath ?? DEFAULTS.loginPath
  const logoutPath = options.logoutPath ?? DEFAULTS.logoutPath
  const publicPaths = options.publicPaths ?? []

  function isPublic(pathname: string): boolean {
    if (pathname === callbackPath || pathname === loginPath || pathname === logoutPath) return true
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

  function clearCookie(res: NextResponse) {
    res.cookies.set(config.sessionCookieName, '', { maxAge: 0, path: '/' })
  }

  async function handleLogin(req: NextRequest): Promise<NextResponse> {
    const returnTo = req.nextUrl.searchParams.get('from') ?? '/'
    const callbackUrl = new URL(callbackPath, originOf(req))
    callbackUrl.searchParams.set('rt', returnTo)
    return NextResponse.redirect(buildAuthorizeUrl(config, callbackUrl.toString()))
  }

  async function handleCallback(req: NextRequest): Promise<NextResponse> {
    const code = req.nextUrl.searchParams.get('code')
    const returnTo = req.nextUrl.searchParams.get('rt') ?? '/'
    if (!code) {
      return NextResponse.redirect(new URL(loginPath, originOf(req)))
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
      return res
    } catch (err) {
      console.error('[vikingo-auth] callback error:', err)
      return NextResponse.redirect(new URL(loginPath, originOf(req)))
    }
  }

  async function handleLogout(req: NextRequest): Promise<NextResponse> {
    const res = NextResponse.redirect(new URL('/', originOf(req)))
    clearCookie(res)
    return res
  }

  return async function middleware(req: NextRequest): Promise<NextResponse> {
    const { pathname } = req.nextUrl

    if (pathname === loginPath) return handleLogin(req)
    if (pathname === callbackPath) return handleCallback(req)
    if (pathname === logoutPath) return handleLogout(req)

    if (isPublic(pathname)) return NextResponse.next()

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
      clearCookie(res)
      return res
    }

    if (session.exp * 1000 < Date.now()) {
      const url = new URL(loginPath, originOf(req))
      url.searchParams.set('from', pathname + req.nextUrl.search)
      const res = NextResponse.redirect(url)
      clearCookie(res)
      return res
    }

    const nextRes = NextResponse.next()
    nextRes.headers.set('x-vikingo-user-email', session.email)
    nextRes.headers.set('x-vikingo-user-sub', session.sub)

    const syncIntervalMs = config.syncIntervalSeconds * 1000
    const needsSync = !session.lastSyncedAt || Date.now() - session.lastSyncedAt > syncIntervalMs
    if (needsSync) {
      try {
        const status = await syncUserStatus(config, session.sub)
        if (status !== 'active') {
          const url = new URL(loginPath, originOf(req))
          url.searchParams.set('reason', status)
          const res = NextResponse.redirect(url)
          clearCookie(res)
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
        console.error('[vikingo-auth] sync error (allowing request to proceed):', err)
      }
    }

    return nextRes
  }
}
