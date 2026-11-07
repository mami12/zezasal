# Përshtatja e frontendit sipas zshop.live

Burimi i referencës: `D:\cassino\lojra\lojrafaqja\zshop.live`.
Përditësimi është vetëm për frontendin e **faqja blu/faqja-main**.
Nuk ndryshon serverin, databazën, `.env`, formulat e llogaritjes ose kuotat.

## Pamja dhe përdorimi

- Ngjyrat, titujt, rreshtat e ndeshjeve dhe panelet bazohen te CSS-të e kapjes
  zshop. Përdoren imazhet origjinale lokale `sport-live`, `sport-prematch`,
  ikona e fushës dhe ikona e futbollit e nxjerrë nga sprite origjinal SVG.
- Kuponi grupon zgjedhjet sipas ndeshjes, me tregjet e ndryshme në rreshta të
  veçantë brenda grupit. Kalimi Teke/Kombinim/Sistem është automatik.
- Totali dhe shuma për kolonë janë të lidhura si në zshop: 100 lekë me dy
  kolona jep 50 lekë për kolonë; shkrimi i 75 lekëve për kolonë jep total 150.
  Minimumi mbetet 100 lekë gjithsej. Shuma nuk ngrihet në 200 automatikisht.
- Qindarkat ndahen saktë: 100.01 jep 50.01 + 50.00. Fusha e kolonës tregon
  shumën bazë dhe diferenca shpjegohet kur kolonat kanë 0.01 ndryshim.
- Kthimi minimal/maksimal është **për kolonë fituese**. Nuk premton kthim
  nëse të gjitha kolonat humbin. Detajet e kolonave hapen brenda kuponit.
- Butoni i bastit dhe shuma qëndrojnë të dukshëm kur lista është e gjatë,
  në telefon, në horizontal dhe me tastierën e telefonit të hapur.
- Tregjet shtesë kanë një treg për rresht në desktop dhe në telefon,
  filtrat sipër, kërkimin, hapjen/palosjen dhe kuotat ekzistuese funksionale.
- Tracker-i përdor sfondin origjinal të ndeshjes dhe statistikat reale nga
  burimi ynë: rezultat, kartonë, kornera, goditje në portë dhe faulle kur ka.
  Nuk simulohet pozicioni i topit ose histori ngjarjesh që API nuk e dërgon.
- Shqip/English dhe kufiri i ndeshjeve nga administratori vazhdojnë të punojnë.

## Printimi dhe shkurtimet: çfarë mungon nga kapja

Kapja përmban kodin që hap iframe-in e printimit nga
`cnf/current/print_template/<modeli>/`, por vetë skedari i modelit nuk është
shkarkuar. Shkurtimet vijnë nga përkthimet e tregjeve, `outcome_alias.json`
dhe `market_codes.json`; këta skedarë gjithashtu mungojnë nga kapja.
Prandaj modeli ekzistues i printimit dhe emërtimet janë lënë siç kërkove.
Nuk janë shpikur shkurtime si DSH pa një hartë të verifikueshme.
Bileta e sistemit vazhdon të printohet si **një biletë**, me të gjitha
zgjedhjet, kolonat, shumën dhe barkodin ekzistues.

## Instalimi / kopjimi në një kompjuter tjetër

Te folderi blu përditësimi vendoset me kopje rezervë në
`.runtime/zshop-frontend-backup-<data>`. Për të parë pamjen e re, rifresko
faqen me **Ctrl+F5**. Nuk kërkohet ndryshim i databazës ose konfigurimit.

Paketa `ZSHOP-FRONTEND-UPDATE` përmban skedarët e ndryshuar dhe frontendin
e ndërtuar. Kopjo përmbajtjen **mbi** projektin ekzistues, duke bashkuar
folderët. **Mos fshi `web/dist` ose `web/public` përpara kopjimit**, sepse
aty ndodhen asetet e lojërave të kazinosë që nuk përfshihen në këtë paketë.
Nuk nevojitet kopjimi i asnjë skedari të serverit ose databazës.

Lista e skedarëve është te `COPY-FILES.txt`. Nuk është bërë push në GitHub.

## Verifikimi

U provuan 1366, 1024, 844, 768, 390 dhe 320 pikselë, fusha totale/kolonë,
kalimi Teke/Sistem, ndarja me qindarka, kërkimi/kategoritë/palosja e tregjeve,
tracker-i dhe përditësimi i rezultatit nga socket. U provua një vendosje
vetëm me bileta prove lokale, që dërgon një kërkesë dhe shfaq një biletë
me të dy tregjet. Printimi u kontrollua edhe si PDF prove termike.

Testet e kuotave mbulojnë pezullimin/skadimin para klikimit, kuponin,
rifreskimin me të njëjtën kuotë dhe mbylljen e kombinimit kur skadon një
nga pjesët. Testi me databazë të përkohshme kontrollon minimumin 100,
kolonat 50/50, përsëritjen pa debit të dyfishtë dhe pagesat ekzistuese.
Databaza reale nuk është hapur nga këto prova.
