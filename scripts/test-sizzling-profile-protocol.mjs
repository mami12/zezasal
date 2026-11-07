import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import express from 'express';
import jwt from 'jsonwebtoken';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {config} from '../server/config.mjs';
import {createSizzlingRealRouter} from '../server/casino/sizzling-real.mjs';
import {placeCasinoSpin,settlePendingWin} from '../server/casino/transactions.mjs';
import {casinoGambleAction} from '../server/casino/gamble.mjs';
import {getPaidGameProfile} from '../server/casino/game-rtp-profiles.mjs';

const sql=new PGlite();await sql.exec(LEDGER_SQL);
const user=randomUUID(),manager=randomUUID();
await sql.query("insert into app_user(id,username,password_hash,role,balance)values($1,'sizzling-manager','test-only','MANAGER',1000000)",[manager]);
await sql.query("insert into app_user(id,username,password_hash,balance,manager_id)values($1,'sizzling-player','test-only',100000,$2)",[user,manager]);
let queue=Promise.resolve();
const database={async connect(){let release;const before=queue;queue=new Promise(resolve=>release=resolve);await before;return{query:(...args)=>sql.query(...args),release};}};
const getUser=async id=>(await sql.query('select * from app_user where id=$1',[id])).rows[0];
const place=args=>{
 const profile=getPaidGameProfile('sizzling'),stops=profile.reels.map(reel=>reel.indexOf(1));let index=0;
 assert.ok(stops.every(stop=>stop>=0));
 return placeCasinoSpin(args,{database,random:()=>stops[index++]});
};
const app=express();app.use(createSizzlingRealRouter({isLedgerReady:()=>true,getUserById:getUser,
 settlePendingWin:id=>settlePendingWin(id,{database}),placeCasinoSpin:place,
 casinoGambleAction:args=>casinoGambleAction(args,{database})}));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const origin=`http://127.0.0.1:${server.address().port}/play`;
const cookie='casino_pixi_wallet_session='+jwt.sign({sub:user,jti:randomUUID(),kind:'casino-pixi-wallet'},config.jwtSecret,{expiresIn:600});
const post=async body=>{
 const response=await fetch(origin,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal(response.status,200);return response.json();
};
try {
 const command={action:'spin',request_id:2,bet:1,denomination:1,lines:5};
 const trigger=await post(command);assert.equal(trigger.error,undefined);assert.ok(Number(trigger.spin.wins.total)>0);
 const afterStake=Number((await getUser(user)).balance);
 const gambleCommand={action:'get_double',request_id:3};
 const started=await post(gambleCommand);assert.equal(started.error,undefined);
 await sql.query("update app_casino_settings set enabled=false,game_profiles=$1::jsonb where id=1",[JSON.stringify({sizzling:'unsupported-profile'})]);
 assert.deepEqual(await post(command),trigger,'committed spin replay remains immutable when OFF');
 assert.deepEqual(await post(gambleCommand),started,'committed gamble response replays when OFF');
 assert.equal((await post({action:'get_double',request_id:4})).error.message,'CASINO_DISABLED','new gambling is blocked under the settings lock');
 const collected=await post({action:'collect',request_id:5});assert.equal(collected.error,undefined);
 assert.deepEqual(await post({action:'collect',request_id:5}),collected,'collect retry credits once');
 assert.equal(Number((await getUser(user)).balance),afterStake+Number(trigger.spin.wins.total));
 assert.equal((await post({...command,request_id:6})).error.code,403,'new paid spins stay OFF');
 const init=await post({action:'init',request_id:7});assert.equal(init.error,undefined);
 assert.equal(init.balance.after,Number((await getUser(user)).balance),'init remains available and cannot double-credit');
 const round=(await sql.query("select * from app_casino_round where user_id=$1",[user])).rows[0];
 const paid=Number((await sql.query("select sum(amount) total from app_transaction where user_id=$1 and reference_id=$2 and type='CASINO_WIN'",[user,round.id])).rows[0].total);
 assert.equal(Number(round.payout),paid);
 assert.equal(Number((await sql.query('select sum(balance) total from app_user where id=any($1::uuid[])',[[user,manager]])).rows[0].total),1100000);
 console.log('PASS Sizzling real HTTP + SQL: immutable spin/gamble replay, OFF blocks future wagers, owed collect/init remain available, one credit and conserved funds');
} finally {
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await sql.close();
}
