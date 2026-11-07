# Kontrolli i kërkesave të mbrojtura — 2026-11-05

Burimi i plotë: `PROTECTED_REQUIREMENTS.md`. Ky është regjistër kontrolli dhe
ndërhyrjesh, jo deklaratë që të gjitha kërkesat janë përfunduar.

| Nr. | Funksioni / gjendja e konstatuar para ndërhyrjes | Ndërhyrja dhe ndikimi i pritshëm |
|---|---|---|
| 1 | Prematch ka faqe, por kufij publikimi, abonimi dhe numri faqesh fshehin ndeshje. | Kontroll `board-settings`, `match-pages`, furnizimi në `server/index`; më shumë ndeshje dhe punë reale furnizimi, pa fshehje për performancë. |
| 2 | Një rregull i vonshëm CSS e mbivendos kufirin një treg në mobile. | Hiq vetëm mbivendosjen mobile; ruaj desktop, ngjyrat dhe fontet. |
| 3 | Vetëm gjashtë vende europiane lejohen deri në kategorinë 3. | Përputh të gjithë Europën me kategoritë 1–3 dhe pjesën tjetër me kategorinë kryesore. |
| 4 | Fshehja ekziston, por bllokimet sipas fushës nuk mbërrijnë të gjitha te klienti; delta bosh mund të mbajë çmime të vjetra. | Sinkronizo politikën në API/socket/cache dhe boshatisjen e çmimeve të fshehura. |
| 5 | U gjetën karaktere të dëmtuara në ndarës dhe ikonë teksti. | Riparo tekstin UTF-8 dhe kontrollo burimet që shfaqen. |
| 6 | Shqipja dhe hartat e përkthimit ekzistojnë; mbulimi duhet kontrolluar. | Plotëso boshllëqet konkrete, pa rishkruar asetet e palëve të treta. |
| 7 | Disa lojëra kanë RTP deri 1000%; kontrolli lejon çifte që motori nuk mund t'i japë. UI pretendon përafrim që motori nuk kryen. Profile origjinale mbi 100% fshihen. | Verifiko çdo lojë, hiq pretendimet e pasakta, zbato kufijtë matematikorë dhe testo shpërndarjet. Probabiliteti i fitimit mbetet maksimum 100%. |
| 8 | Rotacioni dhe cache 10-minutëshe ekzistojnë. Përfundimi ndalet te burimi i parë; mungon krahasimi i plotë dhe porta e konfliktit. | Ruaj provat përfundimtare sipas burimit, krahaso, mbaj pezull vetëm përzgjedhjet e prekura; vendime manuale me auditim. |
| 9 | Ka kohë nga furnizuesi, por disa ngjarje ndërtohen nga ndryshimi i numëruesve me minutën aktuale. | Përdor minutën reale kur jepet; mos shpik minutën e ngjarjes. |
| 10 | Ka socket dhe pajtim gjendjeje; duhen hequr mospërputhjet e katalogut dhe ngjarjeve. | Testo dy klientë, rikthim lidhjeje dhe kohët e burimit pa vonesa shtesë. |
| 11 | `recalcTicket` zerohet në humbje; disa pamje përdorin shumën e shlyer si fitim të mundshëm. | Ruaj kuotimin fillestar veçmas dhe pagesën reale veçmas, pa ndryshuar kreditimin. Vlerat historike të rindërtuara duhen shënuar si të përafërta. |
| 12 | Pamja ekzistuese është e mbrojtur. | Ndryshimet vizuale kufizohen te kërkesat e shprehura; asnjë ridizajnim i përgjithshëm. |
| 13 | Fshirja e butë ekziston, por UI kërkon emër dhe ka pastrim të mëvonshëm të historikut financiar. | Veprim i vetëm vetëm për admin, me auditim dhe ruajtje historiku. |
| 14 | Ka kufij bastesh, por mungon monitorimi i plotë i ekspozimit. | Pamje administrative, identitete dhe agregim pa dyfishim; përdoruesi e shtyu Telegram-in për më vonë. |

Testet kryhen me databaza dhe furnizues prove, pa ndryshuar të dhënat reale.
Push-i në GitHub është autorizuar shprehimisht në bisedë. Telegram-i është shtyrë
nga përdoruesi; pjesët 8E, njoftimi në 8C dhe 14C–E nuk deklarohen të përfunduara.

Përditësim i autorizimit: përdoruesi kërkoi dhe konfirmoi përfshirjen e databazës
dhe çelësave privatë në repository-n privat `mami12/faqja`. Eksporti i plotë ka
`.env` me shteg relativ dhe kopje të verifikuar `data/database/`: 14 llogari dhe
30 tabela aplikacioni, me përputhje të të gjitha të dhënave, kredencialeve dhe
bilanceve. Vlerat private nuk shfaqen në raport ose bisedë. CI përdor mjedis të
izoluar dhe nuk ngarkon konfigurimin privat të paketës.

## Verifikimi i rikthimit

| Pika | Provat e kryera me sukses |
|---|---|
| 1 | `test-match-pages`, `test-board-settings`, `test-board-settings-api`: të gjitha ndeshjet e lejuara, mbi 2500 abonime, persistencë/rinisje dhe ruajtje snapshot-i kur dështon upstream. |
| 2 | `test-board-markets-browser`: një treg në 320/390px, desktop me dy tregjet ekzistuese në 1366px; klikime, pezullime dhe pa dalje jashtë ekranit. |
| 3 | `test-football-competitions`: 97 raste, Europa 1–3, pjesa tjetër kategoria kryesore; Champions, Europa, Conference, World Cup dhe garat ndërkombëtare ruhen. |
| 4 | `test-admin-market-hiding`, `test-market-visibility-socket`, `test-match-sync-browser`: fshehje/riaktivizim global dhe sipas vendit/ligës, HTTP/socket/cache, live/prematch, pa rikthim çmimesh të fshehura. |
| 5 | `test-display-copy`: UTF-8 strikt në gjithë `web/src`, fjalorët, riparimi i karaktereve dhe ruajtja e diagnostikimit origjinal. |
| 6 | `test-sportsbook-labels`, `test-language-browser`: përkthime semantike, numra/kushte të pandryshuara, mesazhe shqip në pamjen e gabimit. Emrat e ekipeve dhe tekstet brenda aseteve origjinale nuk rishkruhen. |
| 7 | 3108 shpërndarje racionale ekzakte, vlerësues të pavarur, prova HTTP/wallet dhe 1,045,000 raunde diagnostikuese. `server/casino/SUPPORT-MATRIX.md` dokumenton secilën lojë: gjashtë Custom dhe dy me profile origjinale. HF mbi 100% dhe çiftet e parealizueshme refuzohen. Simulimi nuk është certifikim. |
| 8 | `test-stats-rotation`: 21 skenarë, përfshirë të pesë burimet pas FT, kuotat, cache dhe rinisjen. `test-protected-finance`: vetëm përzgjedhjet me konflikt mbahen pezull, vendime manuale treg/biletë, auditim, rollback dhe pa kreditim të dyfishtë. `test-market-exposure-browser`: formularët realë në 1366/390px. |
| 9 | `test-protected-event-minutes`, `test-provider-timeline-retention` dhe tracker real në browser: 23, 45+2, 78; renditje numerike, anulime dhe ruajtje përmes përditësimeve të lehta. |
| 10 | Dy dritare reale, rilidhje, korrigjime dhe REST i vjetër që nuk fshin ngjarjen e re. Përhapja lokale u mat 104 ms; nuk përfshin furnizuesin/rrjetin e jashtëm. Buffer-i artificial 3 sekonda u hoq. |
| 11 | `test-protected-ticket-quote`, `test-ticket-payout-presentation`: kuotimi origjinal i pandryshueshëm, pagesa reale veçmas, etiketa e rindërtimit historik; MyBets/History/Manager në 1366/390/320px. |
| 12 | Hash-et: 41 skedarë Fortune, 513 Clover, 662 burime të tjera dhe 583 referenca mobile. `test-fortune-teller-layout`: fullscreen para/ngjatë montimit, autoplay i qendruar, resize dhe dalje/rikthim, pa baste reale. Pamjet e biletave dhe monitorimit u kontrolluan vizualisht; nuk u bë ridizajnim global. |
| 13 | `test-user-removal`, `test-user-directory-browser`: ADMIN aktiv, një klikim/një DELETE, pa dialog, soft delete, auditim, histori e ruajtur dhe rollback; 320–1440px. |
| 14 | `test-protected-finance`, `test-market-exposure-browser`: identitete, shuma për përdorues/përzgjedhje, koeficientë, detyrime të kushtëzuara dhe neto. Biletat e kombinuara nuk dyfishojnë bastin total; ndarja ruan çdo qindarkë. |

## Komandat e kontrollit

- `npm run test:protected` — regresionet kryesore, me databaza dhe HTTP/socket prove.
- `npm run test:protected:browser` — pamjet dhe ndërveprimet në Chrome me mbrojtjen normale.
- `npm run test:protected:simulation` — diagnostikimi statistikor i motorëve.
- `npm --prefix web run typecheck` dhe `npm run build:web`.

Kontrolli bazë është shtuar edhe në GitHub Actions. Figurat/rezultatet lokale
ruhen te `test-artifacts/`, pa u publikuar. Çelësat realë nuk përdoren nga testet.
Vonesa dhe mbulimi real i secilit API varen nga burimi/plani.

## Përdorimi dhe përditësimi

Paneli i ri gjendet te **Admin → Bastet dhe verifikimi**. Shumat e ndara mund të
mblidhen pa dyfishim; shumat e lidhura nuk mblidhen mes ndeshjeve të së njëjtës
biletë. Pagesa dhe netoja në çdo rresht i përkasin asaj përzgjedhjeje dhe varen
nga fitimi i pjesës tjetër të biletës. Nuk paraqiten si maksimum i përbashkët i
të gjitha tregjeve që mund të fitojnë njëkohësisht. Kjo shpjegohet edhe në panel.

Ruaj `.env`, `data/` dhe kopjet rezervë kur përditëson serverin. Rinisja normale
krijon tabelat e reja idempotente; nuk kërkohet zëvendësim i databazës.
`STATS_PROVIDERS_ENABLED=true` aktivizon shërbimin plotësues me çelësat privatë.
Skedarët e publikimit, përfshirë përmirësimet e mëparshme ende të papublikuara,
raportohen te `PROTECTED_REPAIR_FILES.md`. Backup-et para ndërhyrjeve janë te
`.runtime/protected-repair-backup-20261105/`, jashtë GitHub-it.


## Kërkesa e fundit: gjithë futbolli real

Filtri rajonal zëvendësohet nga kërkesa e shprehur e fundit. U hoqën filtrat e kategorisë, datës së parazgjedhur dhe mungesës së koeficientëve, përfshirë reset-in te Sot gjatë ndryshimit të skedës. Metadata e vendit/kampionatit trashëgohet nga nyja prind e header-it prematch.

Prova me API reale: 1424 ndeshje prematch në atë snapshot, 1407 reale dhe 1407 të publikuara; 18 live, 9 reale dhe 9 të publikuara; asnjë ekip i pazgjidhur. Numrat ndryshojnë me API-në. Ofertat outright me ID negative dhe virtualet nuk janë ndeshje futbolli real.

`test-all-real-football`: 3500 prematch reale, të ardhshme dhe pa çmime, me metadata të saktë. `test-board-markets-browser`: ndeshja pas shtatë ditësh pa tregje shfaqet në 1366/390/320px. `test-match-visibility`: fshehje/rikthim administrativ i pavarur nga pezullimi, SQL/reload/njoftim, si live edhe prematch. Admin → Ndeshjet dhe kuotat → Fshih ndeshjen / Shfaq ndeshjen. Fshehja bllokon edhe bastin në përzgjedhjet e ruajtura dhe nuk ndryshon historikun.

Prova shtesë `test-admin-match-control-browser` kaloi butonat realë Fshih/Shfaq, ruajtjen e pezullimeve dhe kuotave, si dhe pamjet admin 320/390/1024/1366px. Kaluan i gjithë runner-i `test:protected`, typecheck dhe build-i i këtij versioni.


## Kufiri i zgjedhur nga administratori

Kërkesa e fundit autorizon fushën prematchLimit: 0 publikon të gjitha, X pozitiv publikon maksimumi X parandeshje, pa tejkalim nga kampionatet me përparësi. Live mbetet i pakufizuar. Furnizimi Zizobet ruan të gjitha ndeshjet pavarësisht këtij kufiri. Përditësimi i kufirit njofton klientët ekzistues. Kaluan testet e API-së reale të izoluar me ruajtje/rinisje, refuzim rolesh dhe rikthim 0; browser1366/390/320px me Ruaj dhe rikuperim nga gabimi; prova1420→100parandeshje+10live. U hoq edhe shpjegimi i vjetër Europa/ndarjet në panel.
