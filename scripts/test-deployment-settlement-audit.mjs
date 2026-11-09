import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {auditDeployment,QUOTED_SQL,PENDING_SQL,EVIDENCE_SQL} from './audit-deployment-settlement.mjs';

for(const sql of [QUOTED_SQL,PENDING_SQL,EVIDENCE_SQL]){
 assert.match(sql.trim(),/^(with|select)\b/i);
 assert.doesNotMatch(sql,/\b(?:update|delete|insert|drop|alter|truncate)\s+(?:app_|into\b)/i);
}
const db=new PGlite();
try{
 await db.exec(LEDGER_SQL);
 const query=(sql,args=[])=>db.query(sql,args);
 await query("insert into app_provider_market_definition(provider_id,scope,native_market_id,native_market_name,definition) values('zizobet','LIVE','11','Next Goal','{}'::jsonb),('zizobet','LIVE','99','Unquoted Market','{}'::jsonb)");
 await query("insert into app_provider_offer_current(match_id,market_key,line,outcome_key,market_name,outcome_name,provider_id,native_market_id,native_outcome_id,price,period) values(1,'zz11@x','','1','Next Goal','1','zizobet','11','goal-home',2,0)");
 await query("insert into app_provider_offer_change(match_id,market_key,line,outcome_key,market_name,outcome_name,provider_id,native_market_id,native_outcome_id,price,suspended,period) values(1,'zz11@x','','1','Next Goal','1','zizobet','11','goal-home',2,false,0)");
 await query("insert into app_provider_offer_change(match_id,market_key,line,outcome_key,market_name,outcome_name,provider_id,native_market_id,native_outcome_id,price,suspended,period) values(2,'zz12@x','','2','Next Goal (OT only!)','2','zizobet','12','ot-away',3,false,0)");
 const user=(await query("insert into app_user(username,password_hash,balance) values('isolated-audit-player','dummy',1000) returning id")).rows[0].id;
 const ticket=(await query("insert into app_ticket(user_id,stake,total_odds,potential_payout,status,placed_at) values($1,10,2,20,'PENDING',now()) returning id",[user])).rows[0].id;
 await query("insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,odds_at_placement,live_contract,settlement_reason) values($1,1,'zz11@x','1','1','Next Goal','Home vs Away',2,$2::jsonb,'EVENT_ORDER_OR_COVERAGE_UNVERIFIED')",[ticket,JSON.stringify({kind:'sequence',event:'goal',side:'home',target:1})]);
 await query("insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,odds_at_placement) values($1,2,'zz12@x','2','2','Next Goal (OT only!)','Other Home vs Other Away',3)",[ticket]);
 await query("insert into app_match_result(match_id,home_team,away_team,home_score,away_score) values(1,'Home','Away',2,0)");
 await query("insert into app_match_event_fact(match_id,provider,provider_event_id,kind,team,minute,seconds,active) values(1,'zizobet','g1','goal','home',12,725,true)");
 await query("insert into app_match_event_coverage(match_id,provider,kind,through_minute,count_home,count_away,complete,observed_at,confirmed_at) values(1,'zizobet','goal',90,2,0,true,now(),now())");
 const report=await auditDeployment({execute:query,maxVariants:30,pageSize:1});
 assert.equal(report.readOnly,true);
 assert.equal(report.complete,true);
 assert.equal(report.sampledGroupedRows,3);
 assert.equal(report.distinctQuoteVariants,2,'Historical and current duplicate must not be double-counted');
 assert.equal(report.sourceRows.current,1);
 assert.equal(report.sourceRows.history,2);
 assert.equal(report.definitions.neverQuoted,1);
 assert.equal(report.pending.lines,2);
 assert.equal(report.pending.missingContract,1);
 assert.equal(report.pending.missingFinal,1);
 assert.equal(report.pending.noPrimaryConfirmation,0,'Only a frozen event contract is counted');
 assert.equal(report.ticketStatusConsistency.wonWithLostOrPendingLeg,0);
 assert.equal(report.ticketStatusConsistency.lostWithoutLostLeg,0);
 assert.equal(report.ticketStatusConsistency.pendingWithoutPendingLeg,0);
 assert.equal(report.dryRun.examined,2);
 assert.equal(report.dryRun.statuses.WON,0,
  'Mismatched primary incidents and legacy OT lines must never auto-win');
 assert.equal(report.dryRun.statuses.PENDING,2);
 assert.equal(report.incidentEvidence[0].mismatches,1,
  'A provider count must be compared against actually persisted event facts');
 assert.ok(report.riskExamples.some(r=>r.market==='Next Goal (OT only!)'&&r.category==='DANGER_WRONG_RESULT'));
 assert.equal(Number((await query('select balance from app_user where id=$1',[user])).rows[0].balance),1000);
 const tiny=await auditDeployment({execute:query,maxVariants:1,pageSize:1});
 assert.equal(tiny.complete,false);
 assert.equal(tiny.offerTruncated,true,'Never call a capped sample an exhaustive audit');
 assert.equal(tiny.pendingTruncated,true);
 console.log('PASS real-schema read-only quote-history, pending-ticket, primary-incident, cap and financial invariants');
}finally{await db.close();}
