import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {normalizeLiveFrame} from '../server/ledger/live-observation-store.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';

const frame=(corners,events)=>normalizeLiveFrame({
 Match:{Score:'0:0',MatchTimeExtended:'35:00',CornersTeam1:corners,
  CornersTeam2:0,YellowCardsTeam1:0,YellowCardsTeam2:0,
  RedCardsTeam1:0,RedCardsTeam2:0,EventStatus:6},
 TimeLines:events
});
const awarded={id:'awarded',type:'corner_kick',team:1,gt:12,clk:'12:05',status:'awarded'};
const notTaken={id:'never-taken',type:'corner_kick',team:1,gt:13,clk:'13:05',isTaken:false};
const taken={id:'taken',type:'corner_kick',team:1,gt:14,clk:'14:05',isTaken:true};
const valid=frame(1,[awarded,notTaken,taken]);
assert.equal(valid.events.filter(e=>e.type==='corner').length,1,
 'An awarded or explicitly unexecuted corner does not count');
assert.equal(valid.coverage.cornerThrough,35,'Only the taken corner reconciles with provider tally');
const conflicting=frame(3,[awarded,notTaken,taken]);
assert.equal(conflicting.coverage.cornerThrough,undefined,
 'Conflicting corner count is not proof of a correct timeline');

const db=new PGlite();
try{
 await db.exec(LEDGER_SQL);
 const run=(sql,params=[])=>db.query(sql,params);
 const matchId=7199981,now=new Date();
 for(const [id,team,minute,seconds] of [
  ['kick-1','home',10,605],['kick-2','away',15,905],
  ['kick-3','home',23,1405]
 ]){
  await run(`insert into app_match_event_fact
    (match_id,provider,provider_event_id,kind,team,minute,seconds,active)
    values($1,'zizobet',$2,'corner',$3,$4,$5,true)`,
   [matchId,id,team,minute,seconds]);
 }
 await run(`insert into app_match_event_coverage
  (match_id,provider,kind,through_minute,count_home,count_away,complete,observed_at,confirmed_at)
  values($1,'zizobet','corner',91,2,1,true,$2,$2)`,
  [matchId,now]);
 await run('insert into app_live_event_cursor(match_id,last_seen_at) values($1,$2)',
  [matchId,now]);
 const result={home_score:0,away_score:0};
 const contract=(kind,rest)=>({
  id:'00000000-0000-4000-8000-000000000001',
  match_id:matchId,live_contract:{version:1,kind,event:'corner',...rest}
 });
 const judge=(kind,rest,final=result)=>gradeStoredEventContract(
  contract(kind,rest),final,{execute:run});
 assert.equal(await judge('race',{target:2,side:'home'}),'WON');
 assert.equal(await judge('race',{target:2,side:'away'}),'LOST');
 assert.equal(await judge('race',{target:4,side:'home'}),'VOID',
  'Unreached two-choice Race to X refunds at verified normal conclusion');
 assert.equal(await judge('window',{from:20,to:30,choice:true}),'WON');
 assert.equal(await judge('window',{from:20,to:30,choice:false}),'LOST');
 assert.equal(await judge('interval-leader',{from:20,to:30,side:'home'}),'WON');
 assert.equal(await judge('interval-leader',{from:20,to:30,side:'away'}),'LOST');
 assert.equal(await judge('window-total',{from:20,to:30,choice:'over',threshold:1}),'VOID');
 assert.equal(await judge('window-total',{from:20,to:30,choice:'exact',target:1}),'WON');
 assert.equal(await judge('window-total',{from:20,to:30,choice:'atLeast',target:2}),'LOST');


 // The quoted English ordinal survives acceptance and is the authority for
 // the PostgreSQL event ordinal, not the display translation or live score.
 const at=now.getTime();
 const base={service:'LIVE',home:'Arsenal',away:'Chelsea',home_score:0,away_score:0,
  match_time_ms:5*60000,score_at:now,clock_at:now};
 const first=frozenLiveContract({market_name:'Next Goal 1st',outcome_name:'1'},base,at);
 const second=frozenLiveContract({market_name:'Next Goal 2nd',outcome_name:'2'},base,at);
 assert.equal(first.target,1);assert.equal(second.target,2);
 assert.throws(()=>frozenLiveContract(
  {market_name:'Next Goal 1st',outcome_name:'1'},
  {...base,home_score:1,match_time_ms:20*60000},at),/ndodhur tashmë/,
  'A 1st goal offer cannot be purchased once goal #1 already occurred');
 assert.throws(()=>frozenLiveContract(
  {market_name:'Next Goal 2nd',outcome_name:'2'},
  {...base,home_score:2,match_time_ms:20*60000},at),/ndodhur tashmë/,
  'A 2nd goal offer cannot be reinterpreted as the third next goal');
 assert.equal(frozenLiveContract({market_name:'Next Goal',outcome_name:'2'},
  {...base,home_score:2,match_time_ms:20*60000},at).target,3,
  'Only a genuinely unnumbered Next Goal is relative to the score');

 const user=(await run("insert into app_user(username,password_hash,balance) values('ordinal-sql-test','isolated',1000) returning id")).rows[0].id;
 const ticket=(await run("insert into app_ticket(user_id,stake,total_odds,potential_payout,status,placed_at) values($1,10,5,50,'PENDING',$2) returning id",
  [user,new Date(at-60000)])).rows[0].id;
 const originals=[
  {title:'Next Goal 1st',key:'zz75001@eyJzZXEiOjF9',choice:'1',price:2.1,c:first},
  {title:'Next Goal 2nd',key:'zz75002@eyJzZXEiOjJ9',choice:'2',price:3.2,c:second}
 ];
 const storedLines=[];
 for(const quote of originals){
  const accepted={version:1,providerMarketKey:quote.key,providerMarketName:quote.title,
   providerOutcomeKey:quote.choice,providerOutcomeName:quote.choice,
   line:'',acceptedOdds:quote.price,liveTerms:quote.c};
  const {rows}=await run(`insert into app_ticket_line
   (ticket_id,match_id,market_key,line,outcome_key,outcome_name,market_name,match_name,
    odds_at_placement,live_contract,accepted_contract)
   values($1,$2,$3,'',$4,$4,$5,'Arsenal - Chelsea',$6,$7::jsonb,$8::jsonb) returning *`,
   [ticket,matchId,quote.key,quote.choice,quote.title,quote.price,
    JSON.stringify(quote.c),JSON.stringify(accepted)]);
  storedLines.push(rows[0]);
 }
 assert.deepEqual(storedLines.map(l=>l.market_name),originals.map(q=>q.title));
 assert.deepEqual(storedLines.map(l=>l.live_contract.target),[1,2]);
 assert.deepEqual(storedLines.map(l=>l.accepted_contract.providerMarketKey),
  originals.map(q=>q.key),'Never merge two provider quoted market IDs');
 await run(`insert into app_match_event_fact
  (match_id,provider,provider_event_id,kind,team,minute,seconds,active)
  values ($1,'zizobet','goal-1','goal','home',4,245,true),
         ($1,'zizobet','goal-2','goal','away',22,1335,true)`,[matchId]);
 await run(`insert into app_match_event_coverage
  (match_id,provider,kind,through_minute,count_home,count_away,complete,observed_at,confirmed_at)
  values($1,'zizobet','goal',91,1,1,true,$2,$2)`,[matchId,now]);
 assert.equal(await gradeStoredEventContract(storedLines[0],null,{execute:run}),'WON',
  'Goal #1 belongs to HOME');
 assert.equal(await gradeStoredEventContract(storedLines[1],null,{execute:run}),'WON',
  'Goal #2 belongs to AWAY, independent from the 1st goal');
 assert.equal(await gradeStoredEventContract(
  {...storedLines[1],live_contract:{...second,side:'home'}},null,{execute:run}),'LOST',
  '2nd goal HOME loses when #2 was scored by AWAY');
 assert.equal(Number((await run('select balance from app_user where id=$1',[user])).rows[0].balance),
  1000,'No wallet movement from reading or grading preserved quote identity');

 await run('update app_match_event_coverage set count_home=3 where match_id=$1 and kind=\'corner\'',[matchId]);
 assert.equal(await judge('race',{target:2,side:'home'}),null,
  'No financial decision when accepted incident facts disagree with source tally');
 console.log('PASS real PostgreSQL engine: taken-corner evidence, primary event races/windows/interval totals, unreached race VOID and mismatched-counter PENDING');
}finally{await db.close();}
