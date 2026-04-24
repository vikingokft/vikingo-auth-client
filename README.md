# @vikingokft/auth-client

Kliens oldali csomag a [vikingo-auth-server](https://github.com/vikingokft/vikingo-auth-server) szerverhez. Drop-in Google Workspace SSO Next.js appokhoz és Node CLI eszközökhöz.

## Telepítés

Mivel GitHub Packages-en van publikálva (privát), a projekt gyökerébe kell egy `.npmrc`:

```
@vikingokft:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Lokálisan a `GITHUB_TOKEN` lehet egy személyes access token (scope: `read:packages`). CI-ben (GitHub Actions) automatikusan adott.

Utána:

```bash
npm install @vikingokft/auth-client
```

## Használat Next.js-ben

### 1. Regisztráld az appot a szerveren

```bash
curl -X POST https://vikingoauth.hu/register \
  -H "Authorization: Bearer $REGISTRATION_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "app_id": "my-app",
    "callback_urls": [
      "https://my-app.vercel.app/auth/callback",
      "http://localhost:3000/auth/callback"
    ]
  }'
```

A válaszban kapott `client_secret`-et tedd a `.env.local`-ba.

### 2. Környezeti változók

```bash
VIKINGO_AUTH_APP_ID=my-app
VIKINGO_AUTH_CLIENT_SECRET=<the-secret-from-register>
VIKINGO_AUTH_SESSION_SECRET=<openssl rand -hex 32>
```

### 3. `middleware.ts` gyökérszinten

```ts
import { vikingoAuth } from '@vikingokft/auth-client/next'

export default vikingoAuth({
  appId: process.env.VIKINGO_AUTH_APP_ID!,
  clientSecret: process.env.VIKINGO_AUTH_CLIENT_SECRET!,
  sessionSecret: process.env.VIKINGO_AUTH_SESSION_SECRET!,
  publicPaths: ['/api/public', /^\/_next\//, /\.(ico|png|svg|webp)$/],
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

Ennyi. Minden route védett, kivéve a `publicPaths` listát.

### 4. User adatok elérése Server Components-ben

```ts
import { getUser } from '@vikingokft/auth-client/next'

export default async function Page() {
  const user = await getUser({
    appId: process.env.VIKINGO_AUTH_APP_ID!,
    clientSecret: process.env.VIKINGO_AUTH_CLIENT_SECRET!,
    sessionSecret: process.env.VIKINGO_AUTH_SESSION_SECRET!,
  })

  return <div>Szia, {user?.name}!</div>
}
```

Vagy ha csak gyors user info kell (middleware által beállított header-ből):

```ts
import { getUserFromHeaders } from '@vikingokft/auth-client/next'

const { email, sub } = await getUserFromHeaders() ?? {}
```

## Használat Node CLI-ben

```ts
import { requireSSO } from '@vikingokft/auth-client/cli'

const user = await requireSSO({
  appId: 'my-cli-tool',
  clientSecret: process.env.VIKINGO_AUTH_CLIENT_SECRET!,
})

console.log(`Belépve mint ${user.email}`)
// ... a CLI továbblép
```

Első futtatáskor böngésző nyílik Google SSO-ra, a token `~/.vikingo/<appId>.json`-ba mentődik (600 permission). Minden további futtatáskor a cache-ből veszi, és háttérben ellenőrzi a Workspace státuszt.

## Hogyan működik

```
Kliens middleware                  vikingo-auth-server
─────────────────                  ───────────────────

no session cookie?
  │
  └─▶ redirect /authorize ───────▶ redirect to Google
                                         │
                                         ▼
                                   Google login
                                         │
                                         ▼
                                   /callback ─▶ issue auth code
                                                     │
                                                     ▼
  ◀─── redirect /auth/callback?code ─────────────────┘
       │
       └─▶ POST /token (code + client_secret) ──▶ return JWT + user
                                                     │
                                                     ▼
  set session cookie ◀─ pack user into session JWT ──┘
  redirect to original URL
```

## Scriptek

```bash
npm run typecheck   # TypeScript check
npm run build       # Build to dist/
```

## Kapcsolódó repók

- [vikingo-auth-server](https://github.com/vikingokft/vikingo-auth-server) — a központi szerver (Cloudflare Worker)
- [vikingo-auth-template](https://github.com/vikingokft/vikingo-auth-template) — új Next.js app sablon SSO-val (tervezett)
