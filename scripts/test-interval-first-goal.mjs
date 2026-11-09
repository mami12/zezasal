import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {liveContract,parseIntervalFirstGoal,gradeLiveContract} from '../server/ledger/live-contract-rules.mjs';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';

const quote=(market_name,outcome_name)=>({market_name,outcome_name,line:''});
const no=quote('Who scores goal 1 in minutes 51-55 (5-minute interval)','No goal');
const home=quote('Who scores goal 1 in minutes 56-60 (5-minute interval)','1');
const away=quote('Who scores goal 1 in minutes 56-60 (5-minute interval)','2');
const none=quote('Who scores goal 1 in minutes 56-60 (5-minute interval)','Pa gol');
for(const [offer,from,to,side] of [
 [no,51,55,'none'],[home,56,60,'home'],[away,56,60,'away'],
 [none,56,60,'none']
]){
 const c=parseIntervalFirstGoal(offer);
 assert.deepEqual([c?.kind,c?.from,c?.to,c?.side,c?.ordinal],
  ['interval-first-event',from,to,side,1],'Native first-event interval parses for '+offer.outcome_name);
 assert.deepEqual(liveContract(offer),c);
}
for(const offer of [
 quote('Who scores goal 2 in minutes 56-60 (5-minute interval)','1'),
 quote('Who scores goal 1 in minutes 56-60 (10-minute interval)','1'),
 quote('Who scores goal 1 in minutes 41-45 (5-minute interval)','1'),
 quote('Who scores goal 1 in minutes 86-90 (5-minute interval)','1'),
 quote('Who scores goal 1 in minutes 56-60 (5-minute interval) overtime','1'),
 quote('Who scores goal 1 in minutes 56-60 (5-minute interval)','Unknown')
])assert.equal(parseIntervalFirstGoal(offer),null,'Ambiguous variant not accepted: '+offer.market_name);
const at=Date.parse('2026-11-09T00:00:00.000Z'),time=new Date(at);
const fixture={service:'LIVE',home:'CS Herediano',away:'Inter San Carlos',
 home_score:1,away_score:0,match_time_ms:50.2*60000,
 score_at:time,clock_at:time};
const contract=frozenLiveContract(no,fixture,at);
assert.deepEqual([contract.kind,contract.from,contract.to,contract.side],
 ['interval-first-event',51,55,'none']);
assert.equal(frozenLiveContract(home,{...fixture,match_time_ms:55.2*60000},at).side,'home');
assert.throws(()=>frozenLiveContract(home,{...fixture,match_time_ms:56.1*60000},at),
 /Intervali ka nisur/,
 'A live 56-60 selection must not be accepted after its opening minute');
assert.throws(()=>frozenLiveContract(no,{...fixture,match_time_ms:51.1*60000},at),
 /Intervali ka nisur/);
assert.throws(()=>frozenLiveContract(no,{...fixture,clock_at:new Date(at-60000)},at),
 /fresket|freskë/,
 'A stale live clock must not silently accept a five-minute bet');

const events=[
 {type:'goal',team:'away',id:'prev',minute:10,seconds:620},
 {type:'goal',team:'home',id:'within-home',minute:56,seconds:3366},
 {type:'goal',team:'away',id:'within-away',minute:58,seconds:3490}
];
const base={source:'zizobet',clock:61,events,
 coverage:{goalThrough:61},teams:{goal:{home:1,away:2}},counts:{goal:3}};
assert.equal(gradeLiveContract(parseIntervalFirstGoal(no),base),'WON');
assert.equal(gradeLiveContract(parseIntervalFirstGoal(home),base),'WON',
 'The first goal INSIDE minutes 56-60 is home even though an away goal happened at minute 10');
assert.equal(gradeLiveContract(parseIntervalFirstGoal(away),base),'LOST');
assert.equal(gradeLiveContract(parseIntervalFirstGoal(none),base),'LOST');
assert.equal(gradeLiveContract(parseIntervalFirstGoal(home),{...base,clock:60.5}),null,
 'The full minute 60 must elapse');
assert.equal(gradeLiveContract(parseIntervalFirstGoal(home),{...base,coverage:{goalThrough:59}}),null,
 'Missing event coverage prevents an award');
assert.equal(gradeLiveContract(parseIntervalFirstGoal(home),{...base,events:[
 events[0],{...events[1],seconds:undefined},{...events[2],minute:56,seconds:undefined}
]}),null,'Same-minute score order is not safe without distinct seconds');

const db=new PGlite();
try{
 await db.exec(LEDGER_SQL);
 const execute=(sql,args=[])=>db.query(sql,args),matchId=71999711;
 const user=(await execute("insert into app_user(username,password_hash,balance) values('interval-first-test','isolated',1000) returning id")).rows[0].id;
 const ticket=(await execute("insert into app_ticket(user_id,stake,total_odds,potential_payout,status) values($1,10,2,20,'PENDING') returning id",[user])).rows[0].id;
 const lines=[];
 for(const [offer,c] of [[no,parseIntervalFirstGoal(no)],[home,parseIntervalFirstGoal(home)],
  [away,parseIntervalFirstGoal(away)],[none,parseIntervalFirstGoal(none)]]){
  const r=await execute(`insert into app_ticket_line
   (ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,
    odds_at_placement,live_contract)
    values($1,$2,'zz-interval-test',$3,$3,$4,'CS Herediano vs Inter San Carlos',2,$5::jsonb)
    returning *`,[ticket,matchId,offer.outcome_name,offer.market_name,JSON.stringify(c)]);
  lines.push(r.rows[0]);
 }
 for(const [name,side,minute,seconds] of [
 ['goal-prior','away',10,620],['goal-in-home','home',56,3366],
 ['goal-in-away','away',58,3490]
 ]){
  await execute(`insert into app_match_event_fact
  (match_id,provider,provider_event_id,kind,team,minute,seconds,active)
  values($1,'zizobet',$2,'goal',$3,$4,$5,true)`,
  [matchId,name,side,minute,seconds]);
 }
 await execute(`insert into app_match_event_coverage
 (match_id,provider,kind,through_minute,count_home,count_away,complete,observed_at,confirmed_at)
 values($1,'zizobet','goal',61,1,2,false,$2,$2)`,[matchId,time]);
 await execute("insert into app_live_event_cursor(match_id,last_seen_at) values($1,$2)",[matchId,time]);
 for(const [line,expectation] of lines.map((v,i)=>[v,['WON','WON','LOST','LOST'][i]]))
  assert.equal(await gradeStoredEventContract(line,null,{execute}),expectation,
   'Persistent PostgreSQL evidence must grade '+line.market_name+' '+line.outcome_name);
 await execute("update app_match_event_coverage set through_minute=59 where match_id=$1",[matchId]);
 assert.equal(await gradeStoredEventContract(lines[1],null,{execute}),null,
  'A partly observed interval cannot settle a team selection');
 await execute("update app_match_event_coverage set through_minute=61,count_home=2 where match_id=$1",[matchId]);
 assert.equal(await gradeStoredEventContract(lines[0],null,{execute}),null,
  'Conflicting primary counts must never settle No goal');
 await execute("update app_match_event_coverage set count_home=1 where match_id=$1",[matchId]);
 await execute("update app_match_event_fact set minute=56,seconds=null where match_id=$1 and provider_event_id='goal-in-away'",[matchId]);
 await execute("update app_match_event_fact set seconds=null where match_id=$1 and provider_event_id='goal-in-home'",[matchId]);
 assert.equal(await gradeStoredEventContract(lines[1],null,{execute}),null,
  'Same-minute goals without order evidence cannot pick the first team');
 assert.equal(Number((await execute('select balance from app_user where id=$1',[user])).rows[0].balance),1000,
  'Grading is read-only and cannot move player money');
 console.log('PASS three-way interval first goal 51-55/56-60, strict close, order, coverage, and wallet safety');
}finally{await db.close();}
