# Migration Guide — Google Workspace SSO bekötése

Ez a dokumentum pontosan leírja, hogyan köss be egy **belső vikingo eszközt** a `vikingoauth.hu` központi SSO-hoz. Két forgatókönyv: (1) **meglévő** app migrálása, (2) **új** projekt induláskor.

> **v0.4.0 óta**: Vercel-en **0 per-project env var** kell. A `NODE_AUTH_TOKEN` pedig Vercel Team Shared env-ből jön (1x setup minden projektre érvényes).

Minden migráció ugyanarra az 4 lépésre épül:

1. **Regisztráld az appot** a szerveren (callback URLs)
2. **Adj hozzá `.npmrc`**-t a GitHub Packages-hez (git-be commitolva)
3. **Telepítsd a `@vikingokft/auth-client` csomagot**
4. **Készíts `middleware.ts`-t** a megfelelő runtime-hoz (Next.js / Vercel edge / CLI)

Vercel-en **nem kell semmit beállítani per project** (a Team-level `NODE_AUTH_TOKEN`-en kívül, ami már létezik).

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

Ezt **minden egyes appnál egyszer** kell megtenni. A `REGISTRATION_TOKEN` a `vikingo-auth-server/.secrets/registration-token.txt` fájlban van a gépeden.

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

A válaszban kapott `client_secret`-re **a v0.4.0-ban nincs szükség** (public client model). A regisztráció maga viszont kötelező — ettől tudja a szerver, hogy az `app_id` létezik és melyik callback URLs-re küldhet code-ot.

**app_id konvenció**: a repo nevével egyezzen. Lowercase, kötőjellel (`my-app-name`, nem `myAppName`). Max 64 karakter.

**callback_urls konvenció**: minden olyan környezethez, ahol futtatod az appot, adj egy callback URL-t. Legalább:
- `https://<production-url>/auth/callback`
- `http://localhost:3000/auth/callback` — ha helyben is akarod tesztelni

---

## 2. `.npmrc` hozzáadása

Ez a fájl a projekt gyökerébe kerül, és megmondja az npm-nek, hogy a `@vikingokft/*` scope-ot a GitHub Packages-ről töltse le.

```bash
# a projekt gyökerében
cat > .npmrc <<'EOF'
@vikingokft:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
EOF
```

**Fontos**: ez nem tartalmaz titkos tokent, csak a `${NODE_AUTH_TOKEN}` placeholder-t. A tényleges token környezeti változóként adódik hozzá.

A `.gitignore`-ban **ne** legyen benne a `.npmrc` — szándékosan commitoljuk. Nincs benne titok.

---

## 3. Csomag telepítése

```bash
NODE_AUTH_TOKEN=$(gh auth token) npm install @vikingokft/auth-client
```

Egyszer futtatod, utána a `package.json`-ba bekerül. Legközelebb, ha valaki `npm install`-t fut a projektben, csak annyit kell tegyen:

```bash
NODE_AUTH_TOKEN=$(gh auth token) npm install
```

---

## 4. `middleware.ts` — a runtime-nak megfelelően

### 4.a Next.js 14+ (App Router)

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

### 4.b Vercel edge (Next.js nélküli)

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

### 4.c Node CLI (tsx, commander, stb.)

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

## 5. Env változók beállítása

### Helyi fejlesztés (`.env.local`)

```bash
# projekt gyökerében
cat > .env.local <<EOF
VIKINGO_AUTH_APP_ID=my-app-name
EOF
```

Helyben az `app_id`-t expliciten kell megadni, mert a `VERCEL_GIT_REPO_SLUG` env csak Vercel-en elérhető automatikusan.

### Vercel — 1x setup a Team szinten

Ezt **csak egyszer** kell, minden projekt örökli. Vercel Dashboard → **Team Settings → Shared Environment Variables** → add:

- `NODE_AUTH_TOKEN` — GitHub PAT `read:packages` scope-pal (lásd alább)

### Vercel — per project: nulla env

Új project bekötésekor **semmi** env változót nem kell beállítani. A middleware a runtime során automatikusan veszi a `VERCEL_GIT_REPO_SLUG`-ot mint `app_id`-t.

### GitHub PAT (`NODE_AUTH_TOKEN`, csak 1x)

Ha még nem hoztál létre egyet:

1. https://github.com/settings/tokens/new
2. **Note**: `Vercel GitHub Packages read`
3. **Expiration**: `No expiration`
4. **Select scopes**: `read:packages` **(csak ez)**
5. **Generate token** → másold ki és tedd a Vercel Team Shared env-be mint `NODE_AUTH_TOKEN`

### Node CLI (nincs Vercel)

A CLI felhasználóinak a gépén kell lennie csak az `app_id`:
- `VIKINGO_AUTH_APP_ID` — a CLI neve, pl. `~/.zshrc`-ben exportálva

---

## 6. Ellenőrzés

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

# 1. Regisztráció (egyszer, lásd lépés 1. fent)
curl -X POST https://vikingoauth.hu/register ...

# 2. Install (public npm, nincs .npmrc és nincs auth token)
npm install @vikingokft/auth-client

# 3. middleware.ts a helyes helyre, a 4.a/4.b/4.c közül megfelelő minta
#    - ha van src/app/ vagy src/pages/ → src/middleware.ts
#    - ha nincs src/ → ./middleware.ts a repo gyökerében

# 4. .env.local + (Vercel env változók csak ha régi auth-ot vegyítesz)

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

# 1. Csak a regisztráció, .env.local, Vercel env — ezek appspecifikusak
curl -X POST https://vikingoauth.hu/register ...

# 2. .env.local létrehozás a kapott secrettel
cat > .env.local <<EOF
VIKINGO_AUTH_APP_ID=my-new-tool
VIKINGO_AUTH_CLIENT_SECRET=<secret-from-step-1>
VIKINGO_AUTH_SESSION_SECRET=$(openssl rand -hex 32)
EOF

# 3. Fejlesztés
NODE_AUTH_TOKEN=$(gh auth token) npm install
npm run dev
```

A template **már tartalmazza**: `.npmrc`-t, `middleware.ts`-t, `package.json`-ban a dependency-t, `AUTH.md` útmutatót, GitHub Actions workflow-t, Dependabot konfigot.

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

### A `NODE_AUTH_TOKEN` egyetlen PAT lehet több projektnek

Egy GitHub Personal Access Token `read:packages` scope-pal **minden `@vikingokft/*` csomaghoz** ad hozzáférést. Nem kell per-projekt PAT. Használd ugyanazt Vercel-en minden projektben.

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
