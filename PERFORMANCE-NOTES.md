# Përmirësimet e ngarkimit

Lista e ndeshjeve ruan të gjithë futbollin real të API-së. Dita dhe gjendja kufizojnë listën vetëm kur zgjidhen shprehimisht nga përdoruesi. Për çdo ndeshje dërgohen vetëm tregu kryesor dhe linja e totalit që do të shfaqet. Rregullat ekzistuese të alternativave (dopjo shans, shënojnë të dyja skuadrat, linja më e afërt) përdoren në server dhe frontend nga i njëjti modul.

Lista dhe faqja e tregjeve montojnë vetëm rreshtat pranë ekranit; pjesa tjetër ruan hapësirën e scroll-it. Butonat abonohen te kuota e tyre dhe te përbërësit e kombinimit, në vend që çdo çmim të rivizatojë të gjithë butonat. Ndryshimi i çmimit në kupon nuk ndryshon gjendjen e përzgjedhjes së butonave të tjerë.

Hapja e ndeshjes kërkon nga furnizuesi tregjet e plota vetëm për atë ndeshje. Ndeshja shfaqet te Kryesore. Kategoritë e tjera dërgohen te shfletuesi kur zgjidhen; kërkimi dhe Të gjitha tregjet mund të marrin listën e plotë me kërkesën e përdoruesit. Numëruesit e kategorive vijnë veçmas nga serveri. Kërkesat e njëpasnjëshme për të njëjtën ndeshje ndajnë ngarkimin e motorit brenda intervalit 3-sekondësh.

Socket.IO dërgon kuotat sipas rreshtave të dukshëm, kategorisë së hapur dhe zgjedhjeve të kuponit, përfshirë përbërësit e kombinimeve. Goli, statusi dhe pezullimet nuk presin cache-in e çmimit. Kuponi vazhdon të marrë përditësime edhe kur ndeshja është jashtë ekranit. Tregjet e çaktivizuara nuk publikohen si kuota. Kontrolli përfundimtar i bastit, afatet e freskisë dhe llogaritja e biletave nuk ndryshojnë.

Admini, kazinoja dhe faqet e raporteve ngarkojnë kodin e tyre vetëm kur hapen.

Matje lokale me 120 ndeshje nga një fotografim i regjistruar i API-së:

- Përgjigjja e listës: 799,221 → 338,421 bytes (58% më pak); gzip: 21,115 → 8,747 bytes.
- Përgatitja e listës në provën lokale: 1,463 → 246 ms. Kjo është matje e provës, jo garanci e shpejtësisë në çdo server.
- Ndeshja e plotë: 231,780 bytes; vetëm Kryesore: 8,331 bytes.
- JavaScript fillestar: afërsisht 813 KB → 550 KB; kodi i faqeve të tjera merret veçmas.
- Provë shfletuesi me 300 abonentë çmimesh: ndryshimi i një kuote rivizatoi vetëm një abonent.
- Provë liste me 1,000 ndeshje: fillimisht 17 rreshta të montuar; ndeshja e fundit arrihet me scroll.

Kaluan provat e serverit me databazë të përkohshme, izolimit WSS listë/kategori/kupon, heqjes së kuotës, përkthimeve dhe intervaleve, cilësimeve globale, si dhe ndërfaqes së përdoruesit/adminit në 1366px dhe 390px.

Pas kopjimit: stop.bat, start.bat dhe rifreskim i plotë i shfletuesit (Ctrl+F5). Nuk kërkohet reset ose migrim i databazës. Klientët me versionin e vjetër të faqes kanë protokollin e mëparshëm deri kur rifreskohen.

## 2026-11-05 — burimi i lehtë dhe ngarkimi i një ndeshjeje

Prematch përdor kërkesën e përbashkët getprematchgameall për çmimet kryesore, në blloqe me 80 ID. Nuk shkarkon katalogun e plotë për çdo ndeshje të pahapur. Focus kërkon getprematchgamefull vetëm për ndeshjen e zgjedhur; shikuesit ndajnë freskinë tresekondëshe. Live përdor çmimet kryesore të header-it; detajet dhe ndeshjet me baste mbeten të ndjekura për freski dhe verifikim. Përditësimi kryesor nuk fshin tregjet shtesë të ruajtura më parë.

Përgjigjja e listës përmban vetëm tregjet që do të shfaqen. Filtrimi bëhet para renditjes/ndërtimit të tregjeve. Një matje sintetike me 400 ndeshje dhe 72,000 kuota dha 27,520,581 → 752,181 bytes (rreth97% më pak), me përgatitje1658 →522ms në laptopin e testit. Kjo matje krahason ndërtimin e plotë me pamjen kryesore; nuk është garanci e kohës së ngarkimit në internet ose përmirësim97% i gjithë faqes.

Hapja e detajeve regjistron interes për statistikat për12minuta, i rinovuar nga leximi i detajeve. Cache/kuota ndahen mes përdoruesve. Pas10minutash bëhet rifreskimi; pa shikues dhe pa bast interesi skadon. Kërkesat e njëkohshme presin radhën me dy punë aktive, pa e hedhur poshtë ndeshjen e tretë.
