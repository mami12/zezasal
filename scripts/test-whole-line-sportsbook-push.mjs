import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {gradeLine,recalcTicket,settleMatch,isProvenTwoWayTotalPush} from '../server/ledger/settler.mjs';
import {pool} from '../server/db.mjs';

const result={
 home_team:'Home',away_team:'Away',home_score:1,away_score:1,
 half_home_score:1,half_away_score:0,corners_home:6,corners_away:4,
 cards_home:2,cards_away:1,
 statistics:{shots:{home:3,away:2},fouls:{home:7,away:4}}
};
const bet=(market_name,line,outcome_name)=>({market_name,line,outcome_name,outcome_key:outcome_name,builder_legs:null});
for(const [market,line,count] of [
 ['Total Goals','2.0',2],['Total Corners','10.0',10],
 ['Total Cards','3.0',3],['1st Half Total Goals','1.0',1],
 ['Home Team Total Goals','1.0',1],['Total Shots','5.0',5],
 ['Total Fouls','11.0',11]
]){
 for(const choice of ['Over','Under']){
  const decision=gradeLine(bet(market,line,choice),result);
  assert.equal(decision,'VOID',market+' '+choice+' '+line+' must PUSH at '+count);
 }
}
assert.equal(gradeLine(bet('Total Goals','1.5','Over'),result),'WON');
assert.equal(gradeLine(bet('Total Goals','2.5','Over'),result),'LOST');
assert.equal(gradeLine(bet('Total Corners','9.5','Under'),result),'LOST');
assert.equal(gradeLine(bet('Total Cards','3.5','Under'),result),'WON');
assert.equal(gradeLine(bet('Total Goals 3-Way','2.0','Over'),result),'LOST',
 'three-way Over must lose when exact 2 wins');
assert.equal(gradeLine(bet('Total Goals 3-Way','2.0','Under'),result),'LOST');
assert.equal(gradeLine(bet('Total Goals 3-Way','2.0','Exactly 2'),result),'WON');
assert.equal(gradeLine(bet('Total Corners','10.0','Over'),{...result,corners_away:null}),null,
 'Missing corners cannot push or lose a wager');

const db=new PGlite();
try{
 await db.exec(LEDGER_SQL);
 const run=(sql,params=[])=>db.query(sql,params);
 const database={connect:async()=>({query:run,release(){}})};
 const player=(await run(
  "insert into app_user(username,password_hash,balance) values('integer-line-push','test',800) returning id"
 )).rows[0].id;
 const combo=(await run(
  "insert into app_ticket(user_id,stake,total_odds,potential_payout,ticket_type,status) values($1,100,6,600,'COMBO','PENDING') returning id",
  [player]
 )).rows[0].id;
 await run(`insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,odds_at_placement,status)
  values ($1,910,'result','1','Home','Full Time Result','Home vs Away',2,'WON'),
         ($1,911,'total','o','Over','Total Goals','Home vs Away',3,'VOID')`,[combo]);
 const done=await recalcTicket(combo,{database});
 assert.deepEqual([done.status,done.payout],['WON',200],
  'VOID leg carries odds 1 while the remaining winning leg keeps odds 2');
 assert.equal(Number((await run('select balance from app_user where id=$1',[player])).rows[0].balance),1000);
 assert.equal(await recalcTicket(combo,{database}),null,'Financial retry cannot credit twice');
 assert.equal((await run(
  "select count(*)::int as n from app_transaction where reference_id=$1 and type='BET_WON'",[combo]
 )).rows[0].n,1);

 const push=(await run(
  "insert into app_ticket(user_id,stake,total_odds,potential_payout,ticket_type,status) values($1,100,2,200,'SINGLE','PENDING') returning id",
  [player]
 )).rows[0].id;
 await run("insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,odds_at_placement,status) values($1,912,'total','o','Over','Total Goals','Match',2,'VOID')",[push]);
 const refund=await recalcTicket(push,{database});
 assert.deepEqual([refund.status,refund.payout],['VOID',100]);
 assert.equal(Number((await run('select balance from app_user where id=$1',[player])).rows[0].balance),1100);
 assert.equal(await recalcTicket(push,{database}),null);
 assert.equal((await run(
  "select count(*)::int as n from app_transaction where reference_id=$1 and type='BET_REFUND'",[push]
 )).rows[0].n,1);
 // Exercise the ACTUAL final-result settlement path. Historically gradeLine
 // correctly returned VOID but settleMatch discarded it as unsupported.
 const sourceResult={...result,home_score:1,away_score:1};
 assert.equal(isProvenTwoWayTotalPush(bet('Total Goals','2.0','Over'),sourceResult),true);
 assert.equal(isProvenTwoWayTotalPush(bet('Total Goals 3-Way','2.0','Over'),sourceResult),false);
 assert.equal(isProvenTwoWayTotalPush(bet('Total Goals','2.5','Over'),sourceResult),false);
 const originalQuery=pool.query,originalConnect=pool.connect;
 try{
  pool.query=(...args)=>run(...args);
  pool.connect=async()=>({query:run,release(){}});
  await run("insert into app_match_result(match_id,home_team,away_team,home_score,away_score) values(915,'Home','Away',1,1)");
  const actual=(await run(
   "insert into app_ticket(user_id,stake,total_odds,potential_payout,ticket_type,status) values($1,100,2,200,'SINGLE','PENDING') returning id",[player]
  )).rows[0].id;
  await run("insert into app_ticket_line(ticket_id,match_id,market_key,line,outcome_key,outcome_name,market_name,match_name,odds_at_placement,status) values($1,915,'total','2.0','over','Over','Total Goals','Home - Away',2,'PENDING')",[actual]);
  const actualPaid=await settleMatch(915);
  assert.equal(actualPaid.settled,1,'Final-match pass must commit a true push');
  assert.deepEqual(actualPaid.tickets.map(t=>[t.status,t.payout]),[['VOID',100]]);
  assert.equal((await run('select status from app_ticket_line where ticket_id=$1',[actual])).rows[0].status,'VOID');
  assert.equal(Number((await run('select balance from app_user where id=$1',[player])).rows[0].balance),1200);
  assert.equal((await settleMatch(915)).settled,0,'A repeated final pass never refunds again');
  assert.equal((await run("select count(*)::int as n from app_transaction where reference_id=$1 and type='BET_REFUND'",[actual])).rows[0].n,1);
 }finally{pool.query=originalQuery;pool.connect=originalConnect;}
 console.log('PASS whole-line sports pushes and real final-settlement once-only refunds');
}finally{await db.close();}
