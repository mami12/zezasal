import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {parsePlayerOrdinalScorer,gradePlayerOrdinalScorerFacts} from '../server/ledger/player-ordinal-scorer.mjs';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';

const first=(choice)=>parsePlayerOrdinalScorer({market_name:'First Goalscorer',outcome_name:choice});
const last=(choice)=>parsePlayerOrdinalScorer({market_name:'Last Goal Scorer',outcome_name:choice});
assert.deepEqual([first('Zor, Yasin')?.position,first('Zor, Yasin')?.playerName],
 ['first','Zor, Yasin']);
assert.equal(last('Kiefersauer, Xaver')?.position,'last');
assert.equal(first('No Goalscorer')?.choice,'none');
assert.equal(parsePlayerOrdinalScorer({market_name:'First Half Goalscorer',outcome_name:'Zor, Yasin'}),null);
assert.equal(parsePlayerOrdinalScorer({market_name:'First/Last Goalscorer',outcome_name:'Zor, Yasin'}),null);
assert.equal(liveContract({market_name:'First Goalscorer',outcome_name:'Zor, Yasin'})?.kind,
 'player-ordinal-goal');

const facts=[
 {team:'home',minute:15,seconds:null,player_name:'Yasin Zor',own_goal:false},
 {team:'away',minute:33,seconds:null,player_name:'Xaver Kiefersauer',own_goal:false}
];
assert.equal(gradePlayerOrdinalScorerFacts(first('Zor, Yasin'),facts,{complete:true}),'WON');
assert.equal(gradePlayerOrdinalScorerFacts(last('Kiefersauer, Xaver'),facts,{complete:true}),'WON');
assert.equal(gradePlayerOrdinalScorerFacts(first('No Goalscorer'),facts,{complete:true}),'LOST');
assert.equal(gradePlayerOrdinalScorerFacts(first('No Goalscorer'),[],{complete:true}),'WON');
assert.equal(gradePlayerOrdinalScorerFacts(first('Xaver Kiefersauer'),facts,{complete:true}),null,
 'A player absent from the opening goal could have been an unused substitute');
assert.equal(gradePlayerOrdinalScorerFacts({...first('Xaver Kiefersauer'),
 participationVerified:true},facts,{complete:true}),'LOST');
assert.equal(gradePlayerOrdinalScorerFacts(first('Zor, Yasin'),facts,{complete:false}),null);

const own=[{team:'away',minute:3,player_name:'Own Scorer',own_goal:true},...facts];
assert.equal(gradePlayerOrdinalScorerFacts(first('Zor, Yasin'),own,{complete:true}),'WON',
 'Own goals do not count toward opening player scorer');
assert.equal(gradePlayerOrdinalScorerFacts(first('No Goalscorer'),
 own.filter(e=>e.own_goal===true),{complete:true}),'WON',
 'An own-goal-only match can have no eligible goalscorer');
const unknown=[{team:'home',minute:4,player_name:'Mystery',own_goal:null,
 aiscore_verified:false},...facts];
assert.equal(gradePlayerOrdinalScorerFacts(first('Zor, Yasin'),unknown,{complete:true}),null,
 'Unknown own-goal classification cannot be silently ignored');
const sameMinute=[
 {team:'home',minute:17,seconds:null,player_name:'Yasin Zor',own_goal:false},
 {team:'away',minute:17,seconds:null,player_name:'Xaver Kiefersauer',own_goal:false}
];
assert.equal(gradePlayerOrdinalScorerFacts(first('Zor, Yasin'),sameMinute,{complete:true}),null,
 'No order can be inferred from two simultaneous minute-only incidents');
const secondsKnown=sameMinute.map((e,i)=>({...e,seconds:17*60+i*12}));
assert.equal(gradePlayerOrdinalScorerFacts(first('Zor, Yasin'),secondsKnown,{complete:true}),'WON');

const stamp='2026-11-08T13:31:00Z';
const fakeExecute=async(sql)=>{
 if(sql.startsWith('with covered as'))return {rows:[{
  home:1,away:1,total:2,count_home:1,count_away:1,
  through_minute:92,complete:true,open_recovery_gap:false,
  confirmed_at:stamp,observed_at:stamp,second_poll_at:stamp
 }]};
 if(sql.includes('select minute,seconds,team,player_id'))return {rows:facts};
 throw Error('Unexpected SQL '+sql.slice(0,80));
};
assert.equal(await gradeStoredEventContract({
 id:'00000000-0000-4000-8000-000000000301',match_id:321,
 live_contract:first('Zor, Yasin')
},{home_score:1,away_score:1},{execute:fakeExecute}),'WON',
 'Stored verified player and goal chronology grade the actual FIRST scorer');

 // FIRST scorer can be confirmed before FT; LAST and a NO-GOAL win cannot.
 const earlyExecute=async(sql)=>{
  if(sql.startsWith('with covered as'))return {rows:[{
   home:1,away:1,total:2,count_home:1,count_away:1,
   through_minute:35,complete:false,open_recovery_gap:false,
   confirmed_at:stamp,observed_at:stamp,second_poll_at:stamp
  }]};
  if(sql.includes('select minute,seconds,team,player_id'))return {rows:facts};
  throw Error('Unexpected early LIVE SQL '+sql.slice(0,100));
 };
 const liveWager=(contract)=>({
  id:'00000000-0000-4000-8000-000000000302',match_id:321,live_contract:contract
 });
 assert.equal(await gradeStoredEventContract(liveWager(first('Zor, Yasin')),null,
  {execute:earlyExecute}),'WON','confirmed FIRST scorer is irreversible while match is LIVE');
 assert.equal(await gradeStoredEventContract(liveWager(first('No Goalscorer')),null,
  {execute:earlyExecute}),'LOST','confirmed FIRST scorer disproves the no-scorer choice');
 assert.equal(await gradeStoredEventContract(liveWager(first('Xaver Kiefersauer')),null,
  {execute:earlyExecute}),null,'unverified player participation cannot cause early loss');
 assert.equal(await gradeStoredEventContract(liveWager(last('Kiefersauer, Xaver')),null,
  {execute:earlyExecute}),null,'LAST scorer stays pending before FT');
 
const now=Date.parse('2026-11-08T13:00:00Z'),clockAt=new Date(now).toISOString();
const live={service:'LIVE',match_time_ms:18*60000,
 clock_at:clockAt,score_at:clockAt,home_score:1,away_score:0};
assert.throws(()=>frozenLiveContract({market_name:'First Goalscorer',
 outcome_name:'Zor, Yasin'},live,now),e=>e.code==='MARKET_DECIDED');
console.log('PASS first/last goalscorer, own-goal exclusions, player identity, 45+ evidence, participation and SQL verification');
