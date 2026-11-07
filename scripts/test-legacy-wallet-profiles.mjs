import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {placeCasinoSpin,settlePendingWin} from '../server/casino/transactions.mjs';
import {placeBookOfRaSpin} from '../server/casino/bookofra-transactions.mjs';
import {getGameProfile,getGameProfiles} from '../server/casino/game-rtp-profiles.mjs';
import {gradeGrid as gradeSizzling,symbolMatrix} from '../server/casino/sizzling-demo.mjs';
import {gradeGrid as gradeBook,FREE_SPINS} from '../server/casino/bookofra.mjs';

// The public adapters and real wallet SQL execute against an isolated database.
// No production pool connection, configuration file or external spin is used.
const sql=new PGlite();await sql.exec(LEDGER_SQL);
let queue=Promise.resolve();
const database={async connect(){let release;const before=queue;queue=new Promise(resolve=>release=resolve);await before;return {query:(...args)=>sql.query(...args),release};}};
const manager=randomUUID(),users=[randomUUID(),randomUUID()];
await sql.query('insert into app_user(id,username,password_hash,role,balance) values($1,$2,$3,$4,$5)',[manager,manager,'test-only','MANAGER',100000000]);
for(const user of users)await sql.query('insert into app_user(id,username,password_hash,role,balance,manager_id) values($1,$2,$3,$4,$5,$6)',[user,user,'test-only','PLAYER',1000000,manager]);
const balance=async id=>Number((await sql.query('select balance from app_user where id=$1',[id])).rows[0].balance);
const pending=async id=>Number((await sql.query('select pending from app_casino_gamble_state where user_id=$1',[id])).rows[0]?.pending||0);
const managerBefore=await balance(manager);let settings={},checked=0;
const apply=async(id,value)=>{settings={...settings,[id]:value};await sql.query('update app_casino_settings set game_profiles=$1::jsonb where id=1',[JSON.stringify(settings)]);};
const collect=async user=>settlePendingWin(user,{database});
const expectedGrid=(reels,stops)=>reels.map((reel,x)=>Array.from({length:3},(_,row)=>reel[(stops[x]+row)%reel.length]));
const chooseSymbol=(profile,symbol)=>profile.reels.map(reel=>{const index=reel.indexOf(symbol);assert(index>=0);return index;});
const randomFrom=stops=>{let i=0;return bound=>{assert(i<stops.length,'an adapter must draw exactly one stop per reel');const stop=stops[i++];assert(stop>=0&&stop<bound);return stop;};};
const round=async id=>(await sql.query('select * from app_casino_round where id=$1',[id])).rows[0];
const freeState=async user=>(await sql.query('select * from app_casino_freespin_state where user_id=$1',[user])).rows[0];

process.env.BOOKOFRA_FREE_SPINS='0';
for(const id of ['sizzling','bookofra']){
 const place=id==='sizzling'?placeCasinoSpin:placeBookOfRaSpin,lines=id==='sizzling'?5:10,profiles=getGameProfiles(id),grids=[];
 for(const profile of profiles){
  await apply(id,profile.id);
  for(const userId of users){
   const requestId=randomUUID(),stops=chooseSymbol(profile,1),grid=expectedGrid(profile.reels,stops),before=await balance(userId);
   const args={userId,requestId,bet:2,denomination:id==='sizzling'?2:1,lines};
   const result=await place(args,{database,random:randomFrom(stops)}),saved=await round(result.roundId);
   const grade=id==='sizzling'?gradeSizzling(grid,2,2):gradeBook(grid,2,lines);
   const payout=id==='sizzling'?Number(grade.total):grade.total;
   assert(payout>0,'winning stops must exercise payout arithmetic');
   assert.equal(result.payout,payout,'the displayed original paytable must determine the whole payout');
   assert.equal(saved.game_version,profile.id);assert.equal(saved.result.mathProfile.id,profile.id);
   assert.equal(saved.result.mathProfile.theoreticalRtp,profile.theoreticalRtp);
   assert.deepEqual(saved.result.symbols,symbolMatrix(grid));
   assert.deepEqual(saved.result.line_wins,grade.line_wins);
   assert.equal(Number(saved.result.total),payout);
   assert.equal(await balance(userId),before-result.stake,'a spin must leave its win pending');
   assert.equal(await pending(userId),payout);
   // Changing or corrupting the future profile cannot reroll an accepted UUID.
   await apply(id,'unsupported-profile');const replayBalance=await balance(userId);
   const replay=await place(args,{database,random:()=>{throw Error('replay rerolled');}});
   assert.equal(replay.roundId,result.roundId);assert.equal(replay.payout,payout);assert.equal(replay.replayed,true);
   assert.equal(await balance(userId),replayBalance);
   await collect(userId);assert.equal(await balance(userId),before-result.stake+payout);
   const collected=await balance(userId);await collect(userId);assert.equal(await balance(userId),collected);
   assert.equal(await pending(userId),0);await apply(id,profile.id);
   checked++;
  }
  grids.push(JSON.stringify(expectedGrid(profile.reels,chooseSymbol(profile,1))));
 }
 assert(new Set(grids).size>1,`${id} profile selection must change the actual strips`);
 const userId=users[0],before=await balance(userId),count=Number((await sql.query('select count(*) as n from app_casino_round')).rows[0].n);
 await apply(id,'unsupported-profile');
 await assert.rejects(place({userId,requestId:randomUUID(),bet:2,denomination:id==='sizzling'?2:1,lines},{database,random:()=>0}),/Unsupported reel profile/);
 assert.equal(await balance(userId),before);assert.equal(Number((await sql.query('select count(*) as n from app_casino_round')).rows[0].n),count);
 await apply(id,getGameProfile(id).id);
}

// A Book bonus keeps the paid round's immutable profile and effective per-line
// bet across later settings changes, OFF switches, restarts and request retries.
process.env.BOOKOFRA_FREE_SPINS='1';
const userId=users[0],profiles=getGameProfiles('bookofra'),low=profiles[0],high=profiles.at(-1);
await apply('bookofra',low.id);
const triggerStops=chooseSymbol(low,0),paidArgs={userId,requestId:randomUUID(),bet:2,denomination:1,lines:10};
const paid=await placeBookOfRaSpin(paidArgs,{database,random:randomFrom(triggerStops)});
assert.equal(paid.free.left,FREE_SPINS);let fs=await freeState(userId);
assert.equal(fs.math_profile,low.id);assert.equal(Number(fs.bet),2);assert.equal(Number(fs.lines),10);
const originalBalance=await balance(userId),originalPending=await pending(userId);
await apply('bookofra',high.id);
await assert.rejects(placeBookOfRaSpin({...paidArgs,requestId:randomUUID()},{database,random:()=>{throw Error('paid spin started inside bonus');}}),/FREE_SPINS_PENDING/);
assert.equal(await balance(userId),originalBalance);assert.equal(await pending(userId),originalPending);
await apply('bookofra','unsupported-profile');await sql.query('update app_casino_settings set enabled=false where id=1');
let expectedPending=originalPending;
for(let index=0;index<FREE_SPINS;index++){
 const stops=chooseSymbol(low,1),grid=expectedGrid(low.reels,stops),args={userId,requestId:randomUUID(),mode:'freespin'};
 const expected=gradeBook(grid,2,10,Number(fs.mud));expectedPending=Number((expectedPending+expected.total).toFixed(2));
 const response=await placeBookOfRaSpin(args,{database,random:randomFrom(stops)});
 assert.deepEqual(response.grid,grid);assert.equal(response.mathProfile.id,low.id);assert.equal(response.graded.total,expected.total);
 assert.equal(response.pending,expectedPending);assert.equal(response.free.left,FREE_SPINS-index-1);
 assert.equal(await balance(userId),originalBalance,'free spins never debit or prematurely credit the account');
 const replay=await placeBookOfRaSpin(args,{database,random:()=>{throw Error('free-spin replay rerolled');}});
 assert.deepEqual(replay,response);assert.equal(await pending(userId),expectedPending);
 const current=await freeState(userId);assert.equal(Number(current?.left_spins||0),FREE_SPINS-index-1);
 assert.equal(Number((await round(paid.roundId)).payout),expectedPending);
}
assert.equal(await freeState(userId),undefined);
await collect(userId);assert.equal(await balance(userId),originalBalance+expectedPending);
await collect(userId);assert.equal(await balance(userId),originalBalance+expectedPending);
await sql.query('update app_casino_settings set enabled=true where id=1');await apply('bookofra',high.id);

// A migrated bonus without a recorded profile uses the original adapter reels,
// not whatever global profile has subsequently been selected.
const legacyProfile=getGameProfile('bookofra',{bookofra:'BOOKOFRA_ORIGINAL_REELS_V2'}),roundId=paid.roundId;
await sql.query('insert into app_casino_freespin_state(user_id,round_id,left_spins,done_spins,mud,bet,lines,math_profile) values($1,$2,1,0,1,1,10,null)',[userId,roundId]);
const legacyStops=chooseSymbol(legacyProfile,1),legacyGrid=expectedGrid(legacyProfile.reels,legacyStops),legacyGrade=gradeBook(legacyGrid,1,10,1);
const legacy=await placeBookOfRaSpin({userId,requestId:randomUUID(),mode:'freespin'},{database,random:randomFrom(legacyStops)});
assert.equal(legacy.mathProfile.id,legacyProfile.id);assert.deepEqual(legacy.grid,legacyGrid);assert.equal(legacy.pending,legacyGrade.total);
await collect(userId);
for(const userId of users){
 const posted=await sql.query('select coalesce(sum(amount),0) as amount from app_transaction where user_id=$1',[userId]);
 assert.equal(Math.round((await balance(userId))*100),100000000+Math.round(Number(posted.rows[0].amount)*100),'player balance reconciles to its own ledger');
}
assert.equal(await balance(manager),managerBefore,'legacy casino activity never changes manager funds');
assert.equal(Number((await sql.query('select count(*) as n from app_transaction where user_id=$1',[manager])).rows[0].n),0,'no automatic manager transaction');
await sql.close();console.log(`PASS ${checked} real SQL legacy profile/player cases, original paytable and denomination payouts, global next-paid selection, replay, invalid-profile collect, Book frozen free games and duplicate-credit prevention`);
