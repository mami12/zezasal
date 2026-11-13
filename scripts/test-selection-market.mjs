import assert from 'node:assert/strict';
import {assertDistinctSelectionMarkets, selectionMarketIdentity, toggleMarketSelection}
  from '../server/ledger/selection-market.mjs';
import {buildBetslipColumns} from '../web/src/utils/betslipColumns.ts';

const pick=(outcomeId,extra={})=>({outcomeId,...extra});
for(const key of ['g6257','gBothScore','gCorrectScore','gGoalTime','gCorners','gCards','gPlayer']){
  const home=pick(`100|${key}||1`),draw=pick(`100|${key}||X`),away=pick(`100|${key}||2`);
  const other=pick('101|g6257||1');
  let slip=[home,other];
  slip=toggleMarketSelection(slip,away);
  assert.deepEqual(slip,[away,other],`${key}: new option replaces previous same-market outcome`);
  slip=toggleMarketSelection(slip,draw);
  assert.deepEqual(slip,[draw,other],`${key}: cannot create an extra column with same-market options`);
  slip=toggleMarketSelection(slip,draw);
  assert.deepEqual(slip,[other],`${key}: clicking the selected outcome removes it`);
  assert.throws(()=>assertDistinctSelectionMarkets([home,away]),
    error=>error.status===400&&error.code==='DUPLICATE_MARKET');
}
const over=pick('100|g6379|2.5|Over'),under=pick('100|g6379|2.5|Under');
const line35=pick('100|g6379|3.5|Under');
const half1=pick('100|g6379p1|2.5|Under');
assert.deepEqual(toggleMarketSelection([over,line35,half1],under),[under,line35,half1],
  'Same total line replaces; distinct line and period remain separate contracts');
assert.doesNotThrow(()=>assertDistinctSelectionMarkets([under,line35,half1]));
assert.notEqual(selectionMarketIdentity(over),selectionMarketIdentity(line35));
assert.notEqual(selectionMarketIdentity(over),selectionMarketIdentity(half1));
// IDs and frozen source contracts, never translated names, drive identity.
assert.equal(selectionMarketIdentity(over),selectionMarketIdentity({matchId:100,marketKey:'g6379',line:'2.5'}));
assert.deepEqual(toggleMarketSelection(
 [{...over,matchId:'faked',marketId:'different',marketName:'Lart/Poshte'}],
 {...under,matchId:'fake',marketId:'elsewhere',marketName:'Total Goals'}),
 [{...under,matchId:'fake',marketId:'elsewhere',marketName:'Total Goals'}]);
assert.throws(()=>assertDistinctSelectionMarkets([
 {matchId:100,marketKey:'g6379',line:null},
 {matchId:'100',marketKey:'g6379',line:''}
]),error=>error.code==='DUPLICATE_MARKET');
assert.doesNotThrow(()=>assertDistinctSelectionMarkets([
 {matchId:'100',marketKey:'g1',line:''},
 {matchId:'100',marketKey:'g2',line:'',marketName:'Same display name'}
]));
// Legacy app fixtures sometimes expose a local marketId instead of native ID.
const aliasA=pick('one',{matchId:'100',marketId:'market-local',marketLine:'',period:0});
const aliasB=pick('two',{matchId:'100',marketId:'market-local',period:0});
assert.deepEqual(toggleMarketSelection([aliasA],aliasB),[aliasB]);
const builderOption=(template,line='2.5',period='')=>({
 outcomeId:`BB|100|${template}`,matchId:'100',builderLegs:[
 {marketId:`100|gBtts${period}|`,outcomeId:`100|gBtts${period}||Yes`},
 {marketId:`100|gTotal${period}|${line}`,outcomeId:`100|gTotal${period}|${line}|Over`},
 ]
});
const yesOver=builderOption('template-yes-over');
const noUnder={...builderOption('template-no-under'),builderLegs:[
 {marketId:'100|gTotal|2.5',outcomeId:'100|gTotal|2.5|Under'},
 {marketId:'100|gBtts|',outcomeId:'100|gBtts||No'}
]};
assert.equal(selectionMarketIdentity(yesOver),selectionMarketIdentity(noUnder));
assert.deepEqual(toggleMarketSelection([yesOver],noUnder),[noUnder],
 'Same two source markets in different builder template cannot create parallel columns');
const sameIdRepeated=[over,under,over,line35];
assert.deepEqual(toggleMarketSelection(sameIdRepeated,under),[line35],
 'Clicking a selected option also cleans up old duplicate-market slip state');
assert.deepEqual(toggleMarketSelection(sameIdRepeated,pick('100|g6379|2.5|Exact')),[pick('100|g6379|2.5|Exact'),line35],
 'A new option removes every old duplicate from that market');
// Different markets on the same fixture continue to build a normal COMBO.
const distinct=[
 {outcomeId:'100|1x2||1',matchId:'100',marketId:'100|1x2|',odds:2},
 {outcomeId:'100|btts||Yes',matchId:'100',marketId:'100|btts|',odds:1.8},
 {outcomeId:'101|1x2||2',matchId:'101',marketId:'101|1x2|',odds:2.2}
];
const slip=buildBetslipColumns(distinct);
assert.equal(slip.automaticSystem,false);
assert.equal(slip.columns.length,1);
assert.equal(slip.columns[0].length,3);
const changed=toggleMarketSelection(distinct,{...distinct[0],outcomeId:'100|1x2||X'});
assert.equal(buildBetslipColumns(changed).columns.length,1);
assert.deepEqual(changed.map(v=>v.outcomeId),['100|1x2||X','100|btts||Yes','101|1x2||2']);
console.log('PASS one choice per market/line across the whole slip, builder aliases, same-fixture different markets, no duplicate columns.');
