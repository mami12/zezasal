# Paneli i përdoruesve dhe roli Agjent

Për butonin e ri të reset-it me kod 1122 dhe minimumin 20 Lek të kazinosë, shiko `RESET-AND-CASINO-MINIMUM.md`. Paketa TRANSFER-RESKIN përmban edhe këto ndryshime.

Zbatuar në kopjen **faqja blu**. Admini krijon një llogari nga **Përdoruesit → Krijo përdorues → Agjent**. Nuk u krijua fjalëkalim ose llogari automatike.

Hierarkia: **Administrator → Agjent → Menaxher → Lojtar**. Admini mund t'ia caktojë një menaxher ekzistues një agjenti nga profili i menaxherit. Menaxherët ekzistues pa agjent mbeten të lidhur drejtpërdrejt me adminin.

Agjenti krijon vetëm menaxherë të vet me bilanc zero. Shton ose tërheq fonde duke i transferuar nga/në portofolin e vet. Sheh lojtarët e këtyre menaxherëve, bilancet, historikun dhe raportet; lojtarët janë vetëm për shikim. Nuk ka të drejtë të ndryshojë kuota, ndeshje, kombinime, rrezik, komisione globale ose kazino. Admini ruan veprimet e plota.

Paneli ka kërkim, role/gjendje/përgjegjës, renditje, faqe me 20 llogari, profile me seksione financash/rrjeti/lëvizjesh/biletash, mesazhe gabimi dhe konfirmime. Në celular tabela bëhet listë kartash dhe profili hapet në ekran të plotë. Mbështeten Shqip dhe English.

Komisioni ekzistues **zbritet nga menaxheri**, mbi shumën e luajtur. Ky ndryshim nuk e kthen në komision të fituar. Raporti e etiketon si tarifë të zbritur. Rezultati sportiv përdor baste të mbyllura dhe pagesat reale të regjistruara; shumat potenciale dhe në pritje nuk paraqiten si fitim. Raportet mbulojnë historikun e ruajtur. Caktimi i ri i përgjegjësit ndryshon aksesin te rrjeti dhe raportimin e lojtarëve; regjistrimet e vjetra të portofolave mbeten në llogaritë origjinale.

## Aktivizimi

Mbyll serverin me `stop.bat`, pastaj hape me `start.bat`. Kolona `agent_id`, tabela e kërkesave financiare dhe tabela e snapshot-eve krijohen automatikisht në databazën ekzistuese. Nuk nevojitet import i ri ose ndryshim në `.env`. File-t e databazës nuk janë pjesë e këtij përditësimi.

## Kalimi te reskin-i

Folderi **TRANSFER-RESKIN** përmban vetëm file-t e nevojshme, të organizuara në të njëjtat rrugë si projekti. Brenda tij `web/src/App.tsx` dhe `web/src/components/Layout/Header.tsx` janë përgatitur posaçërisht nga reskin-i që kishe, duke ruajtur pamjen Vave dhe ngarkimin e ndarë të faqeve. **Mos i merr këta dy file direkt nga faqja blu.**

1. Ndale kopjen reskin me `stop.bat` dhe ruaj një kopje të `server` dhe `web/src` të saj.
2. Kopjo përmbajtjen e **TRANSFER-RESKIN** në `D:\cassino\lojra\lojrafaqja\faqja-main\faqja-main`, duke bashkuar folderët dhe zëvendësuar vetëm file-t e paketës. Lista e plotë është `TRANSFER-RESKIN/COPY-FILES.txt`.
3. Për ndërtim manual: `npm run build:web`. Ose hape `start.bat`, që kontrollon dhe ndërton burimet e ndryshuara. Rifresko faqen me Ctrl+F5.

Mos kopjo `.env`, `data`, `node_modules`, `package.json` ose databazën nga njëra kopje te tjetra. Këto nuk gjenden në paketën e transferimit. Përditësimi i kodit nuk i bashkon databazat e dy kopjeve.

## Rezultatet dhe të dhënat e ndeshjeve

`app_match_snapshot` ruan gjendjen më të fundit të konfirmuar nga feed-i: golat, kornerat, kartonat, pjesët dhe statusin, me identitetet e ekipeve. Nuk shkruhet sërish një snapshot vetëm sepse ora ndryshoi. Kur mbërrin FT i konfirmuar, rezultati ruhet në `app_match_result`, nga ku punon llogaritja ekzistuese e biletave. Snapshot-et për ndeshjet e biletave në pritje ringarkohen pas rinisjes dhe ndiqen edhe jashtë listës së ligave.

Ruajtja nuk prodhon rezultate që API-ja nuk i ka dërguar. Biletat e vjetra pa të dhëna të konfirmuara nuk mund të llogariten me hamendje. Rregulli ekzistues 72-orësh për kthimin VOID të rasteve pa prova mbetet; nuk u ndryshua politika e pagesave. Rezultatet e korrigjuara manualisht ose të paguara nuk mbishkruhen nga feed-i.

## Ligat

Angli, Itali, Francë, Spanjë, Gjermani: nivelet 1–3. Europa tjetër: nivelet 1–2. Rusia dhe shtetet jashtë Europës: niveli 1. Kupat, garat ndërkombëtare dhe miqësoret mbeten. Listat e emrave lidhen me shtetin dhe ID-në e katalogut; emrat e panjohur kërkojnë klasifikim. Filtri është në server para abonimit për kuota. Biletat e vjetra në pritje vazhdojnë të ndiqen për rezultate, pavarësisht këtij kufiri.

## Kontrollet

`node scripts/test-agent-directory.mjs` përdor databazë prove: migrim, hierarki, kufizime rolesh, transferta atomike, kërkesa të përsëritura/konkurruese, llogaritje me pagesa reale dhe ruajtje/rikuperim statistikash. `node scripts/test-user-directory-browser.mjs` përdor të dhëna prove në gjerësi 1440/1024/768/390/320 px. Testet nuk ndryshojnë përdoruesit ose bilancet reale.
