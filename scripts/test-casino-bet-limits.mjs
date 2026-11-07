import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import express from 'express';
import jwt from 'jsonwebtoken';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {config} from '../server/config.mjs';
import {createOriginalWalletStore} from '../server/casino/original-wallet-store.mjs';
import {createOriginalWalletRouter} from '../server/casino/original-wallet.mjs';
import {createCtProtocol} from '../server/casino/ct-protocol.mjs';
import {createAgtProtocol} from '../server/casino/agt-protocol.mjs';
import {createSizzlingRealRouter} from '../server/casino/sizzling-real.mjs';
import {createBookOfRaRealRouter} from '../server/casino/bookofra.mjs';
import {placeCasinoSpin,settlePendingWin} from '../server/casino/transactions.mjs';
import {placeBookOfRaSpin,bookOfRaFreeState} from '../server/casino/bookofra-transactions.mjs';
import {evaluate as cloverGrade} from '../server/casino/lucky-clover-engine.mjs';
import {evaluate as vikingsGrade} from '../server/casino/vikings-engine.mjs';
import {mapVikingsRound,vikingsConfig} from '../server/casino/vikings-ct-router.mjs';
import {evaluate as agtGrade,DATA as AGT} from '../server/casino/agt-engine.mjs';
import {casinoStakeCents} from '../server/casino/bet-limits.mjs';

// Actual HTTP adapters and PostgreSQL statements, with isolated funds only.
const sql=new PGlite();await sql.exec(LEDGER_SQL);
// Upgrade the preceding two-decimal denomination schema before new wagers.
await sql.exec('alter table app_casino_round alter column denomination type numeric(14,2)');
await sql.exec(LEDGER_SQL);await sql.exec(LEDGER_SQL);
assert.equal((await sql.query("select numeric_scale from information_schema.columns where table_name='app_casino_round' and column_name='denomination'")).rows[0].numeric_scale,6);
let queue=Promise.resolve();
const database={query:(...args)=>sql.query(...args),async connect(){let release;const before=queue;queue=new Promise(resolve=>release=resolve);await before;return {query:(...args)=>sql.query(...args),release};}};
const manager=randomUUID(),user=randomUUID();
await sql.query('insert into app_user(id,username,password_hash,role,balance) values($1,$2,$3,$4,$5)',[manager,manager,'test-only','MANAGER',100000000]);
await sql.query('insert into app_user(id,username,password_hash,role,balance,manager_id) values($1,$2,$3,$4,$5,$6)',[user,user,'test-only','PLAYER',1000000,manager]);
const getUser=async id=>(await sql.query('select * from app_user where id=$1',[id])).rows[0];
const balance=async()=>Number((await getUser(user)).balance);
const funds=async()=>Number((await sql.query('select sum(balance) n from app_user where id=any($1::uuid[])',[[manager,user]])).rows[0].n);
const count=async()=>Number((await sql.query('select count(*) n from app_casino_round')).rows[0].n);
let draws=0;
const cloverGrid=[[4,5,6],[5,6,7],[6,7,8],[7,8,9],[8,9,10]];
const vikingGrid=[[5,6,7],[7,8,9],[9,10,11],[3,4,5],[6,7,8]];
const ct=createCtProtocol({spinFn:(bet,lines)=>{draws++;return {grid:cloverGrid,...cloverGrade(cloverGrid,bet,lines)};}});
const vikings=createCtProtocol({selectedLines:25,initialGrid:()=>vikingGrid,configFn:vikingsConfig,mapRound:mapVikingsRound,
 spinFn:(bet,lines)=>{draws++;const game={grid:vikingGrid,...vikingsGrade(vikingGrid,bet,lines),free:false,freeGameNumber:0,freeGameTotal:0};return {grid:vikingGrid,winCents:game.winCents,games:[{...game,totalWin:game.winCents}]};}});
const agt=createAgtProtocol({spinFn:(id,bet,lines)=>{draws++;const d=AGT.games[id],grid=Array.from({length:d.sx},(_,x)=>Array.from({length:d.sy},(_,y)=>1+(x+y)%(d.symbols.length-1)));return {grid,...agtGrade(id,grid,bet,lines)};}});
const store=createOriginalWalletStore({database,ct,vikings,agt});
const app=express();app.use(express.json());
app.use('/original',createOriginalWalletRouter({store,ready:()=>true,auth:async(req,_res,next)=>{const current=await getUser(user);req.user={id:user,role:'PLAYER',status:'ACTIVE',financialEpoch:Number(current.financial_epoch??0)};next();}}));
const placeSizzling=args=>placeCasinoSpin(args,{database,random:()=>{draws++;return 0;}});
const placeBook=args=>placeBookOfRaSpin(args,{database,random:()=>{draws++;return 0;}});
app.use('/sizzling',createSizzlingRealRouter({isLedgerReady:()=>true,getUserById:getUser,placeCasinoSpin:placeSizzling,settlePendingWin:id=>settlePendingWin(id,{database})}));
app.use('/bookofra',createBookOfRaRealRouter({isLedgerReady:()=>true,getUserById:getUser,placeBookOfRaSpin:placeBook,bookOfRaFreeState:id=>bookOfRaFreeState(id,{database}),settlePendingWin:id=>settlePendingWin(id,{database})}));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const initialFunds=await funds();
const oldSessions=[];
try {
 for(const [id,lines] of [['lucky-clover-x3',5],['vikings-fun',25]]) {
  const launch=await fetch(origin+`/original/${id}/session`,{method:'POST'});assert.equal(launch.status,200);
  const cookie=launch.headers.get('set-cookie').split(';')[0];let sequence=0;
  oldSessions.push({id,cookie,kind:'ct'});
  const command=async(name,fields={})=>{
   const response=await fetch(origin+`/original/${id}/rgsm?request=`+encodeURIComponent(JSON.stringify([{command:name,sequence_number:sequence++,...fields}])),{headers:{cookie}});
   return {status:response.status,body:await response.json()};
  };
  const session=(await command('create_session')).body[0],denom=session.enabled_denoms[0];
  assert.equal(session.enabled_denoms.length,1);
  const game=(await command('init_game')).body[0].game_config;
  assert.equal(game.line_min_bet*lines*denom.cents/100,20);assert.equal(game.line_default_bet*lines*denom.cents/100,20);
  const nativeStakes=game.line_step_bet_numbers.map(bet=>casinoStakeCents(bet*lines*denom.cents/100)/100);
  assert.equal(Math.min(...nativeStakes),20);assert.equal(Math.max(...nativeStakes),5000);
  for(const stake of [20,5000]) {
   const before=await balance(),rounds=await count();
   const spin=await command('play',{game_denom:denom.id,lines,line_bet:stake/.20,total_bet:stake/.20*lines});
   assert.equal(spin.status,200);assert.equal(spin.body[0].status.status,'ok');
   assert.equal(await balance(),Number((before-stake).toFixed(2)));assert.equal(await count(),rounds+1);
   const row=(await sql.query('select stake,denomination from app_casino_round where user_id=$1 order by created_at desc limit 1',[user])).rows[0];
   assert.equal(Number(row.stake),stake);assert.equal(Number(row.denomination),denom.cents/100);
   await command('game_finished',{gameplay_id:spin.body[0].gameplay_id});
  }
  for(const stake of [.20,19.99,5000.01,20.001]) {
   const before=await balance(),rounds=await count(),beforeDraws=draws;
   const rejected=await command('play',{game_denom:denom.id,lines,line_bet:stake/.20,total_bet:stake/.20*lines});
   assert.equal(rejected.status,400);assert.equal(await balance(),before);assert.equal(await count(),rounds);assert.equal(draws,beforeDraws);
  }
 }
 for(const [id,game,lines] of [['fruit-queen','fruitqueen',18],['seven-hot','sevenhot20',20]]) {
  const launch=await fetch(origin+`/original/${id}/session`,{method:'POST'});assert.equal(launch.status,200);
  const cookie=launch.headers.get('set-cookie').split(';')[0];
  oldSessions.push({id,cookie,game,kind:'agt'});
  const action=async(name,fields={})=>{const response=await fetch(origin+`/original/${id}/dinit.php?`+new URLSearchParams({action:name,gamename:game,request_id:randomUUID(),...fields}),{headers:{cookie}});return {status:response.status,body:await response.json()};};
  const start=(await action('start')).body;
  for(const bets of Object.values(start.full_bets)){assert.equal(Math.min(...bets),20);assert.equal(Math.max(...bets),5000);}
  for(const stake of [20,5000]) {
   const before=await balance(),rounds=await count(),spin=await action('spin',{li:lines,di:1,amount:stake});
   assert.equal(spin.status,200);assert.equal(await balance(),Number((before-stake).toFixed(2)));assert.equal(await count(),rounds+1);await action('save');
  }
  for(const stake of [.20,19.99,5000.01,20.001]) {
   const before=await balance(),rounds=await count(),beforeDraws=draws,rejected=await action('spin',{li:lines,di:1,amount:stake});
   assert.equal(rejected.status,400);assert.equal(await balance(),before);assert.equal(await count(),rounds);assert.equal(draws,beforeDraws);
  }
 }
 process.env.BOOKOFRA_FREE_SPINS='0';
 const missingSession=await fetch(origin+'/bookofra/play',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'init'})});
 assert.equal(missingSession.status,200);assert.equal((await missingSession.json()).error.code,401);
 for(const [id,lines,kind,name] of [['sizzling',5,'casino-pixi-wallet','casino_pixi_wallet_session'],['bookofra',10,'casino-bookofra-wallet','casino_bookofra_session']]) {
  const cookie=name+'='+jwt.sign({sub:user,jti:randomUUID(),kind},config.jwtSecret,{expiresIn:600});let requestId=1;
  const action=async(command,fields={})=>{const response=await fetch(origin+`/${id}/play`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({action:command,request_id:requestId++,...fields})});assert.equal(response.status,200);return response.json();};
  const init=await action('init');assert.equal(init.error,undefined);
  assert.equal(Number(init.init.bet)*init.denomination*lines,20,'native first spin starts at the new minimum');
  const stakes=Object.entries(init.init.ranges.bet).flatMap(([unit,bets])=>bets.map(bet=>casinoStakeCents(Number(unit)*bet*lines)/100));
  assert.equal(Math.min(...stakes),20);assert.equal(Math.max(...stakes),5000);
  for(const [stake,bet,denomination] of [[20,1,20/lines],[5000,id==='sizzling'?100:50,10]]) {
   await action('init');const before=await balance(),rounds=await count(),spin=await action('spin',{bet,denomination,lines});
   assert.equal(spin.error,undefined);assert.equal(await balance(),Number((before-stake).toFixed(2)));assert.equal(await count(),rounds+1);
  }
  await action('init');
  for(const stake of [.20,19.99,5000.01,20.001]) {
   const before=await balance(),rounds=await count(),beforeDraws=draws,rejected=await action('spin',{bet:1,denomination:stake/lines,lines});
   assert.equal(rejected.error.code,400);assert.equal(await balance(),before);assert.equal(await count(),rounds);assert.equal(draws,beforeDraws);
  }
 }
 // A previously accepted Book maximum remains immutable after lowering limits.
 const historical=randomUUID(),oldRound=randomUUID(),accepted={stake:10000,payout:0,balance:123,grid:Array.from({length:5},()=>[1,2,3]),graded:{line_wins:[],total:0},free:null};
 await sql.query('insert into app_casino_round(id,user_id,client_request_id,game_id,game_version,bet,denomination,lines,stake,payout,balance_after,result) values($1,$2,$3,$4,$5,100,10,10,10000,0,123,$6::jsonb)',[oldRound,user,historical,'bookofra','historical-test',JSON.stringify({acceptedSpin:accepted})]);
 const beforeReplay=await balance(),replay=await placeBookOfRaSpin({userId:user,requestId:historical,bet:100,denomination:10,lines:10},{database,random:()=>{throw Error('Historical replay rerolled');}});
 assert.equal(replay.replayed,true);assert.equal(replay.stake,10000);assert.equal(await balance(),beforeReplay);
 // Already accepted 0.20 stakes retain their reply even though new ones are rejected.
 const belowKey=randomUUID(),belowRound=randomUUID(),belowAccepted={...accepted,stake:.20,balance:456};
 await sql.query('insert into app_casino_round(id,user_id,client_request_id,game_id,game_version,bet,denomination,lines,stake,payout,balance_after,result) values($1,$2,$3,$4,$5,1,.02,10,.20,0,456,$6::jsonb)',[belowRound,user,belowKey,'bookofra','historical-test',JSON.stringify({acceptedSpin:belowAccepted})]);
 const belowReplay=await placeBookOfRaSpin({userId:user,requestId:belowKey,bet:1,denomination:.02,lines:10},{database,random:()=>{throw Error('Legacy below-minimum replay rerolled');}});
 assert.equal(belowReplay.replayed,true);assert.equal(belowReplay.stake,.20);assert.equal(await balance(),beforeReplay);
 const sizzlingKey=randomUUID(),sizzlingResult={symbols:{},line_wins:[],total:'0.00'};
 await sql.query('insert into app_casino_round(user_id,client_request_id,game_id,game_version,bet,denomination,lines,stake,payout,balance_after,result) values($1,$2,$3,$4,1,.04,5,.20,0,456,$5::jsonb)',[user,sizzlingKey,'sizzling','historical-test',JSON.stringify(sizzlingResult)]);
 const sizzlingReplay=await placeCasinoSpin({userId:user,requestId:sizzlingKey,bet:1,denomination:.04,lines:5},{database,random:()=>{throw Error('Legacy sizzling replay rerolled');}});
 assert.equal(sizzlingReplay.replayed,true);assert.equal(sizzlingReplay.stake,.20);assert.equal(await balance(),beforeReplay);
 // A free game already awarded at the old stake is not repriced or forfeited.
 const oldBonus=agt.initialState('fruitqueen',{walletLimits:true});Object.assign(oldBonus,{remaining:1,bet:20,lines:18,denom:1});
 const resumed=agt.run(oldBonus,{action:'freespin',gamename:'fruitqueen',li:18,di:1,amount:.20});assert.equal(resumed.amount,.20);assert.equal(resumed.bonus,0);
 assert.equal(await funds(),initialFunds);
 // Repeated startup migrations preserve the new sub-cent unit and all funds.
 await sql.exec(LEDGER_SQL);await sql.exec(LEDGER_SQL);
 const scale=(await sql.query("select numeric_scale from information_schema.columns where table_name='app_casino_round' and column_name='denomination'")).rows[0].numeric_scale;
 assert.equal(scale,6);assert.equal(await funds(),initialFunds);
 assert.equal(Number((await sql.query("select denomination from app_casino_round where game_id='vikings-fun' order by created_at desc limit 1")).rows[0].denomination),.008);
 // Financial reset invalidates all six kinds of real-wallet cookie, including cached replies.
 await sql.query('update app_user set financial_epoch=financial_epoch+1 where id=$1',[user]);
 const beforeOldCookies=await balance(),roundsBeforeOldCookies=await count();
 for(const session of oldSessions){const url=session.kind==='ct'?`/original/${session.id}/rgsm?request=`+encodeURIComponent(JSON.stringify([{command:'poll',sequence_number:999}])):`/original/${session.id}/dinit.php?`+new URLSearchParams({action:'balance',gamename:session.game});const denied=await fetch(origin+url,{headers:{cookie:session.cookie}});assert.equal(denied.status,401);}
 for(const [id,kind,name] of [['sizzling','casino-pixi-wallet','casino_pixi_wallet_session'],['bookofra','casino-bookofra-wallet','casino_bookofra_session']]){const cookie=name+'='+jwt.sign({sub:user,jti:randomUUID(),kind,epoch:0},config.jwtSecret,{expiresIn:600});const denied=await fetch(origin+`/${id}/play`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({action:'init',request_id:900})});assert.equal((await denied.json()).error.code,401);}
 assert.equal(await balance(),beforeOldCookies);assert.equal(await count(),roundsBeforeOldCookies);
 const freshLaunch=await fetch(origin+'/original/lucky-clover-x3/session',{method:'POST'});assert.equal(freshLaunch.status,200);assert.equal(jwt.verify(freshLaunch.headers.get('set-cookie').split(';')[0].split('=')[1],config.jwtSecret).epoch,1,'reopened original-wallet session carries the new financial epoch');
 console.log('PASS casino stake limits: six real HTTP adapters, native menus/defaults 20–5000 ALL, exact debits/denomination, rejected fresh low wagers, historical low/high replay and awarded free games preserved, conserved funds, reset-invalidated old cookies for all six adapters and new epoch on reopen');
} finally {
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await sql.close();
}

