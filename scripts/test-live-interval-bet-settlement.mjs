import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';

const db=new PGlite();
const observed=new Date('2026-11-12T20:00:00Z');
const run=(sql,params=[])=>db.query(sql,params);
const id='00000000-0000-4000-8000-000000000006';
let checked=0;
const freeze=(match_id,event,kind,settings={})=>({id,match_id,
 live_contract:{version:1,event,kind,from:1,to:10,...settings}});
const add=async(match,event,key,team,minute)=>{
 await run(`insert into app_match_event_fact
  (match_id,provider,provider_event_id,kind,team,minute,seconds,active)
  values($1,'zizobet',$2,$3,$4,$5,$6,true)`,
  [match,key,event,team,minute,minute*60+12]);
};
const setCoverage=async(match,event,home,away,through)=>{
 await run(`insert into app_match_event_coverage
  (match_id,provider,kind,through_minute,count_home,count_away,complete,observed_at,confirmed_at)
  values($1,'zizobet',$2,$3,$4,$5,false,$6,$6)
  on conflict(match_id,provider,kind) do update set
   through_minute=excluded.through_minute,count_home=excluded.count_home,
   count_away=excluded.count_away,observed_at=excluded.observed_at,
   confirmed_at=excluded.confirmed_at`,[match,event,through,home,away,observed]);
};
const grade=(line)=>gradeStoredEventContract(line,null,{execute:run});
try{
 await db.exec(LEDGER_SQL);
 for(const [event,match] of [['goal',97001],['corner',97002],['card',97003],['foul',97004]]){
  await run(`insert into app_live_event_cursor(match_id,last_seen_at)
      values($1,$2) on conflict(match_id) do update set last_seen_at=excluded.last_seen_at`,
    [match,observed]);
  // Incident before acceptance: the already-observed cumulative count is 1:0.
  await add(match,event,event+'-before','home',2);
  await setCoverage(match,event,1,0,6);
  const after= {entryBaseline:{home:1,away:0},entryClockMinute:6,entryObservedAt:observed.toISOString()};
  const over=freeze(match,event,'window-total',{...after,threshold:0.5,choice:'over'});
  const under=freeze(match,event,'window-total',{...after,threshold:0.5,choice:'under'});
  assert.equal(await grade(over),null,event+' previous event must not prepay the new bet');
  assert.equal(await grade(under),null,event+' previous event must not lose the new bet');
  await add(match,event,event+'-after','away',7);
  await setCoverage(match,event,1,1,8);
  assert.equal(await grade(over),'WON',event+' post-placement event wins the timed Over');
  assert.equal(await grade(under),'LOST',event+' post-placement event loses the timed Under');
  await setCoverage(match,event,1,1,12);
  const leader=freeze(match,event,'interval-leader',{...after,side:'away'});
  assert.equal(await grade(leader),'WON',event+' leader counts only incidents since purchase');
  checked+=5;
 }
 // No new goal during the accepted interval, despite a pre-purchase goal.
 const match=97005,event='goal',prior={entryBaseline:{home:1,away:0},entryClockMinute:6};
 await run('insert into app_live_event_cursor(match_id,last_seen_at) values($1,$2)',[match,observed]);
 await add(match,event,'previous','home',2);
 await setCoverage(match,event,1,0,12);
 assert.equal(await grade(freeze(match,event,'window-total',{...prior,threshold:0.5,choice:'under'})),'WON');
 assert.equal(await grade(freeze(match,event,'window-total',{...prior,threshold:0.5,choice:'over'})),'LOST');
 // First goal in minutes 6-10 asks about goal #1 of the MATCH, not a future
 // in-window goal after purchase. Its first goal was at minute 2.
 const ordinal={id,match_id:match,live_contract:{
  version:1,kind:'nth-time',event:'goal',target:1,from:6,to:10,choice:'team-window',side:'home'}};
 assert.equal(await grade(ordinal),'LOST');
 assert.equal(await grade({...ordinal,live_contract:{...ordinal.live_contract,choice:'none',side:undefined}}),'WON');
 checked+=4;

 // Same global score of 90-0 does not imply 90 goals in a NEW minute range.
 const large=97006;
 await run('insert into app_live_event_cursor(match_id,last_seen_at) values($1,$2)',[large,observed]);
 for(let i=1;i<=90;i++)await add(large,'goal','early-'+i,'home',2);
 await setCoverage(large,'goal',90,0,64);
 const next=freeze(large,'goal','window-total',{from:61,to:70,entryBaseline:{home:90,away:0},threshold:0.5,choice:'over'});
 assert.equal(await grade(next),null,'90 earlier goals cannot win a later window');
 await add(large,'goal','later-goal','away',65);
 await setCoverage(large,'goal',90,1,66);
 assert.equal(await grade(next),'WON','one new goal in minutes 61-70 wins despite 90-0 earlier score');
 checked+=2;
 console.log('PASS '+checked+' LIVE PostgreSQL grading checks: purchased event baselines, four kinds, total-vs-ordinal, and 90-0');
}finally{await db.close();}
