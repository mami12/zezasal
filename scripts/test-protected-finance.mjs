import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {buildMatchExposure,manualSettlement} from '../server/ledger/financial-monitoring.mjs';
import {compareFinalStatistics,statisticsNeedReview} from '../server/ledger/settlement-review.mjs';
import {hasRequiredSettlementEvidence,updatePendingLine} from '../server/ledger/settler.mjs';
const db=new PGlite();
const database={connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
try{
 await db.exec(LEDGER_SQL);
 const admin={id:randomUUID(),username:'finance-admin'},player=randomUUID(),manager=randomUUID();
 for(const [id,name,role]of [[admin.id,admin.username,'ADMIN'],[player,'finance-player','PLAYER'],[manager,'finance-manager','MANAGER']])
  await db.query('insert into app_user(id,username,password_hash,role,balance)values($1,$2,\'test\',$3,1000)',[id,name,role]);
 const make=async(match=101,outcome='1')=>{
  const id=randomUUID();await db.query('insert into app_ticket(id,user_id,stake,total_odds,potential_payout)values($1,$2,100,5,500)',[id,player]);
  await db.query("insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,odds_at_placement)values($1,$2,'result',$3,$3,'Full Time Result','Home vs Away',5)",[id,match,outcome]);return id;
 };
 const a=await make(),b=await make(101,'2');
 const balance=async()=>Number((await db.query('select balance from app_user where id=$1',[player])).rows[0].balance);
 const decide=(target,status,actor=admin)=>manualSettlement({...target,status,reason:'Official reviewed final statistics',source:'Official final match report'},actor,{database});
 await assert.rejects(decide({ticketId:a},'WON',{id:manager,username:'finance-manager'}),e=>e.status===403);
 await assert.rejects(manualSettlement({ticketId:a,status:'WON'},admin,{database}),e=>e.status===400);
 await decide({matchId:101,marketKey:'result',outcomeKey:'1'},'WON');assert.equal(await balance(),1500);
 assert.equal((await db.query('select status from app_ticket where id=$1',[b])).rows[0].status,'PENDING','opposite outcome unaffected');
 await decide({ticketId:a},'WON');assert.equal(await balance(),1500,'repeat cannot credit twice');
 await decide({ticketId:a},'LOST');assert.equal(await balance(),1000,'reversal posts exact difference');
 await decide({ticketId:a},'PENDING');assert.equal(await balance(),1000);
 assert.equal((await db.query('select status from app_settlement_override where line_id=(select id from app_ticket_line where ticket_id=$1)',[a])).rows[0].status,'PENDING','manual pending remains protected from automatic grading');
 const lineId=(await db.query('select id from app_ticket_line where ticket_id=$1',[a])).rows[0].id;
 assert.equal(await updatePendingLine(lineId,'LOST',a,{database}),0,'automatic grading cannot overwrite a manual pending hold');
 await decide({ticketId:a},'WON');assert.equal(await balance(),1500);
 assert.equal(Number((await db.query('select original_potential_payout from app_ticket where id=$1',[a])).rows[0].original_potential_payout),500);
 assert.equal((await db.query("select count(*)::int as n from app_transaction where type='MANUAL_SETTLEMENT_CORRECTION'")).rows[0].n,3);
 assert.equal((await db.query("select count(*)::int as n from app_admin_audit where action='MANUAL_SETTLEMENT'")).rows[0].n,5);
 const other=await make(102);await db.query("update app_ticket_line set status='WON' where ticket_id=$1",[other]);
 await decide({ticketId:other},'WON');await db.query('update app_user set balance=0 where id=$1',[player]);
 await assert.rejects(decide({ticketId:other},'LOST'),e=>e.status===409);
 assert.equal((await db.query('select status from app_ticket where id=$1',[other])).rows[0].status,'WON','insufficient reversal rolls back everything');
 const review=compareFinalStatistics([
  {provider:'primary',final:true,values:{corners:{home:3,away:2},fouls:{home:7,away:8}}},
  {provider:'second',final:true,values:{corners:{home:4,away:2},fouls:{home:7,away:8}}},
  {provider:'temporary',final:false,values:{fouls:{home:99,away:99}}}
 ],{attempted:['primary','second','temporary'],unavailable:{temporary:'STATS_NOT_FINAL'}});
 assert.equal(review.status,'MANUAL_REVIEW');assert.equal(review.conflicts.corners.second.home,4);assert.deepEqual(review.consensus.fouls,{home:7,away:8});
 const result={home_score:1,away_score:0,corners_home:3,corners_away:2,statistics_review:review};
 assert.equal(statisticsNeedReview({market_name:'Total Corners'},result),true);
 assert.equal(hasRequiredSettlementEvidence({market_name:'Total Corners'},result),false);
 assert.equal(hasRequiredSettlementEvidence({market_name:'Full Time Result'},result),true,'score selections unaffected by corner conflict');
 assert.equal(statisticsNeedReview({market_name:'Total Fouls'},result),false);
 const base={user_id:'u',username:'player',stake:100,original_potential_payout:600,ticket_status:'PENDING',market_key:'result',market_name:'Full Time Result',line:'',outcome_key:'1',outcome_name:'Home',odds_at_placement:2,status:'PENDING'};
 const rows=[{...base,ticket_id:'parlay',logical_id:'parlay',match_id:1,match_name:'A–B'}, {...base,ticket_id:'parlay',logical_id:'parlay',match_id:2,match_name:'C–D'},
  {...base,ticket_id:'single',logical_id:'single',match_id:1,match_name:'A–B',original_potential_payout:200}];
 const exposure=buildMatchExposure(rows);assert.equal(exposure.totals.stake,200);assert.equal(exposure.totals.tickets,2);
 assert.equal(exposure.matches.reduce((n,m)=>n+m.allocatedStake,0),200,'parlay allocated stake never duplicated');
 assert.equal(exposure.matches[0].markets[0].outcomes[0].maxConditionalPayout,800,'conditional liabilities include every accepted ticket once');
 assert.equal(exposure.matches[0].uniqueUsers,1);
 const thirds=buildMatchExposure([1,2,3].map(match_id=>({...base,ticket_id:'thirds',match_id,match_name:'Three legs'})));
 assert.equal(thirds.matches.reduce((n,m)=>n+Math.round(m.allocatedStake*100),0),10000,'allocation retains the final cent across three legs');
 assert.equal(thirds.matches.reduce((n,m)=>n+Math.round(m.markets[0].outcomes[0].allocatedStake*100),0),10000);
 console.log('PASS protected finance: admin-only audited manual market/ticket decisions, idempotent payment/reversal, rollback, precise conflict holds and parlay exposure without duplicate stake');
}catch(error){console.error(error.stack);process.exitCode=1;}finally{await db.close();}
