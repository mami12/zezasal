# Databaza në kompjuter

Instalimet e reja me `start.bat` zgjedhin automatikisht këtë mënyrë. Nuk nevojitet
konfigurim Supabase. Në përditësime ruaj gjithmonë `data/` dhe `.env` ekzistues.

Faqja mund të përdorë një databazë lokale PostgreSQL përmes PGlite. Nuk kërkon
instalim të veçantë të PostgreSQL apo Supabase. Skedarët ruhen në PC-në e serverit,
brenda `data/database/` (ose folderit të shënuar te `LOCAL_DATABASE_DIR` në `.env`).
Nuk është një skedar i vetëm SQLite; folderi përmban databazën e plotë. Kopja
rezervë krijohet si një arkiv i vetëm `.tgz`.

## Kalimi me llogaritë dhe bilancet ekzistuese

1. Merr versionin e fundit nga GitHub. Ruaj `.env` ekzistues.
2. Mbaj të ndalur çdo kopje tjetër të serverit që përdor të njëjtën databazë,
   përfshirë ndonjë instalim të vjetër në Railway ose një PC tjetër. Mos prano
   baste ose transferta në databazën burim gjatë kalimit.
3. Hap `start.bat`. Ai përditëson paketat dhe faqen, kopjon dhe verifikon databazën
   ekzistuese, pastaj e nis serverin lokalisht. Nuk duhet të ndryshosh `.env` vetë.
4. `migrate-db-local.bat` mbetet si alternativë për kryerjen e migrimit veçmas.

Në VPS, ndal fillimisht shërbimin me panelin/menaxherin që e nis atë, që të mos
riniset automatikisht gjatë migrimit. Pastaj nga folderi i projektit përdor
`node scripts/local-db-setup.mjs migrate`. Pas përfundimit nis sërish shërbimin.
Për kopjen rezervë përdor `node scripts/local-db-setup.mjs backup`, me shërbimin
të ndalur. Të njëjtët skedarë lokalë funksionojnë në Windows dhe Linux.

Migrimi lexon databazën ekzistuese dhe nuk e ndryshon ose fshin atë. Kopjon të
gjitha tabelat `app_`: llogaritë me të njëjtat fjalëkalime dhe ID, bilancet,
biletat, transaksionet, cilësimet, rezultatet dhe gjendjet e papërfunduara të kazinosë.
Kontrollon numrin dhe përmbajtjen e rreshtave, lidhjet ndërmjet tabelave dhe totalin
e bilanceve përpara se të përfundojë. Listat dhe kuotat e përkohshme vazhdojnë të
rifreskohen nga furnizuesi sportiv.

Vetëm pas verifikimit, skedari `.env` kalon automatikisht në:

```dotenv
DB_DRIVER=local
LOCAL_DATABASE_DIR="data/database"
DATABASE_URL=
DB_INIT_STRICT=true
LOG_RAW_FRAMES=false
MATCH_STORE=memory
ODDS_STORE=memory
SEED_DEFAULT_ACCOUNTS=false
```

`JWT_SECRET`, `INGEST_TOKEN` dhe cilësimet e tjera ekzistuese ruhen. Nëse folderi
`data/database` ekziston, migrimi përdor një folder të ri me datë, pa mbishkruar
databazën e mëparshme. Adresa e saktë ruhet automatikisht në `.env`.

Konfigurimi i mëparshëm ruhet privatisht në `.env.cloud-backup-...`. Nëse kopjimi
dështon, konfigurimi aktiv nuk kalohet në një databazë bosh. Folderët me migrim të
papërfunduar bllokohen nga serveri. Mos fshi Supabase derisa të kesh kontrolluar
llogaritë dhe aktivitetin në instalimin lokal. Aktiviteti i ri lokal nuk kopjohet
automatikisht prapa në Supabase; mos alterno ndërmjet dy databazave pas kalimit.

## Nisja dhe ruajtja

Përdor `start.bat` dhe `stop.bat` si më parë. Databaza lokale krijohet dhe hapet
nga vetë serveri, ruhet në disk dhe hapet sërish në nisjen tjetër. Mos zëvendëso
folderin `data` kur përditëson kodin. Ai dhe konfigurimet private nuk dërgohen në
GitHub dhe ruhen jashtë folderëve që publikohen si faqe.

Vetëm një proces mund ta hapë një databazë lokale. Një server i dytë refuzohet.
Gabimi i hapjes së databazës lokale nuk e kalon serverin automatikisht në cloud.

## Kopja rezervë

Hap `backup-db.bat`. Ai ndal serverin, ruan një arkiv në `backups/database-...tgz`
dhe të kërkon të hapësh `start.bat` përsëri. Ruaj një kopje të arkivit në një disk
tjetër së bashku me `.env`; databaza lokale nuk ka kopjen rezervë të Supabase.
Mos kopjo pjesërisht skedarët e databazës ndërkohë që serveri po shkruan në të.

Për restaurim, vendos arkivin pranë `start.bat` me emrin
`database-transfer.tgz` dhe hape **`restore-db.bat`**, pastaj `start.bat`.
Mund edhe ta tërheqësh një arkiv tjetër `.tgz` mbi `restore-db.bat`.
Nëse ke `DATABASE-TRANSFER.json`, mbaje pranë arkivit pa ia ndryshuar emrin.
Mjeti kontrollon hash-in e arkivit dhe përmbajtjen e çdo tabele kundrejt manifestit.

Restaurimi ndal serverin dhe ngarkon kopjen në një **folder të ri bosh**
`data/database-restored-...`. Kontrollon llogaritë, fjalëkalimet e ruajtura,
tabelat dhe vlerat financiare përpara ndryshimit të `LOCAL_DATABASE_DIR`.
Databaza e mëparshme dhe sekretet e kompjuterit ruhen; `.env` i mëparshëm ruhet
privatisht si `.env.before-restore-...`. Një dështim verifikimi nuk aktivizon
databazën e rikthyer. Mos zëvendëso aktivitet financiar të ri me një kopje më të vjetër.

Nëse procesi ndërpritet gjatë migrimit ose backup-it, mund të mbetet
`.runtime/database-maintenance.lock`. Pasi të verifikosh se as serveri, as migrimi
dhe as backup-i nuk po punojnë më, hiq vetëm këtë skedar për të lejuar nisjen.
Folderi i databazës dhe skedarët e tij nuk duhen fshirë.

## Provat

```text
npm run test:local-db
npm run test:mobile-sportsbar
npm run test:windows
npm run test:betting
```

Provat përdorin databaza të izoluara brenda `tmp/`; nuk lidhen me databazën reale.
Mbulohen transaksionet njëkohësisht, rinisja, ndërprerja e procesit, bllokimi i
hapjeve të dyfishta, backup/restaurimi, migrimi dhe llogaritjet reale të portofolit.

Referenca të motorit: [ruajtja lokale](https://pglite.dev/docs/filesystems#node-fs)
dhe [API, transaksionet dhe arkivat](https://pglite.dev/docs/api).
