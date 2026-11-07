import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { casinoStakeCents } from './bet-limits.mjs';

export const FIREJOKER_DATA = JSON.parse(readFileSync(new URL('./firejoker-data.json', import.meta.url), 'utf8'));
export const FIREJOKER_DEFAULT_RTP = FIREJOKER_DATA.defaultRtp;
export const FIREJOKER_BONUS_REEL = FIREJOKER_DATA.bonusReel;
export const FIREJOKER_LINES = [
  [2, 2, 2, 2, 2], [1, 1, 1, 1, 1], [3, 3, 3, 3, 3],
  [1, 2, 3, 2, 1], [3, 2, 1, 2, 3],
].map(line => line.map(row => row - 1));
export const FIREJOKER_LINE_PAY = [
  [0, 0, 20, 50, 100],
  [0, 0, 10, 25, 50],
  [0, 0, 10, 25, 50],
  [0, 0, 4, 10, 20],
  [0, 0, 4, 10, 20],
  [0, 0, 4, 10, 20],
  [0, 0, 4, 10, 20],
  [0, 0, 0, 0, 0],
  [0, 0, 0, 0, 100000],
];
export const FIREJOKER_SCATTER_PAY = [0, 0.5, 3, 0, 0];
export const FIREJOKER_FREE_SPINS = [0, 0, 10, 0, 0];

const profileReels = rtp => {
  const key = String(Number(rtp));
  const reels = FIREJOKER_DATA.reels[key];
  if (!reels) throw Object.assign(new Error('Unsupported Fire Joker Slotopol reel profile'), { status: 503, code: 'UNSUPPORTED_MATH_PROFILE' });
  return reels;
};
const stopAt = (reel, random) => {
  const stop = random(reel.length);
  if (!Number.isInteger(stop) || stop < 0 || stop >= reel.length) throw new Error('Invalid Fire Joker reel stop');
  return [0, 1, 2].map(row => reel[(stop + row) % reel.length]);
};
const emptyResult = grid => ({ grid, wins: [], winCents: 0, freeSpins: 0 });

export function gradeFireJokerGrid(grid, { lineBetCents, stakeCents }) {
  if (!Array.isArray(grid) || grid.length !== 5 || grid.some(reel => !Array.isArray(reel) || reel.length !== 3 || reel.some(symbol => !Number.isInteger(symbol) || symbol < 1 || symbol > 9))) {
    throw new Error('Invalid Fire Joker 5x3 grid');
  }
  if (!Number.isSafeInteger(lineBetCents) || lineBetCents <= 0 || !Number.isSafeInteger(stakeCents) || stakeCents !== lineBetCents * FIREJOKER_LINES.length) {
    throw new Error('Invalid Fire Joker stake');
  }

  const wins = [];
  let winCents = 0;
  for (let index = 0; index < FIREJOKER_LINES.length; index++) {
    const line = FIREJOKER_LINES[index];
    const symbol = grid[0][line[0]];
    let count = 1;
    while (count < 5 && grid[count][line[count]] === symbol) count++;
    const multiplier = FIREJOKER_LINE_PAY[symbol - 1][count - 1] ?? 0;
    if (!multiplier) continue;
    const amountCents = lineBetCents * multiplier;
    wins.push({
      line: index + 1,
      symbol,
      count,
      multiplier,
      amountCents,
      cells: line.slice(0, count).map((row, reel) => [reel, row]),
    });
    winCents += amountCents;
  }

  const scatters = [];
  for (let reel = 0; reel < 5; reel++) {
    for (let row = 0; row < 3; row++) if (grid[reel][row] === 8) scatters.push([reel, row]);
  }
  const scatterPay = FIREJOKER_SCATTER_PAY[scatters.length - 1] ?? 0;
  const freeSpins = FIREJOKER_FREE_SPINS[scatters.length - 1] ?? 0;
  if (scatterPay) {
    const amountCents = stakeCents * scatterPay;
    wins.push({ line: 0, symbol: 8, count: scatters.length, multiplier: scatterPay, amountCents, cells: scatters, freeSpins });
    winCents += amountCents;
  }
  if (!Number.isSafeInteger(winCents)) throw new Error('Fire Joker payout exceeds safe integer range');
  return { grid, wins, winCents, freeSpins };
}

function rollReels(reels, random) {
  return reels.map(reel => stopAt(reel, random));
}

function spinBonus(reels, random) {
  const symbol = FIREJOKER_BONUS_REEL[random(FIREJOKER_BONUS_REEL.length)];
  return [stopAt(reels[0], random), [symbol, symbol, symbol], [symbol, symbol, symbol], [symbol, symbol, symbol], stopAt(reels[4], random)];
}

/** One paid spin plus its Slotopol-prescribed, non-retriggerable free-spin chain. */
export function spinFireJokerRound({ stakeCents, mathProfile, random = randomInt }) {
  const stake = casinoStakeCents(Number(stakeCents) / 100);
  if (stake !== stakeCents || stake % FIREJOKER_LINES.length !== 0) throw new Error('Fire Joker requires a valid five-line total stake');
  const reels = profileReels(mathProfile?.rtp ?? FIREJOKER_DEFAULT_RTP);
  const lineBetCents = stake / FIREJOKER_LINES.length;
  const games = [];
  const paid = gradeFireJokerGrid(rollReels(reels, random), { lineBetCents, stakeCents: stake });
  games.push({ ...paid, free: false, freeGameNumber: 0, freeGameTotal: paid.freeSpins });
  let totalWinCents = paid.winCents;

  // BonusReel contains only symbols 1-7; the center reels cannot retrigger scatters.
  for (let index = 0; index < paid.freeSpins; index++) {
    const free = gradeFireJokerGrid(spinBonus(reels, random), { lineBetCents, stakeCents: stake });
    if (free.freeSpins) throw new Error('Fire Joker Slotopol bonus reels unexpectedly retriggered');
    totalWinCents += free.winCents;
    games.push({ ...free, free: true, freeGameNumber: index + 1, freeGameTotal: paid.freeSpins });
  }
  if (!Number.isSafeInteger(totalWinCents)) throw new Error('Fire Joker round payout exceeds safe integer range');
  return { grid: games.at(-1).grid, wins: paid.wins, winCents: totalWinCents, freeSpins: 0, games, awardedFreeSpins: paid.freeSpins, mathProfile: { ...mathProfile } };
}

export function initialFireJokerGrid({ mathProfile, random = randomInt } = {}) {
  return rollReels(profileReels(mathProfile?.rtp ?? FIREJOKER_DEFAULT_RTP), random);
}