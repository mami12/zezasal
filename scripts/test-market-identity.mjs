import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { decodePushMessage, describeMarket } from '../server/push-decode.mjs';
import { isIdentifiedMarketName, buildMarkets } from '../server/collector.mjs';
import { isHandicapOfferMarket } from '../server/market-policy.mjs';

// A descriptive name from upstream is authoritative, even if the backend
// assigns marketType OTHER or the title is as brief as "Total" or "Corners".
for (const [raw, expectedColumn] of [
  ['Total', 'total'],
  ['Corners', 'corners'],
  ['Cards', 'cards'],
  ['Result', 'result'],
  ['Correct score', 'other'],
  ['Corners. Result', 'corners'],
  ['Corners. Double chance', 'corners'],
  ['Yellow cards. Total', 'cards'],
]) {
  const market = describeMarket({ name: raw, typeId: null, groupId: 90000 });
  assert.equal(market?.name, raw, 'raw provider title must not be translated/rewritten: ' + raw);
  assert.equal(market?.column, expectedColumn, raw);
}
assert.deepEqual(describeMarket({ name: 'Total', typeId: null, groupId: 6379 }), {
  name: 'Total', column: 'total',
}, 'g6379 preserves the exact provider name');
assert.equal(describeMarket({ name: null, typeId: 777, groupId: 9898 }), null,
  'truly nameless + unmapped markets must not be guessed');
assert.equal(describeMarket({ name: null, typeId: 320, groupId: 9898 })?.name, 'Total Corners',
  'a known type may provide its mapped English title in an unnamed delta');
assert.equal(describeMarket({ name: null, groupId: 6379 })?.name, 'Total Goals',
  'a verified group map can supply a title only when the provider does not send one');

const group = (id, name, typeId) => ({
  id: String(id),
  ...(name === null ? {} : { name }),
  renderType: 'total-2',
  outcomes: ['under', 'over'],
  oddsList: [
    { id: '12:L:markettest:[' + typeId + ',[9.5],[0],1,4,[]]', cf: 1.87, status: 1 },
    { id: '12:L:markettest:[' + typeId + ',[9.5],[0],1,5,[]]', cf: 1.93, status: 1 },
  ],
});
const decoded = decodePushMessage({
  messageType: 'match-odds',
  data: {
    matchId: 987654321,
    oddsGroups: [
      group(99001, null, 777),
      group(99002, 'Corners', 777),
      group(99003, 'Corners. Result', 777),
      group(99004, null, 320),
    ],
  },
});
assert.equal(decoded.kind, 'odds');
assert.equal(decoded.rows.length, 6, 'all three named/mapped groups are included');
assert.deepEqual(new Set(decoded.rows.map(x => x.marketName)),
  new Set(['Corners', 'Corners. Result', 'Total Corners']));
assert.equal(decoded.rows.every(x => x.price > 0 && x.line === '9.5'), true);

for (const name of ['Market', 'Unknown', 'cols-2', 'Unverified market (g999)']) {
  assert.equal(isIdentifiedMarketName(name), false, name);
}
for (const name of ['Total', 'Correct score', 'Corners', 'Cards', 'Result', 'Match Result (2-way)']) {
  assert.equal(isIdentifiedMarketName(name), true, name);
}
// Provider and admin state, not market names, decide which offers are excluded.
for (const name of ['Handicap', 'Asian Handicap', 'Corners. Handicap', 'Asian Corners', 'European Handicap']) {
  assert.equal(isHandicapOfferMarket({ name }), false, name + ' remains provider-controlled');
  assert.equal(isHandicapOfferMarket({ name, explicitlyExcluded: true }), true,
    name + ' is blocked when explicitly excluded');
}
for (const name of ['Asian Total', 'Total', 'Corners. Result', 'Yellow cards. Total', 'Correct score']) {
  assert.equal(isHandicapOfferMarket({ name }), false, name + ' is not a handicap');
}

// buildMarkets keeps identified named groups unless explicitly excluded.
const rows = [
  ['Unverified market (g1)', 'g1'],
  ['Total', 'g6379'],
  ['Correct score', 'g6371'],
  ['Corners', 'g100'],
  ['Corners. Result', 'g6481'],
  ['Yellow cards. Total', 'g200'],
  ['Handicap', 'g6344'],
  ['Asian Corners', 'g321'],
  ['Asian Total', 'g322'],
].map(([marketName, marketKey]) => ({
  market_key: marketKey, market_name: marketName, line: '',
  outcome_key: '1', outcome_name: 'Home', price: 1.8,
  board_column: marketName.toLowerCase().includes('corner') ? 'corners' : 'total',
}));
const named = buildMarkets(rows).map(x => x.name);
assert.deepEqual(new Set(named),
  new Set(['Total', 'Correct score', 'Corners', 'Corners. Result', 'Yellow cards. Total', 'Handicap', 'Asian Corners', 'Asian Total']));

// Identical text is not proof that two provider group IDs describe one bet.
const distinct = buildMarkets(['g11111', 'g22222'].map(id => ({
  market_key: id, market_name: 'Corners. Result', line: '',
  outcome_key: '1', outcome_name: 'Home', price: 2.0, board_column: 'corners',
})));
assert.equal(distinct.length, 2, 'retain distinct provider market IDs sharing the same English title');

const require = createRequire(import.meta.url);
const ts = require('typescript');
const moduleCache = new Map();
function loadUiModule(url) {
  if (moduleCache.has(url.href)) return moduleCache.get(url.href).exports;
  const mod = { exports: {} };
  moduleCache.set(url.href, mod);
  const compiled = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const localRequire = id => id.startsWith('.')
    ? (/\.mjs$/.test(id) ? require(fileURLToPath(new URL(id,url))) : loadUiModule(new URL(id + '.ts', url)))
    : require(id);
  new Function('exports', 'require', 'module', compiled)(mod.exports, localRequire, mod);
  return mod.exports;
}
const ui = loadUiModule(new URL('../web/src/utils/marketCatalog.ts', import.meta.url));
const mk = (name, line = '', period = 0, marketType = 'OTHER', extId = '') =>
  ({ id: 'test-' + extId + name + line, name, line, period, marketType, extId });

for (const [name, translated] of [['Total', 'Total'], ['Correct score', 'Correct score'], ['Corners', 'Corners'], ['Cards', 'Cards'], ['Result', 'Result']]) {
  assert.equal(ui.isIdentifiedMarket(mk(name)), true, name + ' is a real upstream name');
  assert.equal(ui.marketDisplayTitle(mk(name), 'al'), translated, name + ' is translated for display');
  assert.equal(ui.marketDisplayTitle(mk(name), 'en'), name, 'raw provider title remains available unchanged');
}
assert.equal(ui.isIdentifiedMarket(mk('Unverified market')), false);
assert.equal(ui.marketDisplayTitle(mk('Total', '4.5', 0, 'OVER_UNDER', 'g6379'), 'al', true), 'Total (4.5)');

const providerFirst=mk('Next Goal 1st','',0,'OTHER','zz75001@eyJzZXEiOjF9');
const providerSecond=mk('Next Goal 2nd','',0,'OTHER','zz75002@eyJzZXEiOjJ9');
assert.notEqual(ui.marketGroupKey(providerFirst),ui.marketGroupKey(providerSecond),
 'Match detail must never group goal #1 and goal #2 as one Next Goal offer');
assert.equal(ui.marketDisplayTitle(providerFirst,'al'),'Next Goal 1st');
assert.equal(ui.marketDisplayTitle(providerSecond,'al'),'Next Goal 2nd');

assert.equal(ui.marketDisplayTitle(mk('Corners. Result'), 'al'), 'Corners. Result');
assert.equal(ui.marketDisplayTitle(mk('Yellow cards. Total'), 'al'), 'Yellow cards. Total');
assert.equal(ui.marketDisplayTitle(mk('Total Corners', '9.5'), 'al', true), 'Total Corners (9.5)');
assert.equal(ui.marketCategoryOf(mk('Corners. Double chance')), 'corners');
assert.equal(ui.marketCategoryOf(mk('Corners. Result', '', 0, '1X2')), 'corners');
assert.equal(ui.marketCategoryOf(mk('Yellow cards. Result')), 'cards');
assert.equal(ui.marketCategoryOf(mk('Correct score')), 'goals');
assert.equal(ui.marketCategoryOf(mk('Result and total')), 'mixed');
assert.equal(ui.marketSelectionLabel('Over 9.5', 'al'), 'Over 9.5');
assert.equal(ui.marketSelectionLabel('Draw', 'al'), 'Draw');
assert.equal(ui.marketCategoryLabel('corners', 'en'), 'Corners');

// Synthetic Bet Builder offers are visually grouped by the market contracts,
// not by admin naming, selection codes or prices. All distinct bets survive.
const builder = (id, templateName, legsLabel, odds) => ({
  id: 'BB|123|' + id + '|market',
  name: 'Bet Builder: ' + templateName,
  marketType: 'OTHER',
  line: '',
  outcomes: [{ id: 'BB|123|' + id, name: legsLabel, odds }],
});
const doubleChanceTotals = [
  builder('1', 'X/2&P_2.5', 'DC X2 + TOTAL Under 2.5', 3.1),
  builder('2', '1/2&L_2.5', 'DC 12 + TOTAL Over 2.5', 3.9),
  builder('3', '1/X&P_3.5', 'TOTAL Under 3.5 + DC 1X', 4.2),
];
assert.equal(new Set(doubleChanceTotals.map(ui.marketGroupKey)).size, 1,
  'all Double Chance + Total Goals options share one visual group');
assert.equal(ui.marketDisplayTitle(doubleChanceTotals[0], 'en'),
  'Bet Builder: X/2&P_2.5');
assert.equal(ui.marketDisplayTitle(doubleChanceTotals[0], 'en', true),
  'Bet Builder: X/2&P_2.5', 'individual template names remain unchanged');
const bttsTotal = builder('4', 'G/G&+2.5', 'BTTS Yes + TOTAL Over 2.5', 2.4);
assert.equal(ui.marketDisplayTitle(bttsTotal, 'al'), 'Bet Builder: G/G&+2.5');
assert.equal(ui.marketSelectionLabel(bttsTotal.outcomes[0].name, 'al', bttsTotal.name, 'Arsenal vs Chelsea'), 'BTTS Yes + TOTAL Over 2.5');
assert.equal(ui.marketDisplayTitle(mk('BTTS + Total Goals 2.5', '2.5'), 'al', true),
  'BTTS + Total Goals 2.5', 'translation must retain the exact market line');
const resultBtts = builder('5', '1&G/G', '1X2 1 + BTTS Yes', 4.4);
const chanceBtts = builder('6', '1/X&G/G', 'DC 1X + BTTS Yes', 2.5);
assert.equal(ui.marketDisplayTitle(bttsTotal, 'en'), 'Bet Builder: G/G&+2.5');
assert.equal(ui.marketDisplayTitle(resultBtts, 'en'), 'Bet Builder: 1&G/G');
assert.equal(new Set([doubleChanceTotals[0], bttsTotal, resultBtts, chanceBtts].map(ui.marketGroupKey)).size, 4,
  'different types of combinations must never merge');
assert.equal(doubleChanceTotals.map(x => x.outcomes[0].odds).join(','), '3.1,3.9,4.2',
  'grouping must not modify odds');
assert.equal(doubleChanceTotals.map(x => x.outcomes[0].id).join(','),
  'BB|123|1,BB|123|2,BB|123|3', 'each individual bet stays selectable');
const unknownBuilder = builder('7', 'Custom Rule', 'Unidentified outcome', 5);
assert.equal(ui.betBuilderGroup(unknownBuilder), null,
  'unknown templates must stay separate rather than be incorrectly grouped');
assert.notEqual(ui.marketGroupKey(unknownBuilder), ui.marketGroupKey(doubleChanceTotals[0]));
assert.notEqual(ui.marketGroupKey(mk('Result and total')), ui.marketGroupKey(doubleChanceTotals[0]),
  'original upstream combined markets must not be merged with synthetic builders');
assert.equal(ui.marketGroupKey(mk('Total Corners', '9.5', 0, 'CORNERS', 'g320')),
  ui.marketGroupKey(mk('Total Corners', '10.5', 0, 'CORNERS', 'g320')));
assert.notEqual(ui.marketGroupKey(mk('Total Corners', '9.5', 0, 'CORNERS', 'g320')),
  ui.marketGroupKey(mk('Total Corners', '9.5', 0, 'CORNERS', 'g900')),
  'different provider group IDs must never merge');
for (const name of ['Handicap', 'Asian Handicap', 'Corners. Handicap', 'Asian Corners']) {
  assert.equal(ui.isHandicapMarket(mk(name)), false, name + ' is not unilaterally hidden in the UI');
}
assert.equal(ui.isHandicapMarket(mk('Asian Total')), false);
assert.equal(ui.isHandicapMarket(mk('Total')), false);


// First goal time is a TEN-outcome market. A provider can reuse the same
// technical code for each interval; do not collapse to the last (81-FT).
const goalTimeSelections = [
  ['1-10', 6.0], ['11-20', 6.0], ['21-30', 7.0],
  ['31-40', 8.0], ['41-50', 8.0], ['51-60', 12.0],
  ['61-70', 15.0], ['71-80', 15.0], ['81 - Full Time', 15.0],
  ['No Goal', 5.5],
];
const timingRows = goalTimeSelections.map(([name, price]) => ({
  market_key: 'gGoalTime', market_name: '1st goal time', line: '',
  outcome_key: '1', outcome_name: name, price, board_column: 'other',
}));
const goalTimeMarkets = buildMarkets(timingRows);
assert.equal(goalTimeMarkets.length, 1);
assert.equal(goalTimeMarkets[0].outcomes.length, 10, 'all ten distinct original intervals survive');
assert.deepEqual(goalTimeMarkets[0].outcomes.map(o => o.name),
  goalTimeSelections.map(([name]) => name));
assert.deepEqual(goalTimeMarkets[0].outcomes.map(o => o.price),
  goalTimeSelections.map(([, price]) => price));

const timingFrame = decodePushMessage({
  messageType: 'match-odds',
  data: { matchId: 87654321, oddsGroups: [{
    id: 90010, name: '1st goal time', renderType: 'cols-10',
    outcomes: goalTimeSelections.map(([name]) => name),
    oddsList: goalTimeSelections.map(([name, price], idx) => ({
      id: '12:L:' + (900100 + idx) + ':[90010,[],[0],1,' + idx + ',[]]',
      outcome: '1', name, cf: price, status: 1,
    })),
  }] },
});
assert.equal(timingFrame.rows.length, 10, 'decoder must preserve all ten odds');
assert.deepEqual(new Set(timingFrame.rows.map(r => r.outcomeKey)),
  new Set(goalTimeSelections.map(([name]) => name)),
  'each interval needs its own unique bettable outcome ID');

console.log('Provider names, category grouping and explicit market exclusions passed');
