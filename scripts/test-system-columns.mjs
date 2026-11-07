import assert from 'node:assert/strict';
import { buildSystemColumns, splitSystemStake, systemColumnPayout, moneyCents, frozenSelectionPrice } from '../server/ledger/system-columns.mjs';

const picks = [
  { matchId: '1497', outcomeId: 'home', price: 5 },
  { matchId: '1497', outcomeId: 'over', price: 2.1 },
  { matchId: '6983', outcomeId: 'saturn', price: 15.18 },
];
const columns = buildSystemColumns(picks);
assert.deepEqual(columns.map(col => col.map(p => p.outcomeId)), [['home', 'saturn'], ['over', 'saturn']]);
assert.deepEqual(splitSystemStake(100, 2), [50, 50]);
assert.deepEqual(columns.map((col, i) => systemColumnPayout(splitSystemStake(100, 2)[i], col.map(p => p.price))), [3795, 1593.9]);
assert.equal(systemColumnPayout(50, [5, 15.18]) + systemColumnPayout(50, [2.1, 15.18]), 5388.9);
assert.deepEqual(splitSystemStake(100, 3), [33.34, 33.33, 33.33]);
assert.deepEqual(splitSystemStake(100.01, 3), [33.34, 33.34, 33.33]);
assert.deepEqual(splitSystemStake(100, 4), [25, 25, 25, 25]);
// Exhaustive cent conservation across every supported count, with varied remainders.
for (let count = 2; count <= 24; count++) for (let extra = 0; extra < 100; extra++) {
  const total = (10000 + extra) / 100, stakes = splitSystemStake(total, count);
  assert.equal(stakes.map(moneyCents).reduce((sum, cents) => sum + cents, 0), moneyCents(total));
  assert.ok(Math.max(...stakes.map(moneyCents)) - Math.min(...stakes.map(moneyCents)) <= 1);
}
// Binary floating math commonly rounds this half-cent down; decimal arithmetic must not.
assert.equal(systemColumnPayout(1, [1.005]), 1.01);
assert.equal(frozenSelectionPrice(2.10005), 2.1001);
assert.equal(frozenSelectionPrice(1.55555), 1.5556);
assert.equal(frozenSelectionPrice(2.1000499999), 2.1);
assert.equal(frozenSelectionPrice(2.1000500001), 2.1001);
assert.equal(systemColumnPayout(33.33, [1.5, 1.5]), 74.99);
for (const value of [0, 99.99, NaN, Infinity, -100, 100.001, null, true, {}, '1e2']) {
  assert.throws(() => splitSystemStake(value, 2));
}
assert.throws(() => buildSystemColumns([picks[0], picks[0]]), /përsëritura/);
assert.throws(() => buildSystemColumns([picks[0], picks[2]]), /njëjta ndeshje/);
assert.throws(() => buildSystemColumns([null, picks[0]]));
const many = Array.from({ length: 25 }, (_, i) => ({ matchId: 'a', outcomeId: String(i) }));
assert.throws(() => buildSystemColumns(many), /24 kolona/);
const exact24 = [2, 3, 4].flatMap((count, m) => Array.from({ length: count }, (_, p) => ({ matchId: String(m), outcomeId: `${m}:${p}` })));
assert.equal(buildSystemColumns(exact24).length, 24);
const tooManyMatches = [...Array.from({ length: 21 }, (_, i) => ({ matchId: String(i), outcomeId: `a${i}` })), { matchId: '0', outcomeId: 'b0' }];
assert.throws(() => buildSystemColumns(tooManyMatches), /20 ndeshje/);
console.log('PASS system columns: exact sample payouts, Cartesian grouping, 2,300 cent-conservation cases, half-up rounding, invalid inputs and bounded expansion');
