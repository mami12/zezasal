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

## One outcome per exact market (current policy)

The current betslip allows **one outcome from each match/market/line**.
Selecting `X` after `1` in the same 1X2 market **replaces** `1`.
Selecting Under after Over on the exact same 2.5 total replaces Over.
Different markets on the same match (for example 1X2 + BTTS, or
Over 2.5 + Over 3.5) remain distinct source contracts and can be combined.

Automatic System columns from alternatives of one market are **no longer
created**. The server rejects such duplicate-market selections across the
**entire logical ticket**, including `/app/api/bets/place-columns`, even
when submitted as separate columns or with forged browser identifiers.
The ordinary placement and booking APIs enforce the same market identity.
Rejected requests never debit the wallet or create a funded ticket.

**Historical System tickets:** The database, receipts, payouts, and financial
reconciliation for previously accepted multi-column tickets stay supported.
The historical-column integration fixture is isolated from the public endpoint;
it does not re-enable alternative columns for new player wagers.

### Historical column settlement

The preserved historical system-colums implementation split a 100 LEK total
stake into 50 + 50 across two alternatives, up to 24 columns. Each historic
column and its idempotent financial transactions continue to settle normally;
existing paid tickets are not rewritten. That old arithmetic is retained only
for integrity, refund, audit and regression of already-funded tickets.

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
