export const AUTH_SERVER_BASE = 'https://vikingoauth.hu'
export const AUTH_SERVER_ISSUER = 'https://vikingoauth.hu'

export interface AuthConfig {
  appId: string
  clientSecret: string
  authServer?: string
  sessionSecret?: string
  sessionCookieName?: string
  syncIntervalSeconds?: number
}

export function resolveConfig(cfg: AuthConfig) {
  return {
    appId: cfg.appId,
    clientSecret: cfg.clientSecret,
    authServer: cfg.authServer ?? AUTH_SERVER_BASE,
    issuer: cfg.authServer ?? AUTH_SERVER_ISSUER,
    sessionSecret: cfg.sessionSecret,
    sessionCookieName: cfg.sessionCookieName ?? 'vikingo_auth',
    syncIntervalSeconds: cfg.syncIntervalSeconds ?? 300,
  }
}

export type ResolvedConfig = ReturnType<typeof resolveConfig>
