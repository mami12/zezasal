# Fire Joker – Original Play'n GO Assets Integration

This directory contains the **Fire Joker** slot game integrated into the casino website using the Slotopol backend.

## Asset Source
- Original Play'n GO bundle extracted from:
  `D:\cassino\lojra\New folder\firejoker\qacdn.playngonetwork.com\8.1.3-firejoker.292\resources\games\videoslot\firejoker\`
- Assets copied into this project:
  - `assets/background.jpg`
  - `assets/logo.png` (cropped from `logo-atlas.png`)
  - `assets/logo-atlas.png`
  - `assets/symbol0.png` … `assets/symbol8.png` (individual symbols sliced from `symbols.png`)
  - `assets/skin_texture*.png`
  - `assets/multiplier*.png`
  - `assets/features.png`
  - `assets/bmpfonts.png`
  - `assets/sounds_desktop.mp3`

All original visual and audio assets are now referenced by `firejoker.js` and `firejoker.css`.

## Client Files
- **firejoker.js** – Implements the CT client logic, integrates with `wallet-bridge.js` and renders the game UI.
- **firejoker.css** – Styles the game, using the background image at `./assets/background.jpg` and logo at `./assets/logo.png`.
- **index.html** – Shell that loads the CSS/JS and defines the DOM structure.

## Build & Test
```bash
# From the project root
npm run build:web   # builds the web assets (Vite)
npm run test:originals   # runs all original-game tests, including Fire Joker
npm run test:original-wallet   # wallet integration tests
```
After building, the game is available at:
```
http://localhost:<port>/app/casino-original/firejoker
```

## Notes
- No custom RTP modal is enabled for Fire Joker (`supportsCustomCasinoMath` excludes it).
- `allowGamble` is disabled in the protocol (`firejoker-protocol.mjs`).
- The backend integration files (`firejoker-data.json`, `firejoker-engine.mjs`, etc.) remain unchanged.

For any further customisations, modify the client files in this directory while keeping the asset files untouched.
