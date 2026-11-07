# Si të shtohet një lojë e re në kazino (brief për developerin)

Ky dokument është **urdhri i punës**. Nëse ndiqet, lojërat ekzistuese nuk prishën dhe
loja e re lëshohet me audio, animacione, butona dhe RTP normal.

---

## 0. Rregulli i parë: VETËM shto, mos ndrysho

Lojërat që punojnë (Sizzling Hot, Book of Ra) **nuk preken**. As refactor, as
"pastrim kodi", as ndryshim i `transactions.mjs`/`gamble.mjs`/`sizzling-*.mjs`.

Lejohet të ndryshohen vetëm **3 skedarë**, dhe vetëm duke **shtuar** rreshta:

| Skedari | Çfarë shtohet |
|---|---|
| `server/index.mjs` | 1 import + 3 `app.use(…)` (demo, real, session) + 1 `app.use` statik |
| `web/src/pages/CasinoPage.tsx` | 1 rresht në listën `GAMES` dhe 1 në `GAMES` e wallet-it |
| `web/package.json` | emri i skriptit të sinkronizimit në `dev`/`build` |

Nëse developer-i do të "rregullojë" diçka te `transactions.mjs`, `gamble.mjs` ose
`ledger/schema.mjs` për lojën e re → **refuzoje**. Lojë e re = skedarë të re.

---

## 1. Kushti paraprak: klienti origjinal

Pranohet vetëm klient me:

- `libs/` me **pixi.js, pixi-spine, howler** (+ `assembler.js`)
- `scripts/bundle-*.js` (~1 MB, i minifikuar)
- `audio/*.ogg` (dhjetëra skedarë)
- `data/*.json` me hash (`linesConfig-hd-*`, `paytableConfig-hd-*`, …)
- `head.html` / `body.html` me atribut `attach-element`

**Nëse këto mungojnë → NUK është klient origjinal.** Mos prano imitim Canvas/HTML.
Pa to s'ka audio, s'ka animacione Spine, s'ka butona origjinalë — dhe do të duket
"shtëpiake", pikërisht ajo që duam të shmangim.

> Përjashtim: game pack zyrtar me `source/SOUND` + `index.html` me `slotEvent` — atëherë
> nuk ndërtohet server i ri, kopjohet në `games/<Lojë>/` dhe kërkon `casino/app/Games/<Lojë>/Server.php`.

---

## 2. Skedarët që krijohen për çdo lojë të re

```
scripts/sync-original-<loje>.mjs        ← kopjo nga sync-original-bookofra.mjs
server/casino/<loje>.mjs                ← protokolli (demo + real router)
server/casino/<loje>-transactions.mjs   ← settlement (paratë)
server/casino/<loje>-reels.txt          ← rrotat e kalibruara
web/public/casino-original/<loje>/      ← gjenerohet në build (s'commit-ohet)
```

Emri `<loje>`: vetëm `a-z0-9` (p.sh. `bookofra`, `gatesofolympus`), i njëjtë në të
gjitha skedarët dhe në URL.

---

## 3. Kërkesat e protokollit (të njëjtat si lojërat ekzistuese)

- `POST` `multipart/form-data`, fusha `data` = JSON.
- Akordet: `init`, `spin`, `collect`, `get_double`, `set_double`
  (+ `initfreespin`/`freespin` nëse loja ka free spins).
- `init` **duhet** të ketë: `balance{before,after}`, `available_actions`,
  `init.bet/lines/multiplier/currency/next_request_id`, `init.ranges`,
  `init.directory.lines` (id 0-based), `available_lines_count`, `paytable`,
  `init.start_symbols`, `init.extra.symbol_types.scatters/wilds`.
- `spin` **duhet**: `symbols`, `wins.line_wins[]` me `idx` **0-based** dhe
  `pos:[rrotë,rresht]`, `wins.total`, `macro_round.wins.total`,
  `available_actions` (snake_case).
- `init` në fillim të sesionit dhe `next_request_id` rritet me 1 çdo kërkesë.

**Kontrat e pranuara:** `availableActions` camelCase, `idx` = numri i linjës,
`macro_round` në freespin, `balance.before ≠ after` në freespin → **gabime, refuzo**.

---

## 4. RTP: numri duhet të dalë, jo "duket mirë"

Kërko nga developer-i **RTP analitik** (jo Monte-Carlo i shkurtër) dhe raport me shkrim:

| Loja | RTP analitik | Toleranca |
|---|---|---|
| Sizzling Hot Deluxe | 95.66% | ±0.3% |
| Book of Ra Deluxe | 95.09% | ±0.3% |
| Lojë e re | RTP e kabinetit origjinal | ±0.5% |

Formula që duhet të përdorë (për linja me wild):

```
P(k) = (p_s + p_w)^k − p_w^k            ; k shenja radhazi
mbyllja = k < 5 ? (1 − p_s − p_w) : 1   ; rrota pasardhëse ndalon
RTP_linje = Σ pay(s,k) · P(k) · mbyllja
```

Scatter: shpërndarja e **dritares 3-rreshtëshe** për çdo rrotë, pastaj konvolucion i
5 rrotave. Totali = linja + scatter.

**Test pranimi:** raport me 300 000 rrotullime reale duhet të dalë brenda ±1% të
numrit analitik. Rrotat e huazuara nga lojëra të tjera (Goldsvet) dhanë **433%** —
prandaj rrotat kalibrohen posaçërisht për paytable-in e lojës.

---

## 5. Paratë: e njëjta rrymë si lojërat ekzistuese

| Veprimi | Bilanc | Fitimi |
|---|---|---|
| `spin` | − bast (vetëm basti) | **pending** |
| `collect` | **+ pending** | zero |
| `get_double`/`set_double` | nuk ndryshon | dyfishohet / humbet |
| `init` ose spin i ri | pending-u paguhet automatikisht | — |

Kërko gjithashtu:

- `client_request_id` unik (UUID nga sesioni + `request_id`) → idempotencë;
- `select … for update` mbi lojtarin + menaxherin, në rend të njëjtë (sort by id);
- transaksione: `CASINO_SPIN`, `CASINO_WIN`, `CASINO_MANAGER_NET`;
- menaxheri: +bast në spin, −fitim në collect;
- `app_casino_round.game_id = '<loje>'`.

**Nuk pranohet** bilanc i veçantë, "demo credits" në prodhim, ose kreditim i fitimit
në spin (kjo prish sinkronizimin me header-in e sportit).

---

## 6. UI: çfarë duhet të punojë (kontroll manual)

- [ ] **Spin/Start** — bast zbritet, rrotat animohen me zë
- [ ] **Bet +/−** dhe **Lines +/−** — numrat ndryshojnë, basti rillogaritet
- [ ] **Paytable** — hapet, vlerat = kabineti origjinal, pa `WARNING!!!`
- [ ] **Autoplay** — numri i rrotullimeve, stop
- [ ] **Gamble** (nëse loja ka) — Kuq/Zi, karta, max 5 hapa
- [ ] **Collect** — fitimi kalon në bilanc, header-i i sportit përditësohet brenda 3s
- [ ] **Audio** — efekte + muzikë; butoni mute punon
- [ ] **Animacione** — Spine (jo foto statike), simbolat "ndizen" kur fitojnë
- [ ] **Vija e fitimit** — kalon saktësisht nëpër simbolat fitues
- [ ] **Mobile** — 390×844 dhe 844×390, pa scroll horizontal, butonat të prekshëm
- [ ] **Reconnect** — rifresko faqen mes lojës: bilanci i saktë, pa fitim të humbur

---

## 7. Testet e pranimit (kopjo komandat)

```bash
node --check server/casino/<loje>.mjs server/casino/<loje>-transactions.mjs server/index.mjs
npm --prefix web run typecheck
npm run build:web

# protokolli (pa DB)
node scripts/test-<loje>-demo.mjs

# paratë (Postgres i disponueshëm, KURRË prodhim)
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/casino_test JWT_SECRET=test \
  node scripts/test-casino-ledger.mjs
```

Plus 5-minutëshi manual në browser (seksioni 6). **Pa këto, puna nuk pranohet.**

---

## 8. Anti-patterns — çdo gjë këtu është refuzim

| Gabim | Pasoja |
|---|---|
| Klient imitim (Canvas/HTML) | S'ka audio/animacione, duket keq, s'ka butona origjinalë |
| Rrota të huazuara pa kalibrim | RTP 150–450%, kazinoja humb para |
| Fitimi kreditohet në spin | Bilanci i kazinosë ≠ bilanci i sportit |
| `idx` 1-based ose rend tjetër linjash | Vija e fitimit e zhvendosur |
| `availableActions` camelCase | `Action can not be empty!` |
| Refactor i `transactions.mjs`/`gamble.mjs` | Prishen lojërat ekzistuese |
| Bilanci demo në prodhim | Lojtari luan me para fiktive |
| Pa `for update` | Bast i dyfishtë, bilanc negativ |
| Commit i aseteve 6–19 MB | Repo i rënduar; asetet duhet të sinkronizohen në build |
| Test vetëm "me sy" | Bug-u del te lojtari, jo te developer-i |

---

## 9. Rendi i punës (checklist për developerin)

1. [ ] Klienti origjinal në dorë (kontrollo seksionin 1)
2. [ ] `scripts/sync-original-<loje>.mjs` + regjistrim në `web/package.json`
3. [ ] Paytable + kodet e simboleve nga loja (grid test)
4. [ ] Linjat nga `data/linesConfig-hd-*.json`
5. [ ] Kalibrim RTP analitik → raport me numra
6. [ ] `server/casino/<loje>.mjs` (init/spin/collect/gamble + free spins)
7. [ ] `server/casino/<loje>-transactions.mjs` (basti/pending/collect, idempotencë)
8. [ ] Rrugët në `server/index.mjs` + statiku i klientit
9. [ ] `CasinoPage`: pllaka e re + `CasinoOriginalWallet` me `game` të ri
10. [ ] Testet e seksionit 7 + 5-minutëshi manual
11. [ ] Deploy në Railway → kontrollo `/app/api/casino/status` dhe një spin real me balancë të vogël

---

## 10. Si ta kontrollosh vetë (pa developer)

- Hap lojën: nëse s'ka muzikë ose simbolat s'lëvizin → klienti nuk është origjinal.
- Bjeri 20 rrotullime: nëse fiton shumë shpesh me shuma të mëdha → RTP i gabuar.
- Fito dhe mos shtyp Collect: bilanci i sportit **nuk duhet** të rritet ende.
- Shtyp Collect: bilanci duhet të rritet saktësisht me fitimin.
- Rifresko faqen mes fitimit: fitimi **nuk duhet** të humbasë.
- Hap Paytable: krahaso me foton e lojës origjinale.
- Hape në telefon horizontalisht: duhet të mbushë ekranin pa scroll.
