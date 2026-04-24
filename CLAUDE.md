# CLAUDE.md

## Mit csinál

`@vikingokft/auth-client` a [vikingo-auth-server](https://github.com/vikingokft/vikingo-auth-server) kliense. Drop-in SSO csomag Next.js appokhoz és Node CLI-khez. A belső vikingo eszközök használják ezt, hogy 3 sor kóddal Google Workspace SSO-ba kerüljenek.

## Három entry point

A `package.json` `exports` mezője 3 alcsomagot exportál:
- **`@vikingokft/auth-client`** (root) — alacsony szintű: verify, api hívások, session pack/unpack
- **`@vikingokft/auth-client/next`** — Next.js middleware + server helpers (`getUser`, `requireUser`)
- **`@vikingokft/auth-client/cli`** — `requireSSO` CLI flow localhost callback-kel

A `next` alcsomag `next`-et mint peer dependency használja (opcionális — CLI-s csomagok nem húzzák be).

## Hol él

- **Repo**: `vikingokft/vikingo-auth-client` (privát)
- **Publikáció**: GitHub Packages, `@vikingokft/auth-client`
- **Build**: `tsc -p tsconfig.build.json` → `dist/`
- **ESM-only** — no CommonJS build

## Fájlstruktúra

```
src/
  index.ts          # core entry (config, api, verify, session)
  core/
    config.ts       # AuthConfig + resolveConfig + AUTH_SERVER_BASE
    types.ts        # AuthedUser, TokenResponse, SyncResponse, Session
    verify.ts       # verifyAuthJwt — remote JWKS-sel
    api.ts          # exchangeCodeForToken, syncUserStatus, buildAuthorizeUrl
    session.ts      # packSession/unpackSession — HS256 self-signed cookie
  next/
    index.ts        # public re-export
    middleware.ts   # vikingoAuth() — NextRequest → NextResponse
    server.ts       # getUser, requireUser, getUserFromHeaders
  cli/
    index.ts        # requireSSO() — localhost callback + cache
```

## Kritikus tudnivalók

### 1. Két külön JWT a rendszerben
- **auth-server JWT (RS256)**: a vikingo-auth-server adja ki, `vikingoauth.hu` az issuer. Ezt a `/token` cseréből kapjuk és `verifyAuthJwt` ellenőrzi.
- **Session cookie JWT (HS256)**: ezt magunk állítjuk elő a `sessionSecret`-tel, HttpOnly Secure cookie-ba mentjük. Nem a Google tokenjét tesszük sütibe.

A séma: Google → Worker → kliens RS256 JWT → kliens újra becsomagolja HS256-tel session cookie-ba. Így a kliensnek nem kell minden requestnél a Workert hívnia, offline verifikálhat.

### 2. Sync ciklus
A middleware `config.syncIntervalSeconds` (alapból 300s) időközönként hív a `/sync`-ra a szervernél. Ha suspended/deleted, a cookie-t kitöröljük és relogra dobjuk. Ha a szerver nem elérhető, **engedélyezzük a kérést** (fault-tolerant) — az audit log látja, nem blokkolunk.

### 3. `sessionSecret` kötelező
A middleware konstruktor kifejezetten hibát dob, ha nincs `sessionSecret`. Használd `openssl rand -hex 32`-t generálni. Per-app külön secret, nem szükséges megosztani az apps között.

### 4. Peer dependency `next`
Az npm csomag `next`-et mint **optional peer dependency** jelöli. CLI-ben nem kell Next.js-nek lennie. TypeScript-ben mégis csak a `src/next/*` alatt importálunk `next/*`-ből, tehát ha a fogyasztó nem importál `/next` subpath-ot, nincs runtime dep.

### 5. ESM-only
A csomag `"type": "module"`. Ha egy régi CommonJS Next.js projektbe húzzuk, dynamic import kell: `await import('@vikingokft/auth-client/next')`. A Next.js 14+ ESM-et native támogat, ez nem lesz probléma.

## Jövőbeni iterációk

Amit érdemes figyelni, mikor fejleszted:

- **Refresh tokenek** — jelenleg 1 órás lejárat után redirectelünk Google-re `prompt: 'select_account'`-tel. Lehetne csendes refresh, de körülményesebb.
- **Szerepkör alapú access** — most bárki belép, aki Workspace user. Lehetne `getUser()` mellé `requireRole(['admin'])` vagy hasonló, ami Admin SDK-ból lekéri a user Workspace group tagságait.
- **SWR/server-action integráció** — jelenleg a middleware minden kéréskor cookie-ból dekódol. Cache-elni lehetne.

## Deploy workflow

1. Bump version a `package.json`-ban + CHANGELOG
2. `git tag v0.x.y && git push --tags`
3. GitHub Actions publish workflow → GitHub Packages-re felmegy
4. Fogyasztó appokban: Dependabot PR nyílik `@vikingokft/auth-client` bump-re
5. Merge → app redeploy, új verzió élesben

A publish token a GitHub Packages-hez `GITHUB_TOKEN` automatikusan adott a workflowban.
