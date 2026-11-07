import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {recordWatchedLiveFrame} from '../server/ledger/live-observation-store.mjs';
import {createLiveSettlementPreviews} from '../server/ledger/live-shadow-settlement.mjs';
import {settleVerifiedLiveProposals} from '../server/ledger/verified-live-settlement.mjs';
import {updatePendingLine,recalcTicket} from '../server/ledger/settler.mjs';

const now=Date.now();
const db=new PGlite();
try{
 await db.exec(LEDGER_SQL);
 const runQuery=(sql,params=[])=>db.query(sql,params);
 const database={connect:async()=>({query:runQuery,release(){}})};
 const player=(await runQuery(
  "insert into app_user(username,password_hash,balance) values('prematch-live-wallet-test','isolated',900) returning id"
 )).rows[0].id;
 const ticket=(await runQuery(
  "insert into app_ticket(user_id,stake,total_odds,potential_payout,ticket_type,status,placed_at) values($1,100,2,200,'COMBO','PENDING',$2) returning id",
  [player,new Date(now-60000)]
 )).rows[0].id;
 const first=(await runQuery(
  `insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,
    match_name,odds_at_placement,status,live_contract)
   values($1,123,'goal','1','1','Next Goal','Home - Away',2,'PENDING',$2::jsonb) returning id`,
  [ticket,JSON.stringify({version:1,kind:'sequence',event:'goal',target:1,side:'home',baseline:{home:0,away:0}})]
 )).rows[0].id;
 const second=(await runQuery(
  "insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,odds_at_placement,status) values($1,456,'result','1','Home','Full Time Result','Another Game',2,'PENDING') returning id",
  [ticket]
 )).rows[0].id;
 const primary={Match:{Score:'1:0',MatchTimeExtended:'10:20',CornersTeam1:0,
  CornersTeam2:0,EventStatus:6},TimeLines:[{id:'g1',type:'score_change',team:1,gt:10,clk:'10:05'}]};
 assert.equal((await recordWatchedLiveFrame(123,primary,{database,now:()=>now-30000})).stored,true);
 const preview=await createLiveSettlementPreviews({runQuery,now:()=>now});
 assert.equal(preview.proposed,1);
 const closeTicket=id=>recalcTicket(id,{database});
 const updateLine=(id,status,tid)=>updatePendingLine(id,status,tid,{database});
 const before=await settleVerifiedLiveProposals({
  runQuery,updateLine,closeTicket,enabled:true,now:()=>now+4500
 });
 assert.equal(before.graded,0,'One observation must never trigger real settlement or payout');
 assert.equal(Number((await runQuery('select balance from app_user where id=$1',[player])).rows[0].balance),900);
 assert.equal((await recordWatchedLiveFrame(123,primary,{database,now:()=>now+15000})).stored,false,
  'An identical independent poll is not a new event; its observation time still verifies state');
 const verified=await settleVerifiedLiveProposals({
  runQuery,updateLine,closeTicket,enabled:true,now:()=>now+16000
 });
 assert.equal(verified.graded,1);
 assert.equal((await runQuery('select status from app_ticket_line where id=$1',[first])).rows[0].status,'WON');
 assert.equal((await runQuery('select status from app_ticket where id=$1',[ticket])).rows[0].status,'PENDING',
  'PREMATCH combo must wait until its unrelated second match wins');
 assert.equal(Number((await runQuery('select balance from app_user where id=$1',[player])).rows[0].balance),900,
  'Do not credit the wallet before every required game wins');
 await runQuery("update app_ticket_line set status='WON' where id=$1",[second]);
 assert.equal((await closeTicket(ticket)).status,'WON');
 assert.equal(Number((await runQuery('select balance from app_user where id=$1',[player])).rows[0].balance),1100);
 assert.equal(await closeTicket(ticket),null,'Recalculation is idempotent');
 assert.equal((await runQuery("select count(*)::int as n from app_transaction where reference_id=$1 and type='BET_WON'",[ticket])).rows[0].n,1,
  'Two checks or retries cannot double-pay');

 // A different accumulator with one LOSING PREMATCH selection closes even
 // though its other match is still pending, and never returns the stake.
 const loss=(await runQuery(
  "insert into app_ticket(user_id,stake,total_odds,potential_payout,ticket_type,status) values($1,100,3,300,'COMBO','PENDING') returning id",[player]
 )).rows[0].id;
 await runQuery(`insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,
 market_name,match_name,odds_at_placement,status) values
 ($1,789,'totals','2.5','Under','Total Goals','Third Game',2,'LOST'),
 ($1,790,'result','1','Home','Full Time Result','Fourth Game',2,'PENDING')`,[loss]);
 const closed=await closeTicket(loss);
 assert.equal(closed.status,'LOST');
 assert.equal(closed.payout,0);
 assert.equal((await runQuery('select status from app_ticket where id=$1',[loss])).rows[0].status,'LOST');
 assert.equal(Number((await runQuery('select balance from app_user where id=$1',[player])).rows[0].balance),1100);
 console.log('PASS real SQL: PREMATCH-to-LIVE two-pass verification, pending combination, final wallet credit once, and early accumulator loss');
}finally{await db.close();}
