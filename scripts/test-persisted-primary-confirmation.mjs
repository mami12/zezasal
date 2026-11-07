import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {recordWatchedLiveFrame} from '../server/ledger/live-observation-store.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';

/** This runs against actual PostgreSQL semantics in PGlite, never a real wallet. */
const db=new PGlite();
try{
 await db.exec(LEDGER_SQL);
 const run=(sql,params=[])=>db.query(sql,params);
 const database={connect:async()=>({query:run,release(){}})};
 const t=Date.parse('2026-11-06T14:00:00.000Z');
 const user=(await run("insert into app_user(username,password_hash,balance) values('incident-confirmation-test','isolated',1000) returning id")).rows[0].id;
 const ticket=(await run("insert into app_ticket(user_id,stake,total_odds,potential_payout,status,placed_at) values($1,100,2,200,'PENDING',$2) returning id",[user,new Date(t-10000)])).rows[0].id;
 const {rows:[line]}=await run(`insert into app_ticket_line
  (ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,odds_at_placement,live_contract)
  values($1,764231,'zz123@a','Home','Home','Next Corner','Home - Away',2,$2::jsonb) returning *`,
  [ticket,JSON.stringify({version:1,kind:'sequence',event:'corner',target:1,side:'home',baseline:{home:0,away:0}})]);
 const frame=(team,clock,includeTimeline=true)=>({
  Match:{Score:'0:0',MatchTimeExtended:clock,CornersTeam1:team==='home'?1:0,
   CornersTeam2:team==='away'?1:0,EventStatus:6},
  ...(includeTimeline?{TimeLines:[{id:'c-1',type:'corner_kick',team:team==='home'?1:2,
    gt:11,clk:'10:35',isTaken:true}]}:{})
 });
 const record=(sample,ms)=>recordWatchedLiveFrame(764231,sample,{database,now:()=>t+ms});
 const grade=()=>gradeStoredEventContract(line,null,{execute:run});
 const unchanged=frame('home','20:00');
 assert.equal((await record(unchanged,0)).stored,true);
 assert.equal(await grade(),null,'One correct frame is not enough for financial settlement');
 assert.equal((await record(unchanged,6000)).stored,false,'Duplicate raw JSON is archived only once');
 assert.equal(await grade(),'WON','Second identical PRIMARY poll confirms PostgreSQL home corner');
 const confirmed=(await run("select confirmed_at from app_match_event_coverage where match_id=764231 and kind='corner'")).rows[0];
 assert.ok(confirmed.confirmed_at,'Database records independent matching verification');
 await record(frame('home','20:30',false),12000);
 assert.equal(await grade(),null,'A later incomplete PRIMARY frame must hold payment, not reuse stale coverage');
 const correction=frame('away','21:00');
 await record(correction,18000);
 assert.equal(await grade(),null,'Provider correction invalidates prior home-corner confirmation');
 const correctedCoverage=(await run("select confirmed_at from app_match_event_coverage where match_id=764231 and kind='corner'")).rows[0];
 assert.equal(correctedCoverage.confirmed_at,null);
 assert.equal((await record(correction,25000)).stored,false);
 assert.equal(await grade(),'LOST','Only a second matching corrected incident proves away corner');
 const funds=(await run('select balance from app_user where id=$1',[user])).rows[0];
 assert.equal(Number(funds.balance),1000,'Evidence verification never moves real or simulated wallet');
 const ticketStatus=(await run('select status from app_ticket where id=$1',[ticket])).rows[0].status;
 assert.equal(ticketStatus,'PENDING','No ticket payout without the dedicated settlement transaction');
 console.log('PASS PostgreSQL incident proof: 2 matching polls, duplicate archive, incomplete snapshot hold, VAR-style correction and no wallet writes');
}finally{await db.close();}
