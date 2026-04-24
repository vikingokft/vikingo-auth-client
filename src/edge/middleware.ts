import { buildAuthorizeUrl, exchangeCodeForToken, syncUserStatus } from '../core/api'
import { resolveConfig, type AuthConfig } from '../core/config'
import { packSession, unpackSession } from '../core/session'
import type { Session } from '../core/types'
import { verifyAuthJwt } from '../core/verify'

export interface VikingoEdgeAuthOptions extends AuthConfig {
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

function clearCookie(headers: Headers, name: string) {
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
  const config = resolveConfig(options)
  const callbackPath = options.callbackPath ?? DEFAULTS.callbackPath
  const loginPath = options.loginPath ?? DEFAULTS.loginPath
  const logoutPath = options.logoutPath ?? DEFAULTS.logoutPath
  const publicPaths = options.publicPaths ?? []

  if (!config.sessionSecret) {
    throw new Error('@vikingokft/auth-client: sessionSecret is required')
  }

  function isPublic(pathname: string): boolean {
    if (pathname === callbackPath || pathname === loginPath || pathname === logoutPath) return true
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
    const returnTo = url.searchParams.get('from') ?? '/'
    const callbackUrl = new URL(callbackPath, originOf(req))
    callbackUrl.searchParams.set('rt', returnTo)
    return redirect(buildAuthorizeUrl(config, callbackUrl.toString()))
  }

  async function handleCallback(req: Request, url: URL): Promise<Response> {
    const code = url.searchParams.get('code')
    const returnTo = url.searchParams.get('rt') ?? '/'
    if (!code) return redirect(new URL(loginPath, originOf(req)).toString())

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
      return redirect(dest.toString(), headers)
    } catch (err) {
      console.error('[vikingo-auth] callback error:', err)
      return redirect(new URL(loginPath, originOf(req)).toString())
    }
  }

  async function handleLogout(req: Request): Promise<Response> {
    const headers = new Headers()
    clearCookie(headers, config.sessionCookieName)
    return redirect(new URL('/', originOf(req)).toString(), headers)
  }

  return async function middleware(req: Request): Promise<Response | undefined> {
    const url = new URL(req.url)
    const { pathname } = url

    if (pathname === loginPath) return handleLogin(req, url)
    if (pathname === callbackPath) return handleCallback(req, url)
    if (pathname === logoutPath) return handleLogout(req)

    if (isPublic(pathname)) return undefined

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
      clearCookie(headers, config.sessionCookieName)
      return redirect(loginUrl.toString(), headers)
    }

    const syncIntervalMs = config.syncIntervalSeconds * 1000
    const needsSync = !session.lastSyncedAt || Date.now() - session.lastSyncedAt > syncIntervalMs
    if (needsSync) {
      try {
        const status = await syncUserStatus(config, session.sub)
        if (status !== 'active') {
          const loginUrl = new URL(loginPath, originOf(req))
          loginUrl.searchParams.set('reason', status)
          const headers = new Headers()
          clearCookie(headers, config.sessionCookieName)
          return redirect(loginUrl.toString(), headers)
        }
      } catch (err) {
        console.error('[vikingo-auth] sync error (allowing request to proceed):', err)
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
