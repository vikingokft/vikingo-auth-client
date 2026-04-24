# Changelog

## [Unreleased]

## [0.4.1] - 2026-04-24

### Javítva
- **CLI**: a `runLocalCallback` mostantól 5 perces timeout-ot tart. Korábban végtelen ideig várt, ha a user nem fejezte be a Google login-t.
- **CLI**: ha a `/sync` válasza `suspended` vagy `deleted`, a `requireSSO` clear hibaüzenettel kilép. Korábban újra Google login-ra próbált menni, ami szintén meghiúsult volna.

### Eltávolítva
- Holt `base64url` re-export a `core/session.ts`-ben.

### Doc
- HKDF info string komment hozzáadva (verziózás magyarázata).

## [0.4.0] - 2026-04-24

### Változott (BREAKING csak akkor, ha korábban kötelezőként kezelted a clientSecret-et — API kompatibilis marad)
- **Public client model**: a `clientSecret` teljesen opcionálissá vált. A szerver már nem kötelezően validálja. A biztonsági rétegek továbbra is: Workspace SSO, regisztrált callback URLs, single-use 120s TTL auth code, rate limiting.
- **Session key**: ha nincs `clientSecret` sem `sessionSecret`, a session cookie aláíró kulcsa az `appId`-ből deriválódik (HKDF-SHA256). Determinisztikus per app.

### Hozzáadva
- **Zero-env-var Vercel setup**: új app bekötésekor **semmilyen** env var beállítás nem szükséges Vercel-en per project. Csak a team-level `NODE_AUTH_TOKEN` kell a build-idejű csomag telepítéshez.

### Frissíthető megjegyzés
A `VIKINGO_AUTH_CLIENT_SECRET` env var továbbra is támogatott — ha be van állítva, a csomag elküldi a szervernek mint extra auth layer. Ezt a régi appok megtarthatják, újak nem kell beállítsák.

## [0.3.1] - 2026-04-24

### Javítva
- **Lazy config resolution**: a middleware most a kérés pillanatában resolválja a configot, nem modul betöltéskor. Ez megoldja a `MIDDLEWARE_INVOCATION_FAILED` hibát edge runtime-okban, ahol bizonyos rendszer env változók (`VERCEL_GIT_REPO_SLUG`) csak futásidőben elérhetőek.
- **`appIdFromVercelUrl()` fallback**: ha sem `VIKINGO_AUTH_APP_ID`, sem `VERCEL_GIT_REPO_SLUG` nincs elérhető, a csomag megpróbálja kinyerni az app_id-t a `VERCEL_PROJECT_PRODUCTION_URL` vagy `VERCEL_URL` subdomain részéből.

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
