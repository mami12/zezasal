# Ku janë lojërat dhe ku shkojnë asetet

Ky dokument përgjigjet një pyetjeje të vetme: **për një lojë, cila dosje është e
vërteta dhe ku duhet ta hedh asetin e ri.**

---

## 1. Si niset projekti

```bat
cd /d D:\cassino\goldsvet-opensource-main\faqja-mainlive
start.bat
```

ose direkt:

```bat
npm run start
```

Porta: **3000** (`PORT=3000` në `.env`).

| URL | Çfarë |
|---|---|
| `http://localhost:3000/` | Site-i / sportsbook |
| `http://localhost:3000/app/casino-original/<loja>/index.html` | Lojë origjinale (demo/fun) |
| `http://localhost:3000/app/casino-original/<loja>/index-real.html` | Lojë me balancë reale |
| `http://localhost:3000/app/casino-goldsvet/sizzling/` | Klient Goldsvet |

---

## 2. Katër shtresat e një loje

Për çdo lojë ka **katër** vende të ndryshme. Ngatërrimi i tyre është shkaku kryesor
i “aseteve të çthurura”.

| Shtresa | Rruga | Çfarë përmban |
|---|---|---|
| **1. Klienti (burim)** | `web\public\casino-original\<loja>\` | HTML/JS/CSS + asetet që shfletuesi ngarkon |
| **2. Klienti (i ndërtuar)** | `web\dist\casino-original\<loja>\` | e njëjta gjë, pas `npm run build:web` — **kjo shërbehet** |
| **3. Logjika e serverit** | `server\casino\<loja>*.mjs` | protokolli, rrotat, RTP, pagesa |
| **4. Karta në lobby** | `web\public\casino-assets\<loja>\` | `logo.png`, `background.jpg` për kartën |

Plus një vend i pestë, vetëm regjistrim:

| Regjistri | Rruga |
|---|---|
| Lista e lojërave | `web\src\pages\CasinoPage.tsx` → array `GAMES` |

> `web\public\casino-original\*` është në `.gitignore` (rindërtohet), ndërsa
> `web\public\casino-assets\` **kommitohet** — ndryshimi është i qëllimshëm.

---

## 3. Lojërat që ekzistojnë tani

| `id` në kod | Dosja e klientit | Logjika e serverit |
|---|---|---|
| `firejoker` | `web\public\casino-original\firejoker\` | `firejoker-engine.mjs`, `firejoker-protocol.mjs`, `firejoker-data.json`, `firejoker-launcher.mjs` |
| `bookofra` | `web\public\casino-original\bookofra\` | `bookofra.mjs`, `bookofra-transactions.mjs`, `bookofra-reels.txt` |
| `sizzling` | `web\public\casino-original\sizzling\` | `sizzling-demo.mjs`, `sizzling-real.mjs`, `sizzling-reels.txt` |
| `vikings-fun` | `web\public\casino-original\vikings-fun\` | `vikings-engine.mjs`, `vikings-ct-router.mjs`, `vikings-data.json` |
| `fruit-queen`, `seven-hot` | `web\public\casino-original\agt\` | `agt-engine.mjs`, `agt-protocol.mjs`, `agt-router.mjs`, `agt-data.json` |
| `lucky-clover-x3` | `web\public\casino-original\lucky-clover-x3\` | `lucky-clover-engine.mjs`, `clover-ct-router.mjs` |
| `playngo-bookofdead` | `web\public\casino-original\playngo-bookofdead\` | `playngo-bookofdead.mjs`, `playngo-bookofdead-engine.mjs` |
| `prophecy-ra-demo` | `web\public\casino-original\prophecy-ra-demo\` | demo statik |

Të gjitha dosjet e klientëve janë nën **`web\public\casino-original\`** — ky është
përgjigjja e shkurtër për “ku janë lojërat”.

---

## 4. Ku i hedh asetet e reja

### Rregulli

```
aset i papërpunuar  →  assets-source\playngo\        (arkiv, nuk shërbehet)
aset që duhet të shihet  →  web\public\casino-original\<loja>\   (burimi i klientit)
kartë në lobby      →  web\public\casino-assets\<loja>\
```

Pastaj:

```bat
npm run build:web
```

dhe rifresko `http://localhost:3000/app/casino-original/<loja>/index.html`.

### Pse `assets-source\`

`assets-source\playngo\` ruan **shtigjet origjinale të CDN-së**
(`cdn.playngonetwork.com\9.6.1-firejoker.432\resources\...`). Kështu bundle-i
origjinal i Play'n GO gjen `resources/...` pa i rishkruar rrugët. Nëse e “pastrosh”
duke i rrafshuar skedarët, bundle-i thyhet.

---

## 5. Fire Joker — rasti konkret

Dosja `web\public\casino-original\firejoker\` përmban **tri** pemë asetesh:

| Dosja | Madhësi | Statusi |
|---|---|---|
| `assets\` | 60 skedarë / 34.5 MB | **aktive** — e lexon `firejoker.js` / `firejoker.css` (background, `symbols\symbol0-8.png`, skin, multiplier, sounds, JSON) |
| `provider-original\8.1.3-firejoker.292\` | — | **aktive** — serveri e shërben te `/app/casino-original/firejoker/provider-original/8.1.3-firejoker.292/` (`server\index.mjs:843`) |
| `provider-original\9.6.1-firejoker.432\` + `provider-original\hera\` | — | kopje e dytë, e papërdorur |
| `png\` | 44 skedarë / 20.2 MB | **e vdekur** — nuk referohet nga asnjë `.mjs`, `.js`, `.html` ose `.json` |

Totali: ~88 MB brenda një loje. Arkivi i ri `assets-source\playngo\` e mban
versionin **9.6.1** në mënyrë të pastër dhe të dokumentuar.

---

## 6. Verifikimi

```bat
npm run verify:firejoker     :: kontrollon që klienti dhe asetet janë në vend
npm run test:firejoker       :: teston protokollin/RTP
npm run test:originals       :: të gjitha lojërat origjinale
```

Nëse `verify:firejoker` kalon, klienti është i plotë. Nuk verifikon versionin —
pra mund të kalosh nga `8.1.3` në `9.6.1` vetëm duke ndryshuar referencën te
`server\index.mjs:750,751,777,778,843`.

---

## 7. Rregullat e punës

1. **Vetëm shto, mos ndrysho** lojërat që punojnë (shih `docs\CASINO-SI-TE-SHTOSH-LOJE-TE-RE.md`).
2. Asnjë aset nuk fshihet pa verifikuar që asnjë kod nuk e referon.
3. Asetet e Play'n GO janë pronë e Play'n GO — vetëm zhvillim/testim lokal.