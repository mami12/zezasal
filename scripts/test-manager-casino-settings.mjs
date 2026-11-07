import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {saveManagerCasinoSettings,managerCasinoSettings} from '../server/casino/manager-settings.mjs';
import {createOriginalWalletStore} from '../server/casino/original-wallet-store.mjs';
import {selectCustomRound} from '../server/casino/custom-math.mjs';
import {placeCasinoSpin} from '../server/casino/transactions.mjs';
import {placeBookOfRaSpin} from '../server/casino/bookofra-transactions.mjs';
import {casinoMathVersion} from '../server/casino/casino-controls.mjs';
import {getCasinoSettings} from '../server/casino/wallet.mjs';
const sql=new PGlite();await sql.exec(LEDGER_SQL);
const db={connect:async()=>({query:(...args)=>sql.query(...args),release(){}})},run=(...args)=>sql.query(...args);
const admin={id:randomUUID(),username:'manager-settings-admin'},managers=[randomUUID(),randomUUID()],players=[randomUUID(),randomUUID()];
try{
 for(const [id,name,role,manager]of [[admin.id,admin.username,'ADMIN',null],...managers.map((id,i)=>[id,'manager-'+i,'MANAGER',null]),...players.map((id,i)=>[id,'player-'+i,'PLAYER',managers[i]])])await run('insert into app_user(id,username,password_hash,role,balance,manager_id)values($1,$2,\'test\',$3,10000,$4)',[id,name,role,manager]);
 await run('update app_casino_settings set enabled=true where id=1');
 const agent=randomUUID();await run("insert into app_user(id,username,password_hash,role,balance)values($1,'agent-cascade','test','AGENT',10000)",[agent]);await run('update app_user set agent_id=$1 where id=any($2::uuid[])',[agent,managers]);
 const globalBefore=(await run('select game_controls from app_casino_settings where id=1')).rows[0];
 for(let i=0;i<2;i++)await saveManagerCasinoSettings({managerId:managers[i],gameId:'lucky-clover-x3',mode:'custom',rtp:i?100:96,hitFrequency:20,commission:i?7.5:12.25},admin,db);
 await assert.rejects(saveManagerCasinoSettings({managerId:managers[0],commission:3},{id:players[0],username:'player'},db),e=>e.status===403);
 await assert.rejects(saveManagerCasinoSettings({managerId:players[0],commission:3},admin,db),e=>e.status===404);
 await assert.rejects(saveManagerCasinoSettings({managerId:managers[0],gameId:'lucky-clover-x3',mode:'custom',rtp:96,hitFrequency:101},admin,db),e=>e.status===400);
 const seen=[],store=createOriginalWalletStore({database:db,checkBet:async()=>{},chooseRound:(id,options)=>{seen.push(options.controls);return selectCustomRound(id,options);}});
 for(let i=0;i<2;i++){
  const info=await getCasinoSettings(run,managers[i]);assert.equal(info.games.find(g=>g.gameId==='lucky-clover-x3').effectiveRtp,i?100:96);assert.equal(info.casinoCommission,i?7.5:12.25);
  const session=(await store.launch(players[i],'lucky-clover-x3')).sessionId;
  await store.act(players[i],'lucky-clover-x3',session,[{command:'create_session',sequence_number:0}]);
  const play={command:'play',sequence_number:1,game_denom:1,lines:5,line_bet:100,total_bet:500};
  await store.act(players[i],'lucky-clover-x3',session,[play]);await store.act(players[i],'lucky-clover-x3',session,[play]);
  assert.equal(seen.at(-1).rtp,i?100:96);
 }
 const commissions=(await run('select manager_id,rate_pct,amount,stake from app_manager_commission order by rate_pct')).rows;
 assert.equal(commissions.length,2,'replay never duplicates commission');
 for(const row of commissions)assert.equal(Number(row.amount),Number((Number(row.stake)*Number(row.rate_pct)/100).toFixed(2)));
 assert.deepEqual((await run('select game_controls from app_casino_settings where id=1')).rows[0],globalBefore,'scope never changes global math');
 for(const id of managers)assert.equal(Number((await run('select balance from app_user where id=$1',[id])).rows[0].balance),10000,'report-only commission never changes manager wallet');
 await saveManagerCasinoSettings({commission:8},admin,db);assert.equal((await managerCasinoSettings(run,{game_controls:{},game_profiles:{}},managers[0])).casinoCommission,12.25,'explicit manager commission overrides global');
 await saveManagerCasinoSettings({managerId:agent,gameId:'lucky-clover-x3',mode:'custom',rtp:40,hitFrequency:10},admin,db);
 for(let i=0;i<2;i++){
  const effective=await getCasinoSettings(run,managers[i]);assert.equal(effective.games.find(g=>g.gameId==='lucky-clover-x3').effectiveRtp,40);assert.equal(effective.games.find(g=>g.gameId==='lucky-clover-x3').effectiveHitFrequency,10);
  const session=(await store.launch(players[i],'lucky-clover-x3')).sessionId;await store.act(players[i],'lucky-clover-x3',session,[{command:'create_session',sequence_number:0}]);await store.act(players[i],'lucky-clover-x3',session,[{command:'play',sequence_number:1,game_denom:1,lines:5,line_bet:100,total_bet:500}]);assert.equal(seen.at(-1).rtp,40);assert.equal(seen.at(-1).hitFrequency,10);
 }
 // Separate Pixi wallet paths must apply the same agent hierarchy.
 for(const [gameId,spin]of [['sizzling',placeCasinoSpin],['bookofra',placeBookOfRaSpin]]){
  await saveManagerCasinoSettings({managerId:agent,gameId,mode:'custom',rtp:40,hitFrequency:10,commission:4},admin,db);
  for(const userId of players){
   const setting=await managerCasinoSettings(run,(await run('select * from app_casino_settings where id=1')).rows[0],managers[players.indexOf(userId)]);
   const args={userId,requestId:randomUUID(),bet:20,denomination:1,lines:gameId==='bookofra'?10:5,mathVersion:casinoMathVersion(gameId,setting)};
   await spin(args,{database:db,checkBet:async()=>{},chooseRound:(id,options)=>{assert.equal(options.controls.rtp,40);assert.equal(options.controls.hitFrequency,10);return selectCustomRound(id,options);}});
  }
 }
 const agentRates=(await run('select rate_pct from app_manager_commission order by created_at desc limit 4')).rows;assert.ok(agentRates.every(row=>Number(row.rate_pct)===4),'agent commission also overrides both manager rates');
 console.log('PASS agent40% overrides manager96/100 and reaches every descendant player paid sampler');
 console.log('PASS manager casino math96/100 reaches real paid-round sampler, two-manager isolation, global inheritance, replay-safe frozen commissions, active-role validation and unchanged manager wallets');
}finally{await sql.close();}
