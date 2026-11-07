import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import express from 'express';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {createOriginalWalletStore} from '../server/casino/original-wallet-store.mjs';
import {createOriginalWalletRouter} from '../server/casino/original-wallet.mjs';
import {createCtProtocol} from '../server/casino/ct-protocol.mjs';
import {createAgtProtocol} from '../server/casino/agt-protocol.mjs';
import {evaluate as cloverGrade} from '../server/casino/lucky-clover-engine.mjs';
import {evaluate as agtGrade,DATA} from '../server/casino/agt-engine.mjs';
import {spinRound,evaluate as vikingsGrade} from '../server/casino/vikings-engine.mjs';
import {mapVikingsRound,vikingsConfig} from '../server/casino/vikings-ct-router.mjs';

// Real PostgreSQL SQL in an isolated in-memory database. Never reads DATABASE_URL.
const sql=new PGlite();await sql.exec(LEDGER_SQL);
let queue=Promise.resolve();
const database={async connect(){let release;const next=new Promise(r=>release=r),before=queue;queue=next;await before;return {query:(...args)=>sql.query(...args),release};}};
const manager=randomUUID(),user=randomUUID(),other=randomUUID();
for(const [id,role,balance,owner] of [[manager,'MANAGER',10000,null],[user,'PLAYER',1000,manager],[other,'PLAYER',1000,null]])await sql.query('insert into app_user(id,username,password_hash,role,balance,manager_id) values($1,$2,$3,$4,$5,$6)',[id,id,'test-only',role,balance,owner]);
const grid=[[4,4,4],[1,8,8],[1,9,9],[1,10,10],[4,4,4]];
const ct=createCtProtocol({spinFn:(bet,lines)=>({grid,...cloverGrade(grid,bet,lines)}),cardRandom:()=>0});
const agt=createAgtProtocol({spinFn:(id,bet,lines)=>{const d=DATA.games[id],grid=Array.from({length:d.sx},()=>Array(d.sy).fill(id==='fruitqueen'?8:1));return {grid,...agtGrade(id,grid,bet,lines)};},cardRandom:()=>0});
const trigger=[[2,7,8],[2,8,7],[2,6,7],[5,6,7],[8,10,11]],normal=[[5,6,7],[7,8,9],[9,10,11],[3,4,5],[6,7,8]];
const vikings=createCtProtocol({spinFn:(bet,lines)=>spinRound(bet,lines,(b,l,free)=>{const grid=free?normal:trigger;return {grid,...vikingsGrade(grid,b,l,free)};}),configFn:vikingsConfig,selectedLines:25,initialGrid:()=>normal,mapRound:mapVikingsRound});
const makeStore=()=>createOriginalWalletStore({database,ct,agt,vikings});let store=makeStore();
const balance=async id=>Number((await sql.query('select balance from app_user where id=$1',[id])).rows[0].balance);
const count=async()=>Number((await sql.query('select count(*) as n from app_casino_round')).rows[0].n);
const session=(await store.launch(user,'lucky-clover-x3')).sessionId;
let sequence=0;
const command=(name,fields={})=>({command:name,sequence_number:sequence++,...fields});
const ctAct=async(c,token=session)=>(await store.act(user,'lucky-clover-x3',token,[c]))[0];
let init=await ctAct(command('create_session'));assert.equal(init.account_status.credit,100000);assert.equal(init.account_status.currency,'LEK');
await ctAct(command('init_game'));
await assert.rejects(store.act(user,'lucky-clover-x3',session,[
 {command:'play',sequence_number:900,game_denom:1,lines:5,line_bet:1,total_bet:5},
 {command:'continue',sequence_number:901,gameplay_id:1,step_number:1,continue_params:{double_betpart:'skip'}},
]),/one command/);
assert.equal(await count(),0);assert.equal(await balance(user),1000);
const play=command('play',{game_denom:1,lines:5,line_bet:100,total_bet:500});
const [a,b]=await Promise.all([ctAct(play),ctAct(play)]);assert.deepEqual(a,b);assert.equal(await count(),1);assert.equal(await balance(user),980);assert.equal(await balance(manager),10000);
await assert.rejects(ctAct({...play,total_bet:10}),/reused/);
const gamble=command('continue',{gameplay_id:a.gameplay_id,step_number:1,continue_params:{double_betpart:'all',double_key:'red'}});
await assert.rejects(store.act(user,'lucky-clover-x3',session,[gamble,{command:'continue',sequence_number:902,gameplay_id:a.gameplay_id,step_number:3,continue_params:{double_betpart:'skip'}}]),/one command/);
const doubled=await ctAct(gamble);assert.equal(doubled.result[0].win,9000000);assert.deepEqual(await ctAct(gamble),doubled);assert.equal(await balance(user),980);
// Recreate the complete router store, as after a process restart.
store=makeStore();await store.close(user,'lucky-clover-x3',session);assert.equal(await balance(user),360980);assert.equal(await balance(manager),10000);
await store.close(user,'lucky-clover-x3',session);assert.equal(await balance(user),360980);
await assert.rejects(ctAct(command('play',play)),/expired/);
const old=(await store.launch(user,'lucky-clover-x3')).sessionId;
await store.launch(user,'lucky-clover-x3');await assert.rejects(ctAct(command('poll'),old),/expired/);

for(const [id,app,lines] of [['fruit-queen','fruitqueen',18],['seven-hot','sevenhot20',20]]){
 const token=(await store.launch(user,id)).sessionId;
 const act=(action,fields={})=>store.act(user,id,token,{action,gamename:app,...fields});
 const start=await act('start');assert.equal(start.currency,'LEK');assert.equal(start.balance,await balance(user));
 const before=await balance(user),request_id=randomUUID();
 await assert.rejects(act('spin',{li:lines,di:1,amount:20}),/request ID/);
 const fields={li:lines,di:1,amount:20,request_id};
 const [spin,replay]=await Promise.all([act('spin',fields),act('spin',fields)]);assert.deepEqual(spin,replay);assert.equal(await balance(user),Math.round((before-20)*100)/100);
 await assert.rejects(act('spin',{...fields,amount:40}),/reused/);
 await assert.rejects(act('double',{color:'forged',request_id:randomUUID()}),/Invalid gamble/);
 const doubleFields={color:'0',request_id:randomUUID()},doubled=await act('double',doubleFields);assert.equal(doubled.win,spin.win*4);assert.deepEqual(await act('double',doubleFields),doubled);
 const saveFields={request_id:randomUUID()},saved=await act('save',saveFields);assert.deepEqual(await act('save',saveFields),saved);assert.equal(await balance(user),Math.round((before-20+doubled.win)*100)/100);
 const after=await balance(user);await store.close(user,id,token);assert.equal(await balance(user),after);
}
// CT free games are one paid round, fully persisted before the animation starts.
const vs=(await store.launch(user,'vikings-fun')).sessionId;
const va=async c=>(await store.act(user,'vikings-fun',vs,[c]))[0];
await va({command:'create_session',sequence_number:1});
const beforeV=await balance(user),rounds=await count();
const free=await va({command:'play',sequence_number:2,game_denom:1,lines:25,line_bet:100,total_bet:2500});
assert.equal(free.result.filter(x=>x.type==='slot_subgame').length,16);assert.equal(await count(),rounds+1);assert.equal(await balance(user),Math.round((beforeV-20)*100)/100);
store=makeStore();await store.close(user,'vikings-fun',vs);
assert.equal(await balance(user),Math.round((beforeV-20+free.result.at(-2).total_win*.008)*100)/100);

const restricted=(await store.launch(other,'fruit-queen')).sessionId;
const restrictedSpin=()=>store.act(other,'fruit-queen',restricted,{action:'spin',gamename:'fruitqueen',li:18,di:1,amount:20,request_id:randomUUID()});
await sql.query('insert into app_player_controls(user_id,self_excluded_until) values($1,now()+interval \'1 day\')',[other]);
await assert.rejects(restrictedSpin(),/vetëpërjashtim/);
await sql.query('delete from app_player_controls where user_id=$1',[other]);
await sql.query('update app_user set balance=0 where id=$1',[other]);await assert.rejects(restrictedSpin(),/Insufficient/);
await sql.query('update app_user set balance=1000 where id=$1',[other]);
await sql.query('update app_casino_settings set enabled=false where id=1');await assert.rejects(restrictedSpin(),/disabled/);
await store.close(other,'fruit-queen',restricted);await sql.query('update app_casino_settings set enabled=true where id=1');
// The sportsbook can change the balance while a casino game is open.
const sportSession=(await store.launch(other,'seven-hot')).sessionId;
await sql.query('update app_user set balance=balance-12.5 where id=$1',[other]);
assert.equal((await store.act(other,'seven-hot',sportSession,{action:'balance',gamename:'sevenhot20'})).balance,987.5);

const app=express();app.use(express.json());
app.use('/app/api/casino/original',createOriginalWalletRouter({store,auth:(req,_res,next)=>{req.user={id:user,role:'PLAYER',status:'ACTIVE'};next();},ready:()=>true}));
const http=app.listen(0,'127.0.0.1');await new Promise(r=>http.once('listening',r));const origin='http://127.0.0.1:'+http.address().port;
try{
 const launch=await fetch(origin+'/app/api/casino/original/fruit-queen/session',{method:'POST'});assert.equal(launch.status,200);const cookie=launch.headers.get('set-cookie').split(';')[0],url=(await launch.json()).gameUrl;
 const page=await fetch(origin+url,{headers:{cookie}});assert.equal(page.status,200);const html=await page.text();assert(html.includes('wallet-bridge.js'));assert(html.includes('<base href="/app/casino-original/agt/">'));
 const denied=await fetch(origin+'/app/api/casino/original/fruit-queen/dinit.php?action=start&gamename=fruitqueen');assert.equal(denied.status,401);
 const cross=await fetch(origin+'/app/api/casino/original/fruit-queen/dinit.php?action=start&gamename=fruitqueen',{headers:{cookie,'sec-fetch-site':'cross-site'}});assert.equal(cross.status,403);
 const mismatch=await fetch(origin+'/app/api/casino/original/fruit-queen/dinit.php?action=start&gamename=sevenhot20',{headers:{cookie}});assert.equal(mismatch.status,400);
}finally{await new Promise(r=>http.close(r));}
const posted=await sql.query('select coalesce(sum(amount),0) as amount from app_transaction where user_id=$1',[user]);
assert.equal(Math.round((await balance(user))*100),100000+Math.round(Number(posted.rows[0].amount)*100),'player balance equals own recorded stakes and collected winnings');
assert.equal(await balance(manager),10000,'manager wallet is unchanged by native casino play and collections');
assert.equal(Number((await sql.query('select count(*) as n from app_transaction where user_id=$1',[manager])).rows[0].n),0,'no automatic manager transaction');
await sql.close();console.log('PASS shared sportsbook wallet: four games, player-ledger reconciliation/no manager credits, retries/concurrency, restart recovery, free games, x2/x4, close/collect, limits, auth and cross-origin denial');
