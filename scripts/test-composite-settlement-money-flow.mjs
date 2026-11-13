/**
 * Full settlement integration: four contradictory/correlated user reports,
 * verified FT 0-1, original quoted terms and real isolated SQL wallet writes.
 * No live provider calls and no production balances are accessed.
 */
import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pool} from '../server/db.mjs';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {SCHEMA_SQL} from '../server/schema.mjs';
import {settleMatch} from '../server/ledger/settler.mjs';

const db=new PGlite();
await db.exec(LEDGER_SQL);await db.exec(SCHEMA_SQL);
const original={query:pool.query,connect:pool.connect};
pool.query=(sql,params)=>db.query(sql,params);
pool.connect=async()=>({query:(sql,params)=>db.query(sql,params),release(){}});
const userId=randomUUID(),matchId=8000075159999;
const home='Dinoko City FC',away='Soweto Super United FC';
const cases=[
 {booking:'D128ECE5',market:'Matchbet and Totals (2.5)',pick:'Away and under',odds:1.04,want:'WON',hold:true,payout:104},
 {booking:'5482F6CF',market:'Matchbet and both teams to score',pick:'Draw / Yes',odds:5.20,want:'LOST',hold:true,payout:0},
 {booking:'A54865BA',market:'Double Chance And Total Goals (1.5)',pick:'12 / Over',odds:5.90,want:'LOST',hold:false,payout:0},
 {booking:'3053412F',market:'Double Chance And Total Goals (1.5)',pick:'12 / Under',odds:1.18,want:'WON',hold:false,payout:118},
 {booking:'UNKNOWN',market:'Unknown Compound Special',pick:'A + B',odds:2.20,want:'PENDING',hold:true,payout:0},
];
try{
 await db.query('insert into app_user(id,username,password_hash,role,balance) values($1,$2,$3,$4,$5)',
   [userId,'isolated-integrity-test','test-only','PLAYER',1000-cases.length*100]);
 await db.query('insert into app_match_result(match_id,home_team,away_team,home_score,away_score,source) values($1,$2,$3,$4,$5,$6)',
   [matchId,home,away,0,1,'FEED']);
 for(let index=0;index<cases.length;index++){
  const row=cases[index],ticketId=randomUUID(),lineId=randomUUID(),
   marketKey='zz'+(80000+index)+'@frozen',line='',
   accepted={
    version:1,providerMarketName:row.market,providerOutcomeName:row.pick,
    providerMarketKey:marketKey,providerOutcomeKey:row.pick,
    sourceProviderId:'ZIZOBET',providerPeriod:0,line,
    homeTeamName:home,awayTeamName:away,
    settlementHold:row.hold?'NATIVE_FINAL_RULE_UNMAPPED':null
   };
  await db.query('insert into app_ticket(id,booking_code,user_id,stake,total_odds,potential_payout,status) values($1,$2,$3,$4,$5,$6,$7)',
    [ticketId,row.booking,userId,100,row.odds,100*row.odds,'PENDING']);
  await db.query(`insert into app_ticket_line
    (id,ticket_id,match_id,market_key,line,outcome_key,outcome_name,
     market_name,match_name,odds_at_placement,accepted_contract,status)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
    [lineId,ticketId,matchId,marketKey,line,row.pick,row.pick,
     row.market,home+' vs '+away,row.odds,JSON.stringify(accepted),'PENDING']);
 }
 const first=await settleMatch(matchId);
 assert.equal(first.settled,4);
 assert.equal(first.awaitingEvidence,1);
 assert.equal(first.tickets.length,4);
 const rows=(await db.query('select booking_code,status,potential_payout from app_ticket order by booking_code')).rows;
 for(const expected of cases){
  const got=rows.find(t=>t.booking_code===expected.booking);
  assert.equal(got?.status,expected.want,'Full ticket must follow all original quote terms: '+expected.booking);
  if(expected.want!=='PENDING')assert.equal(Number(got.potential_payout),expected.payout);
 }
 const wallet=await db.query('select balance from app_user where id=$1',[userId]);
 assert.equal(Number(wallet.rows[0].balance),1000-500+104+118);
 const credits=(await db.query("select amount,type from app_transaction where type='BET_WON' and user_id=$1",[userId])).rows;
 assert.equal(credits.length,2,'Only genuinely WON tickets can credit the wallet');
 assert.deepEqual(credits.map(x=>Number(x.amount)).sort((a,b)=>a-b),[104,118]);
 const second=await settleMatch(matchId);
 assert.equal(second.settled,0,'Repeated settlement must not credit a ticket twice');
 assert.equal(Number((await db.query('select balance from app_user where id=$1',[userId])).rows[0].balance),722);
 assert.equal((await db.query("select count(*) as n from app_transaction where user_id=$1 and type='BET_WON'",[userId])).rows[0].n,2);
 console.log('PASS full isolated SQL settlement and payout: 0-1 Matchbet two tickets + DC complementary outcomes, no replay, unknown PENDING.');
}finally{
 pool.query=original.query;pool.connect=original.connect;
 await db.close();
}
