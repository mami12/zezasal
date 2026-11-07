import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';
import {recordWatchedLiveFrame} from '../server/ledger/live-observation-store.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';

const t=Date.parse('2026-11-07T00:00:00Z');
const prematch={service:'PREMATCH',start_at:'2026-11-08T00:00:00Z',home:'Home',away:'Away'};
const freeze=(minute,choice)=>frozenLiveContract({
 market_name:'Goal in minute '+minute,outcome_name:choice,
 market_key:'zz'+(1000+minute)+'@'+Buffer.from(JSON.stringify({p3:minute})).toString('base64url')
},prematch,t);
const ten=freeze(10,'Yes'),twentyThree=freeze(23,'Yes');
const noTwentyThree=freeze(23,'No'),noTwentyTwo=freeze(22,'No');
assert.deepEqual([ten.kind,ten.event,ten.from,ten.to,ten.choice],['window','goal',10,10,true]);
assert.deepEqual([twentyThree.kind,twentyThree.from,twentyThree.to],['window',23,23]);
assert.equal(noTwentyThree.choice,false);
assert.equal(noTwentyTwo.from,22);
// An unanchored or misspelled market cannot silently turn into another event.
assert.throws(()=>frozenLiveContract({market_name:'Goal in next 10 minutes',outcome_name:'Yes'},
 prematch,t),/verifikueshëm/,'A rolling market needs an observed acceptance clock');

const db=new PGlite();
try{
 await db.exec(LEDGER_SQL);
 const execute=(sql,params=[])=>db.query(sql,params);
 const database={connect:async()=>({query:execute,release(){}})};
 const id=800000078013;
 const player=(await execute("insert into app_user(username,password_hash,balance) values('exact-minute-test','isolated',1000) returning id")).rows[0].id;
 const ticket=(await execute("insert into app_ticket(user_id,stake,total_odds,potential_payout,status,placed_at) values($1,10,2,20,'PENDING',$2) returning id",[player,new Date(t-3000)])).rows[0].id;
 async function line(name,contract){
  return (await execute(
   "insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,odds_at_placement,live_contract) values($1,$2,$3,$4,$4,$3,'Home vs Away',2,$5::jsonb) returning *",
   [ticket,id,name,contract.choice?'Yes':'No',JSON.stringify(contract)]
  )).rows[0];
 }
 const yes10=await line('Goal in minute 10',ten);
 const yes23=await line('Goal in minute 23',twentyThree);
 const no23=await line('Goal at minute 23',noTwentyThree);
 const no22=await line('Goal in minute 22',noTwentyTwo);
 const raw=(second=true)=>({
  Match:{Score:second?'2:0':'1:0',MatchTimeExtended:'25:00',
   EventStatus:6,CornersTeam1:0,CornersTeam2:0,YellowCardsTeam1:0,YellowCardsTeam2:0,
   RedCardsTeam1:0,RedCardsTeam2:0},
  TimeLines:[{id:'goal10',type:'score_change',team:1,gt:10,clk:'10:05'},
   ...(second?[{id:'goal23',type:'score_change',team:1,gt:23,clk:'23:52'}]:[])]
 });
 const read=line=>gradeStoredEventContract(line,null,{execute});
 const capture=(sample,offset)=>recordWatchedLiveFrame(id,sample,{database,now:()=>t+offset});
 await capture(raw(),0);
 assert.equal(await read(yes10),null,'A first event observation cannot pay');
 assert.equal(await read(yes23),null,'A first event observation cannot pay');
 await capture(raw(),6000);
 assert.equal(await read(yes10),'WON','10:05 is inside the original minute 10');
 assert.equal(await read(yes23),'WON','23:52 is inside the original minute 23');
 assert.equal(await read(no23),'LOST');
 assert.equal(await read(no22),'WON','No goal during minute 22 is verified after minute 23');
 await capture(raw(false),12000);
 assert.equal(await read(yes23),null,'A corrected primary feed invalidates the previous verdict');
 await capture(raw(false),18000);
 assert.equal(await read(yes10),'WON','Unchanged first goal remains confirmed');
 assert.equal(await read(yes23),'LOST','Goal 23 Yes loses after a verified correction');
 assert.equal(await read(no23),'WON','Goal 23 No wins after a verified correction');
 assert.equal(Number((await execute('select balance from app_user where id=$1',[player])).rows[0].balance),1000);
 console.log('PASS Zizobet exact minute 10/23: frozen quotes, two polls, positive/negative decisions and VAR correction in PostgreSQL');
}finally{await db.close();}
