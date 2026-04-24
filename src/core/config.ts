export const AUTH_SERVER_BASE = 'https://vikingoauth.hu'
export const AUTH_SERVER_ISSUER = 'https://vikingoauth.hu'

export interface AuthConfig {
  /**
   * The app identifier registered on the auth server.
   * Optional: if omitted, falls back to `VIKINGO_AUTH_APP_ID` then `VERCEL_GIT_REPO_SLUG`
   * env vars, then derives from `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL`.
   */
  appId?: string

  /**
   * Optional: per-app client secret. Not required in the public client model (v0.4.0+).
   * Only set if you want the extra layer of request authentication on top of SSO + callback URL validation.
   */
  clientSecret?: string

  /**
   * Override the auth server base URL. Defaults to https://vikingoauth.hu.
   */
  authServer?: string

  /**
   * Optional explicit session-signing secret. If omitted, derived deterministically from `appId` via HKDF.
   * You typically do NOT need to set this.
   */
  sessionSecret?: string

  sessionCookieName?: string
  syncIntervalSeconds?: number
}

function appIdFromVercelUrl(): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined
  const url = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL
  if (!url) return undefined
  const host = url.split('/')[0] ?? ''
  const label = host.split('.')[0]
  return label || undefined
}

function resolveAppId(cfg: AuthConfig): string {
  const env = typeof process !== 'undefined' && process.env ? process.env : undefined
  const envAppId = env?.VIKINGO_AUTH_APP_ID ?? env?.VERCEL_GIT_REPO_SLUG ?? appIdFromVercelUrl()
  const appId = cfg.appId ?? envAppId
  if (!appId) {
    throw new Error(
      '@vikingokft/auth-client: appId not set. Pass `appId` explicitly, or set VIKINGO_AUTH_APP_ID env var. (Vercel system vars VERCEL_GIT_REPO_SLUG / VERCEL_PROJECT_PRODUCTION_URL are auto-detected when available.)',
    )
  }
  return appId
}

function resolveClientSecret(cfg: AuthConfig): string | undefined {
  const envSecret =
    typeof process !== 'undefined' && process.env ? process.env.VIKINGO_AUTH_CLIENT_SECRET : undefined
  return cfg.clientSecret ?? envSecret
}

export function resolveConfig(cfg: AuthConfig) {
  return {
    appId: resolveAppId(cfg),
    clientSecret: resolveClientSecret(cfg),
    authServer: cfg.authServer ?? AUTH_SERVER_BASE,
    issuer: cfg.authServer ?? AUTH_SERVER_ISSUER,
    sessionSecret: cfg.sessionSecret,
    sessionCookieName: cfg.sessionCookieName ?? 'vikingo_auth',
    syncIntervalSeconds: cfg.syncIntervalSeconds ?? 300,
  }
}

export type ResolvedConfig = ReturnType<typeof resolveConfig>
