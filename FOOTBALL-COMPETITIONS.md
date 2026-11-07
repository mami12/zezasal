# Filtri i kampionateve

`server/football-competitions.mjs` njeh kampionatet sipas emrit dhe shtetit. `server/upstream.mjs` e lidh vendimin me ID-në e kampionatit në katalogun e API-së dhe filtron para ruajtjes në memorie/abonimit për kuota.

- Angli, Itali, Francë, Spanjë, Gjermani, Portugali: nivelet 1–3.
- Shtetet e tjera europiane në listë: vetëm niveli 1.
- Rusia dhe shtetet jashtë Europës: vetëm niveli 1.
- Kupat kombëtare, Superkupat, ndërkombëtaret dhe miqësoret e ekipeve të rritura mbeten të lejuara.
- Përjashtohen moshat, rezervat, virtualet, kampionatet poshtë kufirit, kupat e identifikuara si rajonale dhe bastet afatgjata. Emrat e panjohur nuk lejohen automatikisht.

Funksioni `competitionTierLimit` përcakton kufirin sipas shtetit. Te `pyramids`, pikëpresja ndan nivelet, ndërsa `|` ndan emrat alternativë. API-ja nuk deklaron nivelin, ndaj emrat e rinj duhen kontrolluar. Kjo nuk është garanci që çdo emër që API-ja mund të shtojë më vonë do të njihet.

`FOOTBALL_TOP_TIERS_ONLY=false` në `.env` çaktivizon këtë listë; filtrat për virtualet mbeten. `SUBSCRIBE_LIVE_LIMIT` dhe `SUBSCRIBE_PREMATCH_LIMIT` vazhdojnë të vendosin kufirin numerik pas filtrimit. Për ndeshjet e biletave ekzistuese në pritje ndiqet vetëm informacioni i nevojshëm për llogaritjen, edhe kur liga del jashtë listës.

Pas ndryshimeve përdor `stop.bat` → `start.bat`. Nuk kërkohet rindërtim i frontend-it vetëm për këtë filtër. Kontrolli: `node scripts/test-football-competitions.mjs` dhe `node scripts/test-football-filter.mjs`.

Në publikimin prematch, vetëm ligat e mbrojtura europiane dhe garat kryesore UEFA përjashtohen nga kufiri. Ndeshjet jashtë Europës, kupat e tjera dhe miqësoret mbushin vendet e mbetura. Rifreskimi i zakonshëm i kuotave ndjek këtë përzgjedhje, me përparësinë e ligave përpara kufirit SUBSCRIBE_PREMATCH_LIMIT. Abonimet për rezultate të biletave në pritje ruhen. 0 në panelin e adminit mbetet pa kufi.
