# CLAUDE.md — vikingo-auth-client

Kliens oldali npm csomag a `vikingoauth.hu` szerverhez. Drop-in Google Workspace SSO Next.js + Vercel edge + Node CLI alkalmazásokhoz.

Csomag: `@vikingokft/auth-client` (**public npm**, `registry.npmjs.org`, scope `@vikingokft`). Auth nélkül pull-olható consumer oldalon. v0.5.0 és korábbi verziók GitHub Packages-en voltak (ott nem frissülnek tovább).

---

## Három alcsomag

`package.json` `exports` mező 3 entry pointot exportál:

| Import | Kinél használd | Runtime |
|---|---|---|
| `@vikingokft/auth-client` | core API hívások, alacsony szintű | bárhol |
| `@vikingokft/auth-client/next` | Next.js 14+ App/Pages Router | edge middleware + server components |
| `@vikingokft/auth-client/edge` | Next.js NÉLKÜLI Vercel projekt, Cloudflare Worker, Deno Deploy | bármely Web API edge runtime |
| `@vikingokft/auth-client/cli` | Node CLI eszközök | Node 20+ runtime, `node:http` localhost callback |

`next` peer dependency **opcionális** — CLI/edge appok nem húzzák be.

---

## Architektúra

```
client app                    @vikingokft/auth-client                vikingoauth.hu
─────────────                 ───────────────────────                ──────────────
no session cookie?
  middleware/getUser ─────▶ buildAuthorizeUrl ────────▶ /authorize
                                                            │
                                                            ▼
                                                        Google OAuth
                                                            │
  middleware /auth/callback ◀─────────────────────────  /callback
                              code in query string
                                                       (single-use code,
                                                        TTL 120s)
  middleware ──── exchangeCodeForToken ──────────────▶ /token
              ◀── { access_token: JWT, user } ────────  RS256 sign
                                                            │
  verifyAuthJwt (JWKS-sel) ◀── /jwks.json ────────────────  publik key
              │
              ▼
  packSession (HS256, derived key) ──▶ httpOnly cookie ✓

Subsequent requests:
  middleware ──unpackSession (HMAC verify) ───▶ session valid?
              ───── periodikus /sync (300s) ──▶ /sync ──▶ {active|suspended|deleted}
```

---

## Két különböző JWT a rendszerben

| JWT típus | Algoritmus | Kibocsátó | Cél |
|---|---|---|---|
| **Auth-server JWT** | RS256 | `vikingoauth.hu` | A `/token` endpoint adja vissza. Aszimmetrikus — kliensek csak verifikálni tudják (JWKS), kibocsátani nem. Audience = `app_id`. |
| **Session cookie JWT** | HS256 | a kliens app maga | HttpOnly Secure SameSite=Lax cookie. Saját HMAC kulcs (derived `appId`-ből vagy `clientSecret`-ből vagy explicit `sessionSecret`-ből). |

A flow: Google → szerver-JWT (RS256) → kliens újra-csomagol HS256-tal session cookie-ba. Így nem kell minden requestnél a szervert hívni; a kliens offline tudja verifikálni a sessiont.

---

## Fájlstruktúra

```
src/
  index.ts                    core re-exports
  core/
    config.ts                 AuthConfig, resolveConfig, appId/clientSecret resolution + Vercel env fallbacks
    types.ts                  AuthedUser, TokenResponse, SyncResponse, Session
    verify.ts                 verifyAuthJwt (remote JWKS + jose jwtVerify)
    api.ts                    exchangeCodeForToken, syncUserStatus, buildAuthorizeUrl
    session.ts                packSession/unpackSession (HS256), HKDF-derived key from clientSecret OR appId
  next/
    index.ts                  public re-export
    middleware.ts             vikingoAuth() — NextRequest → NextResponse, lazy config resolution
    server.ts                 getUser, requireUser, getUserFromHeaders (Server Component helpers)
  edge/
    index.ts                  public re-export
    middleware.ts             vikingoEdgeAuth() — standard Web Request → Response, lazy config
  cli/
    index.ts                  requireSSO() — localhost callback (default port 53781), token cache ~/.vikingo/<appId>.json
```

---

## Config resolution sorrendje (`resolveConfig`)

| Mező | Forrás priority |
|---|---|
| `appId` | (1) `cfg.appId` arg (2) `process.env.VIKINGO_AUTH_APP_ID` (3) `process.env.VERCEL_GIT_REPO_SLUG` (4) `process.env.VERCEL_PROJECT_PRODUCTION_URL` subdomain (5) `process.env.VERCEL_URL` subdomain |
| `clientSecret` | (1) `cfg.clientSecret` arg (2) `process.env.VIKINGO_AUTH_CLIENT_SECRET` (3) **undefined** (public client model) |
| `sessionSecret` | csak ha explicit, máskülönben derived |
| `authServer` | default `https://vikingoauth.hu` |
| `sessionCookieName` | default `vikingo_auth` |
| `syncIntervalSeconds` | default `300` (5 perc) |

A config **lazy** — csak az első request-kor resolválódik (modulbetöltéskor NEM, mert pl. `VERCEL_GIT_REPO_SLUG` nem mindig elérhető module init-kor edge runtime-ban).

---

## Public client model (v0.4.0+)

`clientSecret` **opcionális**. Ha nincs:
- A `/token` és `/sync` requestek nem küldenek `client_secret` mezőt
- A szerver csak az `app_id` és callback URL match-et nézi
- A session cookie aláíró kulcs `appId`-ből deriválódik HKDF-SHA256-tal

**Védelmi rétegek a public model-ben**:
1. Workspace SSO (Google csak vikingo Workspace user-eket enged)
2. Regisztrált `callback_urls` (code csak oda mehet)
3. Single-use 120s TTL auth code (256-bit entrópia)
4. Rate limit (20 req/IP/perc)
5. Periodikus `/sync` user state check

Belső, Workspace-en belül használt eszközökhöz **bőven elégséges**.

---

## Publikálás

Public npm (`registry.npmjs.org`), scope `@vikingokft`, `access: public`.

```bash
# Bump verzió + changelog
# Edit: package.json version, CHANGELOG.md
git tag v0.x.y && git push --tags
# → GitHub Actions publish.yml → npm publish (public registry)
```

**Auth a publikáláshoz**: **npm Trusted Publishing (OIDC)**. A workflow `id-token: write` permission-nel fut, az `npm` CLI runtime-ban OIDC tokent cserél npm-nél → nincs `NPM_TOKEN` secret, nincs lejárat, nincs rotáció.

Ha a Trusted Publisher beállítást újra kell konfigurálni: https://www.npmjs.com/package/@vikingokft/auth-client/access → Trusted Publisher → Publisher: GitHub Actions, Org: `vikingokft`, Repo: `vikingo-auth-client`, Workflow: `publish.yml`.

**Auth a fogyasztáshoz** (klienseknek): **nincs**. Public csomag, `npm install` elegendő.

**Provenance**: BE van kapcsolva (`publishConfig.provenance: true`). Minden publish aláírt sigstore attestation-t generál, az npm csomag oldalán látszik a "Built and signed on GitHub Actions" badge.

---

## Frissítési flow

`@vikingokft/auth-client` új release → minden consumer repó Dependabot-ja észreveszi (napi check):

- **Patch (0.x.y → 0.x.y+1)**: PR auto-merge ha CI zöld
- **Minor / Major**: manuális review

A consumer repók `.github/dependabot.yml` config-ja csoportba szedi a `@vikingokft/*` PR-eket.

---

## Kritikus tudnivalók

1. **Session key derivation v0.4.0-ban**: ha sem `clientSecret`, sem `sessionSecret` nincs → derived `appId`-ből (HKDF info `vikingo-auth-session-v1`). Ez determinisztikus, app-specifikus, és a session cookie még mindig HMAC-aláírt.

2. **ESM-only**: a csomag `"type": "module"`. Régi CommonJS Next.js project-be dynamic import kell. Next.js 14+ ESM natívan támogatott.

3. **Lazy config**: a middleware moduljának betöltésekor NEM resolválódik a config (régen igen, ez okozta a `MIDDLEWARE_INVOCATION_FAILED`-et v0.3.0-ban). Most első request-kor cache-elődik.

4. **CLI cache**: `~/.vikingo/<appId>.json`, mode `0o600`. Tartalom: token + user + savedAt. Lejárt token esetén automatikusan újra-bejelentkezik.

5. **Vercel `VERCEL_GIT_REPO_SLUG`** csak akkor available, ha a project Git Integration-nel van linkelve. Vercel CLI deploy esetén nem mindig. Fallback: `VERCEL_PROJECT_PRODUCTION_URL` parsing.

6. **Backwards compat**: `clientSecret` opció megmaradt. Ha valaki külső appot köt be (nem belső), tudja használni a hagyományos secret-es flow-t.

---

## Konvenciók

- Strict TypeScript: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`
- Build: `tsc -p tsconfig.build.json` → `dist/` (declaration + sourcemap)
- Test: nincs még (TODO: vitest)
- Commit üzenetek: angol imperatívusz, `feat:` / `fix:` / `chore:` / `docs:`

---

## Tipikus változtatások

| Mit | Hova |
|---|---|
| Új env var fallback `appId`-hez | `src/core/config.ts` `resolveAppId` |
| Új middleware option | mindkét middleware-ben + `VikingoAuthOptions` / `VikingoEdgeAuthOptions` |
| Új session field | `src/core/types.ts` `Session` + a packSession aktualizál |
| CLI port változtatás | `src/cli/index.ts` default `localPort` |
