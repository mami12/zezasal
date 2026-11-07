import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {createOriginalWalletStore,ORIGINAL_GAMES} from '../server/casino/original-wallet-store.mjs';
import {getGameProfiles,getGameProfile} from '../server/casino/game-rtp-profiles.mjs';
import {createCtProtocol} from '../server/casino/ct-protocol.mjs';
import {createAgtProtocol} from '../server/casino/agt-protocol.mjs';
import {spin as cloverSpin} from '../server/casino/lucky-clover-engine.mjs';
import {spin as vikingsSpin,spinRound,evaluate as vikingsGrade} from '../server/casino/vikings-engine.mjs';
import {spin as agtSpin,evaluate as agtGrade,DATA as AGT} from '../server/casino/agt-engine.mjs';
import {vikingsConfig,mapVikingsRound} from '../server/casino/vikings-ct-router.mjs';
import {createFireJokerProtocol} from '../server/casino/firejoker-protocol.mjs';
import {createFortunePyramidProtocol} from '../server/casino/fortune-pyramid-protocol.mjs';
import {createFortuneTellerProtocol} from '../server/casino/fortune-teller-protocol.mjs';

// Tests run actual SQL and engine calls in memory; no external database or
// production credentials are used, and no network spins are sent.
const sql=new PGlite();await sql.exec(LEDGER_SQL);
let queue=Promise.resolve();
const database={async connect(){let release;const before=queue;queue=new Promise(resolve=>release=resolve);await before;return {query:(...args)=>sql.query(...args),release};}};
const manager=randomUUID(),players=[randomUUID(),randomUUID()];
await sql.query('insert into app_user(id,username,password_hash,role,balance) values($1,$2,$3,$4,$5)',[manager,manager,'test-only','MANAGER',10000000]);
for(const user of players)await sql.query('insert into app_user(id,username,password_hash,role,balance,manager_id) values($1,$2,$3,$4,$5,$6)',[user,user,'test-only','PLAYER',10000,manager]);
const seen=[],record=(id,options)=>seen.push({id,profile:options.mathProfile.id});
const ct=createCtProtocol({spinFn:(bet,lines,options)=>{record('lucky-clover-x3',options);return cloverSpin(bet,lines,()=>0,options);},cardRandom:()=>0});
const vikings=createCtProtocol({spinFn:(bet,lines,options)=>{record('vikings-fun',options);return spinRound(bet,lines,(b,l,free,spinOptions)=>({...vikingsSpin(b,l,free,()=>0,spinOptions),freeSpins:0}),options);},configFn:vikingsConfig,initialGrid:()=>vikingsSpin(25,25,false,()=>0).grid,selectedLines:25,mapRound:mapVikingsRound});
let bonusNext=false;
const agt=createAgtProtocol({spinFn:(id,bet,lines,options)=>{record(id,options);const result=agtSpin(id,bet,lines,()=>0,options),freeSpins=bonusNext?2:0;bonusNext=false;return {...result,freeSpins};},cardRandom:()=>0});
const tracked=(id,protocol)=>({...protocol,run(state,commands,options){if(commands.some(c=>c.command==='play'))record(id,options);return protocol.run(state,commands,options);}});
const firejoker=tracked('firejoker',createFireJokerProtocol({random:()=>0})),fortuneTeller=tracked('fortune-teller',createFortuneTellerProtocol({random:()=>0}));
const fortunePyramid=tracked('fortune-pyramid',createFortunePyramidProtocol());
const protocols={database,ct,vikings,agt,firejoker,fortuneTeller,fortunePyramid};
let store=createOriginalWalletStore(protocols),settings={};
const apply=async(id,profile)=>{settings={...settings,[id]:profile.id};await sql.query('update app_casino_settings set game_profiles=$1::jsonb where id=1',[JSON.stringify(settings)]);};
const saved=async(user,id)=>(await sql.query('select state from app_casino_original_state where user_id=$1 and game_id=$2',[user,id])).rows[0].state;
const balance=async user=>Number((await sql.query('select balance from app_user where id=$1',[user])).rows[0].balance);
const assertMoney=(actual,expected,message)=>assert.equal(Math.round(actual*100),Math.round(expected*100),message);
const totalBefore=(await Promise.all([manager,...players].map(balance))).reduce((sum,n)=>sum+n,0);
const paidProfiles=id=>getGameProfiles(id).filter(profile=>profile.theoreticalRtp>=1&&profile.theoreticalRtp<=1000);

for(const [id,game] of Object.entries(ORIGINAL_GAMES)){
 const profiles=paidProfiles(id),low=profiles[0],high=profiles.at(-1);
 await apply(id,low);
 const sessions=[];
 for(const user of players){
  const session=(await store.launch(user,id)).sessionId;sessions.push({user,session,sequence:0});
  assert.equal((await saved(user,id)).mathProfile.id,low.id);
 }
 const act=async(entry,action,fields={})=>{
  entry.lastParams=game.kind==='ct'?{command:action,sequence_number:entry.sequence++,...fields}:{action,gamename:game.app,request_id:randomUUID(),...fields};
  if(game.kind==='ct')return (await store.act(entry.user,id,entry.session,[entry.lastParams]))[0];
  return store.act(entry.user,id,entry.session,entry.lastParams);
 };
 const lines=game.lines??(id==='vikings-fun'?25:5);
 const play=async entry=>game.kind==='ct'?act(entry,'play',{game_denom:1,lines,line_bet:100,total_bet:lines*100}):act(entry,'spin',{li:AGT.games[game.app].lines.length,di:1,amount:20});
 const finish=async(entry,result)=>{
  if(game.kind==='ct')await act(entry,'game_finished',{gameplay_id:result.gameplay_id});
  else await act(entry,'save');
 };
 if(game.kind==='ct')for(const entry of sessions)await act(entry,'create_session');
 seen.length=0;
 for(const entry of sessions){const result=await play(entry);assert.equal(seen.at(-1).profile,low.id);await finish(entry,result);}
 await apply(id,high);
 for(const entry of sessions){
  const before=seen.length,result=await play(entry);assert.equal(seen.length,before+1);assert.equal(seen.at(-1).profile,high.id);
  const roundState=await saved(entry.user,id),round=(await sql.query('select game_version,result from app_casino_round where id=$1',[roundState.roundId])).rows[0];
  assert.equal(round.game_version,high.id);assert.equal(round.result.mathProfile.id,high.id);assert.equal((await saved(entry.user,id)).mathProfile.id,high.id);
  // An already committed request must replay its exact old result after the
  // administrator changes the selected profile, without another engine call.
  const eventParams=entry.lastParams;
  await apply(id,low);const calls=seen.length,oldBalance=await balance(entry.user);
  const replay=await store.act(entry.user,id,entry.session,game.kind==='ct'?[eventParams]:eventParams);
  assert.deepEqual(game.kind==='ct'?replay[0]:replay,result);assert.equal(seen.length,calls);assert.equal(await balance(entry.user),oldBalance);
  await finish(entry,result);await apply(id,high);
 }
 for(const entry of sessions)await store.close(entry.user,id,entry.session);
}

// Changing a global profile never changes an awarded bonus, including after a
// backend restart. Corrupt future-spin settings must not block its collection.
const id='fruit-queen',low=paidProfiles(id)[0],high=paidProfiles(id).at(-1),user=players[0];
await apply(id,low);let token=(await store.launch(user,id)).sessionId;
const agtAct=(action,fields={})=>store.act(user,id,token,{action,gamename:'fruitqueen',request_id:randomUUID(),...fields});
bonusNext=true;await agtAct('spin',{li:18,di:1,amount:20});assert.equal((await saved(user,id)).remaining,2);
await apply(id,high);store=createOriginalWalletStore(protocols);
seen.length=0;await agtAct('freespin',{li:18,di:1,amount:20});assert.equal(seen.at(-1).profile,low.id);
await sql.query('update app_casino_settings set game_profiles=$1::jsonb where id=1',[JSON.stringify({...settings,[id]:'unsupported'})]);
await agtAct('freespin',{li:18,di:1,amount:20});assert.equal(seen.at(-1).profile,low.id);assert.equal((await saved(user,id)).remaining,0);
await assert.rejects(agtAct('spin',{li:18,di:1,amount:20}),/Unsupported reel profile/);
await store.close(user,id,token);
await apply(id,high);token=(await store.launch(user,id)).sessionId;
await agtAct('spin',{li:18,di:1,amount:20});assert.equal(seen.at(-1).profile,high.id);await store.close(user,id,token);

// Older persisted bonus states have no metadata; they finish with the original
// default profile rather than silently adopting a newly selected global one.
await apply(id,low);token=(await store.launch(user,id)).sessionId;bonusNext=true;
await agtAct('spin',{li:18,di:1,amount:20});
await sql.query("update app_casino_original_state set state=state-'mathProfile' where user_id=$1 and game_id=$2",[user,id]);
await apply(id,high);await agtAct('freespin',{li:18,di:1,amount:20});assert.equal(seen.at(-1).profile,getGameProfile(id).id);
await agtAct('freespin',{li:18,di:1,amount:20});assert.equal((await saved(user,id)).remaining,0);
await store.close(user,id,token);

// Exercise accepted bonus state with deterministic awarded wins. The supplied
// AGT data currently awards no free spins; this fixture verifies persistence
// without enabling or changing either game's production math.
let awardBonus=false;
const bonusProtocol=createAgtProtocol({spinFn:(app,bet,lines,options)=>{
 const d=AGT.games[app],grid=Array.from({length:d.sx},()=>Array(d.sy).fill(app==='fruitqueen'?8:1));
 const result={grid,...agtGrade(app,grid,bet,lines),freeSpins:awardBonus?2:0};awardBonus=false;return result;
},cardRandom:()=>0});
const bonusStore=()=>createOriginalWalletStore({database,ct,vikings,agt:bonusProtocol});
for(const gameId of ['fruit-queen','seven-hot']){
 const app=ORIGINAL_GAMES[gameId].app,lines=AGT.games[app].lines.length,low=paidProfiles(gameId)[0],high=paidProfiles(gameId).at(-1);
 await apply(gameId,low);let resumedStore=bonusStore(),session=(await resumedStore.launch(user,gameId)).sessionId;
 const before=await balance(user),action=(name,fields={})=>resumedStore.act(user,gameId,session,{action:name,gamename:app,request_id:randomUUID(),...fields});
 awardBonus=true;const paid=await action('spin',{li:lines,di:1,amount:20}),original=await saved(user,gameId),expired=session;
 assert.equal(original.remaining,2);assert(paid.win>0);
 await apply(gameId,high);await sql.query('update app_casino_settings set enabled=false where id=1');
 resumedStore=bonusStore();session=(await resumedStore.launch(user,gameId)).sessionId;
 const reopened=await saved(user,gameId);assert.equal(reopened.closed,false);assert.equal(reopened.pending,0);
 for(const key of ['roundId','bet','lines','denom','remaining','totalFree','bonusWin','round'])assert.deepEqual(reopened[key],original[key],`resume must preserve ${key}`);
 assert.deepEqual(reopened.history,original.history);assert.deepEqual(reopened.mathProfile,original.mathProfile);
 assertMoney(await balance(user),before-20+paid.win);
 await assert.rejects(resumedStore.act(user,gameId,expired,{action:'balance',gamename:app}),/expired/);
 const firstFree=await action('freespin',{li:lines,di:1,amount:20});assert.equal((await saved(user,gameId)).remaining,1);
 await resumedStore.close(user,gameId,session);assertMoney(await balance(user),before-20+paid.win+firstFree.win);
 await sql.query('update app_casino_settings set game_profiles=$1::jsonb where id=1',[JSON.stringify({...settings,[gameId]:'unsupported'})]);
 resumedStore=bonusStore();session=(await resumedStore.launch(user,gameId)).sessionId;
 assert.equal((await saved(user,gameId)).remaining,1);assert.equal((await saved(user,gameId)).mathProfile.id,low.id);
 const lastParams={action:'freespin',gamename:app,request_id:randomUUID(),li:lines,di:1,amount:20};
 const lastFree=await resumedStore.act(user,gameId,session,lastParams),retry=await resumedStore.act(user,gameId,session,lastParams);assert.deepEqual(retry,lastFree);
 await resumedStore.close(user,gameId,session);
 const expected=paid.win+firstFree.win+lastFree.win;
 assertMoney(await balance(user),before-20+expected);
 const round=(await sql.query('select payout from app_casino_round where id=$1',[original.roundId])).rows[0];
 const credited=(await sql.query("select coalesce(sum(amount),0) as amount from app_transaction where user_id=$1 and reference_id=$2 and type='CASINO_WIN'",[user,original.roundId])).rows[0];
 assertMoney(Number(round.payout),expected);assertMoney(Number(credited.amount),expected,'all accepted bonus awards must be credited exactly once');
 await assert.rejects(resumedStore.launch(user,gameId),/disabled/);
 await sql.query('update app_casino_settings set enabled=true where id=1');await apply(gameId,high);
 session=(await resumedStore.launch(user,gameId)).sessionId;assert.equal((await saved(user,gameId)).mathProfile.id,high.id);
 await resumedStore.close(user,gameId,session);
}

const trigger=[[2,7,8],[2,8,7],[2,6,7],[5,6,7],[8,10,11]],normal=[[5,6,7],[7,8,9],[9,10,11],[3,4,5],[6,7,8]];
const ctBonus=createCtProtocol({spinFn:(bet,lines,options)=>spinRound(bet,lines,(b,l,free)=>{const grid=free?normal:trigger;return {grid,...vikingsGrade(grid,b,l,free)};},options),configFn:vikingsConfig,selectedLines:25,initialGrid:()=>normal,mapRound:mapVikingsRound});
const ctBonusStore=createOriginalWalletStore({database,ct,vikings:ctBonus,agt});
await apply('vikings-fun',paidProfiles('vikings-fun')[0]);
let ctSession=(await ctBonusStore.launch(user,'vikings-fun')).sessionId;
await ctBonusStore.act(user,'vikings-fun',ctSession,[{command:'create_session',sequence_number:1}]);
const beforeCt=await balance(user),ctPaid=(await ctBonusStore.act(user,'vikings-fun',ctSession,[{command:'play',sequence_number:2,game_denom:1,lines:25,line_bet:100,total_bet:2500}]))[0];
const ctState=await saved(user,'vikings-fun'),ctPending=ctState.pending/100;assert.equal(ctPaid.result.filter(result=>result.type==='slot_subgame').length,16);assert(ctPending>0);
await apply('vikings-fun',paidProfiles('vikings-fun').at(-1));await sql.query('update app_casino_settings set enabled=false where id=1');
await ctBonusStore.close(user,'vikings-fun',ctSession);assertMoney(await balance(user),beforeCt-20+ctPending);
await ctBonusStore.close(user,'vikings-fun',ctSession);assertMoney(await balance(user),beforeCt-20+ctPending);
await sql.query('update app_casino_settings set enabled=true where id=1');ctSession=(await ctBonusStore.launch(user,'vikings-fun')).sessionId;
assertMoney(await balance(user),beforeCt-20+ctPending);assert.equal((await saved(user,'vikings-fun')).mathProfile.id,paidProfiles('vikings-fun').at(-1).id);
assert.equal(Number((await sql.query('select payout from app_casino_round where id=$1',[ctState.roundId])).rows[0].payout),ctPending);
await ctBonusStore.close(user,'vikings-fun',ctSession);

for(const [gameId,game] of Object.entries(ORIGINAL_GAMES)){
 const unsafe={id:'UNSUPPORTED_PROFILE_NOT_IN_THIS_GAME'};
 await apply(gameId,paidProfiles(gameId)[0]);const session=(await store.launch(user,gameId)).sessionId;
 if(game.kind==='ct')await store.act(user,gameId,session,[{command:'create_session',sequence_number:1}]);
 await apply(gameId,unsafe);const before=await balance(user),calls=seen.length;
 const lines=game.lines??(gameId==='vikings-fun'?25:5);
 const params=game.kind==='ct'?[{command:'play',sequence_number:2,game_denom:1,lines,line_bet:100,total_bet:lines*100}]:{action:'spin',gamename:game.app,request_id:randomUUID(),li:AGT.games[game.app].lines.length,di:1,amount:20};
 await assert.rejects(store.act(user,gameId,session,params),error=>error.status===503);
 assert.equal(await balance(user),before);assert.equal(seen.length,calls,'unsafe future profile must fail before drawing a reel stop');
 await store.close(user,gameId,session);await apply(gameId,paidProfiles(gameId)[0]);
}
const totalAfter=(await Promise.all([manager,...players].map(balance))).reduce((sum,n)=>sum+n,0);
const posted=Number((await sql.query('select coalesce(sum(amount),0) as amount from app_transaction where user_id=any($1::uuid[])',[players])).rows[0].amount);
assert.equal(Math.round(totalAfter*100),Math.round(totalBefore*100)+Math.round(posted*100));
assert.equal(await balance(manager),10000000,'casino play never transfers money to the manager wallet');
await sql.close();console.log('PASS real SQL global profiles in all native originals, two-player scope, next-paid selection, round metadata, idempotent replay, frozen bonuses/restart, invalid-profile collection, and ledger reconciliation');
