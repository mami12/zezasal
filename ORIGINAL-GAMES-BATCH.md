# Original game clients — October 2026 batch

## Current wallet integration — October 21

All six lobby games now use the authenticated sportsbook account balance. The four Slotopol clients below launch through `/app/api/casino/original/:id/session`; their separate virtual-credit routes remain available only as standalone development demos and are no longer linked by the lobby. Original game controls and assets are preserved. The new adapter uses the original Slotopol reel/paytable outcomes; the Sizzling RTP-profile setting does not scale these four games.

Each paid spin debits `app_user.balance` and writes a casino round and player/manager ledger entries in one SQL transaction. Wins remain pending until Take/Collect, the next AGT spin, a new launch or Back. Pending state and replay responses live in PostgreSQL, so a restart, repeated request or parallel frame cannot pay twice. Relaunching the same game invalidates its previous frame. CT Viking free-game chains are calculated and persisted with the paid round before playback; closing midway credits the already awarded full result. Existing account blocks, self-exclusion, stake limits and the administrator casino switch apply to new wagers. There is no demo fallback on wallet or database failure.

All game routes use one horizontal fullscreen container with a reserved Back toolbar. Android fullscreen/orientation lock is requested from the game-card click. A rotated landscape layout covers browsers that deny native orientation lock. The child transport bridge keeps provider fullscreen requests inside the parent so Back remains visible. Physical Android/iOS orientation behavior still requires device verification.

`npm run test:original-wallet` runs isolated PostgreSQL-compatible PGlite SQL tests for all four games, stakes, payouts, retries, restart recovery, manager conservation, free games, x2/x4, close/collect, player restrictions and cookie authentication. It never uses production credentials or player money. Browser checks use a disposable local account and verify horizontal presentation, Back, wallet amounts and transport requests.

The following sections document the original demo import and skipped captures.

The casino adds three separately labelled FUN-credit demos: Viking's Fun, Fruit Queen and Seven Hot. Their supplied provider JavaScript, menus, artwork, symbol animations and sound files run locally. Game controls remain in English. Outcomes are calculated on the Node server using ports of the matching [Slotopol scanners](https://github.com/slotopol/server/tree/2a6fd837feea1b52bbfd65035a7698d0c70e096a/game/slot), with the upstream reel strips and MIT source notices included in `server/casino/slotopol-source/`.

These are local demo adapters, not the providers' private RGS services. Demo sessions live in memory and reset when the backend restarts. They do not use the real sports/casino wallet. The existing Sizzling Hot Deluxe and Book of Ra wallet integrations are preserved.

## Included

| Game | Original client | Math | Features |
| --- | --- | --- | --- |
| Viking's Fun | CT Interactive HTML client | `ct/vikingsfun`, 25 selected lines, 96.105777 reel set | 15 free games, retriggers, extra wilds during free games, red/black and suit gamble, take/half |
| Fruit Queen | AGT Phaser client | `agt/fruitqueen`, original selectable lines, nearest 96% reel set | Original bet/line menus, original animation/sound, red/black x2 and suit x4 |
| Seven Hot | AGT Phaser client | `agt/sevenhot`, 20-line client, nearest 96% reel set | Original bet/line menus, original animation/sound, red/black x2 and suit x4 |

Only local transport/session defaults and the demo connection are adapted. AGT English dictionaries and paytables were recovered from newly created official public demo sessions; session identifiers, balances and captured user histories are not packaged. Missing public static files were recovered from the original asset hosts during development. The deployed games do not proxy requests to those hosts.

## Skipped under the instruction to omit incomplete games

| Capture/game | Reason |
| --- | --- |
| Dolphins | The capture does not contain an identifiable complete game client. |
| Ultra Sevens | Site/wrapper files are present; the playable client is missing. |
| Roobet archive | Encrypted launcher/wrapper only; no identifiable complete game client. |
| Ice Fruits 6 Reels | Official client line patterns differ from the Slotopol algorithm, including lines 8/9, 12/13 and 16/17. It is not silently substituted with a different set of winning lines. |
| Zeus | Required original resources `ui/specscatter.webp` and common `ui/smoke.webp` are absent and return HTTP 404 from the public host. |
| Aladdin | Capture is incomplete; four original wild variants/feature presentation were not established as equivalent to Slotopol's single wild representation. |
| Mega Joker Jackpot | Missing playable bootstrap and incomplete CWS resources; exact Jackpot-variant equivalence to the Slotopol Mega Joker algorithm is unverified. |
| Arabian Nights | Incomplete captured launch/session dependencies; full original offline client and bonus protocol were not established. |
| Fruit Shop | Same limitation as Arabian Nights; the Google capture is a duplicate, not an extra game. |
| Beetle Mania Deluxe | Manifest lists many absent resources, including bonus animations and all captured audio. No incomplete version is exposed in the lobby. |
| Fairy Queen | Incomplete Greentube client/launch capture. |
| Fruit Sensation | The supplied Greenslots client is a recreation; original-provider provenance is not established. |

The original source folders on drive D: are unchanged. Experimental clients excluded from the batch are outside the Git repository.

## Mobile asset repair — October 21

The CT clients choose additional resources by user agent. Desktop-only checks missed the `_small` attraction sprites, iPhone fullscreen stylesheet/gesture artwork, and the Lottie image frames used instead of WebM on iOS. These original files, plus the referenced MONEY WebM, are now packaged locally for Lucky Clover X3 and Viking's Fun. No provider UI, audio, animation code or device selection is changed.

AGT mobile button atlases for Fruit Queen and Seven Hot, the mobile sound icon and two fonts are also included from the original public asset host. These resources were absent from the desktop capture.

`npm run test:originals` checks all mobile attraction references, both WebM/Lottie branches, every nested Lottie image, and AGT mobile button atlases against the packaged manifests. Browser checks use phone dimensions and Android/iPhone user-agent branches; these are desktop browser simulations, not physical-device Safari tests.

## Book of Ra / Sizzling rendering and fullscreen repair — October 21

The fullscreen adapter now loads before the assembler even when the original HTML head has `attach-element` attributes. Previously these two wallet entrypoints skipped the adapter, allowing the provider's touch fullscreen handler to leave the parent container and its Back toolbar.

Both pinned Pixi clients now use a backing-pixel budget of 921,600 (1280×720 equivalent) and a DPR cap of 1.5 on touch devices, or 2,073,600 pixels (1920×1080 equivalent) on desktop. Initial sizing, resize and adaptive quality use the same limits. Browser DPR, original HD media, control geometry, animation durations and game math are preserved. The engine URL is versioned so an older cached bundle cannot hide the correction.

`npm run test:pixi-clients` exercises the original resize/adaptive methods and Pixi pointer mapping across 36 viewport/DPR cases, plus the attributed-head fullscreen regression. The build verifier checks both packaged engines. These tests establish the rendering bounds and coordinate alignment; actual Android frame rate and touch behavior still require device verification.

## Shared casino latency and controls — October 22

All six wallet frames stop polling the parent account every three seconds; the original client remains responsible for its own balance meter and Back refreshes the sportsbook balance. Loader checks stop when the frame is ready. Fullscreen/orientation requests from the game card, mount and provider now share one automatic attempt per session; the visible Fullscreen control can retry after a denial. Back invalidates late display requests before the next game starts.

The shared player-limit check no longer scans transaction history for players without period caps, while still applying mature limits and enforcing self-exclusion. Limited players scan only the earliest relevant week/month boundary in the database timezone. `npm run test:casino-display`, `npm run test:player-controls` and `npm run test:original-wallet` cover display races, calendar limits and wallet conservation. These changes reduce unnecessary work; they are not a measured guarantee of production response time.

## Back and Exit fullscreen repair — October 22

Back now releases display intent and returns to the casino immediately. Wallet close runs in the background with a five-second request timeout, followed by an account refresh. Pending wins remain durable if the network is unavailable and are collected by the existing close/next-launch logic. Repeated Back clicks cannot issue duplicate close requests.

The display button toggles between fullscreen landscape and a normal page-sized cabinet while retaining the same game frame and session. Manual exit suppresses automatic provider fullscreen requests until the player explicitly enters again. Browser Escape also restores the normal cabinet; pending native entry, lock or exit promises cannot block Back.

`npm run test:casino-display` covers suspended browser promises, late display races and immediate navigation under wallet failures. Wallet conservation tests and web typecheck/build pass. A disposable local browser check retained Sizzling's selected bet through both display modes and returned to the catalog within one second while its test close endpoint was delayed fifteen seconds. This was a desktop browser check, not a physical Android test or a production deployment verification.

## Verification

- 20,370 deterministic grids were compared directly against the unmodified Go scanners at the pinned Slotopol commit: 12,242 Viking's Fun and 8,128 AGT cases. Base/free modes and mixed wilds were included.
- 600 reference cases from those Go runs are included as regression fixtures.
- Protocol tests cover free-game retriggers, single collection, invalid bets, separate demo sessions and x2/x4 outcomes.
- 554 packaged resource hashes are checked for the three new clients. Lucky Clover's existing 318-resource check remains unchanged.
- `npm run build:web`, `npm run test:originals` and `npm run test:clover` check the integration.

Run `npm run demo:originals` for a local database-free preview on port 3320. Individual paths:

- `/app/casino-original/vikings-fun/index.html`
- `/app/casino-original/agt/fruitqueen.html`
- `/app/casino-original/agt/sevenhot20.html`

Automated and visual checks establish the behavior tested; they are not a claim of equivalence to every private provider service or a guarantee of zero defects.
