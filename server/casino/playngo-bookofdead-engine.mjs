// Play'n GO — Book of Dead engine.
//
// Math is a faithful port of the Slotopol "book" family (Book of Ra Deluxe /
// Book of Dead share the same mechanic: 5x3, 10 paylines, one Book symbol
// that is both wild and scatter, 10 free spins with one expanding symbol).
// When the real Play'n GO reels are extracted from the client bundle they can
// be dropped into `playngo-bookofdead-data.json` without touching this file.
//
// If your `D:\cassino\www.playngo.com` folder holds a different Play'n GO
// title, copy this file to `playngo-<slug>-engine.mjs` and swap the DATA /
// PAYTABLE below; the protocol/router/UI layers are game-agnostic.
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CASINO_MIN_STAKE, walletPixiRanges } from './bet-limits.mjs';

// Inline DATA — a later sync script may replace this with an import of
// `playngo-bookofdead-data.json` extracted from the client's `data/*.json`.
let DATA;
try {
  DATA = JSON.parse(readFileSync(new URL('./playngo-bookofdead-data.json', import.meta.url), 'utf8'));
} catch {
  DATA = null;
}

export const LINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0], [2, 1, 0, 1, 2], [1, 2, 2, 2, 1],
  [1, 0, 0, 0, 1], [2, 2, 1, 0, 0], [0, 0, 1, 2, 2], [2, 1, 1, 1, 0],
];

// Symbol codes 1..9 match the payload the client draws; 0 is the Book
// (wild+scatter). If the client uses a different mapping, adjust in
// `playngo-bookofdead-data.json` and keep the shape identical.
export const PAYTABLE = DATA?.paytable ?? {
  1: { 2: 10, 3: 250, 4: 2500, 5: 9000 },
  2: { 2: 2, 3: 25, 4: 125, 5: 750 },
  3: { 2: 2, 3: 25, 4: 125, 5: 750 },
  4: { 2: 2, 3: 15, 4: 75, 5: 250 },
  5: { 3: 10, 4: 50, 5: 125 },
  6: { 3: 10, 4: 50, 5: 125 },
  7: { 3: 5, 4: 25, 5: 100 },
  8: { 3: 5, 4: 25, 5: 100 },
  9: { 3: 5, 4: 25, 5: 100 },
};
export const SCATTER_PAY = DATA?.scatterPay ?? { 3: 5, 4: 20, 5: 500 };
export const FREE_SPINS = DATA?.freeSpins ?? 10;
export const BET_OPTIONS = [1, 2, 3, 5, 10, 20, 30, 50, 100];
export const DENOMINATIONS = { 0: 0.5, 1: 1, 2: 2, 3: 5, 4: 10 };

// Reel strips: prefer extracted Play'n GO strips in data, otherwise fall
// back to the Slotopol Book-of-Ra family distribution scaled to the 0..9
// code table above.
const FALLBACK_REELS = [
  '1,2,3,4,5,6,7,8,9,0,1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8,9,0,1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8,9',
  '1,2,3,4,5,6,7,8,9,0,1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8,9,0,1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8,9',
  '1,2,3,4,5,6,7,8,9,0,1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8,9,0,1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8,9',
  '1,2,3,4,5,6,7,8,9,0,1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8,9,0,1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8,9',
  '1,2,3,4,5,6,7,8,9,0,1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8,9,0,1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8,9',
];
export const REELS = DATA?.reels?.map(strip => strip.map(Number))
  ?? FALLBACK_REELS.map(s => s.split(',').map(Number));

const money = v => Number(Number(v).toFixed(2));
const cell = code => ({ code });
export const symbolMatrix = grid => Object.fromEntries(grid.map((reel, c) =>
  [c, Object.fromEntries(reel.map((code, r) => [r, cell(code)]))]));

export function randomGrid(random = bound => randomInt(bound), reels = REELS) {
  return reels.map(reel => {
    const stop = random(reel.length);
    if (!Number.isInteger(stop) || stop < 0 || stop >= reel.length) throw new Error('Invalid reel stop');
    return [reel[stop], reel[(stop + 1) % reel.length], reel[(stop + 2) % reel.length]];
  });
}

/** Left-to-right line win; the Book (0) substitutes any line symbol. */
function lineWin(codes) {
  let base = null, count = 0;
  for (const c of codes) {
    if (base === null) {
      if (c === 0) { count++; continue; }
      base = c; count++; continue;
    }
    if (c === base || c === 0) count++; else break;
  }
  if (!base || count < 2) return null;
  const factor = PAYTABLE[base]?.[count] ?? 0;
  if (!factor) return null;
  return { code: base, count, factor };
}

/** Grades a 5x3 grid. `mud` is the expanding symbol during free spins. */
export function gradeGrid(grid, perLine, lines = LINES.length, mud = null) {
  if (!Array.isArray(grid) || grid.length !== 5 ||
      grid.some(c => !Array.isArray(c) || c.length !== 3)) {
    throw new Error('Invalid Play\'n GO grid');
  }
  const lineWins = [];
  let total = 0;
  for (let l = 0; l < Math.min(lines, LINES.length); l++) {
    const rows = LINES[l];
    const codes = rows.map((row, reel) => grid[reel][row]);
    const win = lineWin(codes);
    if (!win) continue;
    const amount = money(win.factor * perLine);
    total = money(total + amount);
    lineWins.push({
      idx: l, code: win.code,
      pos: rows.slice(0, win.count).map((row, reel) => [reel, row]),
      multiplier: win.factor, amount: amount.toFixed(2),
      type: 'basic', extra: {},
    });
  }
  const books = [];
  for (let c = 0; c < 5; c++) for (let r = 0; r < 3; r++) if (grid[c][r] === 0) books.push([c, r]);
  const scatterFactor = SCATTER_PAY[books.length] ?? 0;
  if (scatterFactor) {
    const amount = money(scatterFactor * perLine * LINES.length);
    total = money(total + amount);
    lineWins.push({
      idx: 0, code: 0, pos: books, multiplier: scatterFactor,
      amount: amount.toFixed(2), type: 'scatter', extra: {},
    });
  }
  if (mud !== null && mud > 0) {
    const fullReels = [];
    for (let c = 0; c < 5; c++) if (grid[c].filter(s => s === mud).length >= 3) fullReels.push(c);
    if (fullReels.length >= 2) {
      const factor = PAYTABLE[mud]?.[fullReels.length] ?? 0;
      if (factor) {
        const amount = money(factor * perLine * LINES.length);
        const pos = [];
        for (const c of fullReels) for (let r = 0; r < 3; r++) pos.push([c, r]);
        total = money(total + amount);
        lineWins.push({
          idx: 0, code: mud, pos, multiplier: factor, amount: amount.toFixed(2),
          type: 'mud', extra: {},
        });
      }
    }
  }
  return { total, line_wins: lineWins };
}

export function pickMudSymbol(random = bound => randomInt(bound)) {
  return 1 + random(9);
}
