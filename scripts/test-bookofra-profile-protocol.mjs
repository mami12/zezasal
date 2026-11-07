import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import express from 'express';
import jwt from 'jsonwebtoken';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {config} from '../server/config.mjs';
import {createBookOfRaRealRouter,createBookOfRaSessionRouter} from '../server/casino/bookofra.mjs';
import {placeBookOfRaSpin,bookOfRaFreeState} from '../server/casino/bookofra-transactions.mjs';
import {placeCasinoSpin,settlePendingWin} from '../server/casino/transactions.mjs';
import {casinoGambleAction} from '../server/casino/gamble.mjs';
import {getGameProfile,getPaidGameProfile,publicGameProfiles} from '../server/casino/game-rtp-profiles.mjs';
process.env.BOOKOFRA_FREE_SPINS='1';
const sql=new PGlite();await sql.exec(LEDGER_SQL);
const user=randomUUID(),manager=randomUUID();
await sql.query("insert into app_user(id,username,password_hash,role,balance)values($1,'book-manager','test-only','MANAGER',1000000)",[manager]);
await sql.query("insert into app_user(id,username,password_hash,balance,manager_id)values($1,'book-player','test-only',100000,$2)",[user,manager]);
let queue=Promise.resolve();const database={async connect(){let release;const before=queue;queue=new Promise(resolve=>release=resolve);await before;return{query:(...args)=>sql.query(...args),release};}};
const balance=async()=>Number((await sql.query('select balance from app_user where id=$1',[user])).rows[0].balance);
const state=()=>bookOfRaFreeState(user,{database:sql});
const place=async args=>{
 const replay=await sql.query(args.mode==='freespin'
  ? 'select 1 from app_casino_gamble_event where user_id=$1 and request_id=$2'
  : 'select 1 from app_casino_round where user_id=$1 and client_request_id=$2',[args.userId,args.requestId]);
 if(replay.rows.length)return placeBookOfRaSpin(args,{database,random:()=>assert.fail('a replay must not draw new stops')});
 const fs=args.mode==='freespin'?await state():null;
 const settings=(await sql.query('select game_profiles from app_casino_settings where id=1')).rows[0].game_profiles;
 const profile=fs?getGameProfile('bookofra',{bookofra:fs.math_profile??'BOOKOFRA_ORIGINAL_REELS_V2'}):getPaidGameProfile('bookofra',settings);
 const stops=profile.reels.map(reel=>reel.indexOf(fs?1:0));assert.ok(stops.every(stop=>stop>=0));let index=0;
 return placeBookOfRaSpin(args,{database,random:()=>stops[index++]});
};
const app=express();app.use('/play',createBookOfRaRealRouter({getUserById:async id=>(await sql.query('select * from app_user where id=$1',[id])).rows[0],isLedgerReady:()=>true,
 settlePendingWin:id=>settlePendingWin(id,{database}),bookOfRaFreeState:()=>state(),placeBookOfRaSpin:place}));
app.use(createBookOfRaSessionRouter({runQuery:(...args)=>sql.query(...args),bookOfRaFreeState:()=>state(),auth:(req,_res,next)=>{req.user={id:user,role:'PLAYER',status:'ACTIVE'};next();}}));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const origin=`http://127.0.0.1:${server.address().port}/play/play`;
const token=()=>jwt.sign({sub:user,jti:randomUUID(),kind:'casino-bookofra-wallet'},config.jwtSecret,{expiresIn:600});let cookie=`casino_bookofra_session=${token()}`;
const post=async body=>{const r=await fetch(origin,{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify(body)});assert.equal(r.status,200);const result=await r.json();assert.equal(result.error,undefined,JSON.stringify(result));return result;};
try{
 const actualDefault=getPaidGameProfile('bookofra'),advertised=publicGameProfiles().find(game=>game.gameId==='bookofra');
 assert.ok(actualDefault.theoreticalRtp<=100);assert.equal(advertised.profile,actualDefault.id);assert.equal(advertised.theoreticalRtp,actualDefault.theoreticalRtp);
 const command={action:'spin',request_id:2,bet:2,denomination:.5,lines:10};
 const trigger=await post(command);assert.deepEqual(trigger.available_actions,['initfreespin']);assert.equal(trigger.spin.freespins.left,10);
 const paid=(await sql.query("select * from app_casino_round where game_id='bookofra'")).rows[0];assert.equal(paid.game_version,actualDefault.id);
 assert.deepEqual(await post(command),trigger,'a lost trigger response must replay the complete original bonus handshake');
 const afterStake=await balance(),initialPending=Number((await state()).pending);
 await assert.rejects(placeCasinoSpin({userId:user,requestId:randomUUID(),bet:1,lines:5},{database}),error=>error.message==='FREE_SPINS_PENDING');
 for(const action of ['get_double','set_double'])await assert.rejects(casinoGambleAction({userId:user,requestId:randomUUID(),action,choice:0},{database}),error=>error.message==='FREE_SPINS_PENDING');
 assert.equal(await balance(),afterStake,'another slot or Gamble must not replace an accepted Book bonus');
 assert.equal(Number((await state()).pending),initialPending);
 cookie=`casino_bookofra_session=${token()}`; // reopening the game issues a new authenticated nonce
 const init=await post({action:'init',request_id:1});assert.deepEqual(init.available_actions,['initfreespin']);
 assert.equal(await balance(),afterStake,'bonus-resume init must not silently collect the active chain');
 const start=await post({action:'initfreespin',request_id:2});assert.equal(start.initfreespin.freespins.left,10);assert.equal(start.initfreespin.freespins.wins.total,initialPending);
 await sql.query("update app_casino_settings set enabled=false,game_profiles=$1::jsonb where id=1",[JSON.stringify({bookofra:'unsupported-profile'})]);
 const reopen=await fetch(origin.replace('/play/play','/casino/bookofra/session'),{method:'POST'});
 assert.equal(reopen.status,200);assert.equal((await reopen.json()).ready,true,'an owed bonus must reopen with a fresh cookie even while OFF and future math is invalid');
 cookie=reopen.headers.get('set-cookie').split(';')[0];
 assert.deepEqual((await post({action:'init',request_id:300})).available_actions,['initfreespin']);
 for(let i=0;i<10;i++){
  const action={action:'freespin',request_id:i+3,bet:2,denomination:.5,lines:10};
  const response=await post(action);assert.deepEqual(await post(action),response,'free-spin retries must not consume a second spin');
  // The freespin response total is the whole pending amount, not its increment.
  const events=(await sql.query("select response from app_casino_gamble_event where user_id=$1 and action='bookofra:freespin' order by created_at",[user])).rows;
  const expected=Number(paid.result.total)+events.reduce((sum,event)=>sum+Number(event.response.graded.total),0);
  assert.equal(Number((await sql.query('select payout from app_casino_round where id=$1',[paid.id])).rows[0].payout),expected);
  if(i===0){
   await settlePendingWin(user,{database});
   const resumed=await post({action:'init',request_id:200});assert.deepEqual(resumed.available_actions,['initfreespin']);
   assert.equal((await post({action:'initfreespin',request_id:201})).initfreespin.freespins.left,9);
  }
 }
 assert.equal(await state(),null);
 await settlePendingWin(user,{database});const final=await balance();await settlePendingWin(user,{database});assert.equal(await balance(),final);
 const posted=Number((await sql.query("select coalesce(sum(amount),0) total from app_transaction where user_id=$1 and reference_id=$2 and type='CASINO_WIN'",[user,paid.id])).rows[0].total);
 assert.equal(Number((await sql.query('select payout from app_casino_round where id=$1',[paid.id])).rows[0].payout),posted);
 assert.equal(final,100000-Number(paid.stake)+posted);
 assert.equal(Number((await sql.query('select sum(balance) total from app_user where id=any($1::uuid[])',[[user,manager]])).rows[0].total),1100000);
 await sql.query("update app_casino_settings set enabled=true,game_profiles=$1::jsonb where id=1",[JSON.stringify({bookofra:'BOOKOFRA_ORIGINAL_REELS_V2'})]);
 await assert.rejects(placeBookOfRaSpin({userId:user,requestId:randomUUID(),bet:1,lines:10},{database}),error=>error.code==='UNSUPPORTED_MATH_PROFILE');
 assert.equal(publicGameProfiles({bookofra:'BOOKOFRA_ORIGINAL_REELS_V2'}).find(game=>game.gameId==='bookofra').profile,null);
 console.log('PASS Book real protocol/SQL: supported FS1 default, lost bonus-trigger replay, reopen handshake, frozen bonus while OFF, free-spin retries, cumulative round awards and no duplicate funds');
}finally{await new Promise(resolve=>server.close(resolve));await sql.close();}
