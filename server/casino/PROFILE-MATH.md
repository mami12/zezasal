# Casino reel profiles

In Original mode the administrator selects one supported reel profile per game. The persisted
`app_casino_settings.game_profiles` map applies to every player and is locked
alongside each paid wager. It contains profile identifiers, not an arbitrary
requested percentage. Future paid rounds use the new choice; pending payouts,
accepted request identifiers and already started bonuses keep their contract.

The former `profile` setting is retained for migration history but is no longer
used for new rounds. `SCHOOL_RTP_0` through `SCHOOL_RTP_100` were payout scaling
options for one adapter and did not control the other five engines. These names
are rejected by the new API. There is no payout scalar or result-dependent
reroll in the profile selection path.

## Custom RTP and paid-round hit frequency

Custom mode is a separate probability model, visibly identified to players
before launch. `app_casino_settings.game_controls` stores the global RTP and
hit-frequency targets for each game. Hit frequency means a paid round has a
positive payout, including its full bonus chain, before optional Gamble.
It is not the probability of net profit. Zero RTP and zero hit frequency are
supported together; a positive value paired with zero is impossible.

The immutable, offline-generated `custom-catalog-v1.json` contains complete
trajectories of original reel stops, including awarded free games and Book's
expanding symbol. Production scanners grade these stops at the accepted stake
and line count. Each wager samples one trajectory from exact rational weights
using unbiased cryptographic integers. No balance, player identity, recent
results or house liability participates in the draw. Nothing rescales a
paytable award or searches for a replacement outcome during a wager.

For target return R and hit probability H, the mean return among positive
rounds must be R/H. Losses and two pools of native winning trajectories are
weighted to satisfy both targets exactly. Unsupported pairs are rejected.
The catalog includes conservative bounds that cover every allowed stake and
line count, including cent rounding. This distribution changes the original
prize probabilities and available maximum, so Original mode's theoretical RTP
is not claimed for Custom mode.

Players acknowledge the current custom contract before session creation.
A fingerprint checked again under the paid wager's SQL settings lock prevents
new paid spins under undisclosed settings. Cached accepted replies bypass this
check. Accepted bonus trajectories and their settings remain frozen; changing
settings or switching wagering off cannot replace or forfeit an owed bonus.

All eight real-wallet games accept total paid-spin stakes from 20 through
5,000 ALL. These are total limits, not per-line minimums. CT's Viking credit
unit remains 0.008 ALL for compatibility; new native line bets start at 100,
which represents a total 20 ALL on 25 lines. Persisted denomination uses
six decimals while wallet debits and awards remain integer cents. Historical
accepted request identifiers and awarded free games keep their original terms.

## Four original Slotopol engines

Lucky Clover X3, Viking's Fun, Fruit Queen and Seven Hot use the immutable reel
maps already vendored from Slotopol commit
`2a6fd837feea1b52bbfd65035a7698d0c70e096a`. Profile RTP values are the upstream
published theoretical expectations for those reel maps and scanners. The ports
retain their original paytables. Runtime tests verify all 67 available reel maps
and the original golden grading cases. Administrator choices include the supplied
profiles in the authorized 1–1000% range, including source profiles above 100%.
An expected return above 100% is reported as such; it is not silently capped.

## Sizzling and Book adapters

Their supplied browser paytables differ from Slotopol's corresponding scanners.
Consequently an upstream reel map's name is not presented as this adapter's RTP.
Both the original client reels and the additional pinned Slotopol strips are
graded with the existing adapter paytable. Their expected returns are calculated
by `reel-return.mjs`:

* A uniform stop on each reel determines all three visible symbols. Each reel's
  symbol probabilities and its distribution of visible scatters are enumerated.
* For each paying symbol and prefix length, the exact-prefix probability is the
  product of the matching symbol/wild probabilities, minus the all-wild prefix
  when applicable, times the probability that the next reel breaks the prefix.
* The visible-scatter distributions are convolved across independent reels.
  This preserves the dependence between the three symbols on an individual reel.
* Expected line wins and scatter wins use the unchanged displayed multipliers.
  Their sum divided by the total stake gives the adapter's theoretical return.

Sizzling's original profile is approximately 95.660402%. Its three additional
reel profiles return approximately 82.900480%, 84.764160% and 85.743977% with this
client's paytable. These are different strips, not reduced payouts for a matching
winning grid.

Book's original profile is approximately 95.089721% while the existing free-spin
feature is off. The feature switch is not changed by this update. When it is on,
the existing rule grants ten additional rounds without retriggers. The model
adds `P(trigger) × 10 × E(free round)`, averaging the nine uniformly selected
expanding symbols and their extra reel awards. Book profiles therefore report
the expectation for the currently enabled feature configuration. The existing
original-reel configuration with this bonus is approximately 108.716872%.
It remains selectable under the authorized 1–1000% rule and is reported with that
effective expectation. Its original strips remain the default. Existing accepted
bonuses retain their stored reel profile even if the current choice changes.

New Book round payouts include the selected denomination. A pre-update bonus
without profile metadata retains the original strips and its stored per-line
stake. New bonuses store their profile identifier and effective per-line stake.

## Validation

`test-casino-math.mjs` independently enumerates all 1,024 stop combinations of
small test strips and compares the model to the production scanners, including
all nine Book expanding symbols. Seeded sampling is a diagnostic cross-check,
not RTP certification. A positive payout can be smaller than the stake and is
therefore not necessarily a profitable spin.

The wallet suites run production transactions in isolated PGlite databases and
check profile changes, frozen bonuses, denomination payouts, request replays,
collection and player/manager ledger conservation. The admin suite checks real
HTTP authorization, concurrent SQL persistence and audit entries. None of these
tests uses production database credentials or live customer funds.

The per-game support matrix and mathematical restrictions are recorded in
`SUPPORT-MATRIX.md`. `scripts/test-casino-protected-simulation.mjs` performs seeded
paid-round diagnostics for all eight original engines, the Book bonus variant,
and supported custom examples. Its machine-readable observations are written to
`test-artifacts/protected-casino-simulation.json`. Sampling does not certify RTP;
the exact rational and independent analytic tests remain the primary checks.
