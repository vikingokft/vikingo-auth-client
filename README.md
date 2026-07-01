# @vikingokft/auth-client

Kliens oldali csomag a [vikingo-auth-server](https://github.com/vikingokft/vikingo-auth-server) szerverhez. Drop-in Google Workspace SSO Next.js appokhoz és Node CLI eszközökhöz.

## 🗺️ A Vikingo SSO 4 repóból áll — melyik mire való

| Repo | Mi ez | Mikor nyúlsz hozzá |
|---|---|---|
| [vikingo-auth-server](https://github.com/vikingokft/vikingo-auth-server) | Központi szerver a `vikingoauth.hu`-n — a Google-bejelentkezés agya: JWT, user-lifecycle, admin UI. | **Egyszer, örökre.** Már fut; új eszközhöz NEM nyúlsz hozzá. |
| [@vikingokft/auth-client](https://github.com/vikingokft/vikingo-auth-client) 👈 **ITT VAGY** | npm csomag (kódkönyvtár) Next.js / Node appokhoz. | **Meglévő** Next.js appot kötsz SSO-ra. |
| [vikingo-auth-template](https://github.com/vikingokft/vikingo-auth-template) | Kész Next.js starter, a client már bedrótozva. | **Új** Next.js eszközt *kezdesz* (ebből klónozol). |
| [vikingo-auth-wordpress](https://github.com/vikingokft/vikingo-auth-wordpress) | WordPress plugin (PHP) — a client WP-s megfelelője. | **WordPress** oldalt kötsz SSO-ra. |

**Telepítéskor mindig csak EGYET érintesz:** új Next.js → *template* · meglévő Next.js → *client* (ez) · WordPress → *wordpress plugin*. A *server* már él.

## Telepítés

A csomag **public npm**-en él, auth nélkül pull-olható:

```bash
npm install @vikingokft/auth-client
```

Nem kell `.npmrc`, nem kell token. (v0.5.0 és korábbi verziók GitHub Packages-en voltak — [részletek a CHANGELOG-ban](CHANGELOG.md#051---2026-04-24).)

## Használat Next.js-ben

### 1. Regisztráld az appot

Két opció — bővebben lásd [MIGRATION.md](MIGRATION.md):

- **Auto-register (ajánlott v0.8.0+)**: tegyél egy `VIKINGO_AUTH_REGISTRATION_TOKEN` env vart Vercel team szinten. Az első production request beregisztrálja az app-ot.
- **Kézi**: a [vikingoauth.hu/admin/apps](https://vikingoauth.hu/admin/apps) UI-on, vagy `curl -X POST .../register`.

### 2. Környezeti változók

Vercel-en (auto-detect): semmi nem kötelező. Az `appId` a `VERCEL_GIT_REPO_SLUG`-ból jön, a session-aláíró kulcs az `appId`-ből deriválódik (HKDF-SHA256).

Helyi fejlesztéshez (`.env.local`):

```bash
VIKINGO_AUTH_APP_ID=my-app
```

Opcionális (csak akkor add meg, ha tényleg külön akarod kezelni):

- `VIKINGO_AUTH_CLIENT_SECRET` — extra auth réteg a Worker felé. v0.4.0+ óta nem kötelező.
- `VIKINGO_AUTH_SESSION_SECRET` — felülírja a derived session-aláíró kulcsot.

### 3. `middleware.ts` — `src/middleware.ts` ha `src/`-struktúrát használsz, VAGY a repo gyökerében

> **Fontos**: ha Next.js `src/app/` vagy `src/pages/` struktúrát használsz, a `middleware.ts` **kötelezően** a `src/`-ben legyen. A gyökérbe tett `middleware.ts`-t a Next.js build csendben kihagyja (üres `middleware-manifest.json`) és az SSO nem fog aktiválódni, hiba nélkül.

```ts
import { vikingoAuth } from '@vikingokft/auth-client/next'

export default vikingoAuth({
  publicPaths: ['/api/public', /^\/_next\//, /\.(ico|png|svg|webp)$/],
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

Ennyi. Minden route védett, kivéve a `publicPaths` listát.

### Auto-register + callback URL szinkronizáció (v0.8.0+, v0.9.0)

Ha az új deploy-od első kérése után automatikusan szeretnéd hogy az app megjelenjen a worker registry-jében (admin UI Alkalmazások fülén), állítsd be a Vercel projektedhez (vagy team szinten) a `VIKINGO_AUTH_REGISTRATION_TOKEN` env vart.

```bash
# Vercel CLI
vercel env add VIKINGO_AUTH_REGISTRATION_TOKEN production
# Értéke: a worker REGISTRATION_TOKEN secretje
```

**v0.9.0 viselkedés**: a middleware minden production request-en ellenőrzi a request **tényleges origin-jét** a registry-vel szemben:

- **404** → `POST /register` új app-pal (`callback_urls: [requestOrigin/auth/callback]`, `allow_guest_invites: true`)
- **200, URL már a listán** → no-op
- **200, URL hiányzik** → `PATCH /register/:appId` additívan hozzáadja (a meglévő URL-ek megmaradnak)

Ez azt jelenti, hogy **custom domain alias-ok automatikusan beregisztrálódnak**: ha egy meglévő `app.vercel.app` deploy új `app.vikingoapp.hu` aliast kap, az első odairányuló request automatikusan hozzáteszi a `callback_urls` listához — nincs szükség manuális admin UI szerkesztésre.

**Csak production environmentben fut** (`VERCEL_ENV === 'production'` vagy `VERCEL_ENV` nincs beállítva); preview/development deploy-ok nem írnak a registry-be.

Az auto-register **fire-and-forget**: a request-feldolgozást nem blokkolja, hibákat csak `console.error`-ral logolja. Per-host idempotens — minden külön host pontosan egy register-attempt-et kap a worker élettartama alatt.

Ha nem akarsz auto-register-t, hagyd ki a env var-t — a viselkedés változatlan (kézi `curl /register` vagy admin UI form).

### Vendég invite támogatás (v0.6.0+)

A middleware automatikusan kezeli a `/auth/invite-callback` path-ot, amit az auth-server `/invite/redeem` flow használ vendégekre. Ehhez nem kell semmit külön konfigurálnod.

A vendég session JWT `guest: true` claim-mel jön. A kódban:

```ts
import { getUser } from '@vikingokft/auth-client/next'

const user = await getUser(config)

if (user?.guest) {
  // Read-only mód, korlátozott feature-ök, "vendég vagy" hint, stb.
}
```

Custom path szabályozás (pl. ha nem `/auth/`-ba teszed a callback-eket):

```ts
vikingoAuth({
  callbackPath: '/login/callback',
  inviteCallbackPath: '/login/invite-callback',
  ...
})
```

A vendég session-öket az auth-server admin UI-ról vissza lehet vonni — a middleware periodikus `/sync` hívása észleli és kirúgja a sessiont (max ~5 perc latency).

### 4. User adatok elérése Server Components-ben

```ts
import { getUser } from '@vikingokft/auth-client/next'

export default async function Page() {
  const user = await getUser({})
  return <div>Szia, {user?.name}!</div>
}
```

A config object üres lehet — minden mezőt env-ből vagy auto-detect-ből resolvál. Ha a kliens vendég-meghívóval lépett be, `user.guest === true`.

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
- [vikingo-auth-template](https://github.com/vikingokft/vikingo-auth-template) — Next.js sablon új SSO appok indításához (a csomagot már tartalmazza, a `middleware.ts` a helyén van)
- [vikingo-auth-wordpress](https://github.com/vikingokft/vikingo-auth-wordpress) — WordPress plugin (PHP, nem ezt a csomagot használja, de ugyanahhoz a workerhez csatlakozik)
