import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {normalizeLiveFrame,recordWatchedLiveFrame} from '../server/ledger/live-observation-store.mjs';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';
import {settleVerifiedEventFacts,updatePendingLine,recalcTicket} from '../server/ledger/settler.mjs';

const offer={market_name:'Fouls in minutes 10-15',outcome_name:'Yes',outcome_key:'Yes'};
const contract=liveContract(offer,{clock:0,counts:{},teams:{}});
assert.equal(contract?.kind,'window');
assert.equal(contract?.event,'foul');
assert.equal(contract?.from,10);
assert.equal(contract?.to,15);
assert.equal(liveContract({...offer,market_name:'Total Fouls'},{}),null,
 'Aggregate fouls continue using verified final stat data, not fake incidents');
const raw={Match:{
 Score:'0:0',MatchTimeExtended:'16:30',EventStatus:6,
 FoulsTeam1:1,FoulsTeam2:0,
 CornersTeam1:0,CornersTeam2:0,YellowCardsTeam1:0,YellowCardsTeam2:0,
 RedCardsTeam1:0,RedCardsTeam2:0
},TimeLines:[{id:'foul-1',type:'foul_committed',gt:12,clk:'12:04',
 team:1,player:'Defender'}]};
const frame=normalizeLiveFrame(raw);
assert.equal(frame.coverage.foulThrough,16.5);
assert.deepEqual(frame.teams.foul,{home:1,away:0});
assert.equal(frame.events.find(e=>e.type==='foul')?.player,'Defender');
const missing=normalizeLiveFrame({Match:{...raw.Match,FoulsTeam1:null},TimeLines:raw.TimeLines});
assert.equal(missing.coverage.foulThrough,undefined,
 'Missing foul counter cannot establish event absence');
const contradiction=normalizeLiveFrame({
 Match:{...raw.Match,FoulsTeam1:2},TimeLines:raw.TimeLines});
assert.equal(contradiction.coverage.foulThrough,undefined,
 'A partial foul timeline never establishes a finished window');

const pg=new PGlite();
try{
 await pg.exec(LEDGER_SQL);
 const q=(sql,params=[])=>pg.query(sql,params);
 const database={connect:async()=>({query:q,release(){}})};
 let at=Date.parse('2026-11-12T12:30:00Z');
 const player=(await q("insert into app_user(username,password_hash,balance) values('foul-window-verified','offline',900) returning id")).rows[0].id;
 const ticket=(await q(
  "insert into app_ticket(user_id,stake,total_odds,potential_payout,ticket_type,status,placed_at) "+
  "values($1,100,2,200,'SINGLE','PENDING',$2) returning id",
  [player,new Date(at-20000)])).rows[0].id;
 const line=(await q(
  "insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,"+
  "match_name,odds_at_placement,status,live_contract) "+
  "values($1,810003,'zz900@e30','Yes','Yes','Fouls in minutes 10-15',"+
  "'Home - Away',2,'PENDING',$2::jsonb) returning id",
  [ticket,JSON.stringify(contract)])).rows[0].id;
 const updater=(id,status,tid)=>updatePendingLine(id,status,tid,{database});
 const recalc=id=>recalcTicket(id,{database});
 await recordWatchedLiveFrame(810003,raw,{database,now:()=>at});
 const once=await settleVerifiedEventFacts({runQuery:q,update:updater,recalc});
 assert.equal(once.graded,0,'One Zizobet foul observation cannot trigger a real payout');
 at+=8000;
 await recordWatchedLiveFrame(810003,raw,{database,now:()=>at});
 const twice=await settleVerifiedEventFacts({runQuery:q,update:updater,recalc});
 assert.equal(twice.graded,1,'Two same-counter observations must verify the closed foul window');
 assert.equal((await q('select status from app_ticket_line where id=$1',[line])).rows[0].status,'WON');
 assert.equal((await q('select status from app_ticket where id=$1',[ticket])).rows[0].status,'WON');
 assert.equal(Number((await q('select balance from app_user where id=$1',[player])).rows[0].balance),1100);
 assert.equal((await settleVerifiedEventFacts({runQuery:q,update:updater,recalc})).graded,0);
 assert.equal((await q("select count(*)::int as n from app_transaction where reference_id=$1 and type='BET_WON'",[ticket])).rows[0].n,1);
}finally{await pg.close();}
console.log('PASS provider-counter-verified foul interval: no inferred absence, two polls, one settlement and exactly-once payout');
