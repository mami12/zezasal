# Auditimi real i tregjeve në `zezasal`

Ky audit **nuk ndryshon bileta, koeficientë, rezultate ose bilance**. Përdor një transaksion PostgreSQL `READ ONLY` dhe llogarit rezultate të simuluara pa thirrur shkruesit financiarë.

## 1. Databaza reale

Në instalimin ku ekziston databaza, me konfigurimin e zakonshëm `.env`:

```bash
node scripts/audit-deployment-settlement.mjs 300000 --all > market-audit.json
```

`--all` eksporton **çdo kombinim unik të vëzhguar** nga `app_provider_offer_current` dhe `app_provider_offer_change`, jo vetëm 100 shembujt e rrezikut. `maxVariants` mund të jetë 1–300000; nëse kufiri tejkalohet, raporti shënon `complete:false` dhe procesi kthen kodin 2. Një treg pa ofertë të ruajtur nuk mund të certifikohet nga një listë emrash.

Raporti kontrollon edhe: biletat `PENDING`, `live_contract`, `settlement_reason`, rezultatet e ruajtura, konfirmimin e Zizobet, mospërputhjet e ngjarjeve dhe numëruesve, si dhe statuset financiare `SINGLE/COMBO`. Fusha `dryRun` përdor grader-at ekzistues për maksimumi 100 përzgjedhje në pritje, **pa kryer pagesa**. Statuset janë propozime auditimi, jo urdhra shlyerjeje.

Mos publikoni `market-audit.json` në GitHub. Raporti nuk përmban emra përdoruesish ose bilance, por mund të tregojë markete specifike, aktivitet tregtar dhe statistika të brendshme.

Nëse përdorni `DB_DRIVER=local` (PGlite), **mos e hapni databazën në përdorim** nga serveri. Ndaleni serverin dhe përdorni një kopje të saj jashtë direktorisë aktive. Në kopjen offline, caktoni `LOCAL_DATABASE_DIR` sipas mjedisit tuaj dhe ekzekutoni komandën e mësipërme. PGlite mund të kryejë operacione të brendshme mbi kopjen gjatë hapjes, pavarësisht SQL-së read-only.

## 2. Kontroll njëherësh i endpoint-eve publike

```bash
node scripts/probe-market-information-apis.mjs --network
```

Kontrollon me maksimumi dy GET të kufizuara burimet publike `live/games` dhe `prematch/games` të Zizobet. Për një **ID AiScore të konfirmuar** mund të bëhet edhe një GET i tretë:

```bash
node scripts/probe-market-information-apis.mjs --network --aiscore-id=ID_E_KONFIRMUAR
```

Skripti raporton vetëm statusin HTTP, formatin dhe numrin e elementeve. Nuk publikon payload-et, nuk përdor tokena, nuk kryen kërkesa te API-të me kuota ditore, nuk përditëson databazën. Nëse ka përgjigje `401/403`, ajo **nuk** anashkalohet. `200 JSON` provon vetëm aksesin në momentin e testimit, **jo** saktësinë e minutave ose të një shlyerjeje.

## 3. Si interpretohen rezultatet

- `SCORE_GRADEABLE` nënkupton se ekziston një grader i njohur; duhet gjithsesi prova e rezultatit zyrtar të saktë.
- `INCIDENT_EVIDENCE_REQUIRED` kërkon kronologji të plotë/të konfirmuar, jo vetëm total.
- `noPrimaryConfirmation` shënon mungesën e konfirmimit të Zizobet. Ndeshja mund të jetë ende LIVE, prandaj kjo nuk është vetvetiu bug.
- `mismatches > 0`, `ERROR_REVIEW`, `UNVERIFIED_VOID` apo mospërputhjet e statusit të biletës duhen hetuar. **Mos i ktheni automatikisht në WON, LOST ose VOID.**
- `apiUsage` dhe `aiscoreMappings` janë të dhëna të databazës mbi kuotat/mapping, jo test rrjeti.
- Për marketet e handikapit nuk është zgjeruar logjika e pagesave në këtë fazë.

**Kufizimi kryesor:** testet në GitHub janë të izoluara. Vetëm ekzekutimi read-only me databazën dhe endpoint-et e instaluara realisht mund të nxjerrë një raport operacional; një raport me zero të dhëna nuk certifikon asnjë treg.
