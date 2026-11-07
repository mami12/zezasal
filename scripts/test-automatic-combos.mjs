import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {
  automaticComboTemplates, comboSignature, isCompatibleComboPair,
  multipliedComboPrice, COMBO_PRICE_LIMIT, isSameGameComboLine,
} from '../server/ledger/automatic-combos.mjs';
import {
  decorateMatches, findLeg, mergeComboTemplates, builderId, parseBuilderId,
} from '../server/ledger/bet-builders.mjs';
import { gradeLine } from '../server/ledger/settler.mjs';

const leg = (market, outcome, line = '') => ({ market, outcome, line });
const result = leg('1X2', '1'), over = leg('TOTAL', 'Over', '2.5');
const templates = automaticComboTemplates();
assert.ok(templates.length > 50, 'automatic families include result/BTTS, result/total, DC/total and BTTS/total');
assert.equal(new Set(templates.map(t => t.id)).size, templates.length);
assert.equal(new Set(templates.map(t => comboSignature(t.legs))).size, templates.length);
const reloaded = (await import('../server/ledger/automatic-combos.mjs?isolated-reload')).automaticComboTemplates();
assert.deepEqual(reloaded.map(t => [t.id, comboSignature(t.legs)]), templates.map(t => [t.id, comboSignature(t.legs)]),
  'automatic IDs are stable across module reloads and independent of fixture/price');
for (const template of templates) {
  assert.equal(template.active, true);
  assert.equal(template.automatic, true);
  assert.equal(template.legs.length, 2);
  assert.equal(isCompatibleComboPair(template.legs), true);
  assert.deepEqual(parseBuilderId(builderId('1497', template.id)), { matchId: '1497', templateId: template.id });
  assert.equal(comboSignature(template.legs), comboSignature([...template.legs].reverse()));
}

// Independent score matrix verifies that every automatically offered contract
// has the exact corresponding production settlement behavior, including DC.
const names = {'1X2':'1X2',DC:'Double Chance',BTTS:'Both Teams to Score',TOTAL:'Total'};
const winsAt = (selection, home, away) => {
  const result = home > away ? '1' : home < away ? '2' : 'X';
  switch (selection.market) {
    case '1X2': return selection.outcome === result;
    case 'DC': return selection.outcome === '1X' ? home >= away
      : selection.outcome === 'X2' ? away >= home : home !== away;
    case 'BTTS': return selection.outcome === 'Yes' ? home > 0 && away > 0 : home === 0 || away === 0;
    case 'TOTAL': return selection.outcome === 'Over' ? home + away > Number(selection.line) : home + away < Number(selection.line);
    default: throw new Error('unrecognized test contract');
  }
};
for (const template of templates) {
  const frozen = {builder_legs:template.legs.map(selection => ({
    market_name:names[selection.market],outcome_key:selection.outcome,outcome_name:selection.outcome,line:selection.line,
  }))};
  for (let home = 0; home <= 8; home++) for (let away = 0; away <= 8; away++) {
    const expected = template.legs.every(selection => winsAt(selection,home,away)) ? 'WON' : 'LOST';
    assert.equal(gradeLine(frozen,{home_score:home,away_score:away,home_team:'Home',away_team:'Away'}),expected,
      `frozen ${template.name} settlement at ${home}-${away}`);
  }
}

for (const pair of [
  [result, over],
  [leg('1X2', 'X'), leg('BTTS', 'No')],
  [leg('DC', '1X'), over],
  [leg('BTTS', 'Yes'), leg('TOTAL', 'Over', '2.5')],
]) assert.equal(isCompatibleComboPair(pair), true, JSON.stringify(pair));
for (const pair of [
  [], [result], [result, over, leg('BTTS', 'No')],
  [result, leg('1X2', '2')],
  [result, leg('DC', '1X')],
  [result, leg('TOTAL', 'Under', '0.5')],
  [leg('BTTS', 'Yes'), leg('TOTAL', 'Under', '1.5')],
  [leg('BTTS', 'Yes'), leg('TOTAL', 'Over', '0.5')],
  [leg('BTTS', 'Yes'), leg('TOTAL', 'Over', '1.5')],
  [leg('DC', '12'), leg('TOTAL', 'Over', '0.5')],
  [leg('1X2', 'X'), leg('TOTAL', 'Under', '0.5')],
  [leg('BTTS', 'Maybe'), over], [result, leg('TOTAL', 'Over', '2.7')],
]) assert.equal(isCompatibleComboPair(pair), false, JSON.stringify(pair));

assert.equal(multipliedComboPrice([{ price: 4.31 }, { price: 2.41 }]), 10.39);
assert.equal(multipliedComboPrice([{ outcome: { odds: 1.23456 } }, { outcome: { odds: 2.34567 } }]), 2.90,
  'constituent prices freeze at the same four decimal places used by stored ticket lines');
assert.equal(multipliedComboPrice([{ price: 1.0001 }, { price: 1.5 }]), 1.50,
  'the final offered combo quote uses only two decimals');
assert.equal(multipliedComboPrice([{ price: 1.25 }, { price: 1.7 }]), 2.13,'a half-cent product rounds half-up');
assert.equal(multipliedComboPrice([{ price: 4.31 }, { price: 5.16 }]), 22.24,'long products become the two-decimal quote accepted by the wallet');
assert.equal(multipliedComboPrice([{ price: 2.10005 }, { price: 2 }]), 4.20,
  'source prices also round exact decimal halves before the product is calculated');
assert.equal(multipliedComboPrice([{ price: 20 }, { price: 50 }]), COMBO_PRICE_LIMIT);
for (const parts of [[], [{price:2}], [{price:2},{price:3},{price:4}],
  [{price:1},{price:2}], [{price:0},{price:2}], [{price:-2},{price:2}],
  [{price:NaN},{price:2}], [{price:Infinity},{price:2}], [{price:2},{price:null}],
  [{price:50},{price:20.01}], [{price:1e308},{price:1e308}],
]) assert.equal(multipliedComboPrice(parts), null);

const baseTemplate = templates.find(t => comboSignature(t.legs) === comboSignature([result, over]));
assert.ok(baseTemplate);
const saved = { ...baseTemplate, id: 'd25e4512-2700-4314-a2c5-109950d375e0', automatic: false };
const merged = mergeComboTemplates([saved, { ...saved, active: false }, { ...saved, legs: [result, leg('TOTAL', 'Under', '0.5')] }]);
assert.equal(merged.filter(t => comboSignature(t.legs) === comboSignature(saved.legs)).length, 1);
assert.equal(merged.find(t => comboSignature(t.legs) === comboSignature(saved.legs)).id, saved.id,
  'a saved exact contract is not duplicated by its automatic equivalent');

const market = (name, type, line, entries) => ({
  id: `${name}:${line}`, name, marketType: type, line, period: 0, status: 'ACTIVE',
  outcomes: entries.map(([code, odds]) => ({ id: `${name}:${line}:${code}`, code, name: code, odds, status: 'ACTIVE' })),
});
const full = () => ({ id: '1497', status: 'PREMATCH', homeTeam: 'Home', awayTeam: 'Away', isSuspended: false, markets: [
  market('1X2', '1X2', '', [['1', 4.31], ['X', 3.5], ['2', 2.3]]),
  market('Double Chance', 'OTHER', '', [['1X', 1.6], ['12', 1.3], ['X2', 1.9]]),
  market('Both Teams to Score', 'OTHER', '', [['Yes', 2.41], ['No', 1.8]]),
  market('Total', 'OVER_UNDER', '2.5', [['Over', 1.9], ['Under', 1.8]]),
] });
const combos = match => match.markets.filter(m => String(m.id).startsWith('BB|'));
const decorate = async (match, extra = {}) => {
  await decorateMatches([match], { templates, settings: { combosEnabled: true }, ...extra });
  return combos(match);
};
const projected = full();
const eligible = await decorate(projected);
assert.ok(eligible.length > 10);
const offered = eligible.find(m => m.outcomes[0].id === builderId(projected.id, baseTemplate.id));
assert.ok(offered);
assert.equal(offered.outcomes[0].odds, 8.19);
assert.deepEqual(offered.builderLegs, [
  { marketId: '1X2:', outcomeId: '1X2::1', odds: 4.31 },
  { marketId: 'Total:2.5', outcomeId: 'Total:2.5:Over', odds: 1.9 },
]);
assert.equal((await decorate(projected)).length, eligible.length, 'repeated projection removes stale synthetic offers before rebuilding');

const compactBoard = full();
const originalSources = structuredClone(compactBoard.markets);
const boardOffers = await decorate(compactBoard,{includeAutomatic:false,templates:[saved,...templates]});
assert.equal(boardOffers.length,1,'list responses retain manually configured builders without expanding automatic combo families');
assert.equal(boardOffers[0].outcomes[0].id,builderId(compactBoard.id,saved.id));
assert.deepEqual(compactBoard.markets.filter(m=>!String(m.id).startsWith('BB|')),originalSources,
  'compact decoration preserves every provider source market and price');
assert.equal((await decorate(full())).length,eligible.length,'full match detail continues to offer every eligible automatic combo');
await decorate(compactBoard,{includeAutomatic:false,settings:{combosEnabled:false}});
assert.equal(combos(compactBoard).length,0,'global OFF applies to compact list responses as well');

for (const missing of ['Double Chance', 'Total', '1X2', 'Both Teams to Score']) {
  const match = full();
  const removed = match.markets.find(m => m.name === missing);
  match.markets = match.markets.filter(m => m !== removed);
  const offered = await decorate(match);
  assert.ok(offered.length < eligible.length);
  assert.ok(offered.every(m => m.builderLegs.every(l => l.marketId !== removed.id)),
    `missing ${missing} cannot appear as any combo constituent`);
  if (missing === 'Double Chance') assert.ok(offered.every(m => !/^DC\s/.test(m.outcomes[0].name)));
  if (missing === 'Total') assert.ok(offered.every(m => !m.outcomes[0].name.includes('TOTAL')));
}

for (const modify of [
  match => { match.markets[0].status = 'SUSPENDED'; },
  match => { match.markets[0].outcomes.find(o => o.code === '1').status = 'SUSPENDED'; },
  match => { match.markets[3].status = 'SUSPENDED'; },
  match => { match.markets[3].outcomes.find(o => o.code === 'Over').status = 'SUSPENDED'; },
  match => { match.markets[0].outcomes.find(o => o.code === '1').odds = null; },
]) {
  const match = full(); modify(match);
  await decorate(match);
  assert.equal(combos(match).some(m => m.outcomes[0].id === builderId(match.id, baseTemplate.id)), false,
    'provider/admin/risk suspension or an invalid constituent price removes its combo');
}
for (const patch of [{isSuspended:true}, {status:'ENDED'}, {status:'CANCELLED'}]) {
  assert.equal((await decorate({ ...full(), ...patch })).length, 0);
}

for (const name of ['First Half Total', 'Second Half Total', 'Team Total', 'Home Total', 'Away Total', 'Total Corners', 'Total Cards', 'Player Total', 'Asian Total']) {
  const match = full(); match.markets[3].name = name;
  assert.equal(findLeg(match, over), null, `do not confuse ${name} with full-match goals`);
  assert.ok((await decorate(match)).every(m => !m.outcomes[0].name.includes('TOTAL')));
}
for (const period of [1, 2, 3]) {
  const match = full(); match.markets.forEach(m => { m.period = period; });
  assert.equal((await decorate(match)).length, 0, 'period-specific contracts cannot become full-time combos');
}
const unspecified = full(); unspecified.markets[3].line = '';
assert.equal(findLeg(unspecified, over), null, 'the goals line must be supplied explicitly');
const differentLine = full(); differentLine.markets[3].line = '3.5';
assert.equal(findLeg(differentLine, over), null);

const live = { ...full(), status: 'LIVE', homeScore: 2, awayScore: 1, scoreAt: new Date().toISOString() };
assert.equal((await decorate(live)).length, 0,
  'confirmed LIVE goals decide BTTS and 2.5 totals, removing their combos');
assert.equal((await decorate({ ...full(), status: 'LIVE', homeScore: 0, awayScore: 0, scoreAt: new Date().toISOString() })).length, eligible.length);
assert.equal((await decorate({ ...full(), status: 'LIVE', homeScore: 2, awayScore: 1, scoreAt: null })).length, eligible.length,
  'unconfirmed placeholder scores must not prune markets');
assert.equal((await decorate({ ...full(), homeScore: 2, awayScore: 1 })).length, eligible.length,
  'prematch is not incorrectly pruned using a LIVE-only rule');

const overflow = full(); overflow.markets[0].outcomes[0].odds = 40; overflow.markets[3].outcomes[0].odds = 30;
assert.equal((await decorate(overflow, {templates:[baseTemplate]})).length, 0, 'products above the price cap are never offered');
const impossible = {...baseTemplate, legs:[result, leg('TOTAL','Under','0.5')]};
assert.equal((await decorate(full(), {templates:[impossible]})).length, 0);

const disabled = full();
await decorate(disabled);
disabled.markets.push(market('Result and Total', 'OTHER', '', [['Home And Over 2.5', 5.5]]));
for (const alias of ['Winner and Both Teams to Score','Result / BTTS','Result and Both Score','Result with BTTS']) {
  assert.equal(isSameGameComboLine({marketName:alias}),true, `native combo policy recognizes ${alias}`);
  disabled.markets.push(market(alias,'OTHER','',[['Home And Yes',3.5]]));
}
await decorate(disabled, {settings:{enabled:false, combosEnabled:false}});
assert.equal(combos(disabled).length, 0);
assert.ok(disabled.markets.every(m => !isSameGameComboLine({marketName:m.name})),
  'OFF removes same-game combo offers, including provider-native combo markets');
assert.equal(disabled.markets.length, 4, 'ordinary base markets stay available while combos are off');
assert.equal((await decorate(full(), {settings:{enabled:false,combosEnabled:true}})).length, eligible.length,
  'combos can remain enabled independently of LIVE risk');

// Slow template SQL must not timestamp older source prices as newer than
// a socket update delivered during that wait. This gate exercises the actual
// async lookup, without any production pool connection or database access.
let enterTemplateRead;
const entered = new Promise(resolve=>{enterTemplateRead=resolve;});
let releaseTemplateRead;
const templateGate = new Promise(resolve=>{releaseTemplateRead=resolve;});
let readStartedAt;
const timestamped = full();
const pendingDecoration = decorateMatches([timestamped],{
  settings:{combosEnabled:true},
  executor:async()=>{
    readStartedAt=Date.now(); enterTemplateRead();
    await templateGate;
    return {rows:[]};
  },
});
await entered;
const socketDuringReadAt=Date.now();
await new Promise(resolve=>setTimeout(resolve,20));
releaseTemplateRead();
await pendingDecoration;
assert.equal(combos(timestamped).length,eligible.length);
for (const combo of combos(timestamped)) {
  const quotedAt=Date.parse(combo.builderQuotedAt);
  assert.ok(quotedAt<=readStartedAt && quotedAt<=socketDuringReadAt,
    'a source quote timestamp precedes template SQL wait so newer socket prices remain eligible');
}

console.log(`PASS ${templates.length} automatic combo contracts: stable IDs, exact real legs, eligibility, price products/caps, suspensions, full-time scope, live pruning, compatibility and global OFF`);
