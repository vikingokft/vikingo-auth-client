export const AUTH_SERVER_BASE = 'https://vikingoauth.hu'
export const AUTH_SERVER_ISSUER = 'https://vikingoauth.hu'

export interface AuthConfig {
  /**
   * The app identifier registered on the auth server.
   * Optional: if omitted, falls back to `VIKINGO_AUTH_APP_ID` then `VERCEL_GIT_REPO_SLUG` env var.
   */
  appId?: string

  /**
   * Per-app secret from the `/register` response.
   * Required. Keep in env var `VIKINGO_AUTH_CLIENT_SECRET` (or pass explicitly).
   */
  clientSecret?: string

  /**
   * Override the auth server base URL. Defaults to https://vikingoauth.hu.
   */
  authServer?: string

  /**
   * Optional explicit session-signing secret. If omitted, derived from `clientSecret` via HKDF.
   * You typically do NOT need to set this.
   */
  sessionSecret?: string

  sessionCookieName?: string
  syncIntervalSeconds?: number
}

function resolveAppId(cfg: AuthConfig): string {
  const envAppId =
    typeof process !== 'undefined' && process.env
      ? process.env.VIKINGO_AUTH_APP_ID ?? process.env.VERCEL_GIT_REPO_SLUG
      : undefined
  const appId = cfg.appId ?? envAppId
  if (!appId) {
    throw new Error(
      '@vikingokft/auth-client: appId not set. Either pass `appId` explicitly, or set VIKINGO_AUTH_APP_ID env var (Vercel: VERCEL_GIT_REPO_SLUG is auto-detected).',
    )
  }
  return appId
}

function resolveClientSecret(cfg: AuthConfig): string {
  const envSecret =
    typeof process !== 'undefined' && process.env ? process.env.VIKINGO_AUTH_CLIENT_SECRET : undefined
  const secret = cfg.clientSecret ?? envSecret
  if (!secret) {
    throw new Error(
      '@vikingokft/auth-client: clientSecret not set. Set VIKINGO_AUTH_CLIENT_SECRET env var or pass explicitly.',
    )
  }
  return secret
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
