import type { ResolvedConfig } from './config'
import type { SyncResponse, TokenResponse } from './types'
import { resilientFetch } from './fetch'

export async function exchangeCodeForToken(
  config: ResolvedConfig,
  code: string,
): Promise<TokenResponse> {
  const body: Record<string, string> = {
    code,
    client_id: config.appId,
  }
  if (config.clientSecret) body.client_secret = config.clientSecret

  // A /token egy egyszer használatos code-ot vált be. A retry biztonságos: a tranziens
  // hiba a TLS-kézfogás közben (a kérés elküldése ELŐTT) keletkezik, így a code érintetlen.
  const res = await resilientFetch(
    `${config.authServer}/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    { timeoutMs: 8000, retries: 1 },
  )

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`token exchange failed (${res.status}): ${errBody}`)
  }

  return (await res.json()) as TokenResponse
}

export async function syncUserStatus(
  config: ResolvedConfig,
  sub: string,
  iat?: number,
): Promise<SyncResponse['status']> {
  const body: Record<string, string | number> = {
    sub,
    client_id: config.appId,
  }
  if (config.clientSecret) body.client_secret = config.clientSecret
  // Vendég session-höz: a worker /sync az iat-ot összeveti a guest_revoked rekord
  // revokedAt-jával. Ha iat <= revokedAt, status=deleted, és a middleware kirúgja.
  // Workspace user-eknél az iat-ot a worker figyelmen kívül hagyja.
  if (typeof iat === 'number') body.iat = iat

  // A /sync minden requesten futhat (5 percenként) → szűkebb timeout, hogy egy lassú/flaky
  // szerver ne növelje érdemben a request-latenciát. Fail-open default mellett a hiba nem
  // blokkol; failClosedOnSyncError=true esetén a middleware login-redirecttel kezeli.
  const res = await resilientFetch(
    `${config.authServer}/sync`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    { timeoutMs: 5000, retries: 1 },
  )

  if (!res.ok) {
    throw new Error(`sync failed (${res.status})`)
  }

  const data = (await res.json()) as SyncResponse
  return data.status
}

export function buildAuthorizeUrl(config: ResolvedConfig, returnTo: string): string {
  const params = new URLSearchParams({
    app: config.appId,
    return: returnTo,
  })
  return `${config.authServer}/authorize?${params.toString()}`
}

/**
 * Idempotens auto-regisztráció + callback URL szinkronizáció.
 *
 * 1. `GET /register/:appId` — létezik-e az app a registry-ben?
 *    - 404 → `POST /register` új app-pal (`callback_urls: [callbackUrl]`, `allow_guest_invites: true`)
 *    - 200 + a `callbackUrl` MÁR a listában → no-op
 *    - 200 + a `callbackUrl` HIÁNYZIK → `PATCH /register/:appId` additív hozzáadással
 *
 * Az additív PATCH azt a use-case-t fedi le, amikor egy meglévő app új domain alias-t
 * kap (pl. `meta-lead-to-ac.vercel.app` mellé `meta-lead-to-ac.vikingoapp.hu`) — különben
 * a `/authorize` `invalid_return_url`-rel utasítaná vissza az új URL-ről induló flow-t.
 *
 * `registrationToken`-t a hívó adja át (env var-ból). Auth-client middleware-ek
 * lazy-n hívják a startup-on, ha a `VIKINGO_AUTH_REGISTRATION_TOKEN` env be van állítva.
 *
 * @returns `alreadyRegistered` — true, ha az app már létezett (akár no-op, akár PATCH); false ha most jött létre.
 *          `callbackAdded` — true, ha a PATCH új URL-t adott a listához.
 */
export async function autoRegisterApp(
  config: ResolvedConfig,
  callbackUrl: string,
  registrationToken: string,
): Promise<{ alreadyRegistered: boolean; callbackAdded: boolean }> {
  // Fire-and-forget hívó (middleware) → nyugodtan próbálkozhat többször tranziens hibára.
  const REG_OPTS = { timeoutMs: 5000, retries: 2 } as const

  const checkRes = await resilientFetch(
    `${config.authServer}/register/${encodeURIComponent(config.appId)}`,
    { headers: { authorization: `Bearer ${registrationToken}` } },
    REG_OPTS,
  )

  if (checkRes.status === 200) {
    const existing = (await checkRes.json().catch(() => null)) as
      | { callback_urls?: string[] }
      | null
    const urls = existing?.callback_urls ?? []
    if (urls.includes(callbackUrl)) {
      return { alreadyRegistered: true, callbackAdded: false }
    }

    const patchRes = await resilientFetch(
      `${config.authServer}/register/${encodeURIComponent(config.appId)}`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${registrationToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ callback_urls: [...urls, callbackUrl] }),
      },
      REG_OPTS,
    )
    if (!patchRes.ok) {
      const text = await patchRes.text().catch(() => '')
      throw new Error(`auto-register PATCH failed (${patchRes.status}): ${text}`)
    }
    return { alreadyRegistered: true, callbackAdded: true }
  }

  if (checkRes.status !== 404) {
    const text = await checkRes.text().catch(() => '')
    throw new Error(`auto-register check failed (${checkRes.status}): ${text}`)
  }

  const regRes = await resilientFetch(
    `${config.authServer}/register`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${registrationToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        app_id: config.appId,
        callback_urls: [callbackUrl],
        allow_guest_invites: true,
      }),
    },
    REG_OPTS,
  )
  if (!regRes.ok) {
    const text = await regRes.text().catch(() => '')
    throw new Error(`auto-register failed (${regRes.status}): ${text}`)
  }
  return { alreadyRegistered: false, callbackAdded: true }
}
