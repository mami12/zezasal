# Përkthimet dhe goditjet në portë

Folderi: `faqjaybet/faqja-mainlive`.

## Gjuha

U rishikuan 261 përkthime të fjalorit Fito24 dhe titujt e futbollit nga përgjigjet e ruajtura të burimit aktual. Përkthimi i tregjeve dhe zgjedhjeve përdoret në detajet e ndeshjes, kupon, historik, administrim dhe printim.

- Dallohen saktësisht N gola nga N ose më shumë, golat e shënuar nga golat e pësuar, rezultati në çdo moment nga rezultati përfundimtar.
- Ruhen periudha, minuta, intervali, lloji i kartonit/goditjes dhe kushtet e kombinimeve.
- Zgjatjet dallohen nga minutat shtesë të arbitrit.
- “Pa gol” nuk shfaqet si përgjigjja e përgjithshme “Jo”. BTTS Jo nënkupton që të paktën njëra skuadër nuk shënon, jo domosdoshmërisht rezultatin 0–0.
- Emrat e lojtarëve dhe skuadrave nuk përkthehen si fjalë të zakonshme.
- Ndryshimi është në paraqitje. Çelësat, kuotat, emrat origjinalë të ruajtur dhe rregullat e pagesës nuk ndryshohen nga përkthimi. Anglishtja mbetet e zgjedhshme.

## Goditjet në portë

Poshtë tabelës së golave, kartonëve dhe goditjeve këndore shfaqet një shirit krahasimi. Me 4–2, pjesët janë 2/3 dhe 1/3. Me 0–0 të raportuar shfaqen dy zero dhe shiriti mbetet neutral. Informacioni i panjohur shfaqet me —, pa zero të sajuara.

Kur burimi kryesor ka dy totalet, përdoren ato. Përndryshe hapja e detajeve kërkon statistikën nga burimet plotësuese, me përputhje të ekipeve/orarit dhe cache 5-minutësh të përbashkët. Lista e ndeshjeve nuk nis kërkesa shtesë për këtë statistikë. Zbatohen kufijtë ekzistues të API-ve. Cache mbijeton rinisjen.

Fushat lexohen veçmas për goditjet në portë; sulmet, goditjet jashtë porte, goditjet gjithsej dhe statistikat individuale nuk përdoren si zëvendësim. Totale kontradiktore nga e njëjta përgjigje nuk hamendësohen. Statistika plotësuese në këtë ndryshim është për shfaqje, pa mbishkruar provat financiare të serverit.

## Kontrolli

Kaluan testet e përkthimeve, dallimit saktësisht/minimum, ruajtjes së emrave, kushteve kohore, pesë formateve të statistikave, cache dhe kufijve. U kontrolluan shfletuesit me gjerësi 390 dhe 1366 pikselë, shiriti 4–2, rasti 0–0, mungesa e të dhënave dhe ndërrimi Shqip/English. Ndërtimi i frontendit dhe prova e serverit me databazë të veçuar kaluan.

Për aktivizim: rinis serverin dhe rifresko faqen. Fondet, biletat ekzistuese dhe çelësat privatë nuk ndryshohen nga instalimi.
