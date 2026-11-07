import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';
import {normalizeLiveFrame,recordWatchedLiveFrame} from '../server/ledger/live-observation-store.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
const contract=(name,label,line='')=>liveContract({market_name:name,outcome_name:label,line});
const yellow=contract('Total Yellow Cards','Over','0.5');
const red=contract('Total Red Cards','Over','0.5');
const scorer=contract('Anytime Goalscorer','Player Alpha');
const minute=contract('Yellow card in minutes 10-20','Yes');
assert.equal(yellow?.cardColor,'yellow');assert.equal(red?.cardColor,'red');
assert.equal(minute?.cardColor,'yellow');assert.equal(scorer?.kind,'player-goal');
assert.equal(contract('Second Yellow Cards','Over','0.5'),null);
const frame=(color='yellow_card',ownGoal=false)=>({
 Match:{Score:'1:0',MatchTimeExtended:'25:00',EventStatus:6,CornersTeam1:0,CornersTeam2:0,
  YellowCardsTeam1:color==='yellow_card'?1:0,YellowCardsTeam2:0,
  RedCardsTeam1:color==='red_card'?1:0,RedCardsTeam2:0},
 TimeLines:[{id:'g1',type:'score_change',team:1,gt:9,clk:'08:35',pl:'Player Alpha',ownGoal},
  {id:'c1',type:color,team:1,gt:15,clk:'14:40'}]});
assert.equal(normalizeLiveFrame(frame()).cardColorsVerified,true);
assert.equal(normalizeLiveFrame(frame('card')).cardColorsVerified,false);
const db=new PGlite();try{
 await db.exec(LEDGER_SQL);const q=(sql,p=[])=>db.query(sql,p);
 const database={connect:async()=>({query:q,release(){}})};
 const now=Date.parse('2026-11-06T16:00:00Z'),matchId=889871;
 const user=(await q("insert into app_user(username,password_hash,balance) values('card-scorer-test','isolated',1000) returning id")).rows[0].id;
 const ticket=(await q("insert into app_ticket(user_id,stake,total_odds,potential_payout,status,placed_at) values($1,50,2,100,'PENDING',$2) returning id",[user,new Date(now-10000)])).rows[0].id;
 const put=async(c,name)=>(await q("insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,odds_at_placement,live_contract) values($1,$2,$3,'Yes','Yes',$3,'Home vs Away',2,$4::jsonb) returning *",[ticket,matchId,name,JSON.stringify(c)])).rows[0];
 const y=await put(yellow,'yellow'),r=await put(red,'red'),p=await put(scorer,'scorer'),m=await put(minute,'minute');
 const capture=(f,ms)=>recordWatchedLiveFrame(matchId,f,{database,now:()=>now+ms});
 const judge=l=>gradeStoredEventContract(l,null,{execute:q});
 await capture(frame(),0);assert.equal(await judge(y),null);
 await capture(frame(),6000);assert.equal(await judge(y),'WON');
 assert.equal(await judge(r),null);assert.equal(await judge(p),'WON');
 assert.equal(await judge(m),'WON');
 await capture(frame('card'),12000);assert.equal(await judge(y),null);
 await capture(frame('card'),18000);assert.equal(await judge(y),null);
 await capture(frame('red_card'),24000);assert.equal(await judge(r),null);
 await capture(frame('red_card'),30000);assert.equal(await judge(r),'WON');
 await capture(frame('red_card',true),36000);assert.equal(await judge(p),null);
 await capture(frame('red_card',true),42000);
 const rawGoal=(await q("select own_goal,player_name from app_match_event_fact where match_id=$1 and kind='goal' and active",[matchId])).rows[0];
 assert.equal(rawGoal?.own_goal,true,'Own goal correction must be saved before settlement');
 assert.equal(await judge(p),null,'An own goal must not pay a goalscorer bet');
 const facts=(await q('select kind,card_color,own_goal from app_match_event_fact where match_id=$1 and active',[matchId])).rows;
 assert.equal(facts.find(f=>f.kind==='card').card_color,'red');
 assert.equal(facts.find(f=>f.kind==='goal').own_goal,true);
 assert.equal(Number((await q('select balance from app_user where id=$1',[user])).rows[0].balance),1000);
 console.log('PASS separate yellow/red cards, verified scorer and own-goal correction in PostgreSQL');
}finally{await db.close();}
