# Rikuperimi i tregjeve kryesore, 2026-11-09

**Repo e vetme:** `mami12/zezasal`. Ndryshimet janë në degën `fix/settlement-market-audit-20261109`, përmes draft PR #1. `main` nuk është ndryshuar dhe **nuk është bërë vendosje e basteve në prodhim**.

## Çfarë u rregullua në kod

1. **Kombinimet native Zizobet**: emrat realë `Matchbet and Totals`, `Matchbet and both teams to score`, variantet e pjesëve të para/dyta, `Double chance (1X - 12 - X2) and Totals/BTTS`, `Double chance & total goals`, `Total & both teams to score`; edhe `First Half - Matchbet and Totals 1.5`. Parametri 1.5/2.5 etj. duhet të përputhet me tregun e publikuar dhe kuotën.
2. **HT/FT i golave**: 1/X/2 i pjesës së parë dhe rezultatit përfundimtar interpretohen bashkë, vetëm nga rezultati i verifikuar në të dy momentet. Nuk përdoret i njëjti parser për kornerat apo tregjet e tjera.
3. **HT/FT + total gola**: `Halftime/Fulltime & total goals`, `... & 1st half total goals` dhe `... & exact goals`, me dy kushte eksplicite dhe kontratë të ngrirë te bileta.
4. **HT/FT Correct Score**: kërkon dy rezultate të sakta eksplicite, p.sh. `1-0 / 3-2`. Opcione të paidentifikueshme refuzohen para debitimit.
5. **Corners Halftime/Fulltime**: llogaritet nga kornerat e pjesës së parë dhe të gjithë ndeshjes, përmes ngjarjeve të konfirmuara të Zizobet. Jo nga rezultatet e golave. Minuta 45+ pa tregues të qartë të pjesës nuk mjafton.
6. **Most corners / Most cards**: llogaritet nga totalet e konfirmuara për të dy ekipet. Prania e opsionit X ruhet në kontratën origjinale. Barazimi i tregut 2-way nuk trajtohet si një humbje arbitrare.
7. **Gabimet VOID**: kur parser-i nuk identifikon një kombinim Result+Total ose Result+BTTS, rezultati kthehet `null` (PENDING), **jo VOID**. Nuk kthehen para pa arsye reale.
8. **Tregjet e golave në pjesë/total**: `Double chance & total goals`, `Matchbet and Totals` dhe kombinimet HT/FT nuk lejohen të kapen gabimisht nga parser-i i totalit normal.

## Cilat rregulla nuk janë prekur

- Kërkesat e API kryesor Zizobet; dokumentimi/çmimi i kuotës në momentin e vendosjes; ruajtja e baseline për LIVE; ndalimi i tregjeve të përfunduara; tregjet e lojtarëve mbeten jashtë këtij rikuperimi.
- Pagesat përdorin fakte të verifikuara; pa statistikë të plotë ose me prova kundërthënëse, statusi mbetet PENDING/manual. Unknown nuk është automatikisht LOST/VOID.
- Nuk është ndryshuar pamja e faqes, fondet, RTP, shumat, limiti i lojtarëve apo mënyra e depozitimit.

## Provat

```bash
node scripts/test-native-core-market-recovery.mjs
node scripts/test-corner-comparisons.mjs
node scripts/test-half-combinations.mjs
node scripts/test-interval-first-goal.mjs
node scripts/test-result-btts.mjs
```

Testi i ri lexon emra tregjesh **të ekzistueshëm** në listën e 577 titujve të Zizobet. Outcome-et në teste janë skenarë sintetikë, jo prova të kuotave të të gjitha ndeshjeve. Suite e izoluar nuk certifikon 100% pranimin ose pagesën në prodhim.

## Çfarë mbetet pa certifikim

- Për disa tregje native nuk kemi ende përzgjedhjet e vërteta dhe parametrat e tyre. Me emrin e tregut **nuk mund të vërtetohet çdo kuotë**. Bëj testin masiv të kontrolluar të LIVE dhe PREMATCH të përshkruar në `BULK-MARKET-TEST.md` për identifikim të saktë.
- Tregjet e lojtarëve janë shtyrë sipas kërkesës; bookmaker-defined `Bookings / Booking Points`, marketet e veçanta të kartonëve e golave dhe handikapet kërkojnë konfirmimin e rregullit të provider-it, jo hamendësim.
- Nuk është bërë auditim i DB-së së vërtetë, test me fonde reale, krahasim i biletave të printuara, apo deploy në main.
