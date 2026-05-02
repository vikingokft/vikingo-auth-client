# Migration Guide — Google Workspace SSO bekötése

Ez a dokumentum pontosan leírja, hogyan köss be egy **belső vikingo eszközt** a `vikingoauth.hu` központi SSO-hoz. Két forgatókönyv: (1) **meglévő** app migrálása, (2) **új** projekt induláskor.

> **v0.5.1 óta**: a csomag **public npm**-en van (`@vikingokft/auth-client`, `registry.npmjs.org`). Nincs `.npmrc`, nincs `NODE_AUTH_TOKEN`, nincs GitHub PAT. `npm install @vikingokft/auth-client` simán működik bárhonnan.
>
> **v0.4.0 óta**: a `client_secret` opcionális (public client model). Vercel-en **0 per-project env var** kell — `VIKINGO_AUTH_APP_ID` is auto-detect-elt a `VERCEL_GIT_REPO_SLUG`-ból.
>
> **v0.8.0 óta**: ha akarod, az app az első request-en automatikusan regisztrálódik a worker registry-jébe. Lásd lent: "Auto-register" lépés.

Minden migráció **3 lépésre** épül:

1. **Regisztráld az appot** a szerveren (callback URLs) — VAGY engedd, hogy auto-register intézze.
2. **Telepítsd a `@vikingokft/auth-client` csomagot** (`npm install`, plain).
3. **Készíts `middleware.ts`-t** a megfelelő runtime-hoz (Next.js / Vercel edge / CLI).

Vercel-en **nem kell semmit beállítani per project**.

---

## 0. Döntsd el, melyik runtime kell

| Ha az app... | Használd ezt az exportot |
|---|---|
| **Next.js** (14+) app router vagy pages router | `@vikingokft/auth-client/next` |
| **Vercel** project Next.js nélkül (statikus HTML + `/api/*` functions) | `@vikingokft/auth-client/edge` |
| **Node CLI** eszköz (tsx, commander, stb.) | `@vikingokft/auth-client/cli` |
| Egyéb edge runtime (Cloudflare Worker, Deno Deploy, stb.) | `@vikingokft/auth-client/edge` |

Ha nem vagy biztos: `next` = van `next.config.js`; `edge` = `vercel.json`-ban static + `api/`; `cli` = `package.json`-ban `"bin":` mező vagy tsx script.

---

## 1. App regisztráció a szerveren

**Két opció**:

### 1.A Auto-register (ajánlott v0.8.0+ óta)

Tegyél egy `VIKINGO_AUTH_REGISTRATION_TOKEN` env vart a Vercel projektedhez (vagy team szinten). Az értéke a worker `REGISTRATION_TOKEN` secretje (lásd `vikingo-auth-server/.secrets/registration-token.txt`).

```bash
vercel env add VIKINGO_AUTH_REGISTRATION_TOKEN production
```

Az első request után az app automatikusan megjelenik a worker registry-jében (`/admin/apps` UI-on), `app_id`-vel a `VERCEL_GIT_REPO_SLUG`-ból, callback URL-lel a `VERCEL_PROJECT_PRODUCTION_URL`-ből. Idempotens — meglévő entry-t nem ír felül.

**Csak production environmentben fut** (`VERCEL_ENV === 'production'`), preview deploy-ok nem írnak a registry-be.

### 1.B Kézi regisztráció (curl)

```bash
REGISTRATION_TOKEN=$(cat ~/Documents/Github/vikingo-auth-server/.secrets/registration-token.txt)

curl -X POST https://vikingoauth.hu/register \
  -H "Authorization: Bearer $REGISTRATION_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "app_id": "my-app-name",
    "callback_urls": [
      "https://my-app.vercel.app/auth/callback",
      "http://localhost:3000/auth/callback"
    ]
  }'
```

VAGY a [vikingoauth.hu/admin/apps](https://vikingoauth.hu/admin/apps) felületen, "Új alkalmazás hozzáadása" gombbal.

A válaszban kapott `client_secret`-re v0.4.0+ óta **nincs szükség** (public client model). A regisztráció maga viszont kell — ettől tudja a szerver, hogy az `app_id` létezik és melyik callback URLs-re küldhet code-ot.

**app_id konvenció**: a repo nevével egyezzen. Lowercase, kötőjellel (`my-app-name`, nem `myAppName`). Max 64 karakter.

**callback_urls konvenció**: minden olyan környezethez, ahol futtatod az appot, adj egy callback URL-t. Legalább:
- `https://<production-url>/auth/callback`
- `http://localhost:3000/auth/callback` — ha helyben is akarod tesztelni

---

## 2. Csomag telepítése

```bash
npm install @vikingokft/auth-client
```

Public npm registry, nincs `.npmrc`, nincs auth token. Bárhonnan, bármilyen környezetből telepíthető.

---

## 3. `middleware.ts` — a runtime-nak megfelelően

### 3.a Next.js 14+ (App Router)

**Hova tedd**: ha a projekt használ `src/` mappát (`src/app/` vagy `src/pages/`), akkor **`src/middleware.ts`**. Ha nincs `src/`, akkor a repo gyökerében `middleware.ts`. Rossz helyen a build csendben kihagyja.

```ts
// src/middleware.ts (vagy ./middleware.ts ha nincs src/)
import { vikingoAuth } from '@vikingokft/auth-client/next'

export default vikingoAuth({
  publicPaths: [
    '/api/public',
    /^\/_next\//,
    /\.(ico|png|svg|webp|jpg|css|js|woff2?)$/,
  ],
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

A csomag automatikusan veszi a `VIKINGO_AUTH_CLIENT_SECRET` env-et, és Vercel-en a `VERCEL_GIT_REPO_SLUG`-ot használja `appId`-ként.

**Tipp**: ha van publikus API endpoint (pl. webhook-fogadó), add a `publicPaths`-be a prefix-ét.

### 3.b Vercel edge (Next.js nélküli)

Szintén a projekt gyökerébe.

```ts
// middleware.ts
import { vikingoEdgeAuth } from '@vikingokft/auth-client/edge'

export const config = {
  matcher: ['/((?!favicon\\.ico|style\\.css|app\\.js).*)'],
}

export default vikingoEdgeAuth({
  publicPaths: ['/api/health', '/api/public'],
})
```

A `matcher`-ben manuálisan fel kell sorolni a static fájlokat, amiket nem akarsz védetté tenni (Vercel generic middleware nem tudja az ` _next`-et úgy kezelni, mint a Next.js).

### 3.c Node CLI (tsx, commander, stb.)

Nincs `middleware.ts`. A CLI entry point elején:

```ts
// bin/cli.ts (vagy amit épp használsz)
import { requireSSO } from '@vikingokft/auth-client/cli'

async function main() {
  const user = await requireSSO({
    appId: process.env.VIKINGO_AUTH_APP_ID ?? 'my-cli-name',
    clientSecret: process.env.VIKINGO_AUTH_CLIENT_SECRET!,
  })

  console.log(`Belépve mint ${user.email}`)

  // ... a CLI igazi dolga innen jön
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

Első futtatáskor **böngésző nyílik** → Google login → token mentődik `~/.vikingo/<appId>.json`-ba. Legközelebb cache-ből veszi.

---

## 4. Env változók beállítása

### Helyi fejlesztés (`.env.local`)

```bash
# projekt gyökerében
cat > .env.local <<EOF
VIKINGO_AUTH_APP_ID=my-app-name
EOF
```

Helyben az `app_id`-t expliciten kell megadni, mert a `VERCEL_GIT_REPO_SLUG` env csak Vercel-en elérhető automatikusan.

### Vercel — per project: nulla env (alapeset)

Új project bekötésekor **semmi** env változót nem kell beállítani. A middleware a runtime során automatikusan veszi a `VERCEL_GIT_REPO_SLUG`-ot mint `app_id`-t (vagy fallback a `VERCEL_PROJECT_PRODUCTION_URL` subdomainjére).

### Vercel — opcionális: auto-register (v0.8.0+)

Ha azt akarod, hogy a deploy első kérése automatikusan regisztrálja az app-ot a worker registry-jébe, állíts be EGY env vart team vagy project szinten:

- `VIKINGO_AUTH_REGISTRATION_TOKEN` — a worker `REGISTRATION_TOKEN` secretje (`vikingo-auth-server/.secrets/registration-token.txt`).

A token a feladat elvégzése után el is távolítható: a /register csak akkor fut, ha még nincs entry — meglévő app-ra nem vesz igénybe registration token-t.

### Node CLI (nincs Vercel)

A CLI felhasználóinak a gépén csak az `app_id`-t kell exportálni:
- `VIKINGO_AUTH_APP_ID` — a CLI neve, pl. `~/.zshrc`-ben.

---

## 5. Ellenőrzés

Deploy után teszteld:

1. `curl -I https://my-app.vercel.app/` → `HTTP/2 302`, `location: /auth/login?from=%2F` ✅
2. Böngészőben megnyitva → Google login képernyő
3. Sikeres bejelentkezés után visszatér az app-ba
4. Cookie-k között: `vikingo_auth=eyJ...` (HttpOnly)

Ha valami baj van:
- **`unknown_client` hiba** a loginnál → az `app_id` nem egyezik a regisztrálttal, vagy a callback URL nem szerepel a `callback_urls` listában
- **Nincs SSO redirect / az app simán betöltődik auth nélkül** → a middleware nem fut. Ellenőrzés: build után nyisd meg `.next/server/middleware-manifest.json`-t; ha `"middleware": {}`, a Next.js kihagyta. Oka általában a middleware rossz helyen van:
  - `src/`-struktúránál (`src/app/` vagy `src/pages/` létezik) → **`src/middleware.ts`** kell, nem a repo gyökerében lévő `middleware.ts`
  - `src/` nélkül → a repo gyökerében legyen
- **Redirect loop** → a `publicPaths` nem tartalmazza a `/auth/callback`-et (nem kell, a middleware automatikusan kezeli; ellenőrizd, hogy nem írod felül)

---

## Meglévő repo (migráció)

Ha az app **már él és van benne régi auth** (jelszó, HMAC, bármi):

### Kockázatkerülő stratégia — rétegzett bevezetés

1. **Első körben** csak add hozzá a `middleware.ts`-t — az SSO-t **a régi auth elé** teszed. Két lépésben kell belépni (Google + régi jelszó). Ez tesztelési időszak, ~1 hét.
2. **Amikor stabil**, vedd ki a régi auth kódot. Egyetlen PR, kis diff.
3. **Figyeld a logokat** (Cloudflare Observability a `vikingoauth.hu`-n) az első pár napban.

Ezt tettük a `circle-markdown-import`-tal — a régi `authScreen` HTML form még benne van a projektben, de most először Google SSO után találkozol vele.

### Tényleges lépések

```bash
cd /Users/nagybence/Documents/Github/<my-existing-app>

# 1. Regisztráció (kézi vagy auto-register a 1. lépés szerint)

# 2. Install (public npm, nincs .npmrc és nincs auth token)
npm install @vikingokft/auth-client

# 3. middleware.ts a helyes helyre, a 3.a / 3.b / 3.c közül megfelelő minta
#    - ha van src/app/ vagy src/pages/ → src/middleware.ts
#    - ha nincs src/ → ./middleware.ts a repo gyökerében

# 4. (Opcionális) .env.local + Vercel env

# 5. Commit + push
git add middleware.ts src/middleware.ts package.json package-lock.json 2>/dev/null
git commit -m "add Google Workspace SSO via @vikingokft/auth-client"
git push

# 6. Vercel auto-deploy, teszt
```

### Régi auth eltávolítása (később)

Amikor megbízol az SSO-ban és kiveszed a régi auth-ot:
- töröld a jelszó prompt UI-t (pl. `authScreen` div, `globalAuth()` JS)
- töröld a régi HMAC/password check logikát az API endpoint-okból
- frissítsd a README-t
- commit: `remove legacy password auth, now fully SSO-gated`

---

## Új projekt

Új projektet **`vikingo-auth-template`**-ből indíts:

```bash
gh repo create my-new-tool --template vikingokft/vikingo-auth-template --private --clone
cd my-new-tool

# 1. (Opcionális) Kézi regisztráció — ha nem akarsz auto-registert
# curl -X POST https://vikingoauth.hu/register ...

# 2. (Opcionális) .env.local helyi fejlesztéshez
cat > .env.local <<EOF
VIKINGO_AUTH_APP_ID=my-new-tool
EOF

# 3. Fejlesztés
npm install
npm run dev
```

Vercel-en deploy után az auto-register beállítja a registry-t (ha be van állítva a `VIKINGO_AUTH_REGISTRATION_TOKEN`).

A template **már tartalmazza**: `middleware.ts`-t, `package.json`-ban a dependency-t, GitHub Actions workflow-t, Dependabot konfigot.

---

## Új repo bekapcsolása a managed flow-ba

Új vikingo SSO eszközt hoztál létre? A **`vikingokft` GitHub org-ban van egy `auth-managed` custom property**, ami automatikusan beállítja az új repóra:
- `main` ág védelme (delete + force push tiltás)
- `ci` status check kötelező merge előtt
- Dependabot patch auto-merge (a workflow-fájlok a template-ből megjönnek)

A bekapcsolás kétféleképpen:

### A) GitHub UI

1. Repo **Settings → General** → görgess a **Custom properties** szekcióig
2. Keresd: `auth-managed` → pipáld ki **true**-ra
3. Save

### B) CLI

```bash
gh api -X PATCH /orgs/vikingokft/properties/values \
  --input - <<EOF
{
  "repository_names": ["my-new-app"],
  "properties": [{ "property_name": "auth-managed", "value": "true" }]
}
EOF
```

A ruleset azonnal alkalmazódik. Fontos: a repónak legyen **`ci` nevű GitHub Actions workflow**-ja (a `vikingo-auth-template` ezt már tartalmazza).

## Frissítés (patch-ek, új verziók)

A `@vikingokft/auth-client` csomag automatikusan frissül minden repódban **Dependabot-tal**:

- **Patch (0.x.y → 0.x.y+1)**: biztonsági javítás → **auto-merge**, ha a CI zöld
- **Minor (0.x → 0.y)**: új feature → **manuális review**, PR nyílik
- **Major (0.x → 1.0)**: breaking change → **manuális review**, változáslog szerint

Minden repóban legyen `.github/dependabot.yml` (a template-ben már benne van).

## Biztonsági modell (public client, v0.4.0+)

Az auth-server **nem követel meg `client_secret`-et** a `/token` és `/sync` endpoint-okon. A védelmi rétegek:

1. **Workspace SSO** — Google csak vikingo Workspace user-eket enged be (`hd` claim + domain whitelist)
2. **Regisztrált callback URLs** — a code csak a regisztrált URL-re irányítódik vissza, attacker nem tudja máshova kérni
3. **Single-use code, 120s TTL** — 64-hex (256-bit entrópia) random, brute-force-olhatatlan
4. **Rate limit** — 20 req / IP / perc minden érzékeny endpointon
5. **Workspace status sync** — minden 5. percben lekérdezi a user státuszát; suspend/delete = azonnali kitiltás

Egyetlen elvi támadási vektor: ha attacker hozzáfér a regisztrált callback URL-re érkező requesthez (browser history, server log, MITM), 120s ablakon belül beválthatja a code-ot. Ez a kockázat ugyanúgy fennáll a hagyományos `client_secret`-es model-ben is, ha a secret leak-el.

A `client_secret` opció továbbra is **támogatott** — ha külső appot kötsz be, ahol nem bízol meg a domain-ben, állítsd be `VIKINGO_AUTH_CLIENT_SECRET` env-ben és a kliens elküldi a szervernek.

---

## Fontos megjegyzések

### Callback URL-t kell frissíteni, ha változik a deploy URL

Vercel preview deployok URL-je dinamikus (pl. `my-app-git-branch-foo.vercel.app`). A preview-k **nem** fognak működni, csak a registered callback URL-ek. Opció:
- a `callback_urls` listába vegyél fel wildcard nélküli konkrét preview URL-eket (Vercel "Production Alias" elég lehet)
- vagy csak production-ben használd az SSO-t, preview-ket hagyd publikus

A szerver most nem támogat wildcard-os callback URL-t (ez szándékos, security).

### Szerver oldali user adatok

Ha backend/API route-ban kell a user email-je:

**Next.js**:
```ts
import { getUser } from '@vikingokft/auth-client/next'
const user = await getUser({ appId, clientSecret, sessionSecret })
```

**Edge (Vercel generic)**:
```ts
import { getSessionFromRequest } from '@vikingokft/auth-client/edge'
const user = await getSessionFromRequest(req, { appId, clientSecret, sessionSecret })
```

**CLI**: a `requireSSO()` már visszaadja.
