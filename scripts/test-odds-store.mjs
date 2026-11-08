/**
 * Offline test for the in-memory odds store (server/odds-store.mjs).
 *
 * Decodes the captured real frames (no network, no database) and checks the contract
 * the board depends on: rows stored, change detection for broadcasts, price history,
 * the ordering buildMarkets() expects, and match eviction.
 *
 * Run: node scripts/test-odds-store.mjs [frame-file ...]
 */
import './fixtures/isolated-casino-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePushBatch } from '../server/push-decode.mjs';
import * as store from '../server/odds-store.mjs';
import { buildMarkets } from '../server/collector.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cli = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = (
  cli.length
    ? cli.map((f) => path.resolve(process.cwd(), f))
    : ['sample-frames.txt', 'sample-frames-live2.txt', 'sample-snapshot.txt'].map((f) => path.join(scriptDir, f))
).filter((f) => fs.existsSync(f));

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`);
  if (!ok) failures++;
};

// --- decode real frames into camelCase odds rows ---------------------------------
const rows = [];
for (const file of files) {
  const frames = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const { odds } = decodePushBatch(frames);
  for (const decoded of odds) rows.push(...decoded.rows);
}
const uniqueRows = [...new Map(rows.map((r) => [`${r.matchId}|${r.marketKey}|${r.line}|${r.outcomeKey}`, r])).values()];
console.log(`files=${files.length} decodedRows=${rows.length} uniqueRows=${uniqueRows.length}\n`);
if (!uniqueRows.length) {
  console.log('no odds rows decoded - nothing to test');
  process.exit(1);
}

// --- store behaviour --------------------------------------------------------------
const first = store.applyRows(uniqueRows);
check('every decoded row is stored', store.stats().rows === uniqueRows.length, `rows=${store.stats().rows}`);
check('first apply reports every row as changed', first.changed.length === uniqueRows.length, `changed=${first.changed.length}`);

const second = store.applyRows(uniqueRows);
check('re-applying identical prices reports no change', second.changed.length === 0, `changed=${second.changed.length}`);

const sample = uniqueRows[0];
const moved = { ...sample, price: Number(sample.price) + 0.5 };
const third = store.applyRows([moved]);
check('a price move is reported as changed', third.changed.length === 1, `changed=${third.changed.length}`);

const stored = store
  .getOddsForMatches([sample.matchId])
  .find((r) => r.market_key === sample.marketKey && r.line === (sample.line ?? '') && r.outcome_key === sample.outcomeKey);
check('the stored price is updated', Number(stored?.price) === Number(moved.price), `${stored?.price} vs ${moved.price}`);

const hist = store.getHistory(sample.matchId, 10);
check('the price move landed in history', hist.length > 0 && Number(hist[0].price) === Number(moved.price), `entries=${hist.length}`);
check('history is newest first', hist.length < 2 || new Date(hist[0].at) >= new Date(hist[hist.length - 1].at));

const suspended = { ...moved, suspended: true };
check('a suspension change is reported', store.applyRows([suspended]).changed.length === 1);

// --- the board view ---------------------------------------------------------------
const boardRows = store.getOddsForMatches([sample.matchId]);
const mine = boardRows.filter((r) => r.match_id === sample.matchId);
check('base markets sort first within a match', mine.every((r, i) => i === 0 || !(r.is_base && !mine[i - 1].is_base)));
check('rows carry the snake_case shape the serializer reads', typeof stored?.match_id === 'number' && 'market_name' in stored && 'is_base' in stored);

const markets = buildMarkets(boardRows);
check(
  'buildMarkets turns stored rows into priced markets',
  markets.length > 0 && markets.some((m) => m.outcomes.some((o) => typeof o.price === 'number')),
  `markets=${markets.length}`,
);

console.log(`\n--- board view for match ${sample.matchId} (as the website gets it) ---`);
for (const m of markets.slice(0, 6)) {
  console.log(`  ${(m.name + (m.line ? ' ' + m.line : '')).padEnd(34)} ${m.outcomes.map((o) => `${o.name}=${o.price}`).join('  ')}`);
}

// --- housekeeping -----------------------------------------------------------------
check('clearMatch drops the match', store.clearMatch(sample.matchId) === true && store.getOddsForMatches([sample.matchId]).length === 0);
console.log(`\nstats: ${JSON.stringify(store.stats())}`);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
