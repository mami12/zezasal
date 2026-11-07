# Serveri në Windows 10/11

Faqja dhe serveri punojnë në kompjuterin tënd. Instalimi i ri përdor automatikisht
databazën lokale te `data/database/`, pa lidhje ose fjalëkalim Supabase.

## Herën e parë

1. Instalo **Node.js 24 LTS me npm** nga [nodejs.org](https://nodejs.org/en/download).
   Në Windows 64-bit zgjidh instaluesin `.msi` x64 dhe lër aktiv Add to PATH.
2. Shkarko projektin nga GitHub: **Code → Download ZIP**, pastaj **Extract All**.
   Hape folderin ku ndodhen `start.bat`, `stop.bat` dhe `package.json`.
   Mund të përdorësh edhe `git clone`; Git nuk kërkohet nga launcher-i.
3. Hape **`start.bat`** me dy klikime. Ai krijon `.env` me `DB_DRIVER=local`,
   `LOCAL_DATABASE_DIR=data/database` dhe sekretet e serverit. Nuk ka nevojë të
   plotësosh lidhje databaze ose të hapësh Notepad për instalimin e ri.
4. Herën e parë instalohen paketat dhe ndërtohet
   faqja bashkë me asetet origjinale. Duhet internet dhe mund të duhen disa minuta.
5. Kur serveri të jetë nisur, hapet shfletuesi te **http://localhost:3000/app/**.
   Mbaje dritaren e serverit të hapur; mund ta minimizosh.

Kur përditëson një instalim ekzistues, **ruaj folderin `data/` dhe `.env`**.
Kodi i shkarkuar nga GitHub nuk përmban përdoruesit ose bilancet e një PC-je tjetër.
Për zhvendosje, ndale serverin dhe transfero edhe këta skedarë privatisht.
Kur `.env` ekzistues përdor Supabase, `start.bat` kopjon e verifikon automatikisht
llogaritë dhe historikun para nisjes lokale. Mbaji të ndalur serverët e tjerë gjatë
këtij kalimi. Sekretet dhe cilësimet e tjera ruhen; databaza burim nuk fshihet.
Në dështim, konfigurimi i mëparshëm ruhet dhe serveri nuk nis me llogari bosh.

Për një kopje më të vogël në USB, përdor `npm run pack:windows` dhe ndiq
`USB-TRANSFER.md`. Arkivi përfshin asetet e paketuara të lojërave, pa varësitë e
instaluara, cache, databazën e laptopit ose kopjen e gjeneruar `web/dist`.
`start.bat` instalon varësitë dhe ndërton faqen në kompjuterin tjetër.

Sizzling dhe Book of Ra përdorin së pari kopjen lokale të verifikuar të aseteve.
Shkarkimi nga GitHub bëhet vetëm kur ajo kopje mungon ose është e paplotë.
Nëse nisja shfaq `TimeoutError` pas kontrollit të Fortune Teller, transfero edhe
folderët e plotë `web/public/casino-original/sizzling` dhe `bookofra` nga kopja
funksionale, bashkë me skriptet aktuale. Arkivi USB i përfshin të dy folderët.

Windows 10 i përditësuar përfshin `tar`, që përdoret për dy arkivat origjinale
të lojërave. Nëse mungon, launcher-i e raporton përpara ndërtimit. Node dhe npm
duhet të instalohen bashkë nga instaluesi zyrtar.

## Nisja dhe ndalimi

- **`start.bat`**: nis këtë kopje të serverit dhe hap faqen. Klikimi përsëri
  raporton se serveri është duke punuar; nuk nis server të dytë.
- **`stop.bat`**: ndalon vetëm serverin e kësaj kopjeje dhe pret mbylljen.
  Nuk mbyll programet e tjera Node dhe nuk përdor PID të ruajtur për të vrarë procese.
- Mund të përdorësh edhe **Ctrl+C** në dritaren e serverit. Për ndalim normal
  përdor këto komanda, që kërkesat aktive të përfundojnë përpara mbylljes SQL.

Pas ndërprerjes së energjisë ose rinisjes së Windows-it, hape `start.bat` përsëri.
Këta skedarë nuk instalojnë shërbim Windows, nisje automatike ose Tunnel.
Kompjuteri duhet të qëndrojë ndezur, pa Sleep dhe me internet për të shërbyer faqen.

## Ku ruhen konfigurimet e Railway

**Në `.env`, në të njëjtin folder me `start.bat`.** Profili i instalimit është
`.env.windows.example`. Nisja e parë e kopjon dhe krijon lokalisht dy sekrete
të rastësishme: `JWT_SECRET` dhe `INGEST_TOKEN`. Ato ruhen për nisjet e tjera;
një `.env` ekzistues nuk mbishkruhet. Për të ruajtur token-at ekzistues të hyrjes
mund të vendosësh `JWT_SECRET` e fortë nga Railway; nëse ndryshon, hyn përsëri
në llogari. Kjo nuk ndryshon bilancet e ruajtura në databazë.

Profili përmban vlerat jo-sekrete të dhëna nga Railway. Ndryshimet për këtë
kompjuter janë `PORT=3000`, `NODE_ENV=production`, `SEED_DEFAULT_ACCOUNTS=false`
dhe `IDLE_FEED=false`, që feed-i sportiv të vazhdojë edhe pa vizitorë.
`CASINO_REAL_MONEY_ENABLED` dhe `CASINO_MATH_APPROVED` janë ruajtur siç u dhanë,
por kodi aktual nuk i përdor si kontrolle aktivizimi; konfigurimi ekzistues
i kazinosë mbetet në databazë.

Mos ngarko `.env` në GitHub dhe mos e ndaj me të tjerë. Është i përjashtuar nga
Git, bashkë me `.runtime/`, ku ruhet gjendja private e start/stop. Fjalëkalimi
i databazës nuk përfshihet në skedarët publikë. Vlerat e `.env` kanë përparësi
mbi variablat e trashëguara nga terminali; ato nuk ekzekutohen si komanda Windows.

Nëse ndryshon `PORT`, p.sh. `PORT=3001`, launcher-i hap automatikisht adresën e
re. Nëse porta është e zënë nga një program tjetër, raporton gabimin dhe nuk e
mbyll atë program. Nëse databaza ende po lidhet, kjo shfaqet në dritaren e
serverit; hyrja dhe veprimet me bilancin kërkojnë databazë funksionale.

## Përditësimet dhe adresa publike

Ndal serverin, merr versionin e ri nga GitHub dhe ruaj `.env` ekzistues. Pastaj
hape `start.bat`. Paketat dhe frontend-i rindërtohen kur ndryshojnë burimet;
nisjet e zakonshme përdorin skedarët e ndërtuar më parë. Chromium nuk shkarkohet
nga instalimi i launcher-it, sepse serveri nuk ka nevojë për të.

`localhost` hapet në kompjuterin ku punon serveri. Për publikim në internet
duhet të konfigurohet më vete adresa publike, p.sh. Cloudflare Tunnel me domain.
Ky ndryshim nuk hap porta në router, nuk ndryshon firewall/DNS dhe nuk ndalon
Railway. Kalimi publik bëhet pasi të kontrollosh faqen në kompjuterin e vjetër.

## Provat për zhvillim

`npm run test:windows` përdor konfigurime dhe serverë lokalë prove. Mbulon
sekretet lokale, folderët me hapësira, nisjen e dyfishtë, portën e zënë,
kontrollin privat dhe mbylljen e kërkesave aktive. Nuk prek databazën reale.
# Databaza lokale pa Supabase

Për të kaluar llogaritë, bilancet dhe historikun ekzistues në PC, ndiq
[LOCAL-DATABASE.md](LOCAL-DATABASE.md). Përdor `migrate-db-local.bat`; ai ndal
serverin dhe ndryshon `.env` vetëm pasi kopjimi të jetë verifikuar.
