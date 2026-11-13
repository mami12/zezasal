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
assert.equal(assessInterval(contract,{clock:6}),'OPEN');
assert.equal(assessInterval({...contract,threshold:2.5},{clock:6}),'OPEN');
assert.equal(assessInterval({...contract,from:80,to:90},{clock:60}),'OPEN',
 '100-0 before a later interval cannot decide that later interval');
assert.equal(assessInterval({...contract,from:1,to:10},{clock:11}),'DECIDED');

for(const [event,market] of [
 ['goal','Total goals in minutes 1-10 (10-minute interval)'],
 ['corner','Total corners in minutes 1-10 (10-minute interval)'],
 ['card','Total cards in minutes 1-10 (10-minute interval)'],
 ['foul','Total fouls in minutes 1-10 (10-minute interval)'],
]){
 const c=liveContract({market_name:market,outcome_name:'Over',line:'0.5'});
 assert.equal(c?.event,event);
 const zero=live(6,event);
 assert.equal(primaryLiveCounters(zero,event,{at})?.home,0);
 const frozenZero=await verifyLiveIntervalAcceptance(c,zero,{at,execute:()=>{throw Error('No history allowed')}});
 assert.deepEqual(frozenZero.entryBaseline,{home:0,away:0});
 assert.equal(frozenZero.entryClockMinute,6);

 // Any already-scored goals/corners/cards/fouls are the PRE-PURCHASE
 // baseline, not an automatic win or an automatic rejection.
 const before=live(6,event,1,0);
 const frozen=await verifyLiveIntervalAcceptance(c,before,{at,execute:()=>{throw Error('No history allowed')}});
 assert.deepEqual(frozen.entryBaseline,{home:1,away:0},market);
 assert.equal(frozen.kind,'window-total');
}
const futureContract={...contract,from:80,to:90};
const highScore=await verifyLiveIntervalAcceptance(futureContract,live(60,'goal',90,0),{at});
assert.deepEqual(highScore.entryBaseline,{home:90,away:0},'90-0 before a new minute window does not decide it');
const noStats={...live(6,'corner',0,0),stats:null};
const snapshot={count_home:2,count_away:1,through_minute:6,
 observed_at:new Date(at),confirmed_at:new Date(at-1000)};
const fallback=await verifyLiveIntervalAcceptance(liveContract({
 market_name:'Total corners in minutes 1-10 (10-minute interval)',outcome_name:'Over',line:'0.5'
}),noStats,{at,execute:async(sql,params)=>{
 assert.match(sql,/app_match_event_coverage/);
 assert.doesNotMatch(sql,/app_match_event_fact/);
 assert.deepEqual(params,[1001,'corner']);
 return {rows:[snapshot]};
}});
assert.deepEqual(fallback.entryBaseline,{home:2,away:1},
 'fallback uses CURRENT confirmed counters only, not incident history');
await assert.rejects(()=>verifyLiveIntervalAcceptance(contract,
 {...live(6,'goal',0,0),score_at:null,stats:null},{
 at,execute:async()=>({rows:[]})
}),error=>error.code==='MARKET_EVIDENCE_UNSUPPORTED',
 'missing score and missing confirmed counters cannot be invented as zero');

const race=frozenLiveContract({market_name:'Race to 7 Corners',outcome_name:'1'},
 live(6,'corner',1,0),at);
assert.equal(race.kind,'race');
assert.deepEqual(race.baseline,{home:1,away:0},
 'Race to X continues from the actual primary cumulative counts');
const later=frozenLiveContract({market_name:'Race to 7 Corners',outcome_name:'1'},
 live(60,'corner',6,1),at);
assert.equal(later.kind,'race');
assert.deepEqual(later.baseline,{home:6,away:1});
assert.throws(()=>frozenLiveContract({market_name:'Race to 7 Corners',outcome_name:'1'},
 live(60,'corner',7,0),at),/përfunduar/i);
const firstGoal={version:1,kind:'nth-time',event:'goal',target:1,side:'home',
 choice:'team-window',from:6,to:10};
const firstFrozen=await verifyLiveIntervalAcceptance(firstGoal,live(6,'goal',0,0),{at});
assert.deepEqual(firstFrozen.entryBaseline,{home:0,away:0});
assert.equal(firstFrozen.entryClockMinute,6);
assert.equal(firstFrozen.target,1,'The match-wide first goal must not become first goal since purchase');
const secondFrozen=await verifyLiveIntervalAcceptance({...firstGoal,target:2},
 live(6,'goal',1,0),{at});
assert.deepEqual(secondFrozen.entryBaseline,{home:1,away:0});
assert.equal(secondFrozen.target,2);

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
