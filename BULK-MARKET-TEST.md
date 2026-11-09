# Test masiv i tregjeve me 100 Lek për çdo kuotë

Ky skript kontrollon **një ndeshje PREMATCH** dhe **një ndeshje LIVE** në `zezasal`. Çdo kuotë provohet si **biletë SINGLE e veçantë me fiks 100 Lek**. Nuk ka kufi artificial të fondeve të adminit brenda skriptit; administratori i shton vetë fondet në llogarinë e lojtarit të testit. Kufizimet ekzistuese të platformës, pezullimet dhe verifikimet financiare **nuk anashkalohen**.

## 1. Siguro fondet dhe zgjidh ndeshjet

Përdor një llogari të dedikuar testimi (PLAYER) dhe financoje nga admin paneli. Më pas merr ID e një ndeshjeje para fillimit dhe një ndeshjeje LIVE. **ID-të duhet të jenë numrat e ndeshjeve në sistem, jo emrat e skuadrave.**

Për siguri, kredencialet jepen vetëm si variabla mjedisi, jo si argumente komande. Në Windows PowerShell:

```powershell
$env:BET_TEST_USERNAME = "llogaria-e-testit"
$env:BET_TEST_PASSWORD = "passwordi-i-saj"
$env:BET_TEST_BASE_URL = "http://127.0.0.1:3000"
```

Në server të jashtëm përdor vetëm `https://...`. Një token ekzistues mund të jepet me `BET_TEST_TOKEN` në vend të username/password.

## 2. Simulimi paraprak, pa lekë të shpenzuara

```bash
node scripts/bulk-market-bet-test.mjs --prematch=123 --live=456 --db-native
```

Pa `--execute` **nuk dërgohet asnjë POST për bast**. Raporti përmban të gjitha përzgjedhjet, shumën teorike (`100 × kuotat aktive`) dhe ofertat e pezulluara ose me çmim të pavlefshëm.

`--db-native` është opsional, por rekomandohet për **të gjitha ofertat reale**: merr në mënyrë vetëm-lexim edhe `app_provider_offer_current`, përfshirë tregjet që admin politika apo frontend nuk i shfaqin. Funksionon vetëm kur skripti ka akses në **të njëjtën PostgreSQL** me serverin. Për PGlite në përdorim mos hap një lidhje të dytë; hiq `--db-native` dhe testi do të kontrollojë vetëm tregjet që kthen `/app/api/matches/:id?category=all`.

## 3. Bileta reale në shumicë

```bash
node scripts/bulk-market-bet-test.mjs --prematch=123 --live=456 --db-native --execute
```

Skripti dërgon një kërkesë `POST /app/api/bets/place` për **çdo kuotë aktive**. I përdor ID-të reale, çmimin e kuotuar dhe `clientRequestId` unik për çdo biletë. Nuk formon kurrë kombinime nga zgjedhjet e së njëjtës ndeshje. Nuk ndryshon limitin e depozitimit ose balancën e adminit.

Raportet vendosen te një direktori e re `bulk-market-test-DATA/`:

- `refuzuar-prematch.txt` dhe `refuzuar-live.txt`: emri i tregut, zgjedhja, çmimi dhe mesazhi konkret i refuzimit; përfshihen edhe kuotat e pezulluara që nuk u dërguan si bast.
- `biletat-prematch.txt` dhe `biletat-live.txt`: ID-të e biletave të pranuara dhe kuotat.
- `bulk-test-state.json`: regjistri i plotë i çdo përzgjedhjeje, i ruajtur hap pas hapi. Ruaje privat; ai përmban ID biletash, **jo** password ose token.

Nëse një kërkesë ka gabim rrjeti ose `HTTP 5xx`, skripti **ndalet për atë grup**, sepse serveri mund ta ketë pranuar biletën përpara humbjes së përgjigjes. Regjistri ruan `clientRequestId` dhe rastin `UNCERTAIN`, që të kontrollohet manualisht. Mos e nise sërish verbërisht të njëjtën seri, përndryshe mund të vendosen baste të dyfishta. Nëse lojtarit i mungojnë lekët, pjesa tjetër shënohet `NOT_TESTED_INSUFFICIENT_PLAYER_BALANCE`; ky nuk është gabim marketi.

**Shënim:** Meqë tregjet LIVE mund të mbyllen ose koeficientët të ndryshojnë gjatë testit, disa refuzime të ligjshme janë `MARKET_DECIDED`, `ODDS_CHANGED` ose `SELECTION_UNAVAILABLE`. Raporti ruan arsye konkrete, jo vetëm 'nuk funksionon'.

## 4. Kontrolli i WON / LOST / PENDING më vonë

```bash
node scripts/bulk-market-bet-test.mjs --recheck=bulk-market-test-DATA/bulk-test-state.json
```

Kjo nuk vendos baste. Lexon biletat e pranuara dhe kërkon statuset e tyre nga serveri, duke krijuar `rezultatet-prematch.txt` dhe `rezultatet-live.txt`. Mund të krahasosh këto rezultate me biletat e printuara.

**Kufizim i qartë:** pa `--db-native`, skripti kap vetëm tregjet që shfaq API e detajeve. Me `--db-native`, kap të gjitha kuotat që ekzistojnë **aktualisht** në tabelën e arkivit për ato dy ndeshje, jo tregjet e paofruara asnjëherë. Nuk aktivizon tregje të fshehura dhe nuk kapërcen asnjë rregull sigurie.
