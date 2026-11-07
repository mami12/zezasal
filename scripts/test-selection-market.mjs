import assert from 'node:assert/strict';
import { assertDistinctSelectionMarkets, selectionMarketIdentity, toggleMarketSelection } from '../server/ledger/selection-market.mjs';

const pick = (outcomeId, extra = {}) => ({ outcomeId, ...extra });
for (const key of ['g6257', 'gBothScore', 'gCorrectScore', 'gGoalTime', 'gCorners', 'gCards', 'gPlayer']) {
  const home = pick(`100|${key}||1`), draw = pick(`100|${key}||X`), away = pick(`100|${key}||2`);
  const other = pick('101|g6257||1');
  let slip = [home, other];
  slip = toggleMarketSelection(slip, away);
  assert.deepEqual(slip, [away, other], `${key}: second option replaces first in place`);
  slip = toggleMarketSelection(slip, draw);
  assert.deepEqual(slip, [draw, other], `${key}: rapid 1→2→X keeps only the latest option`);
  assert.deepEqual(toggleMarketSelection(slip, draw), [other], 'clicking the selected option removes it');
  assert.throws(() => assertDistinctSelectionMarkets([home, away]), error => error.status === 400 && error.code === 'DUPLICATE_MARKET');
}

const over = pick('100|g6379|2.5|Over'), under = pick('100|g6379|2.5|Under');
const differentLine = pick('100|g6379|3.5|Under');
const differentPeriod = pick('100|g6379p1|2.5|Under');
assert.deepEqual(toggleMarketSelection([over, differentLine, differentPeriod], under), [under, differentLine, differentPeriod]);
assert.doesNotThrow(() => assertDistinctSelectionMarkets([under, differentLine, differentPeriod]));
assert.notEqual(selectionMarketIdentity(over), selectionMarketIdentity(differentLine));
assert.notEqual(selectionMarketIdentity(over), selectionMarketIdentity(differentPeriod));
// Neither display-language changes nor forged browser IDs may evade the guard.
assert.throws(() => assertDistinctSelectionMarkets([
  { ...over, matchId: 'forged', marketId: 'other', marketName: 'Lart/Poshtë' },
  { ...under, matchId: 'different', marketId: 'changed', marketName: 'Total Goals' },
]), error => error.code === 'DUPLICATE_MARKET');
assert.equal(selectionMarketIdentity(over), selectionMarketIdentity({ matchId: 100, marketKey: 'g6379', line: '2.5' }));
assert.throws(() => assertDistinctSelectionMarkets([
  { matchId: 100, marketKey: 'same-provider-id', line: null },
  { matchId: '100', marketKey: 'same-provider-id', line: '' },
]), error => error.code === 'DUPLICATE_MARKET');
assert.doesNotThrow(() => assertDistinctSelectionMarkets([
  { matchId: 100, marketKey: 'g111', line: '' },
  { matchId: 100, marketKey: 'g222', line: '', marketName: 'Same display name' },
]));
const template = '00000000-0000-4000-8000-000000000001';
const builder = pick(`BB|100|${template}`);
assert.equal(selectionMarketIdentity(builder), selectionMarketIdentity({ matchId: '100', marketKey: `BB:${template}`, line: '' }));
assert.equal(selectionMarketIdentity(builder), selectionMarketIdentity({ matchId: '100', marketId: `BB|100|${template}|market` }));
assert.throws(() => assertDistinctSelectionMarkets([builder, builder]), error => error.code === 'DUPLICATE_MARKET');
const builderOption=(template,line='2.5',period='')=>({
  outcomeId:`BB|100|${template}`,matchId:'100',builderLegs:[
    {marketId:`100|gBtts${period}|`,outcomeId:`100|gBtts${period}||Yes`},
    {marketId:`100|gTotal${period}|${line}`,outcomeId:`100|gTotal${period}|${line}|Over`},
  ],
});
const yesOver=builderOption('template-yes-over');
const noUnder={...builderOption('template-no-under'),builderLegs:[
  {marketId:'100|gTotal|2.5',outcomeId:'100|gTotal|2.5|Under'},
  {marketId:'100|gBtts|',outcomeId:'100|gBtts||No'},
]};
assert.equal(selectionMarketIdentity(yesOver),selectionMarketIdentity(noUnder),'builder pair identity ignores selection outcomes and constituent order');
assert.deepEqual(toggleMarketSelection([yesOver],noUnder),[noUnder],'another option of a grouped builder market replaces the first');
assert.throws(()=>assertDistinctSelectionMarkets([yesOver,noUnder]),error=>error.code==='DUPLICATE_MARKET');
const resolvedBuilder={matchId:'100',marketKey:'BB:saved-template',line:'',builderLegs:[
  {match_id:100,market_key:'gBtts',line:'',outcome_key:'No'},
  {match_id:100,market_key:'gTotal',line:'2.5',outcome_key:'Under'},
]};
assert.equal(selectionMarketIdentity(yesOver),selectionMarketIdentity(resolvedBuilder),'browser and authoritative server builder legs identify the same source-market pair');
assert.doesNotThrow(()=>assertDistinctSelectionMarkets([yesOver,builderOption('different-line','3.5'),builderOption('first-half','2.5','p1')]));
const resultTotal={...builderOption('result-total'),builderLegs:[
  {marketId:'100|gResult|',outcomeId:'100|gResult||1'},yesOver.builderLegs[1],
]};
assert.doesNotThrow(()=>assertDistinctSelectionMarkets([yesOver,resultTotal,pick('100|gBtts||Yes')]));
// Context also supports opaque IDs from local fixtures/legacy API clients.
assert.deepEqual(toggleMarketSelection([
  { outcomeId: 'one', matchId: '100', marketId: 'opaque', marketLine: '', period: 0 },
], { outcomeId: 'two', matchId: '100', marketId: 'opaque', period: 0 }), [
  { outcomeId: 'two', matchId: '100', marketId: 'opaque', period: 0 },
]);
console.log('PASS one selection per exact market: all outcome types replace, repeated clicks toggle, identities ignore labels/forged metadata, lines/periods/provider groups stay distinct');
