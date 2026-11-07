# Lucky Clover x3 — original browser client

Open **Casino → Lucky Clover X3**, or `/app/casino/lucky-clover-x3` after signing in.

The game uses the original CT Interactive browser renderer, UI definitions, stylesheets, sprite animations, sounds, card screen, denomination control, quick bets, MAX line bet, autoplay and help screens. The previous custom controls, Albanian game text and synthesized sounds are no longer loaded.

The supplied capture contained the renderer and graphics but placeholders for the entry page and missing manifests/audio. Public CDN asset manifests were fetched to recover these resources. Runtime resources are packaged under `web/public/casino-original/lucky-clover-x3/vendor/`; no production CDN proxy is installed. The entry selects English and the local demo backend.

## Local engine

`clover-ct-router.mjs` implements the CT browser client's protocol with a local demo account. `clover-ct-config.mjs` supplies local denominations, betting limits and paytable metadata. Spins use the JavaScript port of Slotopol's Lucky Clover x3 algorithm and its 96.057605% reel set. This is a local Slotopol integration, not the provider's remote RGS backend or a claim that its private server configuration is identical.

Engine: https://github.com/slotopol/server

Pinned commit: `2a6fd837feea1b52bbfd65035a7698d0c70e096a`. Source rules, reels, CT line definitions and the MIT license are retained in `server/casino/slotopol-source/`.

The adapter handles the client's row/column formats, credit units, expanding wilds, multiplier animations, win display, pending awards and collect flow. The separate card gamble uses server-generated cryptographic random cards: red/black x2, suit x4, half/all wager and collect. No browser outcome decides the balance. Sequence numbers make retries idempotent.

Accounts start with 100,000.00 FUN as in the reference client. They are isolated from sports balances, stored in memory and expire after four idle hours or restart. This integration uses no external demo-session token or external casino account.

## Run

```text
npm ci
npm run build:web
npm start
```

Standalone, without the sports database:

```text
npm run demo:clover
```

Open http://127.0.0.1:3317/ . Set `CLOVER_PORT` to change the port.

## Validation

```text
npm run test:clover
npm --prefix web run typecheck
```

Tests cover line/scatter/multiplier math, CT symbol orientation and response format, gamble x2, invalid choices, collect and replay behavior. Browser checks use the original English menu, MAX bet, audio loading, spin completion, card gamble and collecting back into the base game. Deterministic fixtures used during development are not shipped in the production server.
