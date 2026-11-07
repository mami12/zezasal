# Si u ndërtuan lojërat e kazinosë (udhëzues për developerin)

Ky dokument përshkruan **saktësisht** metodën që u përdor për Sizzling Hot Deluxe dhe
Book of Ra Deluxe: si u gjet klienti, si u bë protokolli, si u llogarit matematika, si
u lidh me portofolin dhe si u testua. Ndjeke hap pas hapi; çdo hap ka një **test
kontrolli** — nëse testi nuk kalon, mos kalo në hapin tjetër.

> Rregulli bazë: **klienti origjinal nuk modifikohet**. Ndryshohen vetëm 3 vlera te
> `clientConfig`. Gjithçka tjetër (fitimi, humbja, RTP) vendoset në server.

---

## 0. Tre parime që nuk shkelen

1. **Klienti është vetëm vizatim.** Nuk vendos asnjë fitore; ai dërgon `spin` dhe
   pret JSON nga serveri.
2. **Serveri është autoritar.** Rrotat, fitimet, free spins dhe paratë llogariten në
   server. Klienti nuk mund t'i ndryshojë.
3. **Paratë lëvizin vetëm në ledger-in e sportit.** Nuk ka bilanc të dytë. Spin debiton
   bastin, collect krediton fitimin — të dyja në `app_user.balance` + `app_transaction`.

---

## 1. Gjej klientin ORIGJINAL (jo imitim)

Klienti i vërtetë Novomatic/Greentube ka këtë strukturë:

```
<Lojë>/
├── head.html, body.html          ← kanë atributin attach-element
├── libs/                         ← pixi.js, pixi-spine, howler, assembler.js
├── scripts/                      ← bundle-*.js  (~1 MB, i minifikuar)
├── data/                         ← konfigurime me hash: linesConfig-hd-*.json, paytableConfig-hd-*.json
├── images/, animations/          ← atlas webp + Spine
├── audio/                        ← dhjetëra .ogg
└── manifest.json
```

**Test kontrolli:**
```bash
ls <Lojë>/libs | grep -i -E 'pixi|spine|howler'   # duhet të dalin
grep -l 'pixi-spine' <Lojë>/libs/*.js
ls <Lojë>/audio/*.ogg | wc -l                      # Sizzling 30, Book of Ra 51
```

Nëse s'ka `libs/` me pixi-spine dhe `.ogg`, **nuk është origjinali** — është imitim
(HTML/Canvas i thjeshtë) dhe nuk ka kuptim të vazhdosh.

Në këtë projekt klientët vijnë nga `github.com/mami12/New-folder` në një commit të
fiksuar (shih hapin 2), jo si skedarë në këtë repo.

---

## 2. Sinkronizimi i klientit në BUILD (jo në git)

Klienti është ~7–19 MB. Mos e commit-o; shkarkoje në build me një skript.

Shembull i plotë: `scripts/sync-original-bookofra.mjs` (kopjoje dhe ndrysho emrat).

```js
const sourceSha='507f7fdb7aee883f0d78cef0b02d6c4358462c69';   // commit i fiksuar
const url='https://codeload.github.com/mami12/New-folder/tar.gz/'+sourceSha;
// shkarko → tar -xzf → kopjo dosjet
const dirs=['scripts','libs','styles','images','audio','animations','data'];
```

Pastaj:

| Hap | Pse |
|---|---|
| Hiq `<script>` e obfuskatar (`_0x315b…`) | Kodon trupin e kërkesës → `JSON Parse Error` |
| Hiq `<link ... icons/...>` te `head.html` | Skedarët s'ekzistojnë → 404 |
| Shto `<style>` responsive (`#slotCanvas{touch-action:none}`) | Kanavacë e saktë, klikime të sakta |
| Krijo `index.html` (demo) dhe `index-real.html` (portofol) | I njëjti klient, vetëm `playURL` ndryshon |
| Verifiko `data/application.json`, `images/logo.png`, konfigurimet kryesore | Build-i dështon herët, jo në prodhim |

`index.html` duhet të ketë **patjetër**:

```html
<head attach-element="./head.html">
  <script>window.clientConfig={
    resourcesBasePath:"./", playURL:"/app/api/casino/<lojë>/real/play",
    desktop:true, displayCurrency:true, doRedirect:false, language:"en", debug:false
  };</script>
  <script src="./libs/assembler.js" onload="assembler.startDOMLoading()"></script>
</head>
<body attach-element="./body.html"></body>
```

> `attach-element` **duhet** të mbetet në `<head>`/`<body>`. Një `<script>` para
> `<head>` e fshin atributin → **faqe bosh**.

**Test kontrolli:** `node scripts/sync-original-<lojë>.mjs` printon
`client synchronized (507f7fdb7aee), scripts, libs, ...`.

Regjistro në `web/package.json`:
```json
"build": "node ../scripts/sync-original-sizzling.mjs && node ../scripts/sync-original-bookofra.mjs && vite build"
```

---

## 3. Protokolli — çfarë dërgon dhe çfarë pret klienti

### 3.1 Formati i kërkesës
`POST` me `multipart/form-data`, një fushë `data` = JSON:

```json
{ "action":"spin", "bet":1, "lines":10, "denomination":1, "request_id":"3", "customVars":"…" }
```

Akordet: `init`, `spin`, `collect`, `get_double`, `set_double`
(+ `initfreespin`, `freespin` kur loja ka free spins).

### 3.2 Si zbulohet (mos i hamendëso)
- Kërkesat: logo `data` në një skedar dhe shiko çfarë vjen.
- Përgjigjet: hap `scripts/bundle-*.js` dhe kërko
  `parseAvailableActions`, `parseMacroRound`, `InitParser`, `parseLinesConfigData`.

### 3.3 Fushat e detyrueshme në përgjigje

```jsonc
// init
{
  "balance": {"before":1000,"after":1000},
  "denomination": 1,
  "available_actions": ["spin"],                 // snake_case, jo availableActions
  "init": {
    "bet":"1","lines":10,"multiplier":1,"currency":"EUR",
    "restorestate":false,"next_request_id":1,
    "ranges":{"bet":{"1":[1,2,3,5,10]},"denomination":{"1":1}},
    "directory":{
      "lines":{"0":{"0":1,"1":1,"2":1,"3":1,"4":1}},   // celësat = id 0-based
      "available_lines_count":[1,2,3,4,5,6,7,8,9,10],
      "paytable":{"1":{"3":250,"4":2500,"5":9000}}
    },
    "start_symbols":{"0":{"0":{"code":1},"1":{"code":2},"2":{"code":3}}},
    "collect":1,
    "extra":{"symbol_types":{"scatters":[0],"wilds":[0]}}
  }
}

// spin
{
  "balance":{"before":1000,"after":995},
  "denomination":1,
  "macro_round":{"wins":{"total":"25.00"}},
  "available_actions":["collect","gamble","spin"],
  "spin":{
    "bet":1,"lines":10,"multiplier":1,"next_multiplier":1,"type":"spin",
    "symbols":{"0":{"0":{"code":0},"1":{"code":1},"2":{"code":2}}},
    "wins":{"line_wins":[
      {"idx":0,"code":6,"pos":[[0,1],[1,1],[2,1]],"multiplier":1,"amount":"10.00","type":"basic","extra":{}}
    ],"total":"25.00"}
  }
}
```

**Dy gabime që prishin gjithçka:**

| Gabim | Simptomë |
|---|---|
| `availableActions` në vend të `available_actions` | `Action can not be empty!` |
| `idx` = numri i linjës (1,2,3…) | Vija e fitimit vizatohet një rresht më lart/më poshtë |

`idx` **është indeks 0-based** në array-n `linesConfig` të klientit, dhe `pos` janë
`[rrotë, rresht]`.

---

## 4. Matematika — pjesa që developerët e prishin

### 4.1 Paytable dhe simbolet
- Paytable-i merret nga ekrani **Paytable** i lojës (jo nga imagjinata).
- Kodet e simboleve: dërgo një grid test me kode `0..9` dhe shiko **çfarë vizaton**
  klienti; kështu lidh `code → simbol`.

### 4.2 Linjat
Kopjo `data/linesConfig-hd-*.json` të klientit. Çdo linjë ka `id` dhe `symbols`
(p.sh. `[1,0,0,0,1]`). **Renditja dhe id-të duhet të përputhen** me serverin.

### 4.3 RTP — kurrë mos i beso "rrotave të gatshme"
Rrotat e huazuara (Goldsvet) me paytable-in e vërtetë dhanë **433% RTP** — kazinoja
humb 4× më shumë se sa merr. Kjo nuk shihet në 20 rrotullime; shihet në llogaritje.

**Metoda që u përdor (analitike, jo Monte-Carlo):**

1. Për çdo simbol `s` dhe gjatësi `k`, me probabilitet `p_s` për rrotë dhe `p_w`
   për wild:
   ```
   P(k) = (p_s + p_w)^k − p_w^k          // k shenja radhazi, të paktën një jo-wild
   mbyllja = k < 5 ? (1 − p_s − p_w) : 1  // rrota pasardhëse nuk vazhdon
   RTP_linjë = Σ pay(s,k) × P(k) × mbyllja
   ```
2. Scatter: për çdo rrotë llogarit shpërndarjen e **dritares 3-rreshtëshe**
   (`0..3` libra), pastaj konvolucion i 5 rrotave → `P(3), P(4), P(5)`.
3. `RTP = RTP_linjë + Σ P(n) × pay(n)`.
4. Kalibro përbërjen e rrotave (sa herë shfaqet çdo simbol në 75 pozicione) derisa
   RTP të dalë ≈ origjinali.

**Rezultatet e vërteta të këtij projekti:**

| Lojë | RTP analitik | RTP me 400k rrotullime | Hit rate |
|---|---|---|---|
| Sizzling Hot Deluxe | 95.66% | ~95.0% | ~33% |
| Book of Ra Deluxe | 95.09% | 94.96% | 33% |

> Pa këtë hap, loja "punon" por humb para. Mos e lësho në prodhim pa këtë numër.

---

## 5. Paratë — si lidhet me portofolin e sportit

### 5.1 Rregulli i artë: fitimi paguhet në COLLECT
Kabineti fizik: basti zbritet në spin, fitimi shtohet kur shtyp **Collect**. Nëse
krediton menjëherë, header-i i sportit dhe ekrani i kazinosë tregojnë numra të
ndryshëm (bug-u që u raportua).

| Veprimi | Bilanc | Fitimi |
|---|---|---|
| `spin` | − bast | ruhet si **pending** (`app_casino_gamble_state.pending`) |
| `collect` | **+ pending** (transaksion `CASINO_WIN`) | zero |
| `get_double` / `set_double` | **nuk ndryshon** | dyfishohet / humbet |
| `init` ose spin i ri | pending-u **paguhet automatikisht** | — |

### 5.2 Idempotenca
Çdo kërkesë ka `request_id`. Krijo UUID nga `(sesioni, request_id)` dhe ruaje
`client_request_id` unik te `app_casino_round`. Ripërsëritja kthen të njëjtin
rezultat, pa debitim të dytë.

### 5.3 Lock-u
Gjithmonë `select … for update` mbi rreshtat e lojtarit dhe menaxherit, në të
njëjtin rend (sortuar sipas id) — njësoj si baste sportive. Pa këtë, dy spin paralel
e kalojnë bilancin negativ.

### 5.4 Menaxheri
Në spin: menaxheri +bast. Në collect: menaxheri −fitim. Kështu raporti financiar
del i balancuar.

---

## 6. Rrugët dhe sesioni

```
POST /app/api/casino/<lojë>/session     → vendos cookie HttpOnly JWT (path=/app/api/casino/<lojë>/real)
POST /app/api/casino/<lojë>/real/play   → protokolli (init/spin/collect/…)
GET  /app/casino-original/<lojë>/*      → statik; index*.html + assembler.js me no-store
```

- Cookie-ja është **HttpOnly + SameSite=Strict**, vetëm për atë rrugë.
- Frontend-i **nuk e hap iframe-in** pa verifikuar më parë `/real/play` me `init`:
  nëse cookie s'kalon, shfaq gabim — nuk ka fallback demo.
- `index-real.html` duhet të ekzistojë dhe të ketë `playURL` te `/real/play`.

---

## 7. Testet — pa këto mos e shpall "gati"

```bash
node --check server/casino/<lojë>.mjs server/casino/<lojë>-transactions.mjs server/index.mjs
npm --prefix web run typecheck
npm run build:web

# 1) Protokolli (pa DB): init → spin → freespin → collect, me cookie jar
node scripts/test-<lojë>-demo.mjs

# 2) Paratë, me Postgres të disponueshëm (kurrë prodhim!)
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/casino_test JWT_SECRET=test \
  node scripts/test-casino-ledger.mjs

# 3) Klienti në browser: hapet, 0 gabime në console, vija e fitimit saktë
```

**Kontroll manual në browser (5 minuta):**
1. Hyr si `PLAYER` → `/app/casino` → hap lojën.
2. Bilanci duhet të jetë **i njëjti** me header-in e sportit.
3. Bjeri spin: bilanci − bast; nëse fiton, shfaqet "X won" dhe bilanci **nuk**
   rritet derisa të shtypësh Collect.
4. Shtyp Collect → bilanci rritet saktësisht me fitimin.
5. Paytable: vlerat duhet të jenë të njëjtat me kabinetin origjinal.

---

## 8. Kurthet që i kemi hasur (tabelë)

| Simptomë | Shkaku | Zgjidhja |
|---|---|---|
| Faqe bosh | `<script>` para `<head>` fshin `attach-element` | skripti brenda `<head>` |
| `JSON Parse Error` | trupi kodohet nga skripti i nënshkrimit | hiq atë `<script>` |
| `Action can not be empty!` | mungon `available_actions` | shtoje (snake_case) |
| `Cannot read … 'symbol_types'` | mungon `extra.symbol_types` | `{scatters:[0],wilds:[0]}` |
| Të gjitha simbolet scatter | `(int)"P_1" = 0` | mapo `P_n → n`, `SCAT → 0` |
| `WARNING!!!` te paytable | mungon një kombinim | shto çdo `{simbol:{numër:pagesë}}` |
| Vija e fitimit e zhvendosur | `idx` 1-based ose rend ndryshe nga `linesConfig` | `idx` 0-based, id-të e klientit |
| Bilanc i dyfishtë | fitimi kreditohet në spin **dhe** në collect | kredito vetëm në collect |
| Bilanci nuk zbret | mungon `macro_round.wins.total` | dërgoje |
| Free spins nuk nisin | spin-i trigger s'ka `spin.freespins` | shto `{mud:N}` në trigger |
| Libri rrotullohet pafund | `mud` vendoset vetëm në `initfreespin` | vendose në **spin** |
| `How did u reach it???` | `macro_round` ose `before≠after` në freespin | hiqi `macro_round`, barazo |
| 500 te loja | mungon `games/<Lojë>/source/SOUND/` | krijo dosjen |
| Ngarkim i vjetër pas deploy | cache | `Cache-Control: no-store` + `?v=` |

---

## 9. Checklist final

- [ ] Klienti origjinal (libs pixi/spine/howler + ogg + data me hash)
- [ ] `sync-original-<lojë>.mjs` + i regjistruar te `web/package.json`
- [ ] `index.html` (demo) dhe `index-real.html` (wallet) me `playURL` të saktë
- [ ] Skripti i nënshkrimit dhe ikonat e huaja të hequra
- [ ] `init`: balance, available_actions, ranges, directory.lines (id 0-based),
      paytable, available_lines_count, start_symbols, extra.symbol_types
- [ ] `spin`: symbols, wins.line_wins (idx 0-based, pos [rrotë,rresht]), total, macro_round
- [ ] `collect`: krediton pending + transaksion `CASINO_WIN`
- [ ] `get_double`/`set_double`: nuk prekin bilancin
- [ ] Idempotencë me `client_request_id`
- [ ] RTP i llogaritur ≈ origjinali (95.x%), jo "duket mirë"
- [ ] Pyetjet SQL me `for update`
- [ ] `node --check`, typecheck, build, test protokolli, test ledger, browser
- [ ] `/app/api/casino/status` kthen `realMoneyAvailable: true`
- [ ] Deploy: Railway build kalon, `app_casino_settings.enabled = true`

---

## 10. Ku ndodhet çdo gjë në këtë repo

```
server/casino/sizzling-demo.mjs        # protokolli + matematika (demo)
server/casino/sizzling-real.mjs        # router me cookie + portofol
server/casino/bookofra.mjs             # Book of Ra: protokoll, 10 linja, free spins, demo + real
server/casino/bookofra-transactions.mjs# settlement + freespin state
server/casino/transactions.mjs         # Sizzling settlement + creditPendingWin + settlePendingWin
server/casino/gamble.mjs               # collect / get_double / set_double
server/casino/rtp-profiles.mjs         # profilet RTP (shkallëzim pagesash, jo rrotash)
server/ledger/schema.mjs               # tabelat: app_casino_round, _gamble_state, _freespin_state, _settings
scripts/sync-original-sizzling.mjs     # shkarkon klientin (Sizzling)
scripts/sync-original-bookofra.mjs     # shkarkon klientin (Book of Ra)
web/src/pages/CasinoPage.tsx           # katalogu me dy lojërat
web/src/pages/CasinoOriginalWallet.tsx # sesioni + iframe + rifreskimi i bilancit
```

Nëse diçka nuk punon, krahaso me këto skedarë — jo me supozime.
