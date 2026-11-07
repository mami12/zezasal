# Zizobet test provider

The default sports provider is now `zizobet`. An explicit `SPORTS_PROVIDER` environment value overrides that default. Existing database configuration, users, balances, tickets, casino and frontend are unchanged.

Restart with stop.bat then start.bat. `/health` should report `sportsProvider: "zizobet"`, and `oddsSocket.provider: "ZIZOBET"` with `connected: true`.

Public football snapshots are fetched from the Zizobet sports endpoints. Anonymous MQTT/WSS subscriptions notify the server when public caches change; they do not contain complete odds themselves. Notifications are combined in a 3-second refresh cycle. HTTP live-header fallback runs every 15 seconds, the prematch catalog every 60 seconds. Network and upstream cache delays still apply. Existing displayed-price buffering and bet acceptance checks remain in place.

Prematch uses existing league/admin limits. Real live football is not restricted by those prematch filters. Handicap and Asian quarter-total offers are excluded. Full live snapshots contain score, clock, corners and cards when provided. Missing statistics are not invented. Removed full-snapshot selections are suspended.

Finished results require explicit provider completion and actual score evidence. Disappearing from the live list or reaching minute 90 does not imply a final result. Existing settlement/evidence checks remain: receiving a player market does not by itself prove that it can be settled. Unsupported or unavailable final evidence can still require review. Existing accepted Ybets tickets retain their provider identity; a results-only watcher checks those pending tickets without publishing Ybets fixtures or prices.

Validation: isolated full server with a temporary local database, public MQTT connection, football catalog and full market retrieval; fixture checks for score, regular-time scope, cards, corners, suspension, handicap filtering and cache decoding. No production wager, balance reset or database migration was performed.
