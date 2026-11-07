import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import bcrypt from 'bcryptjs';

const parent=resolve('tmp');await mkdir(parent,{recursive:true});
const root=await mkdtemp(join(parent,'local-ledger-test-'));
Object.assign(process.env,{DB_DRIVER:'local',LOCAL_DATABASE_DIR:join(root,'database'),DATABASE_URL:'invalid-cloud-url-must-never-be-used',JWT_SECRET:'isolated-local-database-jwt-test-key-12345',SEED_DEFAULT_ACCOUNTS:'false',CASINO_REAL_MONEY_ENABLED:'true',CASINO_MATH_APPROVED:'true'});
const {pool,initSchema,dbHealth}=await import('../server/db.mjs');
const ledger=await import('../server/ledger/store.mjs');
const {authenticate}=await import('../server/ledger/auth.mjs');
const {createColumnsPlacer}=await import('../server/ledger/bets.mjs');
const {recalcTicket}=await import('../server/ledger/settler.mjs');
const {placeCasinoSpin,settlePendingWin}=await import('../server/casino/transactions.mjs');
const balance=async id=>(await pool.query('select balance from app_user where id=$1',[id])).rows[0].balance;
try {
  await initSchema();await ledger.initLedgerSchema();assert.equal((await dbHealth()).ok,true);
  const password=await bcrypt.hash('local-test-password',4);
  const manager=await ledger.createUser({username:'manager-test',passwordHash:password,role:'MANAGER',balance:10000});
  const player=await ledger.createUser({username:'player-test',passwordHash:password,managerId:manager.id,balance:1000});
  assert.equal((await authenticate('player-test','local-test-password')).user.id,player.id);
  await Promise.all(Array.from({length:10},()=>ledger.moveMoney(player.id,0.01)));
  assert.equal(await balance(player.id),1000.10);
  await Promise.all(Array.from({length:10},()=>ledger.moveManagerFunds(manager.id,player.id,1.23,'deposit')));
  assert.equal(await balance(player.id),1012.40);assert.equal(await balance(manager.id),9987.70);
  await assert.rejects(ledger.moveManagerFunds(manager.id,player.id,20000,'withdraw'),/insufficient player balance/);
  assert.equal(await balance(player.id),1012.40);
  const resolveSelection=async selection=>{
    const [matchId,marketKey,line,outcomeKey]=selection.outcomeId.split('|');
    return {matchId,marketKey,line,outcomeKey,price:2,marketName:marketKey==='result'?'1X2':'Total Goals',outcomeName:outcomeKey,matchName:'Home vs Away'};
  };
  const place=createColumnsPlacer({resolve:resolveSelection,assertRisk:async()=>{},assertPlayer:async()=>{},lockRisk:async()=>({})});
  const request={user:player,totalStake:100,clientRequestId:randomUUID(),selections:[{outcomeId:'99|result||1',oddsAtPlacement:2},{outcomeId:'99|total|2.5|over',oddsAtPlacement:2}]};
  const [ticket,replay]=await Promise.all([place(request),place(request)]);
  assert.deepEqual(ticket,replay);assert.equal(ticket.system.columnCount,2);
  assert.equal(await balance(player.id),912.40);
  assert.deepEqual(ticket.system.columns.map(column=>column.stake),[50,50]);
  for(const [index,column] of ticket.system.columns.entries()){
    await pool.query('update app_ticket_line set status=$2 where ticket_id=$1',[column.id,index===0?'WON':'LOST']);
    assert.ok(await recalcTicket(column.id));assert.equal(await recalcTicket(column.id),null);
  }
  assert.equal(await balance(player.id),1012.40);
  const casinoPlayer=await ledger.createUser({username:'casino-player-test',passwordHash:password,managerId:manager.id,balance:100});
  const spinRequest={userId:casinoPlayer.id,requestId:randomUUID(),bet:1,denomination:4,lines:5};
  const spin=await placeCasinoSpin(spinRequest,{random:()=>0});
  const spinAgain=await placeCasinoSpin(spinRequest,{random:()=>0});
  assert.equal(spinAgain.roundId,spin.roundId);assert.equal(spinAgain.replayed,true);
  assert.equal(await balance(casinoPlayer.id),80);
  await settlePendingWin(casinoPlayer.id);
  const beforeRemoval=await balance(manager.id),remaining=await balance(player.id);
  const removed=await ledger.deleteUser(player.id,manager);
  assert.equal(removed.transferred,remaining);assert.equal(await balance(manager.id),Number((beforeRemoval+remaining).toFixed(2)));
  assert.equal(await ledger.getUserById(player.id),null);
  assert.equal((await ledger.deleteUser(player.id,manager)).alreadyDeleted,true);
  console.log('PASS real local ledger: authentication, concurrent cashier transfers, post-commit reads, 100-total system ticket/retry/settlement, casino wallet/retry, removal and exact retained balances');
} finally {
  await pool.end();
  assert.ok(resolve(root).startsWith(parent+(process.platform==='win32'?'\\':'/')));
  await rm(root,{recursive:true,force:true});
}
