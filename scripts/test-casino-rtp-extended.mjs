/** Real admin API against a disposable local database, never live settings. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import express from 'express';

const parent=resolve('tmp');await mkdir(parent,{recursive:true});
const temp=await mkdtemp(join(parent,'casino-extended-rtp-'));
Object.assign(process.env,{DB_DRIVER:'local',LOCAL_DATABASE_DIR:join(temp,'database'),DATABASE_URL:'',JWT_SECRET:'isolated-extended-casino-rtp-tests',SEED_DEFAULT_ACCOUNTS:'false'});
const {pool,initSchema}=await import('../server/db.mjs');
const ledger=await import('../server/ledger/store.mjs');
const {signToken}=await import('../server/ledger/auth.mjs');
const {createCasinoWalletRouter}=await import('../server/casino/wallet.mjs');
let server;
try{
 await initSchema();await ledger.initLedgerSchema();
 const admin=await ledger.createUser({username:'extended-rtp-admin',role:'ADMIN',balance:700,passwordHash:'test-only'});
 const manager=await ledger.createUser({username:'extended-rtp-manager',role:'MANAGER',balance:500,passwordHash:'test-only'});
 const player=await ledger.createUser({username:'extended-rtp-player',role:'PLAYER',balance:1000,passwordHash:'test-only',managerId:manager.id});
 const app=express();app.use(express.json(),createCasinoWalletRouter());server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=async(actor,path,method='GET',body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{authorization:`Bearer ${signToken(actor)}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
 const ids=['lucky-clover-x3','vikings-fun','fruit-queen','seven-hot','sizzling','bookofra'];
 const before=(await pool.query('select id,balance from app_user order by id')).rows;
 for(const actor of [manager,player])assert.equal((await call(actor,'/admin/casino/controls','PATCH',{gameId:'sizzling',mode:'custom',rtp:600,hitFrequency:100})).status,403);
 let settings=(await call(admin,'/admin/casino/settings')).body;
 for(const rtp of [600,1000,2000])for(const gameId of ids){
  const old=settings.games.find(g=>g.gameId===gameId).mathVersion;
  const changed=await call(admin,'/admin/casino/controls','PATCH',{gameId,mode:'custom',rtp,hitFrequency:100});
  assert.equal(changed.status,200,JSON.stringify(changed));settings=changed.body;
  const game=settings.games.find(g=>g.gameId===gameId);
  assert.equal(game.configurationError,null);assert.equal(game.effectiveRtp,rtp);assert.equal(game.effectiveHitFrequency,100);
  assert.ok(game.controlLimits.rtp.max>=1000);assert.deepEqual(game.controlLimits.hitFrequency,{min:0,max:100});
  assert.ok(game.mathVersion&&game.mathVersion!==old,'new economic terms get a new acknowledgement version');
 }
 const saved=(await pool.query('select game_controls from app_casino_settings where id=1')).rows[0].game_controls;
 const audits=Number((await pool.query("select count(*) as n from app_admin_audit where action='PATCH /admin/casino/controls'")).rows[0].n);
 for(const values of [{rtp:Number.MAX_SAFE_INTEGER,hitFrequency:100},{rtp:600,hitFrequency:100.01},{rtp:600,hitFrequency:101},{rtp:600.001,hitFrequency:100},{rtp:-1,hitFrequency:100},{rtp:1000,hitFrequency:.01},{rtp:0,hitFrequency:100},{rtp:true,hitFrequency:100}]){
  assert.equal((await call(admin,'/admin/casino/controls','PATCH',{gameId:'sizzling',mode:'custom',...values})).status,400);
 }
 for(const gameId of ['lucky-clover-x3','fruit-queen','seven-hot'])assert.equal((await call(admin,'/admin/casino/controls','PATCH',{gameId,mode:'custom',rtp:100,hitFrequency:100})).status,400,'an impossible pair is never silently saved');
 assert.deepEqual((await pool.query('select game_controls from app_casino_settings where id=1')).rows[0].game_controls,saved);
 assert.equal(Number((await pool.query("select count(*) as n from app_admin_audit where action='PATCH /admin/casino/controls'")).rows[0].n),audits);
 const publicStatus=await call(player,'/casino/status');assert.equal(publicStatus.status,200);
 for(const game of publicStatus.body.games){if(game.supportsCustomMath){assert.equal(game.effectiveRtp,2000);assert.equal(game.effectiveHitFrequency,100);}else{assert.equal(game.controls.mode,'original');assert.equal(game.effectiveHitFrequency,null);}assert.ok(game.mathVersion);}
 assert.deepEqual((await pool.query('select id,balance from app_user order by id')).rows,before,'settings never alter any wallet');
 assert.equal(Number((await pool.query('select count(*) as n from app_casino_round')).rows[0].n),0);
 console.log('PASS extended RTP admin API: six games at600/100,1000/100 and2000/100, exact reported limits/versions, role checks, invalid/impossible pairs rejected atomically, unchanged balances and no rounds');
}finally{
 if(server){server.closeAllConnections?.();await new Promise(r=>server.close(r));}
 await pool.end();assert.ok(resolve(temp).startsWith(parent+sep));await rm(temp,{recursive:true,force:true});
}
