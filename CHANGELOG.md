# Changelog

## [Unreleased]

## [0.3.0] - 2026-04-24

### Hozzáadva
- **`appId` auto-detect**: ha nem adod meg explicit módon, a csomag a `VIKINGO_AUTH_APP_ID` env-ből, majd a Vercel által automatikusan injektált `VERCEL_GIT_REPO_SLUG`-ből veszi. Vercel appoknál **nem kell beállítani** az `VIKINGO_AUTH_APP_ID` env változót.
- **Session-signing key derivation**: ha nincs `sessionSecret` megadva, a session cookie aláírása HKDF-SHA256-tal deriválódik a `clientSecret`-ből. Gyakorlatilag **nem kell beállítani** a `VIKINGO_AUTH_SESSION_SECRET` env változót.
- **`clientSecret` is opcionális** a konfig objektumban: ha `VIKINGO_AUTH_CLIENT_SECRET` env változó be van állítva, a csomag onnan olvassa.

### Változott
- **Per-app Vercel env**: korábban 4 env var kellett (`VIKINGO_AUTH_APP_ID`, `VIKINGO_AUTH_CLIENT_SECRET`, `VIKINGO_AUTH_SESSION_SECRET`, `NODE_AUTH_TOKEN`). Most csak **1 kötelező**: `VIKINGO_AUTH_CLIENT_SECRET`. A `NODE_AUTH_TOKEN`-t Vercel Team-level shared env-ként állítsd be egyszer.

### Visszafelé kompatibilis
A régi env változók (`VIKINGO_AUTH_APP_ID`, `VIKINGO_AUTH_SESSION_SECRET`) **továbbra is működnek**, ha explicit be vannak állítva. Csak mostantól opcionálisak.

## [0.2.0] - 2026-04-24

### Hozzáadva
- `@vikingokft/auth-client/edge` — framework-független edge middleware standard Web API `Request`/`Response` használatával. Next.js nélküli Vercel projektek és bármely edge runtime támogatása.
- `getSessionFromRequest()` helper az edge exportban — session kiolvasás bármely `Request`-ből.

## [0.1.0] - 2026-04-24

### Hozzáadva
- `@vikingokft/auth-client/next` — Next.js middleware a teljes route védéshez, session cookie kezelés
- `@vikingokft/auth-client/cli` — Node CLI-khez `requireSSO` helper localhost OAuth callback flow-val, token cache ~/.vikingo/
- `@vikingokft/auth-client` (core) — alacsony szintű API: `verifyAuthJwt`, `exchangeCodeForToken`, `syncUserStatus`, `packSession`/`unpackSession`
- Server Component helperek: `getUser`, `requireUser`, `getUserFromHeaders`
- JWT verifikáció a vikingoauth.hu/jwks.json remote JWKS-sel
- HS256 signed session cookie saját sessionSecret-tel
- Periodikus `/sync` hívás a middleware-ben (300s alapértelmezetten) → suspended/deleted userek automatikus kitiltása

### Technológiák
- TypeScript, ESM-only
- [jose](https://github.com/panva/jose) JWT library
- Peer dependency: `next >= 14`
- Node 20+
