# Fortune Teller

Fortune Teller is available in the casino catalog at `/app/casino/fortune-teller`.
It uses the existing authenticated player wallet, the same balance as sports betting,
and the existing total-stake limits of 20–5000 ALL. Restart the Node server after
updating the backend; the frontend build is in `web/dist`.

## Math source

The engine is a JavaScript port of [Slotopol Fortune Teller](https://github.com/slotopol/server/tree/20c55c7deeb9d147c1812763c8a0626c3a3d1e08/game/slot/playngo/fortuneteller),
pinned to commit `20c55c7deeb9d147c1812763c8a0626c3a3d1e08`.
The original Go rules, cards, scan, link and YAML reels are retained in
`server/casino/slotopol-source/fortuneteller_*`, alongside Slotopol's MIT license.
`scripts/sync-fortune-teller-math.mjs` extracts all 13 reel sets offline and checks
their published single-line returns before recording the actual 20-line returns.

The port retains these rules:

- Five reels, three visible rows, 1–20 selectable original paylines, uniform independent reel stops (20 lines by default).
- Original symbol payments and leading-wild rules; the highest line or wild award wins.
- Two to five cats pay 2/3/30/300 times the total stake.
- Three/four/five cats award 15/20/25 free spins. Cats substitute in free spins;
  free spins do not retrigger and use the accepted round's reels and line bet.
- Three or more Tarot symbols trigger a three-card bonus, including during free spins.
  Each card is one of four independently drawn types. Three equal cards pay
  1000/200/50/20 times the **line bet**; pairs pay 100/20/10/5, all different pay 5.
- There are no outcome rerolls, player-specific reel selection, payout scaling or
  custom RTP probabilities for this game. Optional double-up is not offered.

## RTP: source label versus active 20-line return

Slotopol's YAML RTP labels for this game correspond to its **one-line** scan.
Tarot awards use the line bet, so the effective return changes with the number
of selected paylines. Keeping the rules exactly as published means the default
source reel key `94.735834` produces a theoretical **67.4982627559% at 20 lines**.
It does not produce 94.735834% at 20 lines.

The independent probability calculation matches every published one-line key
within 0.00001 percentage points. All 13 effective 20-line returns are saved in
`server/casino/fortune-teller-data.json`; they range from 61.824444% to 88.493505%.
The administrator sees those effective 20-line values, while `sourceRtp` retains
the original reel key. These are source-based theoretical calculations, not
independent certification or a claim about the licensed Play'n GO server.

## Client and wallet

The client runs the original renderer, controls, timelines, sprites, fonts and audio from the supplied
`fortuntelle` capture, version `9.4.1-fortuneteller.238`. The complete game-version folder
is packaged locally. The native packet adapter connects that renderer to the wallet;
its original controls and animations are not rebuilt in HTML/CSS.
Captured sessions, launch URLs, remote credentials and unrelated website scripts are not published.
The raw capture is ignored by Git; packaged assets remain sufficient for builds
without the capture folder. Slotopol's MIT license covers its source, separately
from the supplied third-party artwork.

Every accepted paid round, including its full free-spin chain and Tarot awards,
is generated and persisted atomically before presentation. The three original four-card selection stages reveal the already accepted Tarot types. Repeated requests replay the same committed response.
Collection, refresh, reopening and explicit exit settle an accepted win once,
even after a restart or profile change. Stakes and payouts reconcile against the
player ledger; there are no automatic manager-wallet transfers.

Entry points:

- Frontend: `web/src/pages/CasinoPage.tsx`, `CasinoOriginalWallet.tsx` and
  `web/public/casino-original/fortune-teller/`.
- Engine/protocol: `server/casino/fortune-teller-engine.mjs`,
  `fortune-teller-protocol.mjs`, `fortune-teller-return.mjs`.
- Authenticated launch: `POST /app/api/casino/original/fortune-teller/session`.
- Original-client commands: `POST /app/api/casino/original/fortune-teller/native`.
- CT compatibility commands: `GET /app/api/casino/original/fortune-teller/rgsm`.
- Exit/collection: `POST /app/api/casino/original/fortune-teller/close`.

## Verification

All wallet and browser tests use an isolated in-memory PostgreSQL database,
synthetic players and test balances. They never connect to the configured live DB.

```text
npm run sync:fortune-teller
npm run test:fortune-teller
npm run test:fortune-teller-browser
npm run test:fortune-teller-layout
npm --prefix web run typecheck
node scripts/test-original-wallet.mjs
node scripts/test-original-wallet-profiles.mjs
node scripts/test-casino-profile-admin.mjs
node scripts/test-firejoker.mjs
```

Browser checks include original controls, changing spin frames, all 15 awarded free spins,
three original four-card Tarot stages, refresh collection and mobile portrait/landscape layout.
The wallet/native tests check durable retries and restart recovery. Screenshots are
written to the ignored `test-artifacts/fortune-teller-native/` folder.

## Original-client integration

`native-wallet.js` starts the supplied Play'n GO entry point. `fortune-teller-native.mjs` maps symbols, coin units, free-spin checkpoints and Tarot acknowledgements to the durable wallet state. The original coin/line selectors remain active; allowed denomination values keep the total stake within 20–5000 ALL. The round records its effective return at the selected line count. Profiles with a theoretical return above 100% at that count are rejected before any new draw.

The packaged provenance file records the source hash and the narrow integration changes: restoring two capture-damaged JavaScript operators, exposing existing state/events, using the available WOFF font and labeling Tarot multipliers X LINE BET. No original image or animation timeline is redrawn.

For the complete Albanian handover and a reusable prompt for another AI, see `SLOTOPOL-INTEGRATION-GUIDE.md`.

Each native frame is bound to its authenticated game-session ID. Packet IDs survive a frame refresh so an old cached initialization cannot replace the current balance. The package verifies all 41 supplied game-version files, including unchanged image, font and audio bytes.

The local adapter observes the actual game container and requests the original
layout and redraw on resize, focus, visibility restoration and host fullscreen
changes. The native focus handler clears the WebGL buffer; its resize path paints
before updating scene transforms. The adapter repaints after that native layout
has finished. The container also anchors the original HTML overlays locally.

`test:fortune-teller-layout` mounts the actual React iframe host after entering
fullscreen. It opens and cancels the original autoplay panel while resizing,
exiting and reentering fullscreen, checks centered panel/button bounds and painted
pixels, then physically clicks both original coin buttons. All checks use an
isolated wallet and assert zero wagers. `FORTUNE_HEADFUL=1` enables a real browser
window; `FORTUNE_BROWSER` selects an installed browser executable and `FORTUNE_DPR`
selects the display scale. Layout screenshots are saved under
`test-artifacts/fortune-teller-layout/`.
