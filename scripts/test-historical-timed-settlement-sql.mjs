import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {validateHistoricalTimedEvents,persistHistoricalTimedEvents} from '../server/ledger/historical-timed-events.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
import {fotMobTimedIncidents,apiFootballTimedIncidents} from '../server/stats-providers/historical-incidents.mjs';

const history={source:'fotmob',kind:'corner',final:true,complete:true,
 timelineAvailable:true,homeCount:2,awayCount:1,events:[
  {id:'c1',type:'corner',team:'home',minute:10,playerId:'42',playerName:'Corner Taker'},
  {id:'c2',type:'corner',team:'away',minute:15},
  {id:'c3',type:'corner',team:'home',minute:23}
 ]};
assert.ok(validateHistoricalTimedEvents(history));
assert.equal(validateHistoricalTimedEvents({...history,events:[
 {...history.events[0],phase:'Second Half'},...history.events.slice(1)]}),null,
 'A second-half incident reported as minute ten is not a verified absolute minute');
assert.equal(validateHistoricalTimedEvents({...history,events:history.events.slice(1)}),null,
 'Partial timeline must not authorize a negative/positive corner settlement');
assert.equal(validateHistoricalTimedEvents({...history,events:[
  history.events[0],history.events[0],history.events[2]]}),null,
 'Duplicated incident IDs must leave races pending');
assert.equal(validateHistoricalTimedEvents({...history,events:[
  {...history.events[0],injury:2},history.events[1],history.events[2]]}),null,
 'Unknown stoppage semantics are not settled as normal minutes');

const fm=fotMobTimedIncidents([
 {type:'Corner',eventId:17,isHome:true,time:'10'},
 {type:'Card',eventId:18,isHome:false,time:'20',card:'Yellow',player:{id:99,name:'Card Recipient'}}
]);
assert.deepEqual([fm.cornerEvents.length,fm.cardEvents.length],[1,1]);
assert.equal(fm.cardEvents[0].cardColor,'yellow');
assert.equal(fm.cardEvents[0].playerName,'Card Recipient');
assert.equal(fm.cardEvents[0].playerId,'99');
const ap=apiFootballTimedIncidents([
 {type:'Card',detail:'Red Card',team:{id:12},time:{elapsed:42},player:{id:73,name:'Sent Off Player'}}
],{teams:{home:{id:11},away:{id:12}}});
assert.equal(ap.cardEvents[0].team,'away');
assert.equal(ap.cardEvents[0].cardColor,'red');
assert.equal(ap.cardEvents[0].playerName,'Sent Off Player');

const db=new PGlite();
const run=(sql,params=[])=>db.query(sql,params);
const database={connect:async()=>({query:run,release(){}})};
try{
 await db.exec(LEDGER_SQL);
 const id=92820211;
 await run(`insert into app_match_result(match_id,home_team,away_team,
   home_score,away_score,corners_home,corners_away,cards_home,cards_away,source)
   values($1,'Home','Away',0,0,2,1,1,1,'RECOVERY')`,[id]);
 const saved=await persistHistoricalTimedEvents(id,history,{database});
 assert.equal(saved.stored,true);
 assert.deepEqual((await run("select player_id,player_name from app_match_event_fact where match_id=$1 and provider='fotmob' and provider_event_id='c1'",[id])).rows[0],
   {player_id:'42',player_name:'Corner Taker'},'Backup corner actor is durable in PostgreSQL');
 assert.equal((await persistHistoricalTimedEvents(id,history,{database})).reason,'ALREADY_VERIFIED');
 assert.equal((await persistHistoricalTimedEvents(id,{
  ...history,events:[{...history.events[0],minute:11},...history.events.slice(1)]
 },{database})).reason,'TIMELINE_CHANGED');
 const card={source:'apifootball',kind:'card',final:true,complete:true,
  timelineAvailable:true,homeCount:1,awayCount:1,events:[
   {id:'y1',type:'card',team:'home',minute:20,cardColor:'yellow',playerId:'83',playerName:'Booked Player'},
   {id:'r1',type:'card',team:'away',minute:42,cardColor:'red'}
 ]};
 assert.equal((await persistHistoricalTimedEvents(id,card,{database})).stored,true);
 assert.equal((await run("select player_name from app_match_event_fact where match_id=$1 and provider='apifootball' and provider_event_id='y1'",[id])).rows[0].player_name,'Booked Player');
 const result={home_score:0,away_score:0,corners_home:2,corners_away:1,
  cards_home:1,cards_away:1};
 const bet=(event,kind,other)=>({id:'00000000-0000-4000-8000-000000000001',
  match_id:id,live_contract:{version:1,event,kind,...other}});
 const grade=(event,kind,other)=>gradeStoredEventContract(bet(event,kind,other),result,{execute:run});
 assert.equal(await grade('corner','sequence',{target:1,side:'home'}),'WON');
 assert.equal(await grade('corner','sequence',{target:2,side:'away'}),'WON');
 assert.equal(await grade('corner','race',{target:2,side:'home'}),'WON');
 assert.equal(await grade('corner','window',{from:10,to:20,choice:true}),'WON');
 assert.equal(await grade('corner','window',{from:30,to:40,choice:false}),'WON');
 assert.equal(await grade('card','window',{from:19,to:21,choice:true,cardColor:'yellow'}),'WON');
 assert.equal(await grade('card','window',{from:19,to:21,choice:true,cardColor:'red'}),'LOST');
 assert.equal(await grade('corner','window',{
  from:10.25,to:11.25,choice:true,startExclusive:true}),null,
 'Minute-only incidents cannot determine seconds in a rolling contract');
 const wrong={...history,homeCount:3};
 assert.equal((await persistHistoricalTimedEvents(id+1,wrong,{database})).stored,false);
 const conflicting={...result,corners_away:2};
 assert.equal(await gradeStoredEventContract(bet('corner','sequence',{target:1,side:'home'}),
  conflicting,{execute:run}),null,'Disagreement with final totals cannot change the wallet');
 console.log('PASS historical corners/cards SQL: Next Corner, Race, windows, card colours, duplicates, conflicts and rolling holds');
}finally{await db.close();}
