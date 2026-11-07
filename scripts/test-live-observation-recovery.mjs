import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createEventEvidenceStore} from '../server/ledger/event-evidence.mjs';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {normalizeLiveFrame,recordWatchedLiveFrame,RECOVERY_TICKETS_SQL} from '../server/ledger/live-observation-store.mjs';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';
import {checkStoredLivePreview,createLiveSettlementPreviews} from '../server/ledger/live-shadow-settlement.mjs';

import {gradeLiveContract} from '../server/ledger/live-contract-rules.mjs';
import {providerTimeline} from '../server/live-event-timeline.mjs';

const now=Date.parse('2026-11-05T21:00:00Z');
const game={Match:{Score:'1:1',MatchTimeExtended:'36:05',CornersTeam1:1,CornersTeam2:0,
 EventStatus:6,YellowCardsTeam1:0,YellowCardsTeam2:0,RedCardsTeam1:0,RedCardsTeam2:0},
 TimeLines:[{id:'g1',type:'score_change',team:1,gt:8},{id:'g2',type:'score_change',team:2,gt:34},
 {id:'c1',type:'corner_kick',team:1,gt:31}]};
const frame=normalizeLiveFrame(game);
assert.equal(frame.counts.goal,2);
assert.equal(frame.counts.corner,1);
assert.equal(frame.coverage.goalThrough,36+5/60);
assert.equal(frame.coverage.cornerThrough,36+5/60);
assert.equal(frame.ended,false);
assert.equal(frame.events.length,3);
// Field layout sampled from the public Zizobet live match detail.
const sameMinuteGame={
 Match:{Score:'1:0',MatchTimeExtended:'46:55',CornersTeam1:1,CornersTeam2:1,EventStatus:4},
 TimeLines:[
  {type:'corner_kick',gt:'47',clk:'46:39',team:'away',pl:null},
  {type:'score_change',gt:'47',clk:'46:40',team:'home',pl:'Lojtari i provës'},
  {type:'corner_kick',gt:'47',clk:'46:15',team:'home',pl:null},
 ],
};
const timed=normalizeLiveFrame(sameMinuteGame);
assert.equal(timed.coverage.cornerThrough,46+55/60);
assert.equal(timed.coverage.goalThrough,46+55/60);
assert.equal(timed.events.find(event=>event.type==='goal').player,'Lojtari i provës');
assert.equal(providerTimeline(123,sameMinuteGame.TimeLines).find(event=>event.type==='goal').player,'Lojtari i provës');
const firstCorner={kind:'sequence',event:'corner',target:1,side:'home'};
assert.equal(gradeLiveContract(firstCorner,timed),'WON');
assert.equal(gradeLiveContract({kind:'race',event:'corner',target:1,side:'away'},timed),'LOST');
const withoutTime=normalizeLiveFrame({...sameMinuteGame,Match:{...sameMinuteGame.Match,MatchTimeExtended:'47:10'},
 TimeLines:sameMinuteGame.TimeLines.map(event=>({...event,clk:'80:00'}))});
assert.equal(gradeLiveContract(firstCorner,withoutTime),null,'unrelated clocks must never break a same-minute tie');
assert.equal(timed.counts.foul,null,'missing fouls are not zero');

const match={service:'LIVE',home_score:1,away_score:0,score_at:new Date(now),clock_at:new Date(now),
 match_time_ms:35*60000,stats:{home:{corners:2},away:{corners:0}},
 raw:{homeTeam:{id:'home'},awayTeam:{id:'away'}}};
assert.equal(frozenLiveContract({market_name:'Next Goal',outcome_name:'2'},match,now).target,2);
assert.equal(frozenLiveContract({market_name:'Next Goal',outcome_name:'Chelsea'},{...match,home:'Arsenal',away:'Chelsea'},now).side,'away');
assert.equal(frozenLiveContract({market_name:'Corner in minutes 36-45',outcome_name:'Yes'},match,now).to,45);
assert.equal(frozenLiveContract({market_name:'Chelsea corner in minutes 36-45',outcome_name:'Yes'},
 {...match,home:'Arsenal',away:'Chelsea'},now).side,'away');
assert.equal(frozenLiveContract({market_name:'Total Goals',outcome_name:'Over',line:'2.5'},match,now).threshold,2.5);
assert.throws(()=>frozenLiveContract({market_name:'Next Goal',outcome_name:'2'},
 {...match,clock_at:new Date(now-120000)},now),/freskëta/);
assert.throws(()=>frozenLiveContract({market_name:'Next Corner',outcome_name:'1'},
 {...match,stats:null},now),/konfirmuar|freskëta|verifikueshëm/);
const uuidA='00000000-0000-4000-8000-000000000001';
const uuidB='00000000-0000-4000-8000-000000000002';
const watch=[
 {id:uuidA,live_contract:{event:'goal'},placed_at:new Date(now-180000)},
 {id:uuidB,live_contract:{event:'corner'},placed_at:new Date(now-180000)}
];
const calls=[];
const database={connect:async()=>({async query(sql,params=[]){
 calls.push({sql,params});
 if(sql.startsWith('select l.id,l.live_contract'))return {rows:watch};
 if(sql.startsWith('select last_seen_at'))return {rows:[{last_seen_at:new Date(now-120000)}]};
 if(sql.startsWith('insert into app_live_event_recovery'))return {rowCount:1};
 if(sql.startsWith('insert into app_live_event_frame'))return {rowCount:1};
 if(sql.startsWith('insert into app_live_event_cursor'))return {rowCount:1};
 // The primary incident writer now persists reconciled provider events and
 // coverage inside this transaction; this mock must understand those writes.
 if(sql.startsWith('select through_minute,complete'))return {rows:[]};
 if(sql.startsWith('select kind from app_match_event_coverage'))return {rows:[]};
 if(sql.startsWith('update app_match_event_fact')||
    sql.startsWith('insert into app_match_event_fact')||
    sql.startsWith('insert into app_match_event_coverage')||
    sql.startsWith('update app_live_event_recovery'))return {rowCount:1};
 if(sql==='begin'||sql==='commit'||sql==='rollback')return {rowCount:0};
 throw new Error('Unexpected statement: '+sql);
 },release(){}})};
const stored=await recordWatchedLiveFrame(123,game,{database,now:()=>now});
assert.deepEqual(stored,{stored:true,recovery:true,watching:2});
assert.equal(calls.filter(x=>x.sql.startsWith('insert into app_live_event_recovery')).length,1);
const targeted=calls.find(x=>x.sql.startsWith('insert into app_live_event_recovery'));
assert.equal(targeted.params[0],123);
assert.deepEqual(targeted.params[3],[uuidA,uuidB]);
assert.deepEqual(targeted.params[4],['goal','corner']);
assert.match(RECOVERY_TICKETS_SQL,/l.id=any\(q.line_ids\)/);
const emptyDatabase={connect:async()=>({async query(sql){
 if(sql.startsWith('select l.id,l.live_contract'))return {rows:[]};
 if(sql==='begin'||sql==='commit')return {rowCount:0};
 throw new Error('Unexpected call for a match without a bet: '+sql);
},release(){}})};
assert.equal((await recordWatchedLiveFrame(555,game,{database:emptyDatabase,now:()=>now})).reason,
 'NO_RELEVANT_TICKETS','No ticket must generate zero history and backup jobs');
let shadowWrites=0,previewClears=0;const next={version:1,kind:'sequence',event:'goal',target:2,side:'away'};
const got=await createLiveSettlementPreviews({now:()=>now,runQuery:async(sql,params)=>{
 if(sql.includes('select l.id as line_id'))return {rows:[
  {line_id:uuidA,ticket_id:'t1',match_id:123,live_contract:next,provider_frame:frame,frame_at:new Date(now),placed_at:new Date(now-1000),open_recovery_gaps:0},
  {line_id:uuidB,ticket_id:'t2',match_id:123,live_contract:next,provider_frame:frame,frame_at:new Date(now),placed_at:new Date(now-1000),open_recovery_gaps:1},
  {line_id:'old-frame',live_contract:next,provider_frame:frame,frame_at:new Date(now-1000),placed_at:new Date(now),open_recovery_gaps:0}
 ]};
 if(sql.startsWith('delete from app_live_settlement_preview')){previewClears++;return {rowCount:1};}
 assert.match(sql,/app_live_settlement_preview/);shadowWrites++;
 assert.equal(params[2],'WON');
 return {rowCount:1};
}});
assert.deepEqual({proposed:got.proposed,held:got.held,mode:got.mode},{proposed:1,held:2,mode:'SHADOW_ONLY'});
assert.equal(shadowWrites,1,'An unresolved backup gap must never create a winning preview');
assert.equal(previewClears,2,'An unresolved backup gap clears any old winning preview');
console.log('PASS targeted per-ticket recovery, frozen next goal, verified frames and shadow-only settlement');

async function simulateLiveMatches(){
 const db=new PGlite();
 try{
  await db.exec(LEDGER_SQL);
  const query=(sql,params=[])=>db.query(sql,params);
  const database={connect:async()=>({query,release(){}})};
  const player=(await query("insert into app_user(username,password_hash,balance) values('sim-live','test',500) returning id")).rows[0].id;
  const ticket=(await query("insert into app_ticket(user_id,stake,total_odds,potential_payout,ticket_type,placed_at) values($1,10,8,80,'COMBO',$2) returning id",[player,new Date(now-1000)])).rows[0].id;
  const fixture={...match,home:'Arsenal',away:'Chelsea',match_time_ms:34*60000,stats:{home:{corners:0},away:{corners:0}}};
  const selections=[
   [123,'Next Goal','Chelsea'],
   [123,'Goal in minutes 35-40','Yes'],
   [123,'Arsenal corner in minutes 35-45','Yes'],
   [123,'Chelsea corner in minutes 35-45','Yes'],
   [123,'Next Corner','Arsenal'],
   [123,'Total Goals','Exactly 2'],
   [456,'Next Goal','Chelsea'],
  ];
  const ids=[];
  for(const [matchId,market,choice] of selections){
   const contract=frozenLiveContract({market_name:market,outcome_name:choice},fixture,now);
   assert.ok(contract,market);
   const result=await query("insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,odds_at_placement,live_contract) values($1,$2,$3,$4,$4,$3,'Arsenal - Chelsea',2,$5) returning id",
    [ticket,matchId,market,choice,JSON.stringify(contract)]);
   ids.push(result.rows[0].id);
  }
  const g1={id:'first-goal',type:'score_change',team:1,gt:12};
  const g2={id:'next-goal',type:'score_change',team:2,gt:36};
  const c1={id:'first-corner',type:'corner_kick',team:1,gt:45};
  const frameAt=(clock,score,corners,events,status=6)=>({
   Match:{MatchTimeExtended:clock,Score:score,CornersTeam1:corners,CornersTeam2:0,EventStatus:status},
   TimeLines:events,
  });
  let elapsed=0;
  const record=(id,frame)=>recordWatchedLiveFrame(id,frame,{database,now:()=>now+elapsed});
  const check=async expected=>{
   await createLiveSettlementPreviews({runQuery:query,now:()=>now+elapsed});
   const result=await query('select line_id,proposed_status from app_live_settlement_preview');
   const byLine=new Map(result.rows.map(row=>[row.line_id,row.proposed_status]));
   assert.deepEqual(ids.map(id=>byLine.get(id)??null),expected);
  };
  const baseline=frameAt('35:00','1:0',0,[g1]);
  await record(123,baseline);
  await record(456,baseline);
  assert.equal((await record(789,baseline)).reason,'NO_RELEVANT_TICKETS');
  await check([null,null,null,null,null,null,null]);

  elapsed=30000;
  await record(123,frameAt('36:10','1:1',0,[g1,g2]));
  await check(['WON','WON',null,null,null,null,null]);

  const saved=(await query('select proposed_status,payload from app_live_settlement_preview where line_id=$1',[ids[1]])).rows[0];
  assert.equal(checkStoredLivePreview(saved).timelineCheck,'AGREES');
  assert.equal(checkStoredLivePreview({...saved,proposed_status:'LOST'}).timelineCheck,'DIFFERS');
  assert.equal(checkStoredLivePreview({...saved,payload:{}}).timelineCheck,'INSUFFICIENT');
  elapsed=60000;
  assert.equal((await record(123,baseline)).stored,true,'A → B → A must retain the rollback as a new observation');
  assert.equal((await record(123,baseline)).stored,false,'Consecutive identical frames can be deduplicated');
  await check([null,null,null,null,null,null,null]);

  elapsed=90000;
  await record(123,frameAt('45:00','1:0',1,[g1,c1]));
  await check([null,'LOST','WON',null,'WON',null,null]);

  elapsed=120000;
  await record(123,frameAt('46:00','1:0',1,[g1,c1]));
  await check([null,'LOST','WON','LOST','WON',null,null]);

  elapsed=180000;
  const g3={id:'third-goal',type:'score_change',team:1,gt:52};
  const g4={id:'fourth-goal',type:'score_change',team:1,gt:56};
  await record(123,frameAt('57:00','3:0',1,[g1,g3,g4,c1]));
  const afterOutage=await record(456,frameAt('46:00','2:1',0,[g1]));
  assert.equal(afterOutage.recovery,true);
  await check(['LOST','LOST','WON','LOST','WON','LOST',null]);
  const recovery=(await query(RECOVERY_TICKETS_SQL,[10])).rows;
  assert.equal(recovery.length,1);
  assert.equal(Number(recovery[0].match_id),456);
  assert.deepEqual(recovery[0].line_ids,[ids.at(-1)]);
  assert.deepEqual(recovery[0].event_types,['goal']);
  assert.equal((await query('select id from app_live_event_frame where match_id=789')).rows.length,0);
  assert.equal((await query('select id from app_live_event_frame where match_id=123')).rows.length,6);
  assert.equal((await query("select id from app_ticket_line where ticket_id=$1 and status='PENDING'",[ticket])).rows.length,ids.length);
  const financial=(await query('select t.status,u.balance,t.potential_payout from app_ticket t join app_user u on u.id=t.user_id where t.id=$1',[ticket])).rows[0];
  assert.deepEqual([financial.status,Number(financial.balance),Number(financial.potential_payout)],['PENDING',500,80]);
  const evidenceStore=createEventEvidenceStore({runQuery:query});
  await evidenceStore.loadEventEvidence(123);
  await query(`insert into app_match_result(match_id,home_score,away_score,finished_at) values
   (123,3,0,now()-interval '49 hours'),
   (800,0,0,now()-interval '23 hours'),
   (801,0,0,now()-interval '25 hours'),
   (802,0,0,now()-interval '49 hours')`);
  for(const id of [123,800,801,802,803]){
   await query("insert into app_match_event_evidence(match_id,payload) values($1,'{}')",[id]);
   await query("insert into app_match_snapshot(match_id,snapshot) values($1,'{}')",[id]);
  }
  await query("update app_ticket_line set status='WON' where match_id=123");
  await query("update app_ticket set status='WON' where id=$1",[ticket]);
  // Keep history retention checks independent from any admin test laboratory.
  assert.equal(Number((await query('select balance from app_user where id=$1',[player])).rows[0].balance),500);
  const pruned=(await evidenceStore.pruneUnbetMatchEvidence()).rows[0];
  assert.deepEqual(pruned,{evidence:2,snapshots:1});
  for(const [table,remaining] of [
   ['app_match_event_evidence',[123,800,803]],
   ['app_match_snapshot',[123,800,801,803]],
  ]){
   const rows=(await query('select match_id from '+table+' order by match_id')).rows;
   assert.deepEqual(rows.map(row=>Number(row.match_id)),remaining);
  }
  console.log('PASS retention: 24h raw evidence, 48h Favorites, historical tickets and unfinished matches protected');
  console.log('PASS SQL simulation: seven simultaneous selections, next goal and corner, minute boundaries, VAR rollback, exact total, selective outage recovery and unchanged wallet');
 }finally{await db.close();}
}
await simulateLiveMatches();
