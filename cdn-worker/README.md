# cdn.filiprosa.cz — Cloudflare Worker + R2

Náhrada původní PHP CDN na Wedosu. **URL struktura je stejná**, takže
[lib/cdn.ts](../lib/cdn.ts) ani [lib/cdn-api.ts](../lib/cdn-api.ts) se nemění.

| Původně (Wedos, PHP)     | Nyní (Cloudflare)                  |
|--------------------------|------------------------------------|
| soubory na disku         | R2 bucket `filiprosa-cdn`          |
| `api/upload.php`         | `POST /api/upload` ve Workeru      |
| `api/manifest.php`       | `POST /api/manifest`               |
| `api/delete.php`         | `POST /api/delete`                 |
| `api/save-users.php`     | `POST /api/save-users`             |
| `api/contact.php` (`mail()`) | `POST /api/contact` přes Resend |
| `.htaccess` cache hlavičky | `cacheControlFor()` ve Workeru   |
| `api/save-users.php`     | zrušeno — viz `/api/users/*` níže  |

Worker přijímá i staré `/api/upload.php` tvary, kdyby někde zůstaly.

## Přihlašování

Heslo ověřuje Worker, ne prohlížeč. `users.json` se ven nevydává vůbec —
`GET /users.json` vrací 404.

| Endpoint | Kdo smí | K čemu |
|----------|---------|--------|
| `POST /api/login` | kdokoliv | jméno + heslo → session token (platí 12 h) |
| `POST /api/logout` | kdokoliv | zneplatní token |
| `POST /api/session` | přihlášený | ověří token, vrátí roli a práva |
| `POST /api/change-password` | přihlášený | mění vlastní heslo |
| `POST /api/users` | admin | seznam účtů bez hashů |
| `POST /api/users/save` | admin | zakládá a upravuje účty |
| `POST /api/users/delete` | admin | maže účty |

Session tokeny leží v KV a po 12 hodinách expirují samy. Hesla se hashují
PBKDF2-SHA256 se 100 000 iteracemi — to je strop, který Workers povolují
(ověřeno: 100 001 skončí chybou za běhu, proto je v `auth.ts` tvrdý ořez).
Účty založené původním klientem mají holé SHA-256; ty se při prvním úspěšném
přihlášení tiše přehashují, takže migrace nikoho nevyzamkla.

Neúspěšné pokusy počítá Worker podle IP (8 za 15 minut). Původní počítadlo
sedělo v `sessionStorage` prohlížeče, takže stačilo otevřít anonymní okno.

### Oprávnění

Adpan práva jen zobrazuje; vynucuje je Worker. Editor s právem jen na galerii
opravdu nenahraje do muzea, ani když si request poskládá ručně.

- `gallery`, `gear`, `graphics`, `site`, `services`, `pricelist` → práva sekce **gallery**
- `museum` → **museum**, `rosnik` → **rosnik**
- manifesty `site` a `faq` a cokoliv mimo výše uvedené složky → jen **admin**

### Záložní token

`ADMIN_TOKEN` (secret Workeru) pořád funguje jako plnohodnotný admin. Je to
cesta zpátky, kdyby se rozbilo přihlašování nebo KV — vkládá se v
`/panel0x/debug`. Běžné přihlášení ho nepotřebuje.

---

## Nasazení — krok za krokem

### 1. R2 bucket

```powershell
cd cdn-worker
npx wrangler r2 bucket create filiprosa-cdn
```

Bucket **nechávej privátní** — nepřipojuj mu veřejnou r2.dev doménu. Veškerý
přístup jde přes Worker.

### 2. KV namespace pro rate limit kontaktního formuláře

```powershell
npx wrangler kv namespace create RATE_LIMIT
```

Vypsané `id` vlož do [wrangler.toml](wrangler.toml) místo `REPLACE_WITH_KV_ID`.

### 3. Tajné hodnoty

```powershell
npx wrangler secret put ADMIN_TOKEN      # stávající token z api/config.php
npx wrangler secret put RESEND_API_KEY   # z resend.com → API Keys
```

> **Token:** v `cdn-upload/api/config.php` je natvrdo `DvCQPJ8xXnPmu4S`. Ten soubor
> byl (a je) na veřejném hostingu, tak ho ber jako kompromitovaný a nastav nový.
> Nový token se pak zadává v adpanu při přihlášení — ukládá se do
> `localStorage['__fr_admin_pass']`, takže stačí přihlásit se znovu.

### 4. Resend

1. Účet na [resend.com](https://resend.com) → **Domains** → přidat `filiprosa.cz`
2. Resend vypíše DKIM/SPF záznamy → přidat je v Cloudflare DNS (zóna `filiprosa.cz`)
3. Počkat na ověření, pak **API Keys** → vytvořit klíč → vložit v kroku 3

`CONTACT_TO` a `CONTACT_FROM` jsou v `[vars]` ve [wrangler.toml](wrangler.toml).
`CONTACT_FROM` musí být na ověřené doméně.

### 5. Nahrání dat do R2

1288 souborů / 860 MB. `wrangler r2 object put` zvládá jeden objekt na příkaz,
takže se používá rclone přes S3 API:

```powershell
winget install Rclone.Rclone
```

V Cloudflare: **R2 → API → Manage API Tokens → Create Token** (Object Read & Write).

```powershell
$env:R2_ACCOUNT_ID = "<account id>"
$env:R2_ACCESS_KEY = "<Access Key ID>"
$env:R2_SECRET_KEY = "<Secret Access Key>"

cd cdn-worker\scripts
.\sync-r2.ps1           # zkušební běh — vypíše, co by nahrál
.\sync-r2.ps1 -Live     # skutečné nahrání
```

Skript vynechává `api/**` a skryté soubory (`.htaccess`, `.user.ini`) — PHP na
Cloudflare stejně neběží a do R2 nepatří.

Stejným příkazem se dělá i pozdější doplnění — `rclone sync` přenáší jen změny.

### 6. Nasazení Workeru

```powershell
cd cdn-worker
npx wrangler deploy
```

`custom_domain = true` ve wrangler.toml si DNS záznam pro `cdn.filiprosa.cz`
převezme automaticky. Pokud tam ještě míří starý A/CNAME záznam na Wedos,
Cloudflare při nasazení nabídne jeho nahrazení — potvrď.

### 7. Ověření

```bash
curl -I https://cdn.filiprosa.cz/gallery.json
curl -I https://cdn.filiprosa.cz/gallery/landscape/landscape001.jpg
```

Pak v adpanu (`/panel0x`): přihlásit se, nahrát testovací fotku, smazat ji,
uložit manifest. A odeslat zprávu kontaktním formulářem.

---

## Vývoj

```powershell
npx wrangler dev --local --var ADMIN_TOKEN:test-token --var RESEND_API_KEY:fake `
  --var CONTACT_TO:test@example.com --var CONTACT_FROM:web@example.com
```

V druhém okně:

```bash
bash scripts/smoke-test.sh
```

Projede 24 kontrol: autentizaci, upload, delete, manifesty, path traversal,
CORS, Range požadavky, 404. Běží proti lokálnímu R2 (miniflare), na produkční
data nesahá.

Sledování produkčního provozu: `npx wrangler tail`.

---

## Co je jinak proti PHP verzi

- **Cache hlavičky** nastavuje Worker, ne `.htaccess`. JSON manifesty mají
  `no-store`, ostatní soubory rok. Po uploadu/smazání Worker sám zneplatní edge
  cache daného objektu.
- **Range requesty** (`/rosnik/*.pdf`) obsluhuje R2 nativně.
- **Rate limit kontaktu** drží KV, ne dočasný soubor. Funguje napříč všemi
  edge lokacemi, což PHP verze neuměla.
- **Limit uploadu** zůstává 50 MB na soubor. Cloudflare navíc omezuje tělo
  požadavku na 100 MB (free plán) — adpan posílá fotky po jedné a zmenšené
  na 1920 px, takže se do toho vejde s rezervou.

## Zbývající bezpečnostní dluh (nezměněno, přeneseno z PHP verze)

`users.json` je veřejně čitelný na `https://cdn.filiprosa.cz/users.json` a
obsahuje `passwordHash` + `salt` všech účtů adpanu — [lib/auth.ts](../lib/auth.ts)
ho takto načítá při přihlášení. Hashe jsou jednoprůchodné SHA-256, tedy slabé
proti offline útoku hrubou silou. Chování jsem záměrně nechal beze změny, aby
migrace nic nerozbila, ale stojí za opravu: přihlašování by mělo běžet jako
endpoint ve Workeru, který ověří heslo na serveru a `users.json` ven vůbec
nepustí.
