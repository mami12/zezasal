import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {createZizobetHistoryArchive} from '../server/ledger/zizobet-match-history.mjs';
import {settleVerifiedEventFacts,updatePendingLine,recalcTicket}
 from '../server/ledger/settler.mjs';

const id=8000001000233;
const events=[
 {id:'g1',type:'score_change',team:1,gt:10,clk:'10:03',pl:'A One',isOwnGoal:false},
 {id:'g2',type:'score_change',team:1,gt:22,clk:'22:20',pl:'A Two',isOwnGoal:false},
 {id:'g3',type:'score_change',team:1,gt:39,clk:'39:12',pl:'A Three',isOwnGoal:false},
 {id:'c1',type:'corner_kick',team:1,gt:12,clk:'12:07'},
 {id:'c2',type:'corner_kick',team:2,gt:15,clk:'15:07'},
 {id:'c3',type:'corner_kick',team:1,gt:44,clk:'44:07'},
 {id:'b1',type:'yellow_card',team:1,gt:34,clk:'34:07',cardColor:'yellow',player:'A Two'},
 {id:'f1',type:'foul_committed',team:1,gt:13,clk:'13:07'},
 {id:'f2',type:'foul_committed',team:2,gt:33,clk:'33:07'}
];
const match={Match:{
 GameID:1000233,MatchTimeExtended:'47:30',EventStatus:10,MatchStatusID:10,
 Score:'3:0',CornersTeam1:2,CornersTeam2:1,
 YellowCardsTeam1:1,YellowCardsTeam2:0,RedCardsTeam1:0,RedCardsTeam2:0,
 FoulsTeam1:1,FoulsTeam2:1
 },TimeLines:events,gmk:[{v:44.4}],hprs:[{v:33.3}]};
const fixture={home:'Home',away:'Away',start_at:'2026-11-12T12:00:00Z'};
const pg=new PGlite();
const q=(sql,args=[])=>pg.query(sql,args);
const database={connect:async()=>({query:q,release(){}})};
let now=Date.parse('2026-11-12T12:49:00Z');
try{
 await pg.exec(LEDGER_SQL);
 const archive=createZizobetHistoryArchive({database,now:()=>new Date(now)});
 // NO watched bets and no UI viewers. Two all-match observations must create
 // financial-grade evidence from the same provider facts as the raw archive.
 const first=await archive(id,match,fixture);
 assert.equal(first.stored,true);
 assert.equal(first.confirmedKinds.length,0);
 const initial=(await q('select kind,confirmed_at from app_match_event_coverage where match_id=$1',[id])).rows;
 assert.equal(initial.length,4,'Goals, corners, cards and fouls share the verified fact pipeline');
 assert.ok(initial.every(r=>r.confirmed_at===null),'A single poll is insufficient');
 assert.equal((await q('select count(*)::int as n from app_live_event_cursor where match_id=$1',[id])).rows[0].n,0,
  'All-match archive must not forge the watched-bet gap cursor');
 now+=6000;
 const second=await archive(id,match,fixture);
 assert.equal(second.stored,false,'No duplicate sports summary for an identical provider sample');
 assert.deepEqual(new Set(second.confirmedKinds),new Set(['goal','corner','card','foul']));
 const counts=(await q('select kind,count(*)::int as n from app_match_event_fact where match_id=$1 and active group by kind',[id])).rows;
 assert.deepEqual(Object.fromEntries(counts.map(r=>[r.kind,r.n])),{goal:3,corner:3,card:1,foul:2});
 const proof=(await q('select evidence_observed_at from app_zizobet_match_history where match_id=$1',[id])).rows[0];
 assert.equal(new Date(proof.evidence_observed_at).getTime(),now);
 const user=(await q("insert into app_user(username,password_hash,balance) values('archive-evidence-single-source','test',1000) returning id")).rows[0].id;
 const picks=[
  {kind:'window-total',event:'goal',side:'home',from:0,to:45,choice:'over',threshold:2.5},
  {kind:'race',event:'corner',target:2,side:'home',noneOffered:true},
  {kind:'interval-leader',event:'corner',from:10,to:20,side:'none'},
  {kind:'over',event:'card',side:'home',threshold:0.5},
  {kind:'window',event:'foul',from:10,to:20,choice:true,startExclusive:false},
  {kind:'player-goal',event:'goal',playerName:'A One',choice:true},
  {kind:'player-goal',event:'goal',playerName:'Unseen Player',choice:true}
 ];
 const tickets=[];
 for(let i=0;i<picks.length;i++){
  const ticket=(await q("insert into app_ticket(user_id,stake,total_odds,potential_payout,ticket_type,status,placed_at) values($1,10,2,20,'SINGLE','PENDING','2026-11-12T11:30:00Z') returning id",[user])).rows[0].id;
  const line=(await q("insert into app_ticket_line(ticket_id,match_id,market_key,line,outcome_key,outcome_name,market_name,match_name,odds_at_placement,status,live_contract) values($1,$2,'zz177@e30','','Yes','Yes',$3,'Home v Away',2,'PENDING',$4::jsonb) returning id",
   [ticket,id,'Fixture contract '+i,JSON.stringify(picks[i])])).rows[0].id;
  tickets.push({ticket,line});
 }
 const update=(lineId,status,ticketId)=>updatePendingLine(lineId,status,ticketId,{database});
 const recalc=ticketId=>recalcTicket(ticketId,{database});
 const done=await settleVerifiedEventFacts({runQuery:q,update,recalc,limit:20});
 assert.equal(done.graded,6,'All six independent fixture/count/sequence/player families should grade');
 const statuses=(await q("select status from app_ticket where user_id=$1 order by placed_at,id",[user])).rows.map(r=>r.status);
 assert.equal(statuses.filter(s=>s==='WON').length,6);
 assert.equal(statuses.filter(s=>s==='PENDING').length,1,
  'An absent scorer without participation proof must remain PENDING');
 const paid=Number((await q('select balance from app_user where id=$1',[user])).rows[0].balance);
 assert.equal(paid,1120,'All six winning single tickets credited once');
 assert.equal((await settleVerifiedEventFacts({runQuery:q,update,recalc,limit:20})).graded,0);
 assert.equal(Number((await q('select balance from app_user where id=$1',[user])).rows[0].balance),paid);

 // Corrections are not financially certified until the corrected incident
 // set has been independently observed twice, even across a service restart.
 const corrected={...match,Match:{...match.Match,Score:'2:0'},
  TimeLines:events.filter(e=>e.id!=='g3')};
 now+=9000;
 const correction=await archive(id,corrected,fixture);
 assert.equal(correction.confirmedKinds.includes('goal'),false);
 assert.equal((await q("select active from app_match_event_fact where match_id=$1 and provider_event_id='g3'",[id])).rows[0].active,false);
 assert.equal((await q("select confirmed_at from app_match_event_coverage where match_id=$1 and kind='goal'",[id])).rows[0].confirmed_at,null);
 const resumed=createZizobetHistoryArchive({database,now:()=>new Date(now+=6000)});
 const resampled=await resumed(id,corrected,fixture);
 assert.ok(resampled.confirmedKinds.includes('goal'),
  'Second correction observation can be confirmed even after process restart');

 // A partial timeline with three official goals but only two event objects
 // cannot deactivate or certify a corrected third goal.
 now+=9000;
 const incomplete={...match,TimeLines:match.TimeLines.filter(e=>e.id!=='g3')};
 const missing=await resumed(id,incomplete,fixture);
 assert.equal(missing.verifiedKinds.includes('goal'),false);
 assert.equal((await q("select confirmed_at from app_match_event_coverage where match_id=$1 and kind='goal'",[id])).rows[0].confirmed_at,null,
  'Newer inconsistent goal count must suspend older confirmed proof');
 // Reappearance of the fully reconciled corrected score needs TWO new polls.
 now+=6000;
 assert.equal((await resumed(id,corrected,fixture)).confirmedKinds.includes('goal'),false);
 now+=6000;
 assert.ok((await resumed(id,corrected,fixture)).confirmedKinds.includes('goal'));

 console.log('PASS all-fixture unified facts, two-poll proof, event families, PENDING participation, exactly-once payouts and restart-safe corrections');
}finally{await pg.close();}
