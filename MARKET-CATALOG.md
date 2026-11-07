# Tregjet dhe renditja

Në admin hap **Tregjet dhe renditja**. Kërko sipas emrit ose përdor kategoritë. Një treg mund të jetë në disa kategori: për shembull totali i këndeve del te Totale dhe Kënde.

**Aktiv / Joaktiv** vlen për familjen e tregut në të gjitha ndeshjet dhe linjat e saj. Joaktiv do të thotë i fshehur dhe i papranueshëm për baste të reja, përfshirë kuponët e vjetër ende të pavendosur. Biletat e pranuara më parë nuk ndryshohen dhe llogariten normalisht.

Te **Radha**, shkruaj pozicionin dhe shtyp Enter ose dil nga fusha. Tregu zhvendoset në atë vend, ndërsa të tjerët riorganizohen. Renditja zbatohet për të gjithë përdoruesit. Tregjet që nuk ofrohen në një ndeshje thjesht anashkalohen.

Katalogu plotësohet automatikisht nga tregjet e hasura në feed. Familjet e reja janë aktive dhe shtohen pas renditjes së caktuar. Pjesët e ndeshjes, intervalet me madhësi të ndryshme dhe kontratat me kushte të ndryshme kanë kontrolle të veçanta. Linjat e të njëjtit total ndajnë një kontroll.

Cilësimet ruhen në databazën ekzistuese, në tabelën `app_market_catalog`, e krijuar automatikisht gjatë nisjes. Nuk kërkohet reset ose migrim manual. Ndryshimet regjistrohen në auditin e adminit dhe u dërgohen klientëve me lidhjen realtime. Në disa procese serveri, rifreskimi i konfigurimit bëhet gjithashtu çdo 10 sekonda.
