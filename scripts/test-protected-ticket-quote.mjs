import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {recalcTicket} from '../server/ledger/settler.mjs';
import {getTicketWithLines} from '../server/ledger/bets.mjs';
const db=new PGlite();await db.exec(LEDGER_SQL);
const database={connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
const runQuery=(...args)=>db.query(...args);
try{
 const user=randomUUID();await db.query("insert into app_user(id,username,password_hash,role,balance)values($1,'quote-player','test','PLAYER',900)",[user]);
 for(const status of ['LOST','WON','VOID']){
  const id=randomUUID();await db.query('insert into app_ticket(id,user_id,stake,total_odds,potential_payout)values($1,$2,100,5,500)',[id,user]);
  await db.query("insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,odds_at_placement,status)values($1,77,'result','1','Home','Full Time Result','Home vs Away',5,$2)",[id,status]);
  const before=Number((await db.query('select balance from app_user where id=$1',[user])).rows[0].balance);
  await recalcTicket(id,{database});await recalcTicket(id,{database});
  const ticket=await getTicketWithLines(id,{runQuery,consolidate:false});
  assert.equal(ticket.status,status);assert.equal(ticket.potentialPayout,500);assert.equal(ticket.potentialPayoutIsEstimated,false);
  assert.equal(ticket.actualPayout,status==='WON'?500:status==='VOID'?100:0);
  assert.equal(Number((await db.query('select balance from app_user where id=$1',[user])).rows[0].balance),before+ticket.actualPayout,'settlement remains exact and idempotent');
  await db.query('update app_ticket set original_potential_payout=0 where id=$1',[id]);
  assert.equal((await getTicketWithLines(id,{runQuery,consolidate:false})).potentialPayout,500,'accepted quote is immutable');
 }
 console.log('PASS protected potential winnings: original500 retained for loss/win/refund; actual payout separate; no duplicate credits');
}finally{await db.close();}
