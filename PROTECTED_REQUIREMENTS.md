# FAQJA – SPECIFIKIMI I PLOTË I PROJEKTIT

## QËLLIMI KRYESOR

Gjatë zhvillimit të projektit FAQJA, disa funksionalitete janë hequr, ndryshuar ose kanë ndaluar së punuari, me apo pa dashje.

Detyra është:

1. Të analizohet kodi aktual.
2. Të identifikohen funksionalitetet e humbura ose të prishura.
3. Të rikthehen dhe integrohen të gjitha kërkesat e mëposhtme.
4. Të testohen në kushte reale.
5. Të mbrohen nga ndryshimet e ardhshme të paautorizuara.

**Asnjë rregull, funksion, ngjyrë ose element UI/UX nuk duhet të ndryshohet pa autorizimin tim të shprehur.**

---

# PJESA I – FRONTEND DHE NDESHJET

## 1. Rikthimi i ndeshjeve Prematch

Problemi aktual: Shumë ndeshje prematch janë zhdukur ose nuk shfaqen. Në disa raste shfaqen vetëm ndeshjet live.

Kërkesat:

- Rikthe të gjitha ndeshjet prematch që sjell API dhe plotësojnë kriteret e përcaktuara.
- Kontrollo backend-in, filtrat, cache, databazën dhe frontend-in.
- Kontrollo nëse ekzistojnë kufizime artificiale në numrin e ndeshjeve.
- Mos fshih ndeshje për të përmirësuar performancën.
- Siguro që të gjithë përdoruesit marrin të njëjtin informacion.
- Kontrollo që ndeshjet të mos zhduken kur faqja qëndron hapur për një kohë të gjatë.
- Siguro sinkronizim të saktë ndërmjet pajisjeve dhe skedave të ndryshme.

**Kriteri i pranimit:** Të gjitha ndeshjet prematch të lejuara që ofron API duhet të shfaqen, pa kufizime të paautorizuara.

## 2. Frontend Mobile – Vetëm një treg

Në faqen kryesore mobile:

- Shfaq vetëm 1 treg për çdo ndeshje, jo 2.
- Rregullo përmasat dhe hapësirat që informacioni të jetë i lexueshëm.
- Mos zvogëlo tepër koeficientët ose emrat e ekipeve.
- Tregjet e tjera duhet të jenë të disponueshme brenda detajeve të ndeshjes.
- Mos ndrysho ngjyrat, fontet, ikonat ose strukturën e përgjithshme.
- Mos ndrysho pamjen desktop pa autorizim.

**Kriteri i pranimit:** Në mobile, faqja kryesore shfaq një treg për ndeshje, me pamje të rregullt dhe të lexueshme.

## 3. Filtrimi i ndeshjeve sipas rajonit

Shfaq të gjitha ndeshjet që ofron API sipas këtyre kritereve:

**Europë:**
- Deri në 3 kategori.

**Pjesa tjetër e botës:**
- Vetëm kategoria kryesore.

Rregulla:

- Mos shto filtra të tjerë që fshehin ndeshjet e lejuara.
- Mos kufizo numrin e ndeshjeve live ose prematch për arsye performance.
- Mos fshih ndeshje vetëm sepse kanë shumë tregje.
- Kontrollo klasifikimin e saktë të vendeve, ligave dhe kategorive.
- Ruaj ndeshjet që plotësojnë kriteret edhe gjatë përditësimeve të cache.

**Kriteri i pranimit:** Çdo ndeshje që plotëson filtrin rajonal dhe ofrohet nga API duhet të jetë e disponueshme në sistem.

---

# PJESA II – ADMIN PANEL

## 4. Aktivizimi dhe fshehja e tregjeve

Problemi aktual: Fshehja e tregjeve nga admin paneli nuk funksionon siç duhet.

Kërkesat:

- Administratori duhet të mund të aktivizojë dhe çaktivizojë tregjet.
- Kur një treg çaktivizohet, ai nuk duhet të shfaqet te përdoruesit.
- Kur aktivizohet përsëri, duhet të shfaqet nëse API e ofron.
- Ndryshimet duhet të zbatohen në frontend, backend dhe WebSocket.
- Cache nuk duhet të rikthejë tregje të çaktivizuara.
- Kontrollo funksionimin për tregjet live dhe prematch.
- Mos ndrysho tregje të tjera që nuk janë përzgjedhur nga administratori.

**Kriteri i pranimit:** Çdo ndryshim i tregjeve nga administratori zbatohet saktë për të gjithë përdoruesit.

## 5. Korrigjimi i gabimeve të enkodimit

- Korrigjo të gjitha tekstet me karaktere të dëmtuara.
- Përdor UTF-8 në mënyrë konsistente.
- Kontrollo frontend-in, admin panelin, databazën dhe përgjigjet e API-ve.
- Korrigjo karakteret shqipe ë dhe ç.
- Mos ndrysho dizajnin gjatë korrigjimit.

## 6. Përkthimi i plotë në shqip

Përkthe të gjitha tekstet që kontrollohen nga projekti:

- Frontend.
- Admin panel.
- Tregjet sportive.
- Kategoritë dhe filtrat.
- Statuset e ndeshjeve.
- Biletat dhe historikun e tyre.
- Butonat dhe menutë.
- Mesazhet e gabimeve.
- Njoftimet.
- Tekstet e kazinove.

Përdor shqipe të saktë, të qartë dhe të kuptueshme.

**Kriteri i pranimit:** Nuk duhet të mbeten tekste të papërkthyera ose karaktere të dëmtuara në pjesët që kontrollohen nga projekti.

---

# PJESA III – KAZINOTË

## 7. RTP dhe Hit Frequency

Kontrollo të gjitha lojërat e kazinosë.

### Konfigurimi i kërkuar

Administratori kërkon konfigurime në intervalin 1%–1000%.

Shembuj:

- RTP 10%, Hit Frequency 1%.
- RTP 50%, Hit Frequency 5%.
- RTP 100%, Hit Frequency 20%.
- RTP 200%, Hit Frequency 50%.
- RTP 1000%, Hit Frequency 1000%.

### Kërkesat

- Mos vendos kufizime arbitrare në konfigurimin e RTP.
- RTP duhet të zbatohet realisht nga motori i lojës.
- Hit Frequency duhet të lidhet me matematikën reale të lojës.
- Hit Frequency standard, si përqindje rrotullimesh fituese, nuk mund të kalojë 100%. Për vlerat mbi 100% duhet të përcaktohet një parametër tjetër, si shumëzues frekuence.
- Mos paraqit një vlerë si funksionale nëse motori nuk mund ta realizojë.
- Kontrollo secilën lojë veçmas.
- Verifiko rezultatet me simulime statistikore.
- Mos ndrysho animacionet, audion, simbolet, butonat ose UI/UX.
- Për lojërat me para reale, respekto rregullat e zbatueshme të certifikimit dhe transparencës.

**Kriteri i pranimit:** Parametrat e mbështetur duhet të zbatohen realisht dhe të verifikohen, jo thjesht të ruhen në admin panel.

---

# PJESA IV – API DHE STATISTIKAT

## 8. API-të shtesë, statistikat dhe verifikimi përfundimtar

Sistemi përdor rreth 4–5 API Keys nga burime të ndryshme.

Disa ofrues kanë limite Free Tier si:

- 100 kërkesa ditore.
- 200 kërkesa ditore.
- 1,000 kërkesa ditore.

### A. Gjatë ndeshjes

- Një kërkesë në fillim të ndeshjes.
- Përditësim çdo 10 minuta gjatë ndeshjes.
- Një kontroll përfundimtar pas mbarimit.
- Merr faullet, goditjet në portë, kornerat dhe statistikat e tjera të disponueshme.
- Nëse një API nuk e ofron informacionin, provo një burim tjetër.
- Nëse një API arrin limitin, përdor burime të tjera të disponueshme sipas kushteve të ofruesve.
- Monitoro kuotat e çdo API Key.
- Përdor cache të përbashkët.
- Mos bëj kërkesa të veçanta për çdo përdorues.
- Siguro që statistikat nga burime të ndryshme i përkasin të njëjtës ndeshje.

Intervali 10-minutësh nuk zbatohet për API-në kryesore të rezultateve dhe koeficienteve live.

### B. Në përfundim të ndeshjes

**Kontrollo të gjitha API-të e konfiguruara dhe të disponueshme që ofrojnë statistikat përkatëse.**

- Merr statistikat përfundimtare nga secili burim.
- Krahaso kornerat, faullet, goditjet në portë dhe tregjet e tjera.
- Verifiko që të dhënat janë përfundimtare.
- Ruaj vlerat, burimet dhe kohën e përditësimit.
- Mos përdor statistika të përkohshme si përfundimtare.
- Respekto rregullat e burimit autoritativ për shlyerjen e basteve.

### C. Kur API-të japin statistika kontradiktore

- Mos zgjedh automatikisht një rezultat të pasigurt.
- Mos përdor mesataren e statistikave.
- Vendos tregjet e prekura në statusin "Në pritje të verifikimit manual".
- Mbaj pezull vetëm biletat ose përzgjedhjet e prekura.
- Shfaq në admin të gjitha vlerat e API-ve.
- Dërgo automatikisht njoftim në Telegram.
- Administratori kontrollon informacionin dhe merr vendimin përfundimtar.

### D. Shlyerja manuale nga administratori

Administratori duhet të ketë mundësi të vendosë manualisht:

- Fituese.
- Humbëse.
- Në pritje.

Funksioni duhet të punojë si në nivel tregu, ashtu edhe për një biletë individuale.

Administratori:

1. Zgjedh ndeshjen dhe tregun ose biletën.
2. Kontrollon statistikat nga API-të.
3. Përcakton rezultatin sipas verifikimit.
4. Vendos statusin manualisht.
5. Sistemi shlyen biletat përkatëse.
6. Regjistrohen administratori, koha, arsyeja dhe burimi i vendimit.

Duhet të parandalohet kreditimi i dyfishtë dhe të ruhet historiku financiar.

### E. Njoftimet Telegram

Kur statistikat nuk përputhen, Telegram dërgon automatikisht:

- Ndeshjen.
- Tregun.
- Statistikat kontradiktore.
- Burimet API.
- Numrin e biletave të prekura.
- Statusin "Në pritje të verifikimit manual".

Telegram shërben vetëm për njoftime. Kontrolli dhe vendimmarrja bëhen në admin panel.

**Kriteri i pranimit:** Asnjë biletë e bazuar në statistika të diskutueshme nuk shlyhet automatikisht pa verifikimin e nevojshëm.

---

# PJESA V – INFORMACIONI LIVE

## 9. Minuta e saktë e ngjarjeve

Shfaq minutën ose kohën e:

- Golave.
- Kartonëve të verdhë.
- Kartonëve të kuq.
- Kornerave.
- Ngjarjeve të tjera që ofron API.

Shembuj:

- Gol 23'.
- Karton i verdhë 45+2'.
- Korner 78'.

Përdor minutën reale të ngjarjes nga API.

Mos e zëvendëso me kohën kur serveri e ka marrë informacionin.

## 10. Sinkronizimi i rezultateve dhe ngjarjeve live

API-ja kryesore ofron informacionin e ngjarjeve me vonesë deri në rreth 2 sekonda.

Kërkesat:

- Përpuno informacionin sapo të mbërrijë.
- Mos shto vonesa të panevojshme.
- Sinkronizo rezultatet, golat, kartonët dhe ngjarjet.
- Të gjitha pajisjet duhet të marrin të njëjtin informacion.
- Dy skeda të së njëjtës faqe nuk duhet të shfaqin rezultate të ndryshme.
- Kontrollo WebSocket, cache dhe mekanizmat e përditësimit.
- Mos fshih ndeshje ose tregje për të përmirësuar performancën.
- Mat vonesën reale të sistemit.

**Kriteri i pranimit:** Përdoruesit marrin informacion të sinkronizuar, pa mospërputhje të panevojshme ndërmjet pajisjeve.

---

# PJESA VI – BILETAT

## 11. Ruajtja e fitimit të mundshëm

Edhe kur një biletë humbet, shuma origjinale e fitimit të mundshëm duhet të mbetet e dukshme.

Shembull:

- Basti: 1,000 lekë.
- Koeficienti: 5.00.
- Fitimi i mundshëm: 5,000 lekë.
- Statusi: Humbëse.
- Fitimi real: 0 lekë.

Mos e zero fitimin e mundshëm origjinal.

Ruaj veçmas:

- Fitimin e mundshëm.
- Fitimin real.
- Statusin e biletës.

Mos ndrysho llogaritjen e bilancit ose pagesave reale.

---

# PJESA VII – MBROJTJA E DIZAJNIT

## 12. Mbrojtja e plotë e UI/UX

**Asnjë ndryshim vizual pa autorizimin tim të shprehur.**

Kjo përfshin:

- Ngjyrat.
- Temat.
- Fontet.
- Madhësitë e teksteve.
- Ikonat.
- Simbolet.
- Pozicionet e elementeve.
- Hapësirat.
- Bordurat.
- Strukturën e faqeve.
- Butonat.
- Menutë.
- Navigimin.
- Animacionet.
- Versionet mobile dhe desktop.
- Admin panelin.
- Pamjen e kazinove.

Shembuj:

Nëse kërkoj një lojë të re Apex, nuk ke autorizim të ndryshosh frontend-in ose admin panelin.

Nëse kërkoj rregullimin e një problemi në backend, nuk ke autorizim të ndryshosh ngjyrat.

Nëse kërkoj që mobile të shfaqë 2 tregje në vend të 1, ndrysho vetëm atë rregull dhe pjesët domosdoshmërisht të lidhura me të.

---

# PJESA VIII – MENAXHIMI I PËRDORUESVE

## 13. Fshirja e përdoruesve nga admin paneli

Aktualisht, për të fshirë një përdorues, kërkohet të shkruhet emri ose një tekst konfirmimi.

Kjo procedurë duhet të hiqet.

Kërkesat:

- Butoni Delete ose Remove.
- Një klikim për të kryer veprimin.
- Pa shkruar emrin e përdoruesit.
- Pa dritare konfirmimi shtesë.
- Pa tekst konfirmimi.

Veprimi duhet të jetë i disponueshëm vetëm për administratorët e autorizuar.

Për ruajtjen e historikut financiar, preferohet soft delete ose çaktivizimi i llogarisë, duke e hequr menjëherë nga lista aktive.

Ruaj historikun e transaksioneve dhe regjistro kush e kreu veprimin.

---

# PJESA IX – MONITORIMI FINANCIAR DHE TELEGRAM

## 14. Monitorimi i të gjitha basteve dhe njoftimet automatike

### A. Informacioni për çdo ndeshje

Administratori duhet të shohë për çdo ndeshje:

- Numrin e përdoruesve unikë që kanë vendosur baste.
- Identitetin e përdoruesve brenda admin panelit.
- Numrin total të basteve.
- Shumën e vendosur nga secili përdorues.
- Shumën totale të basteve.
- Tregjet ku janë vendosur bastet.
- Shumën për çdo rezultat.
- Koeficientet.
- Fitimet e mundshme.
- Pagesën e mundshme të operatorit për çdo rezultat.
- Fitimin ose humbjen e mundshme neto të operatorit.

### B. Informacioni për tregun 1X2

Për shembull, nëse 10 përdorues kanë vendosur baste në një ndeshje, administratori duhet të shohë:

- Sa përdorues kanë zgjedhur 1.
- Sa kanë zgjedhur X.
- Sa kanë zgjedhur 2.
- Sa para janë vendosur në secilin rezultat.
- Sa duhet të paguajë operatori nëse del 1.
- Sa duhet të paguajë nëse del X.
- Sa duhet të paguajë nëse del 2.
- Ekspozimin financiar për secilin rezultat.

E njëjta logjikë duhet të zbatohet edhe për Over/Under, BTTS, Double Chance dhe tregjet e tjera.

Biletat e kombinuara duhet të llogariten duke marrë parasysh të gjitha përzgjedhjet e tyre, pa dyfishuar shumat.

### C. Telegram – Njoftime automatike për çdo ndeshje me baste

**Nuk duhet të ketë prag financiar për dërgimin e njoftimeve.**

- Çdo ndeshje ku vendosen baste duhet të monitorohet.
- Sistemi duhet të dërgojë automatikisht informacion në Telegram.
- Njoftimi duhet të përmbajë ndeshjen, numrin e basteve, shumat dhe ekspozimin financiar.
- Kur vendosen baste të reja, informacioni duhet të përditësohet.
- Për të shmangur mesazhet e tepërta, mund të përditësohet i njëjti mesazh i ndeshjes.
- Nuk kërkohet që administratori ta ketë hapur panelin.

### D. Telegram – Njoftimet për pikën 8

Dërgo automatikisht njoftime kur:

- API-të japin statistika kontradiktore.
- Një treg kërkon verifikim manual.
- Një biletë mbetet në pritje për shkak të statistikave.
- Një API ka gabime ose ka arritur limitin.

Njoftimet duhet të përmbajnë informacionin e nevojshëm për të identifikuar problemin.

### E. Rregullat e Telegram

- Përdor Telegram Bot.
- Dërgo njoftimet në grup privat të administratorëve.
- Token-i të ruhet në backend.
- Regjistro gabimet e dërgimit.
- Provo përsëri dërgimet që dështojnë.
- Mos dërgo mesazhe të dyfishta pa arsye.
- Mos ekspozo të dhëna personale ose kredenciale në njoftime.

**Telegram përdoret vetëm për njoftim. Administratori kontrollon dhe merr vendimet në admin panel.**

---

# PJESA X – RREGULLAT E DETYRUESHME TË ZHVILLIMIT

## 15. Analiza përpara modifikimeve

Për secilën nga 14 kërkesat:

1. Identifiko çfarë funksionon.
2. Identifiko çfarë është prishur.
3. Identifiko çfarë është hequr.
4. Identifiko çfarë mungon.
5. Identifiko skedarët që kërkojnë ndërhyrje.
6. Raporto ndikimin e mundshëm në funksionet ekzistuese.

Mos fillo ndryshime të paautorizuara.

## 16. Integrimi dhe rikthimi

- Rikthe funksionet e humbura.
- Rregullo funksionet e prishura.
- Integro kërkesat e reja.
- Mos ndrysho funksione të tjera jashtë detyrës.
- Mos bëj refactoring të panevojshëm që prek rregullat e mbrojtura.

## 17. Testimi i detyrueshëm

Pas implementimit:

- Testo prematch dhe live.
- Testo filtrimin rajonal.
- Testo tregjet e admin panelit.
- Testo përkthimin dhe enkodimin.
- Testo RTP dhe Hit Frequency.
- Testo API-të shtesë dhe kuotat.
- Testo statistikat kontradiktore.
- Testo shlyerjen manuale.
- Testo sinkronizimin live.
- Testo biletat dhe bilancet.
- Testo fshirjen e përdoruesve.
- Testo monitorimin financiar.
- Testo njoftimet Telegram.
- Testo që UI/UX nuk ka ndryshuar pa autorizim.

## 18. Dokumentimi

Krijo në repository:

**PROTECTED_REQUIREMENTS.md**

Përmban të gjitha 14 kërkesat, përshkrimet dhe kriteret e pranimit.

**AGENTS.md**

Përmban udhëzimet për developerët dhe agjentët AI.

Këto dokumente duhet të lexohen përpara çdo modifikimi të ardhshëm.

## 19. Miratimi i ndryshimeve

Nëse një modifikim mund të prekë një rregull të mbrojtur:

1. Ndalo përpara ndërhyrjes.
2. Identifiko rregullin që mund të preket.
3. Shpjego ndikimin.
4. Propozo zgjidhje që ruan funksionalitetin.
5. Kërko miratimin tim nëse ndryshimi i rregullit është i nevojshëm.

Heshtja ime nuk konsiderohet miratim.

## 20. GitHub dhe publikimi

- Mos bëj push në main pa miratimin tim.
- Mos bëj merge pa miratimin tim.
- Mos ndrysho konfigurime të tjera pa autorizim.
- Raporto të gjithë skedarët e ndryshuar.
- Raporto testet e kryera dhe rezultatet.
- Mos deklaro përfundimin e detyrës nëse ka funksione të patestuara.

---

# RREGULLI PËRFUNDIMTAR

**Të 14 kërkesat kryesore janë specifikime të detyrueshme dhe të mbrojtura.**

Fillimisht duhet të rikthehen, integrohen dhe verifikohen.

Pas kësaj, asnjë developer ose agjent AI nuk ka autorizim t'i ndryshojë, heqë, anashkalojë ose prishë pa kërkesën time të shprehur.

Nëse kërkoj ndryshimin e një rregulli, ndryshohet vetëm ai rregull. Të gjitha rregullat e tjera mbeten në fuqi.

Asnjë ndryshim funksional ose vizual i paautorizuar nuk lejohet.


## Ndryshim i shprehur nga përdoruesi — 2026-11-05

Kërkesa e fundit zëvendëson filtrin rajonal të pikës 3: shfaq çdo ndeshje futbolli real që sjell API, live dhe prematch, pa kufizim vendi, kategorie, moshe/gjinie, date të parazgjedhur ose pranie koeficientësh. Përjashtohen vetëm virtualet/simulimet dhe ofertat që nuk janë ndeshje. Filtrat e datës të zgjedhur shprehimisht nga përdoruesi mbeten opsionalë.


## Zgjedhje e adminit për numrin e parandeshjeve — 2026-11-05

Përdoruesi autorizon kufi publikimi të zgjedhur shprehimisht nga administratori: 0 = të gjitha; X pozitiv = maksimumi X parandeshje, pa përjashtim që e tejkalon kufirin për ligat prioritare. Burimi ruan gjithë futbollin real dhe historikun. Live mbetet pa kufi. Fshehja individuale dhe të gjitha mbrojtjet e tjera ruhen.


## Ngarkimi sipas kërkesës dhe hierarkia e kazinosë — 2026-11-05

Autorizimi i fundit: lista kryesore merr vetëm koeficientët kryesorë; hapja e emrit të ndeshjes ose tregjeve shtesë kërkon tregjet e plota vetëm për ndeshjen e zgjedhur. Të gjitha ndeshjet reale dhe zgjedhjet e adminit për publikim ruhen. API-të shtesë aktivizohen edhe kur shikohet një ndeshje pa bast; ndajnë cache dhe kuota, me rifreskim dhjetëminutësh. Monitorimi i basteve dhe verifikimi përfundimtar vazhdojnë.

Admini cakton komision kazino/Apex dhe profile ose RTP/shpeshtësi për agjentë e menaxherë. Cilësimi i shprehur i agjentit për lojën ka përparësi për TË GJITHË menaxherët dhe lojtarët e tij. Shembull: agjenti 40%, menaxherët 96%/100% → lojtarët e të dyve përdorin 40%. Pa cilësim të agjentit trashëgohet ai i menaxherit, pastaj globali. Nuk zgjidhen rezultate sipas identitetit individual të lojtarit.

Ndryshimet vlejnë për raundet e reja me pagesë. Bonusët, raundet ekzistuese, riluajtja e kërkesës dhe komisionet historike ruajnë kushtet e regjistruara. Komisioni është raport financiar mbi bastin, 0–100%, pa transferim automatik të bilancit të menaxherit. RTP lejohet mbi 1000% deri te kufiri i realizueshëm i tabelës reale të lojës. Shpeshtësia si probabilitet mbetet 0–100%; çiftet e parealizueshme refuzohen. Fire Joker dhe Fortune Teller ruajnë vetëm profilet origjinale të mbështetura; një përqindje arbitrare nuk shpallet e realizuar për këto lojëra.


## Lojëra të shtuara me klientin origjinal — 2026-11-05

Ice Fruits 6 Reels dhe Fortune Pyramid përdorin klientët e tyre origjinalë të dhënë nga përdoruesi. Për Ice Fruits përdoren linjat që shfaq klienti origjinal; bobinat, përputhja Wild/Scatter dhe tabela e pagesave vijnë nga burimi i fiksuar Slotopol. Për Fortune Pyramid të 20 linjat përputhen me Slotopol. Mos paraqit dy versionet e linjave të Ice Fruits si identike. Të dyja lojërat ofrojnë profile origjinale të verifikuara; nuk shfaqin RTP ose shpeshtësi arbitrare si të mbështetur. Portofoli, kufijtë e bastit, përparësia e agjentit, komisionet dhe historiku mbeten të mbrojtura.
