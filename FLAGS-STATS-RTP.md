# Flamujt, statistikat dhe RTP

## Flamujt

Kategoritë e ndeshjeve kanë flamurin përpara emrit. Janë përdorur 100 SVG origjinale nga kapja lokale e Fito24, të ruajtura brenda frontendit. `web/public/country-flags/SOURCE.json` regjistron prejardhjen dhe gjurmët e skedarëve. Kategoritë ndërkombëtare dhe vendet për të cilat mungon një flamur i identifikuar shfaqin globin neutral.

## Goditjet dhe faullet

Kur furnizuesi i dërgon, normalizohen veçmas goditjet totale, goditjet në portë dhe faullet e kryera. Nuk përdoren sulmet, goditjet jashtë porte ose goditjet e lira në vend të këtyre statistikave. Të dhënat që mungojnë nuk bëhen zero. Vlerat dhe koha kur janë marrë ruhen në databazën lokale për verifikimin pas përfundimit të ndeshjes dhe pas rinisjes.

Nuk është shtuar një furnizues i ri sportiv dhe nuk është premtuar që çdo ndeshje do t'i ketë këto statistika. Pamja i shfaq vetëm kur janë dhënë të dyja vlerat. Llogaritja e tregjeve të mbështetura përdor statistikat e përfundimit; golat nuk përdoren në vend të goditjeve apo faulleve.

Tregjet për një lojtar të caktuar, golashënuesin, rendin e golave apo minutën kërkojnë histori të verifikuar ngjarjesh dhe identitet lojtarësh. Adapteri aktual nuk e jep këtë informacion të plotë. Prandaj këto baste nuk ofrohen si të reja; biletat ekzistuese nuk shpallen fituese/humbëse nga rezultati total. Ato kalojnë për shqyrtim ose te rregulli ekzistues i kthimit pas 72 orësh kur nuk mund të verifikohen. Tregjet statistikore me emër të paqartë skuadre, faulle të fituara, handikap, linja çerek apo kushte të pambështetura nuk ngatërrohen me totalin e ndeshjes.

## RTP mbi 100%

Për gjashtë motorët me matematikë të personalizuar, administratori mund të vendosë RTP nga 0 deri te kufiri i realizueshëm i tabelës reale të çdo loje, edhe mbi 1000%; shpeshtësia mbetet 0–100%. Fire Joker dhe Fortune Teller përdorin profilet origjinale të publikuara. Paneli tregon kombinimet e vlefshme për çdo lojë dhe RTP-në e nevojshme për shpeshtësi 100%. Cilësimet nuk ndryshojnë vetë. Për shembull, një lojë me kthim minimal 2× kërkon të paktën 200% RTP për të paguar çdo raund. Në kufirin minimal mund të realizohet vetëm pagesa minimale; për larmi nevojitet më shumë RTP ose më pak shpeshtësi.

RTP 200% do të thotë kthim mesatar afatgjatë 200 lekë për 100 lekë të luajtura. Nuk garanton fitim mbi bastin në çdo rrotullim. Vlerat e mëdha rrisin pagesat mesatare në kurriz të fondit të operatorit. Paytable dhe figurat vazhdojnë të llogariten nga motorët e lojërave; pagesat nuk fryhen duke ndryshuar vizualisht figurat. Informacioni i shanseve mbetet i lexueshëm për lojtarin.

## Instalimi

Vlefshmëria e kuotave përdor kohën reale të marrjes së secilës kuotë, veçmas nga rifreskimi i listës, rezultatit ose orës së ndeshjes. Zbatohen të njëjtët kufij si gjatë pranimit në server: 120 sekonda për LIVE dhe kufiri i konfiguruar për prematch (90 minuta si parazgjedhje). Kuota e vjetruar ose pa kohë të verifikuar shfaqet e bllokuar. Kombinimi bllokohet kur skadon njëra pjesë; kuponi kontrollon të njëjtat afate para vendosjes. Vetëm një kuotë e re mund ta rihapë. Gjatë rindërtimit të furnizimit bllokohen të gjitha zgjedhjet. Kontrolli në server mbetet për rastin kur gjendja ndryshon gjatë dërgimit të kërkesës.

Ndryshimet janë për faqen blu. Paketa `TRANSFER-RESKIN` ruan variantet e pamjes Vave për menunë, kategoritë dhe ndeshjen. Kopjo përmbajtjen sipas `COPY-FILES.txt`, ndërto frontendin dhe rinis serverin. Mos kopjo databaza ose `.env` nga testet. Nuk kërkohet reset financiar.
