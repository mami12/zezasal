/**
 * Financial acceptance invariant: a real two-condition market can win only
 * when BOTH legs are proved by the same verified, frozen match score.
 * This protects all provider DC+total variants, not one cherry-picked result.
 */
import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {gradeLine,hasRequiredSettlementEvidence,unverifiedCompositeLine} from '../server/ledger/settler.mjs';
import {isHalfComboFamily,parseHalfCombination,gradeHalfCombination} from '../server/ledger/half-combinations.mjs';

const title='Double Chance And Total Goals';
const choice=['1X','12','X2'];
const winners={
 '1X':(h,a)=>h>=a,
 '12':(h,a)=>h!==a,
 'X2':(h,a)=>a>=h
};
const scopes=[
 {name:'',period:0,extract:(h,a)=>[h,a]},
 {name:'1st half. ',period:1,extract:(_h,_a,hh,ha)=>[hh,ha]},
 {name:'2nd half. ',period:2,extract:(h,a,hh,ha)=>[h-hh,a-ha]}
];
const result=(h,a,hh=0,ha=0)=>({
 home_score:h,away_score:a,half_home_score:hh,half_away_score:ha,
 home_team:'Dinoko City FC',away_team:'Soweto Super United FC'
});
let cases=0;
for(const scope of scopes)for(const line of [0.5,1.5,2.5,3.0,4.5])
 for(const dc of choice)for(const variant of ['quoted-market-line','title-suffix','inline-amount']){
  const name=scope.name+title+(variant==='title-suffix'?(' ('+line+')'):'');
  const make=direction=>({
   market_name:name,
   line:variant==='quoted-market-line'?String(line):'',
   period:scope.period,
   outcome_name:dc+' / '+(variant==='inline-amount'?direction+' '+line:direction),
   outcome_key:dc+' / '+(variant==='inline-amount'?direction+' '+line:direction),
   builder_legs:null,
   accepted_contract:{providerPeriod:scope.period},
  });
  const over=make('Over'),under=make('Under');
  assert.equal(isHalfComboFamily(over),true,'Native family recognized '+name);
  const frozenOver=parseHalfCombination(over),frozenUnder=parseHalfCombination(under);
  assert.equal(frozenOver?.kind,'half-combo',JSON.stringify(over));
  assert.equal(frozenUnder?.kind,'half-combo',JSON.stringify(under));
  assert.equal(frozenOver.totalLine,line);
  assert.equal(frozenUnder.totalLine,line);
  for(let h=0;h<=6;h++)for(let a=0;a<=6;a++)
   for(const [hh,ha] of [
      [0,0],[h,a],[Math.floor(h/2),Math.floor(a/2)]
   ].filter(([x,y],i,all)=>all.findIndex(([u,v])=>u===x&&v===y)===i)){
    const score=result(h,a,hh,ha);
    const [partH,partA]=scope.extract(h,a,hh,ha);
    const totals=partH+partA,dcWins=winners[dc](partH,partA);
    const expectedOver=totals===line?'VOID':dcWins&&totals>line?'WON':'LOST';
    const expectedUnder=totals===line?'VOID':dcWins&&totals<line?'WON':'LOST';
    assert.equal(gradeHalfCombination(frozenOver,score),expectedOver);
    assert.equal(gradeHalfCombination(frozenUnder,score),expectedUnder);
    assert.equal(gradeLine(over,score),expectedOver,
      'Native Over must grade both legs: '+JSON.stringify({scope:scope.name,line,dc,h,a,hh,ha}));
    assert.equal(gradeLine(under,score),expectedUnder,
      'Native Under must grade both legs: '+JSON.stringify({scope:scope.name,line,dc,h,a,hh,ha}));
    assert.equal(hasRequiredSettlementEvidence(over,score),true);
    assert.equal(hasRequiredSettlementEvidence(under,score),true);
    assert.equal(gradeLine({...over,live_contract:frozenOver},score),expectedOver,
      'Frozen contract must take precedence over a later parser revision');
    assert.notEqual([gradeLine(over,score),gradeLine(under,score)].filter(v=>v==='WON').length,2,
      'Complementary opposite goal totals can NEVER both win');
    cases++;
   }
 }

const simple=(name,choice,line='')=>({
 market_name:name,outcome_name:choice,outcome_key:choice,line,
 builder_legs:null,accepted_contract:{providerPeriod:0}
});
const live=result(2,0);
assert.equal(gradeLine(simple(title+' (1.5)','12 / Over'),live),'WON');
assert.equal(gradeLine(simple(title+' (1.5)','12 / Under'),live),'LOST');
assert.equal(gradeLine(simple(title+' (1.5)','12 / Over'),result(1,0)),'LOST');
assert.equal(gradeLine(simple(title+' (1.5)','12 / Under'),result(1,0)),'WON');
assert.equal(gradeLine(simple(title+' (1.5)','12 / Over'),result(1,1)),'LOST');
assert.equal(gradeLine(simple(title+' (1.5)','12 / Under'),result(1,1)),'LOST');

// Unknown or conflicting native conditions MUST NOT be graded as a single
// recognized leg. They may be offered and accepted, but settlement is PENDING.
for(const row of [
 simple(title+' (1.5)','12 / Maybe'),
 simple(title+' (1.5)','12 / Over','2.5'),
 simple(title,'12 / Over'),
 simple('Double Chance And Total Goals Special (1.5)','12 / Over','1.5'),
 simple('Match Result And Corners (1.5)','1 / Over','1.5'),
 simple('Who Scores And Total Shots','1 / Over','1.5'),
 simple('Goal Scorer And Total Goals','Player A / Over','1.5'),
 simple('Double Chance With Unknown Prop','12 / Over','1.5'),
]){
 assert.equal(gradeLine(row,live),null,'Incomplete composite cannot be WON/LOST/VOID: '+row.market_name);
 assert.equal(hasRequiredSettlementEvidence(row,live),false);
}
assert.equal(unverifiedCompositeLine(simple('Double Chance And Total Goals Special (1.5)','12 / Over')),true);
// Ordinary non-combo markets retain their independent, established rules.
assert.equal(gradeLine(simple('Double Chance','12'),live),'WON');
assert.equal(gradeLine(simple('Total Goals','Over','1.5'),live),'WON');
assert.equal(gradeLine(simple('Total Goals','Under','1.5'),live),'LOST');
console.log('PASS '+cases+' full-score/half-score complementary DC+totals invariants, frozen terms, unknown composite PENDING, independent markets unchanged.');
