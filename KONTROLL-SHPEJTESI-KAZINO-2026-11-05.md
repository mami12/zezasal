# Kontrolli i shpejtësisë dhe kazinosë — 2026-11-05

## Rezultati

1. Furnizuesi prematch jep kuotat kryesore me kërkesa të përbashkëta. Tregjet e plota merren për ndeshjen e hapur; ndeshjet me baste ruajnë ndjekjen e nevojshme për verifikim. Kërkesat e afërta për të njëjtën ndeshje ndajnë cache3sekonda. Header-i live vazhdon të përditësojë kuotat pasi mbyllet detaji, pa fshirë tregjet shtesë të ruajtura.
2. Lista kryesore filtron kuotat para renditjes/ndërtimit dhe dërgon vetëm kontratat që shfaqen.400 ndeshje/72,000 kuota:27,520,581 →752,181 bytes në provën sintetike, rreth97% më pak se ndërtimi i plotë. Koha varet nga pajisja/ngarkesa; ky nuk është pretendim97% më e shpejtë për të gjithë faqen.
3. Hapja e detajeve nis pasurimin statistikor edhe pa bast. Dy punë aktive, të tjerat në radhë; cache10minuta, interes shikimi12minuta i rinovueshëm. Kuotat, rotacioni, verifikimi përfundimtar dhe bllokimi i konflikteve ruhen.
4. Admini zgjedh Global/Agjent/Menaxher, komision kazino/Apex dhe cilësimet për lojë. Agjent40% → të gjithë menaxherët e tij dhe lojtarët e tyre40%. Agjenti ka përparësi ndaj96%/100% të menaxherit. Pa cilësim të agjentit trashëgohet menaxheri, pastaj globali.
5. Të tre rrugët e portofolit lexojnë hierarkinë brenda transaksionit. Komisionet ruhen një herë për raund; nuk lëvizin bilancin e stafit. Bonusët dhe kërkesat e përsëritura ruajnë rezultatet/kushtet e tyre.

## Mbështetja reale matematikore

RTP/HF të personalizuara: Lucky Clover X3, Viking’s Fun, Fruit Queen, Seven Hot, Sizzling Hot Deluxe, Book of Ra Deluxe. Kufiri RTP vjen nga pagesat reale të çdo loje, jo tavan arbitrar1000%. API-ja u provua edhe me2000%/100% në të gjashta. HF është probabilitet0–100%; çiftet e parealizueshme refuzohen.

Fire Joker dhe Fortune Teller kanë vetëm profile origjinale të mbështetura. Përqindja arbitrare40% nuk është implementuar në motorët e tyre dhe paneli nuk e pranon si të realizuar. Asetet dhe pamja e lojërave mbeten të njëjta.

## Kontrollet

- npm run test:protected: të gjitha kontrollet e skemës, futbollit/publikimit, tregjeve, kuotave/statistikave, financës, historikut dhe kazinosë në databaza të izoluara.
- npm run test:protected:browser: paneli i kazinosë në1366/390px, faqja kryesore në1366/390/320px, sinkronizimi mes skedave, tregjet e fshehura, gjuha, përdoruesit, fitimi origjinal dhe fullscreen/autoplay Fortune Teller.
- node scripts/test-admin-match-reads.mjs: listë e lehtë dhe detaj i vetëm, lejet dhe pa shkrime financiare.
- node scripts/test-stats-rotation.mjs:24 skenarë me burime/çelësa provë, pa harxhuar kuotat private.
- node scripts/test-manager-casino-settings.mjs: SQL reale, menaxher96/100, agjent40, rrotullime reale të izoluara dhe komision i ngrirë pa dyfishim.
- npm --prefix web run typecheck dhe npm run build:web: kaluan; assetet origjinale të paketuara u verifikuan. Mbetet paralajmërimi ekzistues për bundle fillestar mbi500KB.
- Kopja private e databazës u hap vetëm në memorie: përmirësimi i skemës kaloi dhe14 llogaritë u ruajtën. Nuk u ndryshuan bilancet ose historia në databazën e laptopit/serverit.

## Dorëzimi

Paketa e plotë për Windows përfshin kodin, asetet, konfigurimin privat dhe kopjen e verifikuar të databazës me14 llogari. node_modules dhe mbetjet e testeve nuk përfshihen; start.bat instalon varësitë/ndërton faqen. Për server me aktivitet të ri, ruaj data/database dhe .env ekzistuese. Mos zëvendëso aktivitetin e ri me snapshot-in e instalimit.

Kopja para ndryshimeve: .runtime/speed-manager-backup-20261105 dhe commit-i pararendës i repository-t privat.

## Skedarët e ndryshuar

- AGENTS.md
- CASINO-STAFF-SETTINGS.md
- FLAGS-STATS-RTP.md
- PERFORMANCE-NOTES.md
- PROTECTED_REQUIREMENTS.md
- scripts/test-board-speed.mjs
- scripts/test-casino-rtp-extended.mjs
- scripts/test-custom-casino-math.mjs
- scripts/test-manager-casino-browser.mjs
- scripts/test-manager-casino-settings.mjs
- scripts/test-protected-requirements.mjs
- scripts/test-provider-timeline-retention.mjs
- scripts/test-stats-rotation.mjs
- scripts/test-zizo-board-demand.mjs
- server/casino/bookofra-transactions.mjs
- server/casino/bookofra.mjs
- server/casino/custom-math.mjs
- server/casino/manager-settings.mjs
- server/casino/original-wallet-store.mjs
- server/casino/sizzling-real.mjs
- server/casino/transactions.mjs
- server/casino/wallet.mjs
- server/collector.mjs
- server/index.mjs
- server/ledger/admin.mjs
- server/ledger/board-projection.mjs
- server/ledger/routes.mjs
- server/ledger/schema.mjs
- server/odds-store.mjs
- server/stats-providers/service.mjs
- server/zizobet-feed.mjs
- web/src/components/Admin/CasinoSettings.tsx
- web/src/types/casino.ts
- KONTROLL-SHPEJTESI-KAZINO-2026-11-05.md
