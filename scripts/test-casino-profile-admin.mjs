import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import express from 'express';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {createCasinoWalletRouter} from '../server/casino/wallet.mjs';
const sql=new PGlite();await sql.exec(LEDGER_SQL);
const admin=randomUUID();await sql.query("insert into app_user(id,username,password_hash,role)values($1,'profile-admin','test-only','ADMIN')",[admin]);
await sql.query("update app_casino_settings set profile='SCHOOL_RTP_1' where id=1");
let queue=Promise.resolve();const database={async connect(){let release;const before=queue;queue=new Promise(resolve=>release=resolve);await before;return{query:(...args)=>sql.query(...args),release};}};
const runQuery=async(...args)=>{const db=await database.connect();try{return await db.query(...args);}finally{db.release();}};
const app=express();app.use(express.json());app.use('/app/api',createCasinoWalletRouter({database,runQuery,ready:()=>true,auth:(req,_res,next)=>{req.user={id:admin,username:'profile-admin',role:req.headers['x-test-role']||'ADMIN'};next();}}));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const origin=`http://127.0.0.1:${server.address().port}/app/api`;
const get=async()=>{const r=await fetch(origin+'/admin/casino/settings');assert.equal(r.status,200);return r.json();};
const patch=async(body,role='ADMIN')=>fetch(origin+'/admin/casino/profile',{method:'PATCH',headers:{'content-type':'application/json','x-test-role':role},body:JSON.stringify(body)});
try{
 const settings=await get();assert.deepEqual(settings.games.map(game=>game.gameId).sort(),['bookofra','firejoker','fortune-pyramid','fortune-teller','fruit-queen','ice-fruits-6x3','lucky-clover-x3','seven-hot','sizzling','vikings-fun']);assert.equal(settings.legacyProfileIgnored,true);
 assert.ok(settings.games.every(game=>!String(game.profile).includes('SCHOOL_RTP_')));
 assert.ok(settings.games.every(game=>game.profiles.every(profile=>profile.theoreticalRtp>=1&&profile.theoreticalRtp<=1000)));
 for(const game of settings.games){
  const low=game.profiles[0],high=game.profiles.at(-1);
  assert.ok(low.theoreticalRtp<high.theoreticalRtp,`${game.gameId} offers real low/high profiles`);
  for(const profile of [low,high]){
   const r=await patch({gameId:game.gameId,profile:profile.id});assert.equal(r.status,200);
   const saved=(await r.json()).games.find(entry=>entry.gameId===game.gameId);
   assert.equal(saved.profile,profile.id);assert.equal(saved.theoreticalRtp,profile.theoreticalRtp);
   const persisted=(await sql.query('select game_profiles from app_casino_settings where id=1')).rows[0].game_profiles;
   assert.equal(persisted[game.gameId],profile.id);
  }
 }
 for(const body of [{profile:'SCHOOL_RTP_1'},{gameId:'sizzling',profile:'SCHOOL_RTP_1'},
  {gameId:'sizzling',profile:settings.games[0].profiles[0].id},
  {gameId:'sizzling',profile:settings.games.find(game=>game.gameId==='sizzling').profiles[0].id,userId:randomUUID()}])assert.equal((await patch(body)).status,400);
 assert.equal((await patch({gameId:settings.games[0].gameId,profile:settings.games[0].profiles[0].id},'PLAYER')).status,403);
 const audits=(await sql.query("select * from app_admin_audit where action='PATCH /admin/casino/profile'")).rows;
 assert.equal(audits.length,settings.games.length*2);assert.ok(audits.every(row=>row.details.scope==='all players; future paid rounds only'));
 // Concurrent changes to different games keep both keys; the settings row is locked.
 await Promise.all(settings.games.slice(0,2).map(async game=>assert.equal((await patch({gameId:game.gameId,profile:game.profiles[0].id})).status,200)));
 const after=await get();for(const game of settings.games.slice(0,2))assert.equal(after.games.find(entry=>entry.gameId===game.gameId).profile,game.profiles[0].id);
 const controls=async(gameId,values,role='ADMIN')=>fetch(origin+'/admin/casino/controls',{method:'PATCH',headers:{'content-type':'application/json','x-test-role':role},body:JSON.stringify({gameId,...values})});
 for(const game of settings.games){
  if(!game.supportsCustomMath){assert.equal((await controls(game.gameId,{mode:'custom',rtp:95,hitFrequency:10})).status,400);continue;}
  const beforeVersion=(await get()).games.find(item=>item.gameId===game.gameId).mathVersion;
  for(const [rtp,hitFrequency] of [[0,0],[95,10]]){
   const response=await controls(game.gameId,{mode:'custom',rtp,hitFrequency});assert.equal(response.status,200);
   const saved=(await response.json()).games.find(item=>item.gameId===game.gameId);
   assert.deepEqual(saved.controls,{mode:'custom',rtp,hitFrequency});
   assert.equal(saved.effectiveRtp,rtp);assert.equal(saved.effectiveHitFrequency,hitFrequency);assert.notEqual(saved.mathVersion,beforeVersion);
   assert.deepEqual((await sql.query('select game_controls from app_casino_settings where id=1')).rows[0].game_controls[game.gameId],saved.controls);
  }
 }
 // Saving a number is not implementation: unsupported payout means are rejected.
 assert.equal((await controls('sizzling',{mode:'custom',rtp:1,hitFrequency:100})).status,400);
 for(const values of [{mode:'custom',rtp:0,hitFrequency:1},{mode:'custom',rtp:1,hitFrequency:0},{mode:'custom',rtp:-1,hitFrequency:1},{mode:'custom',rtp:1000.01,hitFrequency:1},{mode:'custom',rtp:10,hitFrequency:101},
  {mode:'custom',rtp:'0',hitFrequency:0},{mode:'custom',rtp:0,hitFrequency:0,userId:admin}]){
  assert.equal((await controls('sizzling',values)).status,400);
 }
 assert.equal((await controls('sizzling',{mode:'custom',rtp:0,hitFrequency:0},'PLAYER')).status,403);
 await Promise.all(settings.games.filter(game=>game.supportsCustomMath).slice(0,2).map(async game=>assert.equal((await controls(game.gameId,{mode:'original',rtp:95,hitFrequency:10})).status,200)));
 const controlsAudit=(await sql.query("select * from app_admin_audit where action='PATCH /admin/casino/controls'")).rows;
 assert.equal(controlsAudit.length,settings.games.filter(game=>game.supportsCustomMath).length*2+2);assert.ok(controlsAudit.every(row=>row.details.scope==='all players; future paid rounds only'));
 assert.deepEqual((await get()).stakeLimits,{min:20,max:5000,currency:'ALL'});
 console.log('PASS casino profile/admin controls: all ten games, original-only restrictions, zero/custom RTP+hit, exact SQL persistence, math versions, impossible pairs, concurrent saves, audit and authorization');
}finally{await new Promise(resolve=>server.close(resolve));await sql.close();}

