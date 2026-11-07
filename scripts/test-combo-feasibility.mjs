import assert from 'node:assert/strict';
import { automaticComboTemplates } from '../server/ledger/automatic-combos.mjs';
import { canComboStillWin, isImpossibleLiveCombination } from '../server/ledger/combo-feasibility.mjs';
import { isDecidedLiveOutcome } from '../server/ledger/decided-markets.mjs';
const wins=(leg,h,a)=> {
  const r=h>a?'1':h<a?'2':'X';
  return leg.market==='1X2'?leg.outcome===r:leg.market==='DC'?leg.outcome.includes(r):leg.market==='BTTS'?(leg.outcome==='Yes')===(h>0&&a>0):leg.outcome==='Over'?h+a>Number(leg.line):h+a<Number(leg.line);
};
let checked=0;
for(const template of automaticComboTemplates()) for(let h=0;h<=8;h++) for(let a=0;a<=8;a++) {
  let expected=false;
  for(let fh=h;fh<=18&&!expected;fh++) for(let fa=a;fa<=18;fa++) if(template.legs.every(leg=>wins(leg,fh,fa))){expected=true;break;}
  assert.equal(canComboStillWin(template.legs,h,a),expected,`${template.name} from ${h}-${a}`);
  checked++;
}
const match={status:'LIVE',homeTeam:'Arsenal',awayTeam:'Chelsea',homeScore:1,awayScore:2};
const market={name:'Result and Total Goals',outcomeName:'Home And Under 3.5',period:0};
assert.equal(isImpossibleLiveCombination(match,market),true);
assert.equal(isDecidedLiveOutcome(match,market),true);
assert.equal(isImpossibleLiveCombination(match,{...market,outcomeName:'Home And Under 5.5'}),false);
assert.equal(isImpossibleLiveCombination(match,{...market,outcomeName:'Away And Under 3.5'}),false);
assert.equal(isImpossibleLiveCombination(match,{name:'Double Chance and Total Goals',outcomeName:'1X And Under 3.5'}),true);
assert.equal(isImpossibleLiveCombination(match,{name:'Double Chance and Total Goals',outcomeName:'X2 And Under 3.5'}),false);
assert.equal(isImpossibleLiveCombination({...match,score_at:null},market),false,'unconfirmed placeholder score is not evidence');
assert.equal(isImpossibleLiveCombination({...match,status:'PREMATCH'},market),false);
assert.equal(isImpossibleLiveCombination(match,{...market,period:2}),false,'aggregate score must not grade a second-half contract');
assert.equal(isImpossibleLiveCombination(match,{...market,name:'First Half Result and Total'}),false);
assert.equal(isImpossibleLiveCombination(match,{...market,outcomeName:'opaque-code'}),false,'unknown contracts cannot be guessed');
assert.equal(isImpossibleLiveCombination({...match,homeScore:null},market),false);
assert.equal(isImpossibleLiveCombination(match,{name:'Bet Builder: 1 + Under 3.5',outcomeName:'1X2 1 + TOTAL Under 3.5'}),true);
assert.equal(isImpossibleLiveCombination(match,{name:'Total Goals',outcomeName:'Under 3.5'}),false);
for(const name of ['Winner and Both Teams to Score','Result / BTTS','Result with BTTS']) {
  assert.equal(isImpossibleLiveCombination({...match,homeScore:0,awayScore:1},{name,outcomeName:'X/No'}),true,name);
  assert.equal(isImpossibleLiveCombination({...match,homeScore:0,awayScore:1},{name,outcomeName:'Away To Nil'}),false,name);
}
assert.equal(isImpossibleLiveCombination(match,{...market,line:'',outcomeName:'Home And Under'}),false,'missing goal line cannot be guessed as zero');
assert.equal(canComboStillWin([{market:'1X2',outcome:'X'},{market:'BTTS',outcome:'No'}],0,0),true);
assert.equal(canComboStillWin([{market:'1X2',outcome:'X'},{market:'BTTS',outcome:'No'}],0,1),false);
console.log(`PASS live combo feasibility: ${checked} independent future-score oracle cases, native/synthetic contracts, unknown scores and period boundaries`);
