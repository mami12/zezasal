/**
 * Financial acceptance invariant: a real two-condition market can win only
 * when BOTH legs are proved by the same verified, frozen match score.
 * This protects all provider DC+total variants, not one cherry-picked result.
 */
import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {gradeLine,hasRequiredSettlementEvidence,unverifiedCompositeLine,gradeHeldNativeCombo} from '../server/ledger/settler.mjs';
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

// The two real-world FT 0-1 tickets cannot both stay PENDING once a verified
// result is saved. Historical NATIVE_FINAL_RULE_UNMAPPED snapshots are also
// recoverable, but ONLY if the immutable original quote can be proved.
const final01=result(0,1);
const quotedCases=[
 ['Matchbet and Totals (2.5)','Away and under','WON'],
 ['Matchbet and Totals (2.5)','Away and over','LOST'],
 ['Matchbet and Totals (2.5)','Draw and under','LOST'],
 ['Matchbet and both teams to score','Draw / Yes','LOST'],
 ['Matchbet and both teams to score','Away / No','WON'],
 ['Matchbet and both teams to score','Away / Yes','LOST'],
 ['Matchbet and both teams to score','Draw / No','LOST'],
 ['Matchbet and both teams to score','Home / Yes','LOST'],
 ['Double Chance And Total Goals (1.5)','12 / Over','LOST'],
 ['Double Chance And Total Goals (1.5)','12 / Under','WON'],
];
const historical=(line,hold='NATIVE_FINAL_RULE_UNMAPPED')=>({
 ...line,market_key:'zz998@frozen',outcome_key:line.outcome_name,period:0,
 accepted_contract:{
  version:1,providerMarketName:line.market_name,providerOutcomeName:line.outcome_name,
  providerMarketKey:'zz998@frozen',providerOutcomeKey:line.outcome_name,
  providerPeriod:0,line:line.line,sourceProviderId:'ZIZOBET',
  homeTeamName:'Dinoko City FC',awayTeamName:'Soweto Super United FC',
  settlementHold:hold
 }
});
for(const [market,selection,expected] of quotedCases){
 const row=simple(market,selection);
 assert.equal(isHalfComboFamily(row),true,'Every provider combined family must be identified');
 assert.equal(gradeLine(row,final01),expected,market+' / '+selection);
 assert.equal(hasRequiredSettlementEvidence(row,final01),true);
 for(const hold of ['NATIVE_FINAL_RULE_UNMAPPED','NATIVE_HALF_COMBO_UNMAPPED','NATIVE_CONTRACT_REVIEW']){
  const stored=historical(row,hold);
  assert.equal(gradeHeldNativeCombo(stored,final01),expected);
  assert.equal(gradeLine(stored,final01),expected,'A recovered held ticket is gradeable from its original exact quote');
  assert.equal(hasRequiredSettlementEvidence(stored,final01),true);
  assert.equal(gradeLine({...stored,accepted_contract:{...stored.accepted_contract,
    providerOutcomeKey:'unrelated'}},final01),null,'Tampered provider code cannot recover');
  assert.equal(gradeLine({...stored,accepted_contract:{...stored.accepted_contract,
    line:'17.5'}},final01),null,'Changed provider numeric threshold cannot recover');
  assert.equal(gradeLine({...stored,accepted_contract:{...stored.accepted_contract,
    sourceProviderId:'OTHER'}},final01),null,'Unknown provider cannot inherit recovery');
 }
}
assert.equal(gradeLine(historical(simple('Unknown Special','Unknown Option')),final01),null);
assert.equal(hasRequiredSettlementEvidence(historical(simple('Unknown Special','Unknown Option')),final01),false);
assert.equal(gradeLine(historical(simple('Matchbet and Totals (2.5)','Away and under'),'NATIVE_PLAYER_HISTORY_UNVERIFIED'),final01),null);

// Every combined 1X2+totals and 1X2+BTTS must obey both conditions for
// a grid of verified full-time scores, not just the exact customer ticket.
let matchbetCases=0;
for(let h=0;h<7;h++)for(let a=0;a<7;a++)
 for(const outcome of ['Home','Away','Draw'])for(const direction of ['over','under']){
  const score=result(h,a),total=h+a,winning=h>a?'Home':h<a?'Away':'Draw';
  const expected=winning===outcome&&(direction==='over'?total>2.5:total<2.5)?'WON':'LOST';
  const row=simple('Matchbet and Totals (2.5)',outcome+' and '+direction);
  assert.equal(gradeLine(row,score),expected,JSON.stringify({h,a,outcome,direction}));
  matchbetCases++;
 }
for(let h=0;h<7;h++)for(let a=0;a<7;a++)
 for(const outcome of ['Home','Away','Draw'])for(const yes of ['Yes','No']){
  const score=result(h,a),winning=h>a?'Home':h<a?'Away':'Draw';
  const expected=winning===outcome&&((h>0&&a>0)===(yes==='Yes'))?'WON':'LOST';
  const row=simple('Matchbet and both teams to score',outcome+' / '+yes);
  assert.equal(gradeLine(row,score),expected,JSON.stringify({h,a,outcome,yes}));
  matchbetCases++;
 }

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
console.log('PASS '+cases+' DC-total plus '+matchbetCases+' Matchbet scoring-grid/half-score complementary DC+totals invariants, frozen terms, unknown composite PENDING, independent markets unchanged.');
