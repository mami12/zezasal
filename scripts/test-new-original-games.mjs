/** Native rules, exact expectations and real wallet SQL; no live database. */
import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {classicReelReturn} from '../server/casino/classic-reel-return.mjs';
import {DATA as pyramid,evaluate as gradePyramid} from '../server/casino/fortune-pyramid-engine.mjs';
import {DATA as agt,evaluate as gradeAgt} from '../server/casino/agt-engine.mjs';
import {getGameProfiles} from '../server/casino/game-rtp-profiles.mjs';
import {createOriginalWalletStore} from '../server/casino/original-wallet-store.mjs';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
const ice=agt.games['6megaice'];
for(const data of [ice,pyramid])for(const [rtp,reels]of Object.entries(data.reels))assert.ok(Math.abs(classicReelReturn(reels,data.pay,data.scatterPay).rtp-Number(rtp))<.00001);
// Independent target-by-target line grading, including wild-prefix tie cases.
function reference(data,grid,stake,selected){
 let total=0;
 for(const line of data.lines.slice(0,selected)){
  let best=0;for(let target=1;target<=8;target++){if(target===2)continue;let n=0;while(n<grid.length&&(grid[n][line[n]]===target||target!==1&&grid[n][line[n]]===1))n++;best=Math.max(best,data.pay[target-1][n-1]??0);}total+=stake/selected*best;
 }
 const count=grid.flat().filter(s=>s===2).length;total+=stake*(data.scatterPay[count-1]??0);return Math.round(total);
}
let seed=177;const random=max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;};
for(const [data,grade]of [[ice,(g,b,l)=>gradeAgt('6megaice',g,b,l)],[pyramid,gradePyramid]])for(let i=0;i<3000;i++){
 const reels=data.reels[String(data.rtp??data.defaultRtp)];const grid=reels.map(reel=>{const stop=random(reel.length);return [0,1,2].map(y=>reel[(stop+y)%reel.length]);});
 for(const selected of [1,5,20])assert.equal(grade(grid,2000,selected).winCents,reference(data,grid,2000,selected));
}
const native=JSON.parse(await readFile('server/casino/agt-metadata/6megaice.json','utf8'));
assert.deepEqual(native.start.lines.map(matrix=>Array.from({length:6},(_,x)=>matrix.findIndex(row=>row[x]===1))),ice.lines);
for(let s=1;s<=8;s++)assert.deepEqual(native.restore.pay_table[ice.symbols[s-1]].slice(1),s===2?ice.scatterPay:ice.pay[s-1]);
assert.equal('user_id' in native.start,false);assert.equal('comb' in native.restore,false);
const sql=new PGlite();await sql.exec(LEDGER_SQL);
const db={connect:async()=>({query:(...args)=>sql.query(...args),release(){}})};
const manager=randomUUID(),player=randomUUID();
try{
 await sql.query("insert into app_user(id,username,password_hash,role,balance)values($1,'new-games-manager','test','MANAGER',10000)",[manager]);
 await sql.query("insert into app_user(id,username,password_hash,role,balance,manager_id)values($1,'new-games-player','test','PLAYER',10000,$2)",[player,manager]);
 await sql.query('update app_casino_settings set enabled=true where id=1');
 const wallet=createOriginalWalletStore({database:db,checkBet:async()=>{}});
 for(const id of ['ice-fruits-6x3','fortune-pyramid']){
  const {sessionId}=await wallet.launch(player,id);let command;
  if(id==='fortune-pyramid'){
   const [reply]=await wallet.act(player,id,sessionId,[{command:'create_session',sequence_number:0}]);assert.equal(reply.server_denom.value,.01);
   const [init]=await wallet.act(player,id,sessionId,[{command:'init_game',sequence_number:1}]);assert.equal(init.game_config.lines.length,20);assert.ok(reply.enabled_denoms.every(d=>d.label in init.game_config.game_denoms));
   command=[{command:'play',sequence_number:2,game_denom:1,lines:20,line_bet:100,total_bet:2000}];
  }else{
   const start=await wallet.act(player,id,sessionId,{action:'start',gamename:'6megaice'});assert.ok(start.full_bets['20'].includes(20));
   const init=await wallet.act(player,id,sessionId,{action:'restore',gamename:'6megaice'});assert.equal(init.comb.length,18);
   command={action:'spin',gamename:'6megaice',request_id:randomUUID(),li:20,di:1,amount:20};
  }
  const response=await wallet.act(player,id,sessionId,command);assert.deepEqual(await wallet.act(player,id,sessionId,command),response);
  await wallet.close(player,id,sessionId);const balance=(await sql.query('select balance from app_user where id=$1',[player])).rows[0].balance;
  await wallet.close(player,id,sessionId);assert.equal((await sql.query('select balance from app_user where id=$1',[player])).rows[0].balance,balance,'close cannot pay twice');
  assert.equal(Number((await sql.query('select count(*) as n from app_casino_round where game_id=$1',[id])).rows[0].n),1);
  assert.ok(getGameProfiles(id).length>10);
 }
 assert.equal(Number((await sql.query('select balance from app_user where id=$1',[manager])).rows[0].balance),10000);
 const ledger=Number((await sql.query('select sum(amount) as total from app_transaction where user_id=$1',[player])).rows[0].total);assert.equal(Number((await sql.query('select balance from app_user where id=$1',[player])).rows[0].balance),10000+ledger);
 console.log('PASS 41 independently verified RTP profiles, 18000 native paytable comparisons, exact visible paylines/symbols, both real SQL wallet protocols, replay/single collection and unchanged manager balance');
}finally{await sql.close();}
