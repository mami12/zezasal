import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {createOriginalWalletStore} from '../server/casino/original-wallet-store.mjs';
import {createCtProtocol} from '../server/casino/ct-protocol.mjs';
import {evaluate} from '../server/casino/vikings-engine.mjs';
import {vikingsConfig,mapVikingsRound} from '../server/casino/vikings-ct-router.mjs';

// Find a genuine native 4-cent win at the 20-cent total/25-line stake.
let seed=12345,grid,grade;
const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
for(let attempt=0;attempt<100000;attempt++){
 grid=Array.from({length:5},()=>Array.from({length:3},()=>3+next()%9));grade=evaluate(grid,20,25);
 if(grade.winCents===4&&grade.freeSpins===0)break;
}
assert.equal(grade.winCents,4);
const sql=new PGlite();await sql.exec(LEDGER_SQL);
let queue=Promise.resolve();
const database={async connect(){let release;const before=queue;queue=new Promise(resolve=>release=resolve);await before;return{query:(...args)=>sql.query(...args),release};}};
const user=randomUUID(),manager=randomUUID();
await sql.query('insert into app_user(id,username,password_hash,role,balance) values($1,$2,$3,$4,$5)',[manager,manager,'test-only','MANAGER',10000]);
await sql.query('insert into app_user(id,username,password_hash,role,balance,manager_id) values($1,$2,$3,$4,$5,$6)',[user,user,'test-only','PLAYER',1000,manager]);
const balance=async id=>Number((await sql.query('select balance from app_user where id=$1',[id])).rows[0].balance);
try{
 for(const [part,key,card,pendingCents] of [['half','red',0,6],['half','red',26,2],['all','red',0,8],['all','red',26,0],['half','diamond',0,10],['all','diamond',0,16]]){
  const protocol=createCtProtocol({selectedLines:25,configFn:vikingsConfig,mapRound:mapVikingsRound,initialGrid:()=>grid,cardRandom:()=>card,
   spinFn:(stake,lines)=>{const result={grid,...evaluate(grid,stake,lines),free:false,freeGameNumber:0,freeGameTotal:0};return {grid,winCents:result.winCents,games:[{...result,totalWin:result.winCents}]};}});
  const store=createOriginalWalletStore({database,vikings:protocol}),session=(await store.launch(user,'vikings-fun')).sessionId;
  let sequence=0;
  const act=async command=>(await store.act(user,'vikings-fun',session,[command]))[0];
  await act({command:'create_session',sequence_number:sequence++});
  const before=await balance(user),paid=await act({command:'play',sequence_number:sequence++,game_denom:1,lines:25,line_bet:1,total_bet:25});
  assert.equal(paid.result[0].total_win,5);assert.equal(await balance(user),Number((before-.20).toFixed(2)));
  const request={command:'continue',sequence_number:sequence++,gameplay_id:paid.gameplay_id,step_number:1,continue_params:{double_betpart:part,double_key:key}};
  const result=await act(request);
  assert.equal(result.status.status,'ok');assert.equal(result.result[0].win,pendingCents/.8);
  assert.deepEqual(await act(request),result,'a gamble retry cannot draw or settle twice');
  const state=(await sql.query('select state from app_casino_original_state where user_id=$1 and game_id=$2',[user,'vikings-fun'])).rows[0].state;
  assert.equal(state.pending,pendingCents);assert(Number.isSafeInteger(state.pending));
  await act({command:'game_finished',sequence_number:sequence++,gameplay_id:paid.gameplay_id});
  assert.equal(await balance(user),Number((before-.20+pendingCents/100).toFixed(2)));
  assert.equal(Number((await sql.query('select payout from app_casino_round where id=$1',[state.roundId])).rows[0].payout),pendingCents/100);
  assert.equal(Number(((await balance(user))+(await balance(manager))).toFixed(2)),11000);
 }
 // Execute the exact archived client cash renderer. Number credits are kept;
 // 7.5 provider credits at 0.8 cents display six wallet cents, not five.
 const source=readFileSync(new URL('../web/public/casino-original/vikings-fun/vendor/html-20200413-stable/rgs/second2.min.js',import.meta.url),'utf8');
 assert(source.includes('gameWin=Number(currDouble.win)'));
 const nativeCash=source.match(/this\.cash=(function\(e,t\)\{return t\|cashOnly\?ammountString\(e\*currDenom\.cents\)\+cashReg:addThousendSeparators\(e\)\})/);
 assert(nativeCash,'the original cash renderer must preserve Number credit counts');
 const cash=vm.runInNewContext('('+nativeCash[1]+')',{cashOnly:true,currDenom:{cents:.8},cashReg:'',ammountString:cents=>(cents/100).toFixed(2),addThousendSeparators:String});
 assert.equal(cash(7.5),'0.06');assert.equal(cash(2.5),'0.02');assert.equal(cash(12.5),'0.10');
 console.log('PASS Viking 0.20 stake: native four-cent win, Half red win/loss, All red win/loss, Half/All suit, immutable replay, whole-cent SQL settlement, original fractional-credit rendering and conserved funds');
}finally{await sql.close();}
