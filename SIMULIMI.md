# SIMULIMI: testimi i tregjeve sportive

Komanda kryesore:

```bash
npm run simulimi
```

Ky version përdor një katalog shembujsh të përfshirë në skript dhe pesë ndeshje sintetike me rezultate, gola, kornera, kartonë, minuta, pjesë dhe statistika. Testohen edhe të gjitha shabllonet automatike të kombinimeve 2-këmbëshe, me rezultate të pritshme të llogaritura veçmas. Nuk hap lidhje me API-të sportive, nuk vendos bileta dhe nuk ndryshon bilanc, histori ose databazë.

## Katalogu i plotë i tregjeve

Katalogu i plotë është dinamik, jo listë fikse në Git: ruhet në tabelat `app_provider_market_definition` dhe `app_provider_offer_current`. Për të kaluar **çdo përzgjedhje të marrë realisht** në motorin e njëjtë të vlerësimit, në një mjedis me databazën e duhur:

```bash
npm run simulimi -- --db --limit=500000
```

`--db` kryen vetëm `SELECT` në një transaksion `READ ONLY` dhe përfundon me `ROLLBACK`. Nuk përdor asnjë API të jashtme. Kufiri i rreshtave nuk fsheh rezultate: nëse arrihet, raporti shënon `partial: true` dhe kërkon rimarrje të katalogut për mbulim të plotë. Për rezultate pa përdorur fare databazën, eksporto manualisht një JSON me `definitions` dhe `quotes` (fushat janë si në tabelat e mësipërme), pastaj përdor:

```bash
npm run simulimi -- --catalog=quotes.json
```

Raporti i detajuar gjenerohet te `simulimi-report.json`. Mund të ndryshohet me `--report=raport.json`. Regjistron çdo treg, përzgjedhje, linjë, periudhë dhe përgjigjen e motorit në skenarët sintetike. Nuk është e nevojshme të jepen username/password të përdoruesit, token bastesh apo ID ndeshjesh reale.

## Çfarë do të thonë rezultatet?

- `EXERCISED_NOT_CERTIFIED`: motori real ktheu të paktën një rezultat. Kjo **nuk** certifikon pagesën në kushte reale, as nuk garanton se çdo opsion ka rregull të saktë.
- `NOT_EXERCISED`: kontrata u njoh, por provat sintetike nuk mjaftuan për rezultat përfundimtar. Duhet provë më e specializuar për ngjarjet e ruajtura dhe pjesët.
- `NEEDS_RULE`: kontrata/përzgjedhja nuk ka rrugë të provuar të zgjidhjes. Nuk raportohet si sukses.
- `CONFLICT`: u kap një rezultat kontradiktor ose gabim gjatë ekzekutimit të motorit.
- `NOT_QUOTED_IN_SAMPLE`: përkufizimi ekziston, por s'ka përzgjedhje në burimin e dhënë.

```bash
npm run simulimi -- --catalog=quotes.json --strict
```

`--strict` jep kod daljeje jo-zero kur ka përzgjedhje të pambuluara ose përkufizime pa ofertë të testuar. Testet me pritshmëri të pavarura dështojnë gjithmonë nëse motori jep statusin e gabuar.

**Kufiri i qëllimshëm:** kjo është provë e izoluar e motorit të vlerësimit, jo simulim financiar në databazën e përdoruesve. Tregjet që duan kronologji të verifikuar SQL, renditje të lojtarëve, prova ngjyrash kartonësh ose të dhëna të tjera të ruajtura raportohen si të pambuluara nëse nuk mund të vlerësohen nga prova sintetike. Nuk shpiket fituesi për të prodhuar një raport 100%. Për këto duhen teste të veçanta të motorit të ruajtjes me databazë testimi.

**Zonat që nuk preken:** marrja e koeficienteve, Zizobet, AiScore, fetcher-at, frontend LIVE, emrat e lojtarëve dhe logjika e shlyerjes. Simulimi vetëm i thërret funksionet ekzistuese të verifikimit.
