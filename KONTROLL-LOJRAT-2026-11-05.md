# Ice Fruits 6 Reels dhe Fortune Pyramid — 2026-11-05

Të dyja lojërat hapen nga katalogu i kazinosë dhe përdorin klientin origjinal brenda faqes. Portofoli është i përbashkët me lojërat e tjera; kufiri i bastit është 20–5,000 ALL. Nuk u krijua skemë e re financiare dhe nuk u ndryshuan llogaritë ekzistuese.

## Burimi dhe matematika

- Burimi i motorëve: Slotopol, commit e2f58bd388b12d4f9da058188bf43f19604898c8. Skedarët Go, YAML, Lua dhe licenca MIT ruhen te server/casino/slotopol-source.
- Ice Fruits 6 Reels: klienti AGT 6megaice, rrjetë 6×3, 8 simbole, 20 linja, 22 profile bobinash. Linjat janë ato të klientit origjinal të dhënë; disa nga linjat e Slotopol ndryshojnë. Pagesat, Wild/Scatter dhe bobinat vijnë nga Slotopol; përputhen me tabelën e dukshme origjinale.
- Fortune Pyramid: klienti CT origjinal, rrjetë 5×3, 8 simbole, 20 linja. Të 20 linjat e klientit përputhen me Slotopol, me 19 profile bobinash.
- Dy lojërat e reja mbështesin profile origjinale, edhe kur caktohen për agjent/menaxher. Nuk pranojnë vlera arbitrare RTP/HF.

## Asetet dhe integrimi

Paketa përfshin klientët, animacionet, figurat, fontet dhe audion origjinale. Manifestet verifikojnë 110 burime Ice Fruits dhe 399 Fortune Pyramid. Për Ice Fruits u korrigjuan operatorët JavaScript që kishte ndarë formatter-i i kapjes; zëvendësimi i transportit dërgon kërkesat te portofoli lokal. Për Fortune Pyramid u rikuperua loader-i i paprekur, i krahasuar byte për byte me CDN-në origjinale. Dhjetë skedarët audio të lojës që mungonin u rikuperuan nga CDN-ja e saj origjinale dhe u fiksuan me hash. Burimet e përbashkëta që mungonin u morën nga paketat ekzistuese të po të njëjtit klient. Nuk paketohen regjistrimet e sesioneve, faqet e treta dhe telemetria e kapur.

Protokolli i Ice Fruits ruan rrotullimet, mbledhjen dhe dyfishimin përmes përshtatësit AGT; klienti CT i Fortune Pyramid përdor njësitë monetare të sakta dhe kërkesa të renditura. Portofoli verifikon sesionin dhe regjistron një debit për raund. Raportet diagnostikuese nuk regjistrojnë baste.

## Testet

- node scripts/test-new-original-games.mjs: 41 profile RTP të llogaritura në mënyrë të pavarur, 18,000 krahasime të pagesave dhe prova SQL të dy protokolleve, riluajtjes së kërkesës dhe mbledhjes së vetme.
- node scripts/test-new-original-games-browser.mjs: klientët origjinalë brenda faqes React, klikim fizik i spin-it me vetëm një raund në portofol, menuja e bastit Ice Fruits dhe dritarja e autoplay Fortune Pyramid në 1366 dhe 390 px; kalim fullscreen me autoplay hapur.
- node scripts/verify-new-original-assets.mjs: 509 burime, hash-et dhe mbulimi i plotë i manifesteve.
- npm run test:protected: kontrollet ekzistuese kaluan, përfshirë profilet e dhjetë lojërave dhe përparësinë e agjentit.
- npm --prefix web run typecheck dhe npm run build:web.

Burimet lokale të papërpunuara mbeten te game-sources. Kopjet e skedarëve të mëparshëm janë te .runtime/new-games-backup-20261105. Paketa private e Windows ruan kopjen e verifikuar të databazës dhe konfigurimin ekzistues.

## Skedarët

Asetet renditen te web/public/casino-original/ice-fruits-6x3/assets-manifest.json dhe web/public/casino-original/fortune-pyramid/assets-manifest.json. Skedarët e tjerë të ndryshuar:

- AGENTS.md
- PROTECTED_REQUIREMENTS.md
- scripts/sync-fortune-pyramid-assets.mjs
- scripts/sync-fortune-pyramid-math.mjs
- scripts/sync-ice-fruits-assets.mjs
- scripts/sync-ice-fruits-math.mjs
- scripts/test-casino-profile-admin.mjs
- scripts/test-new-original-games-browser.mjs
- scripts/test-new-original-games.mjs
- scripts/test-original-wallet-profiles.mjs
- scripts/test-protected-requirements.mjs
- scripts/verify-new-original-assets.mjs
- server/casino/agt-engine.mjs
- server/casino/agt-metadata/6megaice.json
- server/casino/classic-reel-return.mjs
- server/casino/fortune-pyramid-data.json
- server/casino/fortune-pyramid-engine.mjs
- server/casino/fortune-pyramid-protocol.mjs
- server/casino/game-rtp-profiles.mjs
- server/casino/ice-fruits-data.json
- server/casino/original-wallet-store.mjs
- server/casino/original-wallet.mjs
- server/casino/slotopol-source/fortunepyramid_calc.lua
- server/casino/slotopol-source/fortunepyramid_data.yaml
- server/casino/slotopol-source/fortunepyramid_link.go
- server/casino/slotopol-source/fortunepyramid_rule.go
- server/casino/slotopol-source/fortunepyramid_scan.go
- server/casino/slotopol-source/icefruits6x3_calc.lua
- server/casino/slotopol-source/icefruits6x3_data.yaml
- server/casino/slotopol-source/icefruits6x3_link.go
- server/casino/slotopol-source/icefruits6x3_rule.go
- server/casino/slotopol-source/icefruits6x3_scan.go
- web/package.json
- web/public/casino-assets/fortune-pyramid/background.webp
- web/public/casino-assets/fortune-pyramid/top_name.webp
- web/public/casino-assets/ice-fruits-6x3/emptyback.jpg
- web/public/casino-assets/ice-fruits-6x3/top.webp
- web/src/pages/CasinoOriginalWallet.tsx
- web/src/pages/CasinoPage.tsx
- web/src/types/casino.ts
- KONTROLL-LOJRAT-2026-11-05.md
