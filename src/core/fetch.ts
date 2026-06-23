// Reziliens fetch wrapper az auth-szerver (vikingoauth.hu) felé menő hívásokhoz.
//
// Miért kell: az auth-szerver Cloudflare Workers-en fut, custom domainnel. A TLS a
// Cloudflare edge-én terminálódik, így a kliens néha tranziens kapcsolati hibát kap
// MÉG A TLS-kézfogás közben ("Client network socket disconnected before secure TLS
// connection was established", ECONNRESET) — a kérés ilyenkor el sem indult. Korábban
// minden hívás timeout és retry nélkül futott, így egy ilyen pillanatnyi edge-reset a
// login-flow awaitelt hívásán (exchangeCodeForToken / sync) a böngésző alap socket-
// timeoutjáig (30–60s) "befagyasztotta" a belépést.
//
// Megoldás: timeout (AbortSignal.timeout) + KIZÁRÓLAG transport-szintű hibára korlátozott
// retry. HTTP-státuszra (4xx/5xx) NEM retry-zunk — azt a hívó `!res.ok` ága kezeli
// változatlanul, hogy a szerver-oldali elutasítás szemantikája ne változzon.

// Node (undici) + Edge runtime kapcsolati hibakódok, amelyek átmeneti hálózati gondot
// jeleznek és biztonságosan újrapróbálhatók (a kérés fel sem épült / megszakadt).
// ENOTFOUND szándékosan KIMARAD: az tipikusan tartós DNS/konfig hiba, a retry nem segít.
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
])

/**
 * Igaz, ha a hiba egy átmeneti hálózati/kapcsolati hiba (vagy a timeout abortja).
 * Kezeli a Node-stílusú `err.code` / `err.cause.code` alakot (undici "fetch failed"
 * TypeError → a valódi ok a `cause`-ban) és az Edge-stílusú `TimeoutError`/`AbortError`-t.
 */
export function isTransientNetworkError(err: unknown): boolean {
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return true
  }
  const e = err as { code?: string; name?: string; cause?: { code?: string } } | null
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return true
  if (e?.code && TRANSIENT_CODES.has(e.code)) return true
  if (e?.cause?.code && TRANSIENT_CODES.has(e.cause.code)) return true
  return false
}

export interface ResilientFetchOptions {
  /** Per-próbálkozás timeout ms-ben. Alapértelmezés: 8000. */
  timeoutMs?: number
  /** Hány extra próbálkozás átmeneti hiba esetén (az elsőn felül). Alapértelmezés: 1. */
  retries?: number
}

/**
 * `fetch` timeouttal és átmeneti kapcsolati hibára korlátozott retry-jal.
 *
 * - Minden próbálkozás friss `AbortSignal.timeout(timeoutMs)`-t kap.
 * - Csak `isTransientNetworkError`-ra próbálkozik újra; a sikeres válasz (akár 4xx/5xx)
 *   azonnal visszatér, a hívó dolga eldönteni mit kezd a státusszal.
 * - A retry-k között rövid, lineárisan növő backoff (250ms, 500ms, …) van.
 */
export async function resilientFetch(
  url: string,
  init: RequestInit = {},
  opts: ResilientFetchOptions = {},
): Promise<Response> {
  const { timeoutMs = 8000, retries = 1 } = opts
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
      lastErr = err
      if (!isTransientNetworkError(err) || attempt === retries) break
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    }
  }
  throw lastErr
}
