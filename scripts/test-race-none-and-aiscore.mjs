import assert from 'node:assert/strict';
import {liveContract,gradeLiveContract,gradeFromAcceptedCounters} from '../server/ledger/live-contract-rules.mjs';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
import {parseAiScoreScorers,enrichPrimaryScorerNames} from '../server/stats-providers/aiscore-scorer-enrichment.mjs';
import {aiscoreFixtureMatches,selectedInformationEndpoints} from '../server/stats-providers/football-information.mjs';

const race=(event,choice,noneOffered=true)=>liveContract({
 market_name:'Which team wins race to 7 '+event,
 outcome_name:choice,raceNoneOffered:noneOffered
});
for(const [market,event] of [['goals','goal'],['corners','corner'],['cards','card']]){
 assert.equal(race(market,'1')?.event,event);
 assert.equal(race(market,'2')?.side,'away');
 assert.equal(race(market,'None')?.side,'none');
 assert.equal(race(market,'Asnjëra')?.side,'none');
 assert.equal(race(market,'X')?.side,'none');
 assert.equal(race(market,'None')?.noneOffered,true);
}
assert.equal(liveContract({market_name:'1st half - Which team wins race to 7 corners',outcome_name:'None'}),null,
 'Half-specific races require a separate period-aware contract');
const evidence=(event,home,away,reached=null,full=true)=>async(sql,args)=>{
 assert.match(sql,/with covered as/);
 const target=7;
 assert.equal(args[7],target);
 return {rows:[{
  home,away,total:home+away,count_home:home,count_away:away,
  through_minute:90,complete:full,open_recovery_gap:false,
  observed_at:'2026-11-08T18:42:00Z',confirmed_at:'2026-11-08T18:41:55Z',
  second_poll_at:'2026-11-08T18:42:00Z',
  race_home_time:reached==='home'?32*60:null,
  race_away_time:reached==='away'?43*60:null
 }]};
};
const result=(home,away)=>({home_score:home,away_score:away,corners_home:home,corners_away:away,cards_home:home,cards_away:away});
const stored=async(event,choice,home,away,reached=null,full=true,noneOffered=true)=>gradeStoredEventContract({
 match_id:1,id:'test-line',live_contract:race(event,choice,noneOffered)
},full?result(home,away):null,{execute:evidence(event,home,away,reached,full)});
for(const event of ['goals','corners','cards']){
 assert.equal(await stored(event,'None',6,5),'WON','No team reaches X, quoted None wins');
 assert.equal(await stored(event,'1',6,5),'LOST','Home loses the three-way race if nobody reaches X');
 assert.equal(await stored(event,'2',6,5),'LOST','Away loses the three-way race if nobody reaches X');
 assert.equal(await stored(event,'1',6,5,null,true,false),'VOID','Two-way race preserves its refund rule');
 assert.equal(await stored(event,'None',7,4,'home'),'LOST');
 assert.equal(await stored(event,'1',7,4,'home'),'WON');
 assert.equal(await stored(event,'2',7,4,'home'),'LOST');
 assert.equal(await stored(event,'None',6,5,null,false),null,'No payout before FT completeness');
}
const prematch={service:'PREMATCH',start_at:'2030-01-01T17:00:00Z',home:'Home',away:'Away'};
assert.equal(frozenLiveContract({market_name:'Which team wins race to 7 corners',
 outcome_name:'None',raceNoneOffered:true},prematch,Date.parse('2026-11-08T12:00:00Z'))?.side,'none');
const time='2026-11-08T17:31:00Z';
const live={service:'LIVE',home:'Home',away:'Away',home_score:0,away_score:0,
 score_at:time,clock_at:time,match_time_ms:31*60000};
const cards={market_name:'Which team wins race to 7 cards',outcome_name:'None',raceNoneOffered:true};
assert.throws(()=>frozenLiveContract(cards,live,Date.parse(time)),
 error=>error.code==='MARKET_EVIDENCE_UNSUPPORTED','Never accept LIVE card race with no verified card count');
assert.equal(frozenLiveContract({...cards,raceCardSnapshot:{count_home:3,count_away:2,
 through_minute:31,observed_at:time,confirmed_at:time}},live,Date.parse(time))?.baseline?.home,3);
const c=race('corners','None');
assert.equal(gradeLiveContract(c,{events:[],clock:90,counts:{corner:0},coverage:{cornerThrough:90}},{ended:true}),'WON');
assert.equal(gradeFromAcceptedCounters({...c,baseline:{home:0,away:0}},
 {teams:{corner:{home:6,away:5}},ended:true}),'WON');

const payload={data:{match:{id:'abcde1234567',home_team:{name:'Home'},away_team:{name:'Away'}},
 events:[{event_type:'goal',team:'home',minute:'24',player:{id:'p1',name:'Goal Scorer'}},
 {event_type:'goal',team:'away',minute:'52',player_name:'Away Scorer'},
 {event_type:'goal',team:'home',minute:'65',own_goal:true,player_name:'Not Scorer'}]}};
assert.equal(aiscoreFixtureMatches(payload,'abcde1234567',{home:'Home',away:'Away'}),true);
assert.equal(aiscoreFixtureMatches(payload,'abcde1234567',{home:'Away',away:'Home'}),false);
assert.equal(selectedInformationEndpoints({aiscore_id:'abcde1234567'},['player']).length,2);
assert.deepEqual(parseAiScoreScorers(payload).map(e=>e.playerName),['Goal Scorer','Away Scorer']);
let modified=0;
const execute=async(sql)=>{
 if(sql.includes('select mapping_status'))return {rows:[{mapping_status:'CONFIRMED'}]};
 if(sql.includes('select provider_event_id'))return {rows:[{provider_event_id:'provider-goal-24'}]};
 if(sql.includes('update app_match_event_fact')){modified++;return {rowCount:1};}
 throw Error('unexpected DB query');
};
assert.deepEqual(await enrichPrimaryScorerNames(123,payload,{execute}),{updated:2,scorers:2});
assert.equal(modified,2,'Only confirmed, uniquely matched goal scorers are saved');
console.log('PASS Race to X 1/2/None for goals corners cards and AiScore confirmed scorer parser');
