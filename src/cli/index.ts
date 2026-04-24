import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { exec } from 'node:child_process'
import { buildAuthorizeUrl, exchangeCodeForToken, syncUserStatus } from '../core/api'
import { resolveConfig, type AuthConfig } from '../core/config'
import { verifyAuthJwt } from '../core/verify'
import type { Session, TokenResponse } from '../core/types'

export interface RequireSSOOptions extends AuthConfig {
  cachePath?: string
  autoOpenBrowser?: boolean
  localPort?: number
}

export interface AuthState {
  token: string
  user: Session
  savedAt: number
}

function defaultCachePath(appId: string): string {
  return join(homedir(), '.vikingo', `${appId}.json`)
}

async function readCache(path: string): Promise<AuthState | null> {
  try {
    await stat(path)
    const data = await readFile(path, 'utf-8')
    return JSON.parse(data) as AuthState
  } catch {
    return null
  }
}

async function writeCache(path: string, state: AuthState): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(state, null, 2), { mode: 0o600 })
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`
  exec(cmd, () => {})
}

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes — user has this long to complete Google login

async function runLocalCallback(port: number, expectedPath: string): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (!req.url) {
        res.writeHead(400).end('no url')
        return
      }
      const url = new URL(req.url, `http://127.0.0.1:${port}`)
      if (url.pathname !== expectedPath) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
        return
      }
      const code = url.searchParams.get('code')
      if (!code) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(
          `<!doctype html><meta charset="utf-8"><title>Vikingo auth</title>
          <style>body{font-family:system-ui;background:#0a0a0a;color:#fafafa;padding:40px;text-align:center}</style>
          <h1>Hiba</h1><p>Hiányzó auth code. Próbáld újra.</p>`,
        )
        clearTimeout(timer)
        server.close()
        reject(new Error('no code'))
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
        `<!doctype html><meta charset="utf-8"><title>Vikingo auth</title>
        <style>body{font-family:system-ui;background:#0a0a0a;color:#fafafa;padding:40px;text-align:center}
        .check{width:56px;height:56px;border-radius:50%;background:#10b981;color:white;margin:0 auto 20px;line-height:56px;font-size:28px}</style>
        <div class="check">✓</div>
        <h1>Sikeres bejelentkezés</h1><p>Ezt az ablakot bezárhatod, vissza a terminálhoz.</p>
        <script>setTimeout(()=>window.close(),2000)</script>`,
      )
      clearTimeout(timer)
      server.close()
      resolve({ code })
    })
    const timer = setTimeout(() => {
      server.close()
      reject(new Error(`login timed out after ${CALLBACK_TIMEOUT_MS / 1000}s`))
    }, CALLBACK_TIMEOUT_MS)
    server.listen(port, '127.0.0.1')
    server.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

export async function requireSSO(options: RequireSSOOptions): Promise<Session> {
  const config = resolveConfig(options)
  const cachePath = options.cachePath ?? defaultCachePath(config.appId)
  const port = options.localPort ?? 53781

  const cached = await readCache(cachePath)
  if (cached) {
    const now = Math.floor(Date.now() / 1000)
    if (cached.user.exp > now + 60) {
      try {
        const status = await syncUserStatus(config, cached.user.sub)
        if (status === 'active') return cached.user
        if (status === 'suspended' || status === 'deleted') {
          throw new Error(
            `Workspace fiókod státusza: ${status}. Ehhez a CLI-hez nincs hozzáférésed. Lépj kapcsolatba az adminnal.`,
          )
        }
      } catch (err) {
        // Sync failure (network, server down) → fall back to cached token, don't block work.
        // Suspended/deleted is a real auth failure — re-throw.
        if (err instanceof Error && err.message.includes('Workspace fiókod státusza')) throw err
        return cached.user
      }
    }
  }

  const callbackPath = '/callback'
  const returnTo = `http://127.0.0.1:${port}${callbackPath}`
  const authorizeUrl = buildAuthorizeUrl(config, returnTo)

  console.log('\n🔐 Google Workspace belépés szükséges.')
  console.log(`   Nyisd meg (ha nem indul el magától): ${authorizeUrl}\n`)

  if (options.autoOpenBrowser !== false) openBrowser(authorizeUrl)

  const callbackPromise = runLocalCallback(port, callbackPath)
  const { code } = await callbackPromise

  const token: TokenResponse = await exchangeCodeForToken(config, code)
  const user = await verifyAuthJwt(token.access_token, config)

  await writeCache(cachePath, { token: token.access_token, user, savedAt: Date.now() })

  console.log(`✓ Belépve mint ${user.email}\n`)
  return user
}
