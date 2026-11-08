import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {settleVerifiedEventFacts,pendingEventReason} from '../server/ledger/settler.mjs';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';

assert.equal(pendingEventReason({
 live_contract:{kind:'player-goal',event:'goal',playerName:'Example'}
},{home_score:1,away_score:0}),'PLAYER_IDENTITY_OR_PARTICIPATION_UNVERIFIED');
assert.equal(pendingEventReason({
 live_contract:{kind:'sequence',event:'corner',target:2}
},{home_score:1,away_score:0}),'EVENT_ORDER_OR_COVERAGE_UNVERIFIED');

const at=Date.parse('2026-11-08T12:00:00Z');
const prematch={service:'PREMATCH',start_at:'2026-11-09T12:00:00Z',home:'Home',away:'Away'};
assert.throws(()=>frozenLiveContract({
 market_name:'Anytime Goalscorer',outcome_name:'Yes',market_key:'zz5900'
},prematch,at),error=>error?.code==='MARKET_EVIDENCE_UNSUPPORTED',
 'An unidentifiable goalscorer market must fail before the wallet is debited');

const db=new PGlite();
try{
 await db.exec(LEDGER_SQL);
 const query=(sql,params=[])=>db.query(sql,params);
 const player=(await query("insert into app_user(username,password_hash,balance) values('historical-pending-reasons','isolated',1000) returning id")).rows[0].id;
 const ticket=(await query("insert into app_ticket(user_id,stake,total_odds,potential_payout,status) values($1,10,2,20,'PENDING') returning id",[player])).rows[0].id;
 const matchId=89917743;
 await query("insert into app_match_result(match_id,home_team,away_team,home_score,away_score,corners_home,corners_away,cards_home,cards_away,source) values($1,'Home','Away',1,0,2,1,1,0,'RECOVERY')",[matchId]);
 const original={version:1,kind:'sequence',event:'corner',target:2,side:'home'};
 const line=(await query(`insert into app_ticket_line(ticket_id,match_id,market_key,line,outcome_key,outcome_name,market_name,match_name,odds_at_placement,status,live_contract)
 values($1,$2,'zz79100@eyJhIjoxfQ','','1','Home','Next Corner 2nd','Home - Away',2,'PENDING',$3::jsonb) returning id`,
 [ticket,matchId,JSON.stringify(original)])).rows[0];
 const timestamp=new Date();
 await query(`insert into app_match_event_coverage
 (match_id,provider,kind,through_minute,count_home,count_away,complete,observed_at,confirmed_at)
 values($1,'fotmob','corner',91,2,1,true,$2,$2)`,[matchId,timestamp]);
 let supplied=null;
 let result=await settleVerifiedEventFacts({
  runQuery:query,
  grade:async (selection,final)=>{
   supplied=final;
   return null;
  },
  update:async()=>{throw new Error('Must not update a pending financial selection');},
  recalc:async()=>null
 });
 assert.equal(result.examined,1,'Verified historical corner coverage must enter periodic scan');
 assert.equal(result.graded,0);
 assert.equal(Number(supplied.corners_home),2,'Periodic settlement must load final corner totals');
 assert.equal(Number(supplied.cards_home),1,'Periodic settlement must also load final card totals');
 let status=(await query('select status,settlement_reason from app_ticket_line where id=$1',[line.id])).rows[0];
 assert.equal(status.status,'PENDING');
 assert.equal(status.settlement_reason,'EVENT_ORDER_OR_COVERAGE_UNVERIFIED');
 result=await settleVerifiedEventFacts({
  runQuery:query,
  grade:async (_selection,final)=>{
   assert.equal(Number(final.corners_away),1);
   return 'WON';
  },
  update:async(id,state)=>query('update app_ticket_line set status=$2,settlement_reason=null where id=$1 and status=\'PENDING\'',[id,state]).then(r=>r.rowCount),
  recalc:async()=>null
 });
 assert.equal(result.graded,1);
 status=(await query('select status,settlement_reason from app_ticket_line where id=$1',[line.id])).rows[0];
 assert.equal(status.status,'WON');
 assert.equal(status.settlement_reason,null,'Diagnostic clears once the evidence grades the line');
 console.log('PASS historical corner/card FT columns, PENDING reason, clearing on grading, unsupported scorer placement hold');
}finally{await db.close();}
