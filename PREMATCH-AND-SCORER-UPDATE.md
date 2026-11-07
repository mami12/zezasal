# Lista para fillimit dhe verifikimi i golashënuesve

## Administratori

Hap **Admin → Lista e ndeshjeve**. Vendos kufirin dhe shtyp **Ruaj**.
`0` do të thotë pa kufi; lejohen numra të plotë deri në 10000.

Kufiri zbatohet mbi listën e përbashkët, përpara kërkimit dhe filtrave të klientit.
Ligat e para të lejuara dhe kupat/garat ndërkombëtare të lejuara ruhen.
Garat kryesore ndërkombëtare dhe ligat e para të Anglisë, Italisë, Spanjës,
Gjermanisë e Francës vijnë në fillim. Nëse ndeshjet e mbrojtura janë më shumë
se kufiri, mbeten të gjitha. Paneli shpjegon tejkalimin dhe jep numrat aktualë.
Pjesa e mbetur e kufirit plotësohet nga ligat e tjera të pranuara.

Ndeshjet në lojë nuk kufizohen nga ky opsion. Kufiri nuk ndryshon mbledhjen
e rezultateve, abonimet WSS ose llogaritjen e biletave ekzistuese.
Ndeshjet pa kuota nuk marrin kuota të shpikura. Ndeshjet e mbrojtura mbeten
të listuara edhe kur kuotat nuk kanë ardhur ende.
Mund të shfaqen vetëm ndeshje që ekzistojnë në katalogun e furnizuesit dhe
kalojnë filtrat ekzistues të ligave.

Cilësimi ruhet në `app_board_settings`, brenda databazës lokale ekzistuese,
dhe veprimi regjistrohet në regjistrin e administratorit. Tabela krijohet
automatikisht gjatë rinisjes; përdoruesit dhe bilancet nuk zëvendësohen.
Vetëm ADMIN aktiv mund ta lexojë/ndryshojë këtë panel. Klientët marrin
rifreskim pas ruajtjes; nuk vendosin kufij të ndryshëm me parametrat e URL-së.

## Bileta e raportuar

- Bileta: **3F973816**, Abha FC – Al Faisaly Harmah.
- ID e furnizuesit: **41331919**; tregu **g16176 / Player to score**.
- Zgjedhja: **Abdoulaye Seck**, kuota 34.00.
- API e faqes e ktheu biletën **VOID**, me kthim 100 lekë.

Më 27 tetor 2026 u provuan lidhja REST e katalogut dhe dy abonimet reale
WSS të përdorura nga aplikacioni: `subscribe-match-info` dhe
`subscribe-match-odds` me tregjet e plota. WSS u lidh dhe dërgoi
`match-info-snapshot` dhe `match-odds-snapshot`. Në përgjigjet për këtë
ndeshje nuk u gjetën golashënues, historik golash ose rezultat zyrtar i
zgjedhjes. Katalogu REST nuk e përmbante më ndeshjen e përfunduar.
Një adresë provë `matches/get-one` ktheu 404 dhe nuk trajtohet si endpoint
i mbështetur. Ky kontroll nuk provon se një shërbim tjetër i furnizuesit
nuk i ka të dhënat; duhen dokumentacion ose përgjigje reale të verifikueshme.

Kodi i llogaritjes nuk mbështet kontratën e golashënuesit me statistikat që
ruan sot. Rezultati final nuk tregon kush shënoi ose nëse lojtari mori pjesë.
Prandaj këto tregje mbeten të fshehura/bllokuara për baste të reja, si në
publikim ashtu edhe në kontrollin e serverit. Biletat e vjetra nuk shpallen
fituese/humbëse nga hamendësimi; politika ekzistuese e shqyrtimit/kthimit
vazhdon. Nuk është ndryshuar statusi ose bilanci i biletës së raportuar.

Diagnostikimi lokal: `node scripts/probe-scorer-evidence.mjs 41331919`.
Ai lexon vetëm të dhëna dhe përfundon lidhjen WSS pas 22 sekondash.
Raporti ruhet në `outputs/scorer-evidence-41331919.json`, pa hyrje llogarie
ose të dhëna private të databazës.

## Instalimi

Ndryshimi instalohet te folderi **faqja blu/faqja-main**. Pas përditësimit,
ndal dhe rihap serverin me `stop.bat` dhe `start.bat`; rifresko shfletuesin.
Folderi reskin mbetet i veçantë. Për të është përgatitur **TRANSFER-RESKIN**,
që ruan pamjen Vave dhe përmban të njëjtin funksionalitet. Lista e skedarëve
është te `TRANSFER-RESKIN/COPY-FILES.txt`. Nuk përfshihet databazë ose `.env`.
Nuk është bërë push në GitHub.

## Verifikimi

Testet e politikës mbulojnë kufirin, ruajtjen e ligave kryesore mbi kufi,
renditjen e qëndrueshme, listë mbi 2000 ndeshje, ndeshjet në lojë dhe
mosndryshimin e të dhënave të mbledhura. Testet me databazë të përkohshme
mbulojnë rolet, administratorin e ngrirë, auditin, ruajtjen pas rinisjes,
filtrat dhe listat publike. Provat e shfletuesit kontrollojnë panelin në
1366, 390 dhe 320 pikselë, dy gjuhët dhe gabimin gjatë ruajtjes.
