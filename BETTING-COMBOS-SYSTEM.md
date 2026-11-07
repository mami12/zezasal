# Automatic combos and system columns

In **Admin → Risk Management**, **Enable / Disable Combos** controls same-match
joint markets, for both prematch and LIVE. It is independent of the LIVE risk
master switch. It does not disable ordinary accumulators across different matches
or alternative system columns. Changes are persisted and audited; connected
browsers receive the updated switch immediately. Existing accepted bets retain
their frozen contracts and still settle.

Standard full-time football templates are available automatically: result + BTTS,
result + total goals, double chance + total goals, and BTTS + total goals. Each
contains exactly two selections. Every required market, exact line and outcome
must exist and be active. Suspended, completed, missing, impossible or redundant
contracts are excluded. Availability is evaluated again during LIVE play;
there is no fixed prematch/LIVE count. Unknown player, half-time and team-total
contracts are not guessed.

The configured automatic combo price is the product of its two real source odds,
rounded half-up to four decimal places, capped at 1000. This is the requested
product rule, not a claim to reproduce another bookmaker's correlated pricing.
The server reconstructs the contract and validates prices, freshness, suspensions
and the persisted combo switch again before any wallet debit. A changed price
requires acceptance; a browser price is never an authority.

## Alternative columns

Selecting more than one outcome from the same match automatically changes the
betslip to **System**. Each column contains exactly one selection per match.
The server generates the complete Cartesian expansion from source match IDs;
it rejects duplicate, missing or forged columns. Up to 24 columns and 20 matches
per column are supported. Different outcomes in the same market can be alternatives.

The minimum is **100 LEK for the whole slip**, including every column. The amount
stays unchanged as picks are added or removed. Two columns receive 50 + 50;
three receive 33.34 + 33.33 + 33.33. Remaining cents go to the first columns in
visible order. The wallet debit always equals the entered total.

For 100 LEK, picks 5.00 and 2.10 on one match plus 15.18 on another produce:

| Column | Stake | Odds | Conditional return |
| --- | ---: | ---: | ---: |
| 1 | 50.00 | 75.90 | 3795.00 |
| 2 | 50.00 | 31.878 | 1593.90 |

If both columns win, their returns sum to 5388.90. The per-column minimum/maximum
is labelled as conditional; no return is guaranteed. Mutually exclusive outcomes
cannot all win. Each column is stored as a System ticket with an `AUTO:i/n` marker,
and its receipt shows the group total and column stake. Booking multiple columns
remains disabled; placing a funded system is supported.

All columns, wallet movements, manager commissions and the retry key commit
atomically. Failed validation creates no partial funded slip. Retry keys are
checked across both ordinary and system placement endpoints. Legacy clients
without the explicit `totalStake` contract must refresh rather than having an
old per-column amount silently reinterpreted.

## Verification

Run `npm run test:betting`, `npm --prefix web run typecheck` and `npm run build:web`.
The financial suites use isolated embedded PostgreSQL and fake match/odds data;
they never place production bets or use the production database. Coverage includes
exact cent allocation, independent grading of all generated contracts, rejected
stale/suspended offers, price changes while locks are awaited, concurrent retries,
transaction rollback, cancellation, partial VOID and repeat settlement. Browser
tests exercise the actual React betslip at desktop/mobile sizes and real local
Socket.IO combo toggles.

On Windows, update the project while retaining the private `.env`, then use
`stop.bat` / `start.bat`. The launcher detects changed sources and rebuilds the app.
Refresh existing browser tabs after the server restarts. No new environment
variables or manual database migration are required.
