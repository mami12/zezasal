import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { buildSystemColumns, frozenSelectionPrice, moneyCents, splitSystemStake, systemColumnPayout } from '../server/ledger/system-columns.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../web/src/utils/betslipColumns.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const module = { exports: {} };
new Function('exports', 'require', 'module', compiled)(module.exports, () => ({
  systemColumnPayout,
  frozenSelectionPrice,
}), module);
const { stakeToCents, splitStakeCents, buildBetslipColumns, previewColumnPayouts } = module.exports;
const pick = (matchId, outcomeId, odds = 2) => ({ matchId, outcomeId, odds });

for (const value of ['100', '100.00', '100.01', '100.1', '0', '9999999.99']) {
  assert.equal(stakeToCents(value), moneyCents(value));
}
for (const value of ['', '-1', '100.001', '1e2', '100cats', 'NaN', 'Infinity', '9007199254740992']) {
  assert.equal(stakeToCents(value), null, value);
}

const example = [pick('A', 'A1', 5), pick('A', 'Aover', 2.1), pick('B', 'B1', 15.18)];
const preview = buildBetslipColumns(example);
assert.equal(preview.automaticSystem, true);
assert.deepEqual(preview.columns, buildSystemColumns(example));
assert.deepEqual(splitStakeCents(10000, 2), [5000, 5000]);
assert.deepEqual(previewColumnPayouts(preview.columns, [5000, 5000]).map(column => column.payout), [3795, 1593.9]);
assert.equal(buildBetslipColumns([]).columnCount, 0);
assert.equal(buildBetslipColumns(example.slice(0, 1)).automaticSystem, false);
assert.equal(buildBetslipColumns([example[0], example[2]]).automaticSystem, false);

// Cover every accepted column count and cent remainder, checking server parity.
for (let count = 2; count <= 24; count++) {
  for (let remainder = 0; remainder < count; remainder++) {
    const cents = 10000 + remainder;
    const allocation = splitStakeCents(cents, count);
    assert.equal(allocation.reduce((sum, value) => sum + value, 0), cents);
    assert.ok(Math.max(...allocation) - Math.min(...allocation) <= 1);
    assert.deepEqual(allocation, splitSystemStake(cents / 100, count).map(value => Math.round(value * 100)));
  }
  const choices = Array.from({ length: count }, (_, index) => pick('A', `A${index}`, 1.3456));
  const actual = buildBetslipColumns(choices);
  assert.equal(actual.columnCount, count);
  assert.deepEqual(actual.columns, buildSystemColumns(choices));
}
assert.deepEqual(splitStakeCents(10000, 3), [3334, 3333, 3333]);
assert.deepEqual(splitStakeCents(10000, 4), [2500, 2500, 2500, 2500]);

// Full Cartesian coverage, one pick per match, deterministic order and no duplicate columns.
const combined = [pick('B', 'B1'), pick('A', 'A1'), pick('B', 'B2'), pick('A', 'A2'), pick('C', 'C1'), pick('A', 'A3')];
const combinedPreview = buildBetslipColumns(combined);
assert.equal(combinedPreview.columnCount, 6);
assert.deepEqual(combinedPreview.columns, buildSystemColumns(combined));
assert.equal(new Set(combinedPreview.columns.map(column => column.map(selection => selection.outcomeId).join('|'))).size, 6);
for (const column of combinedPreview.columns) assert.equal(new Set(column.map(selection => selection.matchId)).size, column.length);

// 2^100 alternatives must be rejected without expanding the product.
const explosive = Array.from({ length: 100 }, (_, index) => [pick(String(index), `${index}1`), pick(String(index), `${index}2`)]).flat();
assert.equal(buildBetslipColumns(explosive).overflow, true);
assert.deepEqual(buildBetslipColumns(explosive).columns, []);
assert.equal(buildBetslipColumns(Array.from({ length: 25 }, (_, index) => pick('A', `A${index}`))).overflow, true);

// Half-cent rounding is shared with the server, including persisted 4-decimal prices.
for (const [stake, odds] of [[50, [1.2345]], [33.34, [1.1015, 2.3456]], [25, [2.66665, 1.11115]], [100, [1.00005]], [100, [2.10005]]]) {
  const column = odds.map((price, index) => pick(String(index), String(index), price));
  assert.equal(previewColumnPayouts([column], [Math.round(stake * 100)])[0].payout, systemColumnPayout(stake, odds));
}
assert.equal(previewColumnPayouts([[pick('A', 'half-up-source', 2.10005)]], [10000])[0].odds, 2.1001);
for (const odds of [NaN, Infinity, 0, -2]) {
  const invalid = previewColumnPayouts([[pick('A', 'invalid', odds)]], [10000])[0];
  assert.equal(invalid.invalid, true, 'invalid quotes are flagged without crashing the slip');
}
assert.equal(previewColumnPayouts([[pick('A', 'huge', 9999999999), pick('B', 'huge2', 10)]], [10000])[0].invalid, true, 'oversized payouts must be blocked');
console.log('PASS betslip columns: exact total-stake allocation, every remainder up to 24 columns, Cartesian completeness, safe size cap and server payout parity');
