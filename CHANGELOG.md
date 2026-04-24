# Changelog

## [Unreleased]

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
