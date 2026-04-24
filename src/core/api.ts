import type { ResolvedConfig } from './config'
import type { SyncResponse, TokenResponse } from './types'

export async function exchangeCodeForToken(
  config: ResolvedConfig,
  code: string,
): Promise<TokenResponse> {
  const body: Record<string, string> = {
    code,
    client_id: config.appId,
  }
  if (config.clientSecret) body.client_secret = config.clientSecret

  const res = await fetch(`${config.authServer}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`token exchange failed (${res.status}): ${errBody}`)
  }

  return (await res.json()) as TokenResponse
}

export async function syncUserStatus(
  config: ResolvedConfig,
  sub: string,
): Promise<SyncResponse['status']> {
  const body: Record<string, string> = {
    sub,
    client_id: config.appId,
  }
  if (config.clientSecret) body.client_secret = config.clientSecret

  const res = await fetch(`${config.authServer}/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

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
