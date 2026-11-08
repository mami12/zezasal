import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {liveContract,gradeFromAcceptedCounters} from '../server/ledger/live-contract-rules.mjs';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
const line=(market_name,outcome_name='1',sequenceNoneOffered=false)=>({
 market_name,outcome_name,sequenceNoneOffered
});
const counts={card:{home:2,away:1},goal:{home:1,away:0},corner:{home:4,away:2}};
for(const [name,target,event]of [
 ['First Card',1,'card'],['Next Card',4,'card'],['Next Booking',4,'card'],
 ['2nd Card',2,'card'],['First Goal',1,'goal'],['Next Corner',7,'corner']
]){
 const c=liveContract(line(name),{counts});
 assert.equal(c?.kind,'sequence',name);
 assert.equal(c.target,target,name+' ordinal');
 assert.equal(c.event,event,name+' event');
}
assert.equal(liveContract(line('Next Card','No Card'),{counts})?.side,'none');
const now=Date.parse('2026-11-08T13:00:00Z');
const stamp=new Date(now).toISOString();
const match={service:'LIVE',match_time_ms:18*60000,clock_at:stamp,
 score_at:stamp,home_score:0,away_score:0};
const snap={count_home:1,count_away:0,through_minute:18,observed_at:stamp,confirmed_at:stamp};
assert.throws(()=>frozenLiveContract(line('Next Card'),match,now),
 e=>e.code==='MARKET_EVIDENCE_UNSUPPORTED','Missing card count is not a zero count');
const next=frozenLiveContract({...line('Next Card'),raceCardSnapshot:snap},match,now);
assert.deepEqual(next.baseline,{home:1,away:0});
assert.equal(next.target,2);
assert.throws(()=>frozenLiveContract({...line('First Card'),raceCardSnapshot:snap},match,now),
 e=>e.code==='MARKET_EVIDENCE_UNSUPPORTED',
 'Do not sell First Card after a card is already on the confirmed scoreboard');
assert.equal(gradeFromAcceptedCounters({...next,noneOffered:true},
 {teams:{card:{home:1,away:0}},ended:true}),'LOST');
assert.equal(gradeFromAcceptedCounters({...next,noneOffered:false},
 {teams:{card:{home:1,away:0}},ended:true}),'VOID',
 'Two-way Next Card with no following card is refunded');
assert.equal(gradeFromAcceptedCounters({...next,side:'none',noneOffered:true},
 {teams:{card:{home:1,away:0}},ended:true}),'WON');
const execute=async(sql,args)=>{
 if(sql.startsWith('with covered as'))return {rows:[{
  home:0,away:0,total:0,count_home:0,count_away:0,
  through_minute:93,complete:true,
  observed_at:stamp,confirmed_at:stamp,second_poll_at:stamp,
  open_recovery_gap:false
 }]};
 throw Error('Unexpected SQL: '+sql.slice(0,60));
};
for(const [withThird,expected]of [[true,'LOST'],[false,'VOID']]){
 assert.equal(await gradeStoredEventContract({
  id:'00000000-0000-4000-8000-000000000005',match_id:105,
  live_contract:liveContract(line('First Card','1',withThird),{counts:{card:{home:0,away:0}}})
 },{home_score:0,away_score:0,cards_home:0,cards_away:0},{execute}),expected,
 'No event settlement respects the provider quote structure');
}
console.log('PASS first/next/numbered booking contracts, LIVE card baseline, no-card and refund');
