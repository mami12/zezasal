import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {createOriginalWalletStore,ORIGINAL_GAMES} from '../server/casino/original-wallet-store.mjs';
import {createCtProtocol} from '../server/casino/ct-protocol.mjs';
import {createAgtProtocol} from '../server/casino/agt-protocol.mjs';
import {vikingsConfig,mapVikingsRound} from '../server/casino/vikings-ct-router.mjs';
import {spin as vikingSpin,spinRound} from '../server/casino/vikings-engine.mjs';
import {placeCasinoSpin,settlePendingWin} from '../server/casino/transactions.mjs';
import {placeBookOfRaSpin,bookOfRaFreeState} from '../server/casino/bookofra-transactions.mjs';
import {casinoMathVersion} from '../server/casino/casino-controls.mjs';
import {selectCustomRound,getCustomCatalog,gradeCustomTrajectory} from '../server/casino/custom-math.mjs';
import {getPaidGameProfile} from '../server/casino/game-rtp-profiles.mjs';
import {FREE_SPINS} from '../server/casino/bookofra.mjs';

// Production SQL, protocols, selection and settlement run only in a fresh
// in-memory PostgreSQL database. No configured pool or real funds are accessed.
process.env.BOOKOFRA_FREE_SPINS='0';
const sql=new PGlite();await sql.exec(LEDGER_SQL);
let queue=Promise.resolve();
const database={query:(...args)=>sql.query(...args),async connect(){let release;const previous=queue;queue=new Promise(resolve=>release=resolve);await previous;return {query:(...args)=>sql.query(...args),release};}};
const manager=randomUUID(),player=randomUUID();
await sql.query('insert into app_user(id,username,password_hash,role,balance) values($1,$2,$3,$4,$5)',[manager,manager,'isolated-test-only','MANAGER',100000000]);
await sql.query('insert into app_user(id,username,password_hash,role,balance,manager_id) values($1,$2,$3,$4,$5,$6)',[player,player,'isolated-test-only','PLAYER',1000000,manager]);
const cents=value=>Math.round(Number(value)*100),balance=async id=>cents((await sql.query('select balance from app_user where id=$1',[id])).rows[0].balance);
const initialPlayer=await balance(player),initialManager=await balance(manager);
const row=async id=>(await sql.query('select * from app_casino_round where id=$1',[id])).rows[0];
const nativeState=async id=>(await sql.query('select state from app_casino_original_state where user_id=$1 and game_id=$2',[player,id])).rows[0]?.state;
const freeState=async()=>(await sql.query('select * from app_casino_freespin_state where user_id=$1',[player])).rows[0];
const financialSnapshot=async()=>({player:await balance(player),manager:await balance(manager),rounds:Number((await sql.query('select count(*) as n from app_casino_round')).rows[0].n),transactions:Number((await sql.query('select count(*) as n from app_transaction')).rows[0].n)});
let controls={},profiles={},chooseCalls=0,initialCalls=0,forcedPlan=null,lastPlan=null,seed=91383;
const random=bound=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/2**32*bound);};
const apply=async(gameId,mode='custom',rtp=0,hitFrequency=0)=>{
 controls={...controls,[gameId]:{mode,rtp,hitFrequency}};
 await sql.query('update app_casino_settings set enabled=true,game_controls=$1::jsonb,game_profiles=$2::jsonb where id=1',[JSON.stringify(controls),JSON.stringify(profiles)]);
 return version(gameId);
};
const version=gameId=>casinoMathVersion(gameId,{game_controls:controls,game_profiles:profiles});
const chooseRound=(gameId,options)=>{
 chooseCalls++;lastPlan=forcedPlan??selectCustomRound(gameId,options,random);forcedPlan=null;return lastPlan;
};
const instrument=protocol=>({...protocol,initialState:(...args)=>{initialCalls++;return protocol.initialState(...args);}});
const ct=instrument(createCtProtocol());
const vikings=instrument(createCtProtocol({spinFn:spinRound,configFn:vikingsConfig,initialGrid:options=>vikingSpin(25,25,false,options).grid,selectedLines:25,mapRound:mapVikingsRound}));
const agt=instrument(createAgtProtocol());
const createStore=()=>createOriginalWalletStore({database,ct,vikings,agt,chooseRound});
let store=createStore();
const legacyOptions={database,chooseRound,random};
const nativeEntry=async(gameId,mathVersion)=>{
 const result=await store.launch(player,gameId,{mathVersion});
 const entry={gameId,session:result.sessionId,sequence:0,last:null};
 if(ORIGINAL_GAMES[gameId].kind==='ct')await nativeAct(entry,'create_session');
 return entry;
};
async function nativeAct(entry,action,fields={}){
 const game=ORIGINAL_GAMES[entry.gameId];
 entry.last=game.kind==='ct'?{command:action,sequence_number:entry.sequence++,...fields}:{action,gamename:game.app,request_id:randomUUID(),...fields};
 const response=await store.act(player,entry.gameId,entry.session,game.kind==='ct'?[entry.last]:entry.last);
 return game.kind==='ct'?response[0]:response;
}
const nativePaid=(entry,stake)=>ORIGINAL_GAMES[entry.gameId].kind==='ct'
 ?nativeAct(entry,'play',{game_denom:1,lines:entry.gameId==='vikings-fun'?25:5,line_bet:Math.round(stake/.20),total_bet:(entry.gameId==='vikings-fun'?25:5)*Math.round(stake/.20)})
 :nativeAct(entry,'spin',{li:entry.gameId==='fruit-queen'?18:20,di:1,amount:stake});
const nativeFinish=(entry,response)=>ORIGINAL_GAMES[entry.gameId].kind==='ct'?nativeAct(entry,'game_finished',{gameplay_id:response.gameplay_id}):nativeAct(entry,'save');
const nativeReplay=async(entry,params)=>{const result=await store.act(player,entry.gameId,entry.session,ORIGINAL_GAMES[entry.gameId].kind==='ct'?[params]:params);return ORIGINAL_GAMES[entry.gameId].kind==='ct'?result[0]:result;};
const pixiArgs=(gameId,stake)=>({userId:player,requestId:randomUUID(),mathVersion:version(gameId),lines:gameId==='sizzling'?5:10,
 ...(stake===20?{bet:1,denomination:gameId==='sizzling'?4:2}:stake===5000?{bet:100,denomination:gameId==='sizzling'?10:5}:{bet:gameId==='sizzling'?2:1,denomination:1})});
const pixiPlace=(id,args,options=legacyOptions)=>(id==='sizzling'?placeCasinoSpin:placeBookOfRaSpin)(args,options);
const collect=()=>settlePendingWin(player,{database});
const assertPlayerLedger=async()=>{
 const posted=await sql.query('select coalesce(sum(amount),0) as amount from app_transaction where user_id=$1',[player]);
 assert.equal(await balance(player),initialPlayer+cents(posted.rows[0].amount),'player balance equals its posted debits and payouts');
 assert.equal(await balance(manager),initialManager,'casino activity never changes the manager wallet');
 assert.equal(Number((await sql.query('select count(*) as n from app_transaction where user_id=$1',[manager])).rows[0].n),0,'no automatic manager transaction');
};
const isVersionError=error=>error.status===409&&error.code==='CASINO_MATH_CHANGED';
const zeroMasks=(id,response)=>{
 if(ORIGINAL_GAMES[id]?.kind==='ct'){
  const slots=response.result.filter(result=>result.type==='slot_subgame');assert(slots.length>0);
  for(const slot of slots){assert.equal(Number(slot.win),0);assert.equal(Number(slot.total_win),0);assert.deepEqual(slot.lines_win,[]);assert.deepEqual(slot.scatters_win,[]);}
  assert(!response.result.some(result=>result.type==='can_play_red_black_double'));
 }else if(ORIGINAL_GAMES[id]){
  assert.equal(response.win,0);assert(response.linesMask.every(mask=>mask===0));assert(response.linesValue.every(value=>value===0));assert.equal(response.bonus,0);
 }else if(id==='sizzling'){assert.equal(response.payout,0);assert.deepEqual(response.result.line_wins,[]);}
 else{assert.equal(response.payout,0);assert.deepEqual(response.graded.line_wins,[]);assert.equal(response.free,null);}
};
const positivePlan=(id,stakeCents,lines)=>{
 for(let attempt=0;attempt<1000;attempt++){
  const plan=selectCustomRound(id,{stakeCents,lines,controls:controls[id]},random);
  if(plan.payoutCents>0)return plan;
 }
 throw Error('Seeded fixture failed to select a positive custom trajectory');
};

try{
 let boundaryRounds=0,positiveRounds=0;
 for(const id of [...Object.keys(ORIGINAL_GAMES),'sizzling','bookofra']){
  const acknowledged=await apply(id);
  const native=Boolean(ORIGINAL_GAMES[id]);
  const beforeMissing=await financialSnapshot(),beforeInitial=initialCalls,beforeChoose=chooseCalls;
  if(native){
   await assert.rejects(store.launch(player,id),isVersionError);
   await assert.rejects(store.launch(player,id,{mathVersion:'stale-version'}),isVersionError);
  }else{
   const args=pixiArgs(id,20);delete args.mathVersion;
   await assert.rejects(pixiPlace(id,args),isVersionError);
   await assert.rejects(pixiPlace(id,{...args,mathVersion:'stale-version'}),isVersionError);
  }
  assert.deepEqual(await financialSnapshot(),beforeMissing);assert.equal(initialCalls,beforeInitial);assert.equal(chooseCalls,beforeChoose,'missing acknowledgement must not select a round');
  const entry=native?await nativeEntry(id,acknowledged):null;
  // A launch acknowledgement never authorizes a subsequently changed profile.
  await apply(id,'custom',95,10);
  const beforeStale=await financialSnapshot(),calls=chooseCalls;
  await assert.rejects(native?nativePaid(entry,20):pixiPlace(id,{...pixiArgs(id,20),mathVersion:acknowledged}),isVersionError);
  assert.deepEqual(await financialSnapshot(),beforeStale);assert.equal(chooseCalls,calls);
  await apply(id);
  for(const stake of [20,5000]){
   const before=await balance(player),beforeHouse=await balance(manager);
   const args=native?null:pixiArgs(id,stake);
   const result=native?await nativePaid(entry,stake):await pixiPlace(id,args);
   const originalRequest=native?structuredClone(entry.last):args;
   const state=native?await nativeState(id):null,saved=await row(native?state.roundId:result.roundId);
   assert.equal(await balance(player),before-cents(stake));assert.equal(await balance(manager),beforeHouse);
   assert.equal(cents(saved.stake),cents(stake));assert.equal(cents(saved.payout),0);zeroMasks(id,result);
   const metadata=native?saved.result.mathProfile.customMath:saved.result.customMath;
   assert.equal(metadata.rtp,0);assert.equal(metadata.hitFrequency,0);assert.equal(metadata.version,lastPlan.version);assert.equal(saved.game_version,lastPlan.version);
   // Exact accepted requests replay even when new rounds are disabled and the
   // new global terms no longer match the old session/argument version.
   await apply(id,'custom',95,10);await sql.query('update app_casino_settings set enabled=false where id=1');
   const beforeReplay=await financialSnapshot(),oldCalls=chooseCalls;
   const replay=native?await nativeReplay(entry,originalRequest):await pixiPlace(id,originalRequest);
   if(native)assert.deepEqual(replay,result);else{assert.equal(replay.roundId,result.roundId);assert.equal(replay.payout,0);assert.equal(replay.replayed,true);}
   assert.deepEqual(await financialSnapshot(),beforeReplay);assert.equal(chooseCalls,oldCalls);
   if(native)await nativeFinish(entry,result);else await collect();
   assert.equal(await balance(player),before-cents(stake));await assertPlayerLedger();await apply(id);boundaryRounds++;
  }
  if(native)await store.close(player,id,entry.session);

  // Positive custom rounds still use the unscaled native paytable and retain
  // the exact accepted targets, catalog version, result and pending payout.
  for(const [rtp,hitFrequency] of [[95,10],[600,100]]){
  await apply(id,'custom',rtp,hitFrequency);
  const lines=id==='vikings-fun'?25:id==='fruit-queen'?18:id==='seven-hot'?20:id==='bookofra'?10:5;
  forcedPlan=positivePlan(id,2000,lines);const expected=forcedPlan;
  const before=await balance(player),positiveEntry=native?await nativeEntry(id,version(id)):null;
  const result=native?await nativePaid(positiveEntry,20):await pixiPlace(id,pixiArgs(id,20));
  const saved=await row(native?(await nativeState(id)).roundId:result.roundId);
  assert.equal(cents(saved.payout),expected.payoutCents);assert.equal(await balance(player),before-2000);
  const metadata=native?saved.result.mathProfile.customMath:saved.result.customMath;
  assert.equal(metadata.rtp,rtp);assert.equal(metadata.hitFrequency,hitFrequency);assert.equal(metadata.version,expected.version);assert.equal(saved.game_version,expected.version);
  if(native){
   const state=await nativeState(id);assert.equal(state.pending,expected.payoutCents);
   if(ORIGINAL_GAMES[id].kind==='agt'){
    assert.equal(cents(result.win),expected.payoutCents);assert.deepEqual(state.last.comb,result.comb);
   }else{
    const slots=result.result.filter(value=>value.type==='slot_subgame');assert.equal(slots.length,expected.spins.length);
    assert.equal(cents(Number(slots.at(-1).total_win)*(id==='vikings-fun'?.008:.04)),expected.payoutCents);
   }
   await nativeFinish(positiveEntry,result);await store.close(player,id,positiveEntry.session);
  }else{
   assert.equal(cents(result.payout),expected.payoutCents);
   assert.deepEqual(id==='bookofra'?result.grid:Object.values(result.result.symbols).map(column=>Object.values(column).map(symbol=>symbol.code)),expected.spins[0].grid);
   await collect();
  }
  assert.equal(await balance(player),before-2000+expected.payoutCents);const once=await balance(player);await collect();assert.equal(await balance(player),once);await assertPlayerLedger();positiveRounds++;
  }

  // Switching back restores the real chosen original engine profile, without
  // consulting the custom selector or retaining custom probability metadata.
  profiles={...profiles,[id]:getPaidGameProfile(id).id};await apply(id,'original',95,10);
  const beforeOriginalCalls=chooseCalls;
  if(native){
   const original=await nativeEntry(id,version(id));await nativePaid(original,20);
   const saved=await row((await nativeState(id)).roundId);assert.equal(saved.game_version,profiles[id]);assert.equal(saved.result.mathProfile.customMath,undefined);
   await store.close(player,id,original.session);
  }else{
   const result=await pixiPlace(id,pixiArgs(id,20));const saved=await row(result.roundId);
   assert.equal(saved.game_version,profiles[id]);assert.equal(saved.result.customMath,undefined);await collect();
  }
  assert.equal(chooseCalls,beforeOriginalCalls);await assertPlayerLedger();
 }

 // A fully accepted custom Book bonus is immutable through collect/reload,
 // server-store recreation, new settings, free-spin OFF, global OFF and retries.
 process.env.BOOKOFRA_FREE_SPINS='1';await apply('bookofra','custom',95,10);
 const catalog=getCustomCatalog('bookofra'),stakeCents=2000,lines=10;
 const trajectory=catalog.trajectories.find(trajectory=>{
  if(trajectory.stops.length<=1)return false;
  const plan=gradeCustomTrajectory('bookofra',trajectory,{stakeCents,lines});
  return plan.spins[0].winCents>0&&plan.spins.slice(1).some(spin=>spin.winCents>0);
 });
 assert(trajectory,'catalog must contain a complete payable Book bonus');
 const graded=gradeCustomTrajectory('bookofra',trajectory,{stakeCents,lines});
 const template=selectCustomRound('bookofra',{stakeCents,lines,controls:controls.bookofra},()=>0);
 const bonus=JSON.parse(JSON.stringify({...template,spins:graded.spins.map(spin=>({...spin,mathProfile:template.mathProfile})),payoutCents:graded.payoutCents,trajectory:{...trajectory,catalogVariant:'bookofra-on'}}));
 forcedPlan=bonus;
 const beforeBonus=await balance(player),paidArgs=pixiArgs('bookofra',20),paid=await placeBookOfRaSpin(paidArgs,legacyOptions);
 assert.equal(paid.free.left,FREE_SPINS);assert.equal(cents(paid.payout),graded.spins[0].winCents);
 let fs=await freeState();assert.equal(fs.custom_round.version,bonus.version);assert.equal(fs.custom_round.spins.length,FREE_SPINS);
 assert.deepEqual(fs.custom_round.spins.map(spin=>spin.grid),graded.spins.slice(1).map(spin=>spin.grid));
 await collect();assert.equal(await balance(player),beforeBonus-stakeCents+graded.spins[0].winCents);
 const reload=await bookOfRaFreeState(player,{database});assert.equal(reload.left_spins,FREE_SPINS);assert.deepEqual(reload.custom_round,fs.custom_round);
 await apply('bookofra','custom',0,0);await sql.query('update app_casino_settings set enabled=false,game_profiles=$1::jsonb where id=1',[JSON.stringify({...profiles,bookofra:'unsupported-future-profile'})]);
 process.env.BOOKOFRA_FREE_SPINS='0';
 const neverChoose=()=>{throw Error('A frozen bonus was selected again');};
 const resumedOptions={database,chooseRound:neverChoose,random:()=>{throw Error('A frozen bonus drew a new reel stop');}};
 let pending=0;
 for(let index=0;index<FREE_SPINS;index++){
  const args={userId:player,requestId:randomUUID(),mode:'freespin'};
  const oldBalance=await balance(player),response=await placeBookOfRaSpin(args,resumedOptions),expected=graded.spins[index+1];
  pending+=expected.winCents;
  assert.deepEqual(response.grid,expected.grid);assert.deepEqual(response.graded,expected.graded);
  assert.equal(cents(response.pending),pending);assert.equal(response.free.left,FREE_SPINS-index-1);assert.equal(await balance(player),oldBalance);
  assert.deepEqual(await placeBookOfRaSpin(args,resumedOptions),response,'including final free-spin retry after state deletion');
  assert.equal(cents((await row(paid.roundId)).payout),graded.spins[0].winCents+pending);
  fs=await freeState();assert.equal(fs?.left_spins??0,FREE_SPINS-index-1);
 }
 assert.equal(await freeState(),undefined);
 const paidReplay=await placeBookOfRaSpin(paidArgs,resumedOptions);assert.equal(paidReplay.replayed,true);assert.deepEqual(paidReplay.free,paid.free);assert.equal(cents(paidReplay.payout),graded.spins[0].winCents);
 await collect();assert.equal(await balance(player),beforeBonus-stakeCents+graded.payoutCents);
 const collected=await balance(player);await collect();assert.equal(await balance(player),collected);
 const credited=await sql.query("select coalesce(sum(amount),0) as amount from app_transaction where user_id=$1 and reference_id=$2 and type='CASINO_WIN'",[player,paid.roundId]);
 assert.equal(cents(credited.rows[0].amount),graded.payoutCents);assert.equal(cents((await row(paid.roundId)).payout),graded.payoutCents);await assertPlayerLedger();
 console.log(`custom casino wallet: ${boundaryRounds} zero-RTP boundary rounds, ${positiveRounds} positive native contracts, all-six acknowledgement/replay/original restoration, frozen Book bonus/reload/OFF/retries/once-only collection and player-ledger reconciliation/no manager balance mutation PASS`);
}finally{await sql.close();}



