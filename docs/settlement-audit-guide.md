# Zizobet settlement audit and missing-data checklist

This guide is for the operator of the `zezasal` deployment. **No script
changes a bet, winner, wallet, balance, commission, limits, API settings or
database state.** These are read-only reports, not settlement actions.

Run in the project directory on a machine with the same PostgreSQL connection
as the betting server, preferably against a database **read replica**:

```sh
node scripts/audit-provider-readiness.mjs > provider-readiness.json
node scripts/audit-market-settlement-readiness.mjs 30000 --all > market-audit.json
node scripts/audit-ticket-settlement-integrity.mjs 2000 > ticket-integrity.json
```

If the market archive has more than 30,000 **distinct**
(provider/market/outcome/period/line) combinations, increase the limit up to
150,000, or query an exact time window. The console JSON says
`partial: true` if it reached the requested limit.

## Reading the results

* **Provider readiness:** `providerKeys` shows only whether optional API
  keys are present, not their contents. `secondaryUsage` and
  `primaryCoverage` expose quota pressure and whether the timeline was
  confirmed. `fixtureMappings` reports how many matches were safely mapped
  to AiScore. `secondaryIncidents` counts facts actually archived.
* **Market readiness:** `riskyOffers` contains exact provider key/name,
  outcome, period and reason. `UNKNOWN_REVIEW` and
  `DANGER_WRONG_RESULT` require mapping or a bookmaker rule, not permission
  to fall back to an unrelated final-score grader. `SCORE_GRADEABLE` is only
  static recognition, not a real-money settlement guarantee.
* **Ticket integrity:** `POSSIBLE_WRONG_SETTLEMENT` is a signal for
  **manual investigation**, not proof the historic payout is wrong.
  `PENDING_BUT_GRADEABLE` means a new automatic grading pass may be
  appropriate after verifying the evidence.
  `NEEDS_HISTORICAL_EVIDENCE` means a ticket was already settled but the
  current archive cannot reproduce the old evidence; never reverse a wallet
  transaction based on that label alone.

For individual incidents, compare:

1. Exact provider match ID, named teams and kickoff date/time.
2. Accepted ticket line ID, quote/market ID, market line, selection and
   original frozen terms including period and any acceptance-time baseline.
3. Zizobet provider snapshots and confirmed full-time/half-time scoreboard.
4. Primary goal/corner/card incident coverage and source timestamps.
5. For player or statistic props, linked FotMob/AiScore/other provider
   incident identities, full-time counters and any conflicting source records.

## Optional API configuration

* `STATS_PROVIDERS_ENABLED=true` turns on the secondary statistics service.
* Optional registered keys:
  `APIFOOTBALL_API_KEY`, `SPORTAPI_API_KEY`,
  `GOALAPI_API_KEY`, `BSD_API_KEY`.
* FotMob is accessed without an API key in this project, but its
  upstream coverage, endpoint access and usage terms may change.
* AiScore requests require a **confirmed match-ID mapping**, not just
  the team's text. `AISCORE_INFO_ENABLED=false` disables the collector.
* The worldcup26 fallback does not have a key variable in the current code,
  but its league coverage is limited.
* Keys cannot fix an absent minute-by-minute foul/shot timeline or a market
  whose provider settlement rules were never documented.

Please don't upload `.env`, API keys, database credentials, entire wallets,
or user records to issues/chat. Share the redacted JSON reports and sanitized
individual ticket/provider examples instead.

## Decision policy

Only actual evidence can produce `WON` / `LOST`. `VOID` requires a
verified bookmaker push/cancellation rule. Missing, stale, mutually
contradictory, or mismatched evidence remains `PENDING` or manual review.
