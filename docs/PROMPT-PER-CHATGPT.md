# Prompt për ChatGPT — shto një lojë të re pa prishur asgjë

Kopjo gjithçka në bllokun më poshtë dhe jepja ChatGPT-së **bashkë me repo-n** (zip ose
qasje). Pastaj aplikoje patch-in që kthen dhe ekzekuto testet vetë.

> Këshillë: ChatGPT pa akses në repo shpik skedarë. Nëse s'ke si t'i japësh repo-n,
> kërkoji **vetëm diff/patch** dhe aplikojeni ti, pastaj nis testet.

---

## Mënyra që funksionon vërtet: scaffold + check

Mos i kërko ChatGPT-së të shkruajë lojën nga zero. Kërkoji të përdorë dy komandat e
repo-s:

```bash
node scripts/new-casino-game.mjs <loje>    # kopjon Book of Ra → <loje>, printon TODO-t
node scripts/check-casino-game.mjs <loje>  # 8 kontrolle: skedarë, syntax, rrota, API,
                                           # klient origjinal, skedarë të paprekur,
                                           # RTP 93.5–97%, init+spin
```

`new-casino-game.mjs` krijon automatikisht:

```
scripts/sync-original-<loje>.mjs
server/casino/<loje>.mjs
server/casino/<loje>-transactions.mjs
server/casino/<loje>-reels.txt
```

dhe printon saktësisht rreshtat që duhen shtuar në `server/index.mjs`,
`CasinoPage.tsx` dhe `web/package.json`. ChatGPT-së i mbetet **vetëm** të plotësojë
matematikën e lojës (LINES, PAYTABLE, rrotat) — pa shpikur arkitekturë.

**Rregulli:** nëse `check-casino-game.mjs` nuk printon `All checks passed`, loja
**nuk deploy-ohet**. Kjo është porta e vetme e hyrjes.

---

## PROMPT (kopjo nga këtu)

```
Ti je developer në repo-n "faqja" (Node/Express + React/Vite + PostgreSQL).
Kazinoja ka dy lojëra që PUNOJNË: Sizzling Hot Deluxe dhe Book of Ra Deluxe, të dyja
me portofolin real të lojtarit. Detyra jote: shto lojën <EMRI I LOJËS>.

RREGULLA ABSOLUTE
1) Vetëm shto. MOS ndrysho: server/casino/transactions.mjs, server/casino/gamble.mjs,
   server/casino/sizzling-*.mjs, server/casino/bookofra*.mjs, server/ledger/schema.mjs,
   web/src/pages/CasinoOriginalWallet.tsx. As refactor, as formatim, as "përmirësime".
2) Skedarët që lejohet të ndryshohen janë vetëm:
   - server/index.mjs             (3 app.use + 1 app.use statik + 1 import)
   - web/src/pages/CasinoPage.tsx (1 rresht në listën GAMES + 1 në mapin e wallet-it)
   - web/package.json             (emri i skriptit të sinkronizimit)
3) Modeli i vetëm i lejuar është skaffold-i:
   node scripts/new-casino-game.mjs <loje>
   NUK shkruan kod nga zero; plotëson vetëm TODOs që ai printon.
4) Nëse klienti që të japin nuk ka libs/ me pixi+spine+howler, scripts/bundle-*.js,
   audio/*.ogg dhe data/*-hd-*.json → NDALO dhe thuaj "nuk është klient origjinal".
5) Mos shpik kurrë vlera paytable, kode simbolesh ose rrota. Merrji nga loja ose nga
   data/linesConfig-hd-*.json. Nëse s'i ke, pyet.

HAPAT
A. node scripts/new-casino-game.mjs <loje>   (krijon 4 skedarët + printon TODO-t)
B. Plotëso te server/casino/<loje>.mjs: LINES, PAYTABLE, SCATTER_PAY, FREE_SPINS,
   gradeGrid() — vetëm pjesët specifike të lojës.
C. Vendos rrotat e kalibruara te server/casino/<loje>-reels.txt (5 x 75).
D. Shto rreshtat që printon skaffold-i te index.mjs, CasinoPage.tsx, package.json.
E. Ekzekuto: node scripts/check-casino-game.mjs <loje>
   Derisa të mos printojë "All checks passed", puna nuk është gati.

KONTRATA E PROTOKOLLIT (mos e ndrysho)
- POST multipart/form-data, fusha data = JSON.
- action: init | spin | collect | get_double | set_double (+ initfreespin/freespin).
- init: balance{before,after}, available_actions (snake_case), init.bet/lines/multiplier/
  currency/next_request_id, init.ranges, init.directory.lines (id 0-based),
  available_lines_count, paytable, init.start_symbols, init.extra.symbol_types.
- spin: symbols, wins.line_wins[] me idx 0-BASED dhe pos:[rrotë,rresht], wins.total,
  macro_round.wins.total, available_actions.
- Gabime të ndaluara: availableActions camelCase, idx 1-based, macro_round në freespin,
  balance.before != after në freespin.

PARATË
- spin: vetëm basti zbritet; fitimi ruhet si pending (app_casino_gamble_state).
- collect: krediton pending + transaksion CASINO_WIN.
- get_double/set_double: nuk prekin bilancin, vetëm pending.
- init ose spin i ri: pending-u auto-kolektohet.
- menaxheri: +bast në spin, −fitim në collect.

RAPORTI QË DUHET TË KTHESH
1) Lista e skedarëve të krijuar/ndryshuar (patch/diff i plotë).
2) RTP analitik i llogaritur me formulën:
   P(k) = (p_s+p_w)^k − p_w^k ; mbyllja = k<5 ? 1−p_s−p_w : 1
   RTP_linje = Σ pay(s,k)·P(k)·mbyllja ; plus scatter (dritare 3-rreshtëshe,
   konvolucion 5 rrotash). Duhet të dalë brenda ±0.5% të RTP-së së kabinetit origjinal.
3) Rezultati i 300 000 rrotullimeve (RTP + hit rate) që konfirmon numrin analitik.
4) Prova që ka ekzekutuar: node --check, typecheck, build, check-casino-game,
   test ledger, browser.
5) Çfarë NUK ke prekur (konfirmim me shkrim për 5 skedarët e ndaluar).

MOS THUAJ "gati" pa këto 5 pika dhe pa "All checks passed".
```

---

## Çfarë t'i japësh ChatGPT-së përveç promptit

1. **Repo-n** (zip) — pa të shpik skedarë dhe path-e.
2. **Klientin origjinal** të lojës (dosjen me `libs/`, `audio/`, `data/`).
3. **Paytable-in** (foto ose tekst) dhe **tabelën e linjave** nëse nuk janë në `data/`.
4. Përgjigje në formatin **patch/diff**, jo "këtu është kodi".

## Kontrolli yt për 5 minuta pas çdo ndryshimi

| Kontrolli | Si e shikon |
|---|---|
| Nuk preku lojërat e vjetra | `git diff --stat` → vetëm skedarë të re + 3 të lejuar |
| Testet e pranimit | `node scripts/check-casino-game.mjs <loje>` → "All checks passed" |
| Loja hapet | `/app/casino` → pllaka e re → hapet me bilanc |
| Audio + animacione | Dëgjon muzikë; simbolat lëvizin kur fitojnë |
| Butonat | Spin, Bet +/−, Paytable, Autoplay, Gamble, Collect |
| RTP | Kërko numrin analitik; nëse s'ka numër → nuk është bërë |
| Sinkronizimi i parave | Fito pa Collect → bilanci i sportit nuk ndryshon; Collect → rritet |
| Mobile | Rrotullo telefonin horizontalisht → mbush ekranin |

## Nëse ChatGPT përsëri "ngatërron"

- Kërkoji **vetëm një hap**: "Ekzekuto `node scripts/new-casino-game.mjs <loje>` dhe
  trego output-in. Mos shkruaj kod." Pastaj hapin tjetër.
- Kur të kthejë kod, kërkoji: "Trego `git diff --stat` dhe konfirmo që nuk ke prekur
  `transactions.mjs`, `gamble.mjs`, `sizzling-*.mjs`, `bookofra*.mjs`, `schema.mjs`."
- Nëse shpik paytable/RTP → ndalo dhe kërko numrat nga loja.

---

## Alternativa më e sigurt

Nëse ChatGPT vazhdon të prishë: jep vetëm **klientin dhe paytable-in**, dhe ndryshimi
bëhet direkt në repo (siç u bë për Sizzling dhe Book of Ra) — pa ndërmjetës. Kjo
garanton: RTP i llogaritur, paratë në sinkronizim dhe testet e kalueshme.
