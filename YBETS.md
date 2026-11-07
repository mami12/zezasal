# Burimi i futbollit: Ybets

Faqja blu përdor tani `SPORTS_PROVIDER=ybets` si parazgjedhje. Nuk kërkohet llogari Ybets, fjalëkalim apo API key. `.env` dhe databaza lokale ekzistuese nuk ndryshohen. Pas instalimit ndale serverin dhe hape sërish me `start.bat`; në shfletues përdor `Ctrl+F5`.

## Çfarë merret

- Vetëm futboll real: prematch dhe live, me faqëzimin e plotë të katalogut.
- Kuotat dhe ndryshimet e ndeshjeve nga kanalet publike WSS të sportsbook.ybets.net. Katalogu dhe pamjet e plota HTTP përdoren gjithashtu për rikuperimin e lidhjes dhe rifreskimin.
- Të gjitha tregjet vendase të ndeshjes së hapur, përveç handicap-it. Ruhet identiteti i plotë i tregut dhe parametrave të tij.
- Kufijtë e ligave dhe kufiri i ndeshjeve në admin vazhdojnë të vlejnë. Ndeshjet e hapura dhe ato me bileta në pritje ndiqen veçmas nga kufiri i tabelës.
- Tregjet e pezulluara, kuotat e vjetra dhe bllokimet e adminit nuk bëhen të luajtshme. Zgjedhjet e provuara si të përfunduara sipas rezultatit/kohës hiqen; gjendjet e panjohura nuk hamendësohen.

## Rezultatet dhe provat e tua

Tregjet e lojtarëve, minutave, kartonave dhe statistikave lejohen sipas kërkesës për testim. **Ekzistenca e tregut nuk provon që ky burim publik jep edhe rezultatin e tij.** Nëse të dhënat e nevojshme mungojnë, bileta mbetet për kontroll/vendim nga admini; ky adapter nuk shpik golashënues, kartona, faulle apo ngjarje që nuk i ka marrë. Për tregjet vendase Ybets nuk zbatohet kthimi automatik pas 72 orësh vetëm për mungesë të provës.

Statusi Ybets `CLOSED` (3) mbyll ofertën, por nuk provon përfundimin e ndeshjes. Vetëm një pamje e plotë me fazë përfundimtare dhe rezultat të konfirmuar mund të arkivohet si rezultat final. Një sinjal vetëm me status nuk përdor rezultatin e vjetër si rezultat final.

Përditësimi nuk ka kryer reset. Biletat e vjetra mbajnë ID-të e tyre; ndeshjet e reja kanë ID të veçanta. Transporti i vjetër përdoret vetëm për ndjekjen e rezultateve të biletave të vjetra nëse `ODDS_SOCKET=true`; nuk furnizon më tabelën e re.

## Kontrolli

Te `/health` shfaqen `sportsProvider: ybets`, `collector.provider: YBETS`, gjendja e WSS-it dhe gjendja e databazës lokale. Mos publiko përmbajtjen e `.env`.

Nëse do të rikthehesh qëllimisht te burimi i mëparshëm, vendos `SPORTS_PROVIDER=luckybet` në `.env` dhe rinis serverin. Nuk përzihen ID-të e dy burimeve.
