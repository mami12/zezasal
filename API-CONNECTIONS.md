# Lidhjet e faqes dhe statistikat plotësuese

Folderi aktual: faqjaybet/faqja-mainlive (emri i mëparshëm: faqja-main). Nuk është ndryshuar burimi i kuotave.

| Shërbimi | Lidhja | Çelësi në .env |
|---|---|---|
| Zizobet, kuota dhe ndeshje | https://wss-eu-uk1.ws-amazon.com/api/cache/get?key= | Nuk kërkon çelës privat në këtë përshtatës |
| Zizobet, fjalorë/metadata | https://analytics-sp.googleserv.tech/api/ | Nuk kërkon çelës privat |
| Zizobet, njoftime MQTT | wss://wss-eu-uk1.ws-amazon.com/mqtt | Lidhja ekzistuese, protokolli mqtt |
| BSD | https://sports.bzzoiro.com/api/v2/ | BSD_API_KEY, Authorization: Token |
| Worldcup26 | https://worldcup26.ir/get/soccer/ | Pa çelës |
| SportAPI | https://sportapi.ai/api/ | SPORTAPI_API_KEY, X-Api-Key |
| Goal API | https://api.goal-api.com/v1/ | GOALAPI_API_KEY, Authorization: Bearer |
| API-Football | https://v3.football.api-sports.io/ | APIFOOTBALL_API_KEY, x-apisports-key |

Lista me vlerat private është vetëm në `.runtime/API-KEYS.private.md`. Nuk shërbehet nga faqja dhe nuk duhet ngarkuar në GitHub. Football-data.org nuk është integruar. Burimet përdoren me rotacion brenda kuotës së secilit; kalimi te burimi tjetër nuk rivendos dhe nuk tejkalon kufirin e burimit të parë.

Lidhje të tjera ekzistuese: Betgenius përdor https://gsm-widgets.betstream.betgenius.com/v1/widget/ për playByPlay, multisportscoreboardwidget dhe teamStats, me customer googstreams dhe fixtureId. Ybets https://sportsbook.ybets.net/api/v2/ mund të kontaktohet vetëm për biletat e vjetra Ybets në pritje; nuk furnizon tabelën apo kuotat e reja. LuckyBet dhe Sportradar nuk aktivizohen si burime të reja nga ky ndryshim.

## Kur bëhen kërkesat

Aktivizimi: `STATS_PROVIDERS_ENABLED=true`. Shërbimi punon në backend. Pesë burimet plotësuese përdorin REST; nuk është shtuar asnjë WebSocket tjetër.

Vetëm ndeshjet live me të paktën një rresht bilete `PENDING` dhe biletë prind `PENDING` hyjnë në përditësimin e statistikave. Përfshihen edhe bastet e zakonshme 1X2, jo vetëm tregjet që kërkojnë ngjarje. Hapja e detajeve pa bast aktiv, ndeshjet prematch dhe biletat e mbyllura nuk shpenzojnë kërkesa. Nuk bëhet më kontroll BSD para bastit vetëm nga hapja e faqes. Tregjet që kërkojnë prova mbeten të bllokuara pa mbulim të verifikuar; rregullat e adminit dhe të verifikimit ruhen.

Përditësimi ekzekutohet në backend edhe kur askush nuk ka hapur faqen. Cikli i statistikave është 10 minuta për ndeshje dhe ndahet mes të gjitha biletave e vizitorëve. Ndeshjet e përfunduara nuk rifillojnë polling edhe nëse katalogu ende thotë `LIVE`; kontrollohen statusi dhe rezultati i arkivuar. Pas mbylljes së të gjitha basteve ndalon ndjekja.

Renditja bazë është BSD → Worldcup26 → SportAPI → Goal API → API-Football, duke përjashtuar burimet pa çelës të konfiguruar. Burimi që provohet i pari zhvendoset me radhë në çdo cikël të nevojshëm; pozicioni ruhet në databazë dhe ndahet mes ndeshjeve. Në mungesë të ndeshjes, fushave ose në rast gabimi/kuote provohet tjetri. Kërkimi ndalon kur janë plotësuar goditjet në portë, goditjet totale, faullet, këndoret dhe intervalet e golave. Posedimi dhe kartonët plotësohen nga e njëjta përgjigje kur raportohen qartë. Nuk bashkohen anë me vlera që kundërshtojnë njëra-tjetrën.

Verifikimi final i ngjarjeve mbetet i veçantë dhe ndiqet vetëm kur e kërkon një bast aktiv përkatës. Gjatë lojës përdor të njëjtin interval 10 minuta dhe cache HTTP të përbashkët. Pas konfirmimit të përfundimit provohet në kalimin e radhës të verifikimit të biletave, pastaj pas 3, 15, 60 minutash dhe çdo 6 orë nëse mungojnë ende provat. Ky verifikim nuk përdor cache të vjetër live si provë finale. Një cikël mund të përfshijë disa kërkesa HTTP për kalendar, ngjarje, statistika dhe, kur duhen prova, formacione. Secila numërohet veçmas.

Oraret, rotacioni, lidhjet e identiteteve, cache dhe numëruesit ruhen në databazë dhe mbijetojnë rinisjen. Gabimet HTTP dhe timeout-et numërohen. Gabimet 401/402/403/429 ndalojnë përkohësisht burimin; respektohen `Retry-After` dhe headers të kuotës së mbetur kur raportohen. Kuota ditore shteron deri në ditën tjetër UTC, ajo mujore deri në muajin tjetër UTC. Intervali 10 minuta është objektivi kur ka kuotë dhe mbulim të disponueshëm.

## Kufijtë dhe ruajtja

Kufij mbrojtës lokalë të paracaktuar: BSD 1000/ditë dhe 14000/muaj; Worldcup26 500/ditë dhe 10000/muaj; SportAPI 2000/ditë dhe 14000/muaj; Goal API 1000/ditë dhe 31000/muaj (tavan lokal mujor); API-Football 100/ditë dhe 3100/muaj. Kufijtë BSD/Worldcup26 janë tavane të vendosura nga aplikacioni, jo garanci për planin e ofruesit. Kufiri real i ofruesit ka përparësi. Mund të ulen me `BSD_DAY_LIMIT`, `BSD_MONTH_LIMIT`, `WORLDCUP26_DAY_LIMIT`, `WORLDCUP26_MONTH_LIMIT`, `SPORTAPI_DAY_LIMIT`, `SPORTAPI_MONTH_LIMIT`, `GOALAPI_DAY_LIMIT`, `GOALAPI_MONTH_LIMIT`, `APIFOOTBALL_DAY_LIMIT`, `APIFOOTBALL_MONTH_LIMIT`. Vlera `0` ndalon kërkesat e reja të atij burimi për periudhën. Për një plan me 100 kërkesa/ditë vendoset `PROVIDER_DAY_LIMIT=100` për ofruesin përkatës.

Tabela lokale: `app_stats_usage` (numërues), `app_stats_cache` (cache dhe lidhje), `app_match_event_evidence` (ngjarje vetëm për ndeshjet me bileta përkatëse). Nuk ruhet çelësi në këto tabela. Pas rinisjes nuk rivendoset kuota e konsumuar.

Përputhja kërkon të dy emrat në të njëjtën anë dhe orarin brenda 5 minutash; kandidatët e shumëfishtë refuzohen. Nuk hamendësohen emrat. Ndryshimet e shkrimit ndërmjet ofruesve mund ta lënë një treg të fshehur. Worldcup26 kontrollon si parazgjedhje eng.1, esp.1, ita.1, ger.1, fra.1, por.1; lista mund të ndryshohet te `WORLDCUP26_LEAGUES`.

Nuk garantohet mbulimi i çdo tregu: para llogaritjes kërkohet timeline i plotë, përputhje e golave për secilin ekip me rezultatin final dhe identitet/pjesëmarrje e lojtarit. Mungesa e asistit/metodës nuk do të thotë zero. Golat në kohën shtesë dhe penalltitë për përcaktimin e fituesit nuk përzihen me 90 minutat. Burimet nuk bashkohen për të krijuar një timeline të hamendësuar. Tregjet pa kontratë të verifikuar mbeten të fshehura/pending sipas rastit.

Diagnostikimi: `/health`, fusha `statsProviders`, tregon kërkesat dhe gabimet me kode pa çelësa, `watchedMatches`, `cachedStatistics` dhe `refreshIntervalMs=600000`. Verifikimi i izoluar: `npm run test:statistics` (përfshin intervalet, rotacionin, kuotat, rinisjen, ndeshjet me/pa baste dhe shfaqjen në shfletues). Për ndryshimet në .env ose kod duhet rinisur serveri.

## Goal API

Burim plotësues në rotacion për biletat në pritje: kalendari `/fixtures/date/:date`, statistikat `/fixtures/:id/statistics`, detajet `/fixtures/:id`, ngjarjet `/fixtures/:id/events`, formacionet `/fixtures/:id/lineups`. Kalendari ruhet një orë dhe ndahet mes ndeshjeve. Gjatë lojës respekton ciklin e përbashkët 10 minuta; pas përfundimit përdoret vetëm për provat që kërkon një biletë në pritje. Mënyra e goditjes me kokë/këmbë nuk hamendësohet. Asisti i munguar nuk trajtohet automatikisht si zero. Identifikuesit playerKey të formacioneve përputhen me identifikuesit e ngjarjeve; zëvendësuesit nuk quhen pjesëmarrës vetëm sepse figurojnë në stol.

Nuk aktivizohet WSS i Goal API (`wss://api.goal-api.com/ws`): është jashtë këtij integrimi dhe varet nga plani. Çelësi ruhet vetëm te `.env` dhe lista private.

## Kontratat e zgjeruara të biletave

Përpunimi përdor emrat dhe çelësat origjinalë të tregut, jo përkthimin në ekran. Mbështeten kontratat e përcaktuara `Player to score exactly N goals` (saktësisht N), `Player to score N+ goals`/`Player to score N+` (N ose më shumë), hat-trick (3+), dhe zgjedhjet numerike të `Player exact goals`. Emri i paqartë `Player to score 3 goals` nuk hamendësohet si 3+ apo saktësisht 3.

Intervalet e mbështetura: `in minutes A-B`, me skaje përfshirëse dhe gjerësi të kontrolluar; `before minute N` për minuta më të vogla se N; `after N minutes` për minuta më të mëdha se N; `within/by/until N minutes` deri në N përfshirë; `at minute N` vetëm minuta N. Formati real `from A:00 to B min` përfshin minutat e etiketuara A+1 deri në B. Tregjet me këtë afat fshihen pasi mbaron dritarja në minutën e konfirmuar të ndeshjes. Këto janë rregulla sipas minutës së raportuar, jo kontrata me saktësi sekonde. Formatet e papërcaktuara mbeten të mbyllura.

Golat 45+X mbeten në pjesën e parë dhe 90+X në pjesën e dytë; 30 minutat shtesë dhe gjuajtjet e penalltive përjashtohen. `When will goal N be scored` vlerëson golin e numëruar dhe intervalin e zgjedhur ose opsionin pa gol. Renditja e paqartë e disa golave në të njëjtën minutë nuk hamendësohet.

Gol me kokë, me këmbën e majtë/djathtë, autogol dhe penallti vlerësohen vetëm me fushën përkatëse të konfirmuar. Një `Normal Goal` nuk identifikon këmbën ose kokën. Fituesi llogaritet pasi të jetë konfirmuar timeline i plotë dhe të përputhet me rezultatin përfundimtar.

## Kontroll shtesë: qëndrueshmëria live

Lista e pjesshme live nuk zëvendëson kuotat dhe gjendjen e verifikuar nga detajet e ndeshjes. Mungesa e një fushe nuk është pezullim i konfirmuar. Pezullimi i shprehur nga API-ja respektohet. Kur një ndeshje mungon përkohësisht nga lista, ruhet ndjekja e saj dhe kontrollohen detajet; kuotat e paverifikuara bllokohen dhe nuk shiten si të freskëta. Në kalimin prematch/live provohet edhe detaji live, pa pritur që katalogët të përputhen. Një status final i konfirmuar nuk kthehet live nga një përgjigje më e vjetër.

Kur burimi rihap një kuotë, detajet e ndeshjes së hapur rifreskohen me kërkesa të bashkuara (jo për çdo ndryshim çmimi), pa pritur ciklin periodik prej 20 sekondash. Kontrollet paraprake të statistikave nuk vonojnë verifikimin final; një timeline final i paplotë nuk ndalon kalimin te burimi rezervë.

## Statistikat dhe intervalet në faqen e ndeshjes

Faqja e detajeve shfaq goditjet në portë dhe faullet për secilën skuadër, si dhe golat e ndarë në intervalet 1–15, 16–30, 31–45+, 46–60, 61–75 dhe 76–90+. Përqindjet, sulmet, goditjet jashtë porte dhe statistikat e lojtarëve nuk përdoren si zëvendësim për totalet e skuadrës. Goli në kohën shtesë të pjesës së parë ose të dytë futet në intervalin përkatës; koha shtesë e ndeshjes dhe seria e penalltive përjashtohen.

Burimi kryesor ka përparësi kur i raporton numrat. Kur mungojnë, për ndeshjet live me baste aktive kërkimi plotësues i backend-it përdor rotacionin e përshkruar më sipër. Çdo cikël rindërton numrat dhe intervalet nga përgjigjet e reja, pa ngrirë vlerat jo-bosh të ciklit të kaluar. Për intervalet përdoret lista e golave nga një burim i vetëm dhe vetëm pasi përgjigjja është e plotë; ngjarjet e paqarta, të dyfishuara ose pa skuadër nuk numërohen. Kartonët dhe penalltitë e humbura nuk trajtohen si gola.

Kërkesa dhe cache ndahen nga të gjithë shikuesit e së njëjtës ndeshje. Cache plotësues ruhet 10 minuta, edhe pas rinisjes. Të dhënat plotësuese përdoren vetëm për shfaqje, pa mbishkruar të dhënat kryesore të ruajtura apo provat e verifikimit të biletës. Në mungesë të dy numrave shfaqet vijë bosh me —; zero shfaqet vetëm kur raportohet zero. Shiriti 4:2 është 2/3 me 1/3; 0:0 nuk ngjyros shiritin.

Referenca për formatet dhe kufijtë: [BSD football events](https://sports.bzzoiro.com/docs/football/events/), [SportAPI](https://sportapi.ai/docs), [Goal API](https://goal-api.com/documentation).
