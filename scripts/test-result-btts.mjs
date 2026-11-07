import assert from 'node:assert/strict';
import { isResultBttsMarket, parseResultBttsOutcome, gradeResultBtts } from '../server/ledger/result-btts.mjs';

assert.equal(isResultBttsMarket('Result and Both Teams to Score'), true);
assert.equal(isResultBttsMarket('Match Result & BTTS'), true);
assert.equal(isResultBttsMarket('Both Teams to Score / Result'), true);
assert.equal(isResultBttsMarket('Both Teams to Score'), false);
assert.equal(isResultBttsMarket('Full Time Result'), false);
assert.equal(isResultBttsMarket('Corners. Result and Both Teams to Score'), false);

const scenarios = [
  ['1/Yes', '1', true, [2, 1], 'WON'],
  ['1 + No', '1', false, [1, 0], 'WON'],
  ['Draw & GG', 'X', true, [2, 2], 'WON'],
  ['X/No', 'X', false, [0, 0], 'WON'],
  ['2/Yes', '2', true, [1, 2], 'WON'],
  ['2:NG', '2', false, [0, 1], 'WON'],
  ['1/Nil', '1', false, [1, 0], 'WON'],
  ['X/Nil', 'X', false, [0, 0], 'WON'],
  ['2/Nil', '2', false, [0, 1], 'WON'],
  ['Nil/1', '1', false, [2, 0], 'WON'],
  ['Home & Nil', '1', false, [1, 0], 'WON'],
  ['Nil & Chelsea', '2', false, [0, 2], 'WON'],
  ['No/1', '1', false, [2, 0], 'WON'],
  ['Home & BTTS: No', '1', false, [3, 0], 'WON'],
  ['Arsenal & No', '1', false, [1, 0], 'WON'],
];
for (const [outcome, expectedResult, btts, [home, away], expectedGrade] of scenarios) {
  const decoded = parseResultBttsOutcome(outcome, 'Arsenal', 'Chelsea');
  assert.deepEqual(decoded, { result: expectedResult, bothScore: btts }, outcome);
  assert.equal(gradeResultBtts(decoded, home, away), expectedGrade, outcome);
}

const oneNo = parseResultBttsOutcome('1/No');
assert.equal(gradeResultBtts(oneNo, 2, 1), 'LOST'); // Won home, but both scored.
assert.equal(gradeResultBtts(oneNo, 0, 0), 'LOST'); // No goals, but it was a draw.
assert.equal(gradeResultBtts(parseResultBttsOutcome('X/Yes'), 2, 2), 'WON');
assert.equal(gradeResultBtts(parseResultBttsOutcome('X/No'), 0, 0), 'WON');
assert.equal(parseResultBttsOutcome('Nil'), null, 'Nil alone does not identify a match result');
assert.equal(parseResultBttsOutcome('yes'), null);
assert.equal(parseResultBttsOutcome('1'), null);
assert.equal(parseResultBttsOutcome('1-0'), null);
assert.equal(gradeResultBtts(null, 1, 0), 'VOID');


const namedOutcomes = [
  ['Both Teams Not to Score and Draw', 'X', false, [0, 0]],
  ['Draw and Both Teams Not to Score', 'X', false, [0, 0]],
  ['Both Teams to Score and Draw', 'X', true, [1, 1]],
  ['Arsenal & No', '1', false, [1, 0]],
  ['Chelsea & No', '2', false, [0, 1]],
];
for (const [description, result, bothScore, score] of namedOutcomes) {
  const parsed = parseResultBttsOutcome(description, 'Arsenal', 'Chelsea');
  assert.deepEqual(parsed, { result, bothScore }, description);
  assert.equal(gradeResultBtts(parsed, ...score), 'WON', description);
}
assert.equal(
  gradeResultBtts(parseResultBttsOutcome('Both Teams Not to Score and Draw'), 1, 1),
  'LOST',
  'Draw with both scoring is not 0-0',
);
assert.equal(parseResultBttsOutcome('Both Teams Not to Score'), null, 'Plain BTTS No is not mixed');
assert.equal(parseResultBttsOutcome('Draw'), null, 'Plain draw is not mixed');

console.log('Result + BTTS combinations: passed.');
