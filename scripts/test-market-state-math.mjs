import assert from 'node:assert/strict';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';
import {liveContract,parseNumberedGoalWindow} from '../server/ledger/live-contract-rules.mjs';
import {assessInterval,verifyLiveIntervalAcceptance} from '../server/ledger/live-interval-acceptance.mjs';
import {primaryLiveCounters} from '../server/ledger/primary-live-counters.mjs';
import {buildSystemColumns} from '../server/ledger/system-columns.mjs';

const at=Date.parse('2026-11-12T20:00:00Z');
const prematch={match_id:1001,service:'PREMATCH',start_at:new Date(at+3600000),
  home:'Alpha',away:'Beta',home_score:null,away_score:null,stats:null};
for(const [market,choice,expected] of [
 ['Race to 7 Corners','1','race'],
 ['Next Goal','None','sequence'],
 ['Who scores goal 1 in minutes 6-10 (5-minute interval)','1','nth-time'],
 ['Total goals in minutes 1-10 (10-minute interval)','Over','window-total'],
 ['Total corners in minutes 11-20 (10-minute interval)','Over','window-total'],
 ['Total cards in minutes 21-30 (10-minute interval)','Over','window-total'],
 ['Total fouls in minutes 31-40 (10-minute interval)','Over','window-total'],
]){
 const contract=frozenLiveContract({market_name:market,outcome_name:choice,
   line:expected==='window-total'?'0.5':''},prematch,at);
 assert.equal(contract?.kind,expected,market);
 if(contract?.baseline)assert.deepEqual(contract.baseline,{home:0,away:0},market);
}
assert.equal(parseNumberedGoalWindow({
 market_name:'Who scores goal 1 in minutes 6-10 (5-minute interval)',outcome_name:'1'
})?.side,'home');
const current={home:0,away:0};
const live=(minute,event='goal',home=0,away=0)=>{
 const observed=new Date(at);
 const side=event==='corner'?'corners':event==='foul'?'fouls':'yellow';
 return {match_id:1001,service:'LIVE',start_at:new Date(at-3600000),
  home:'Alpha',away:'Beta',home_score:event==='goal'?home:0,away_score:event==='goal'?away:0,
  score_at:observed,clock_at:observed,match_time_ms:minute*60000,
  raw:{provider:'ZIZOBET',homeTeam:{id:'home'},awayTeam:{id:'away'}},
  stats:{home:{[side]:home,...(event==='card'?{red:0}:{_unused:undefined}),
    _observedAt:{[side]:observed.toISOString(),...(event==='card'?{red:observed.toISOString()}:{})}},
   away:{[side]:away,...(event==='card'?{red:0}:{_unused:undefined}),
    _observedAt:{[side]:observed.toISOString(),...(event==='card'?{red:observed.toISOString()}:{})}}}
 };
};
const contract=liveContract({market_name:'Total goals in minutes 1-10 (10-minute interval)',
  outcome_name:'Over',line:'0.5'});
assert.equal(contract.kind,'window-total');
assert.equal(assessInterval(contract,{clock:6,windowHome:0,windowAway:0}),'OPEN');
assert.equal(assessInterval(contract,{clock:6,windowHome:1,windowAway:0}),'DECIDED');
assert.equal(assessInterval({...contract,threshold:2.5},{clock:6,windowHome:2,windowAway:0}),'OPEN');
assert.equal(assessInterval({...contract,threshold:2.5},{clock:6,windowHome:3,windowAway:0}),'DECIDED');
assert.equal(assessInterval({...contract,from:80,to:90},{clock:60,windowHome:100,windowAway:0}),'OPEN',
 '100-0 before a later interval cannot decide that later interval');
assert.equal(assessInterval({...contract,from:1,to:10},{clock:11,windowHome:0,windowAway:0}),'DECIDED');

for(const [event,market] of [
 ['goal','Total goals in minutes 1-10 (10-minute interval)'],
 ['corner','Total corners in minutes 1-10 (10-minute interval)'],
 ['card','Total cards in minutes 1-10 (10-minute interval)'],
 ['foul','Total fouls in minutes 1-10 (10-minute interval)'],
]){
 const frame=live(6,event);
 const c=liveContract({market_name:market,outcome_name:'Over',line:'0.5'});
 assert.equal(c?.event,event);
 assert.deepEqual(primaryLiveCounters(frame,event,{at})?.home,0);
 await verifyLiveIntervalAcceptance(c,frame,{at,execute:()=>{throw Error('Must not require history for confirmed zero')}});

 const before=live(6,event,1,0);
 assert.equal(primaryLiveCounters(before,event,{at})?.home,1);
 const snapshot={count_home:1,count_away:0,total_home:1,total_away:0,
    interval_home:1,interval_away:0,color_interval_home:0,color_interval_away:0,
    through_minute:6,observed_at:new Date(at),confirmed_at:new Date(at-1000),
    card_colors_verified:true};
 await assert.rejects(()=>verifyLiveIntervalAcceptance(c,before,{
   at,execute:async()=>({rows:[snapshot]})
  }),error=>error.code==='MARKET_DECIDED',event+' accepted already-hit over threshold');
}
// No incident archive may be silently converted into zero after a nonzero counter.
await assert.rejects(()=>verifyLiveIntervalAcceptance(contract,live(6,'goal',1,0),{
 at,execute:async()=>({rows:[]})
}),error=>error.code==='MARKET_EVIDENCE_UNSUPPORTED');
const firstGoal={version:1,kind:'nth-time',event:'goal',target:1,side:'home',
 choice:'team-window',from:6,to:10};
assert.equal(assessInterval(firstGoal,{clock:0,goalTotal:0}),'OPEN');
assert.equal(assessInterval(firstGoal,{clock:6,goalTotal:0}),'OPEN');
assert.equal(assessInterval(firstGoal,{clock:2,goalTotal:1}),'DECIDED');
assert.equal(assessInterval(firstGoal,{clock:0,goalTotal:100}),'DECIDED');
assert.equal(assessInterval(firstGoal,{clock:11,goalTotal:0}),'DECIDED');

// One fixture can have multiple different markets in one financial column.
const picks=[{matchId:101,outcomeId:'101|result||1'},
 {matchId:101,outcomeId:'101|total|2.5|Over'},
 {matchId:102,outcomeId:'102|result||2'}];
assert.throws(()=>buildSystemColumns(picks),/dy alternativa|njëjti treg/,
  'different markets alone never create an automatic SYSTEM wager');
const options=[...picks,{matchId:101,outcomeId:'101|result||2'}];
const cols=buildSystemColumns(options);
assert.deepEqual(cols.map(col=>col.map(p=>p.outcomeId)),[
 ['101|result||1','101|total|2.5|Over','102|result||2'],
 ['101|result||2','101|total|2.5|Over','102|result||2']
]);
console.log('PASS primary PREMATCH zero and LIVE event window math: goals, corners, cards, fouls, 100-0, ordinal and same-fixture columns');
