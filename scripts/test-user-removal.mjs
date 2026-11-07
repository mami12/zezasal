import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import { pool } from '../server/db.mjs';
import * as ledger from '../server/ledger/store.mjs';
import { removePlayer, purgeDeletedPlayerHistory, deletedHistoryCutoff } from '../server/ledger/user-removal.mjs';
import { recalcTicket } from '../server/ledger/settler.mjs';
import { managerCommissionReport } from '../server/ledger/manager-finance.mjs';
import { createColumnsPlacer } from '../server/ledger/bets.mjs';
import { adminRouter } from '../server/ledger/admin.mjs';
import { signToken, authenticate } from '../server/ledger/auth.mjs';

// All money, accounts, sessions and routes below use embedded PostgreSQL only.
const sql = new PGlite();
const originalQuery = pool.query, originalConnect = pool.connect;
let queue = Promise.resolve();
const direct = (text, params) => !params?.length && text.includes('create table')
  ? sql.exec(text).then(() => ({ rows: [] })) : sql.query(text, params);
const database = {
  async connect() {
    let release; const next = new Promise(resolve => { release = resolve; });
    const before = queue; queue = next; await before;
    return { query: direct, release };
  },
  async query(...args) { const client = await this.connect(); try { return await client.query(...args); } finally { client.release(); } },
};
pool.query = direct;
pool.connect = () => database.connect();
const balance = async id => Number((await sql.query('select balance from app_user where id=$1', [id])).rows[0]?.balance);
const account = async (role, amount, managerId = null) => {
  const id = randomUUID(), username = `remove-${id}`;
  await sql.query('insert into app_user(id,username,password_hash,role,balance,manager_id) values($1,$2,$3,$4,$5,$6)', [id, username, 'test-only', role, amount, managerId]);
  return { id, username, role, status: 'ACTIVE' };
};
const ticket = async (user, status = 'PENDING') => {
  const id = randomUUID();
  await sql.query('insert into app_ticket(id,user_id,stake,total_odds,potential_payout,status) values($1,$2,100,2,200,$3)', [id, user.id, status]);
  await sql.query("insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,odds_at_placement,match_name,market_name,outcome_name,status) values($1,99,'result','1',2,'Home vs Away','1X2','1',$2)", [id, status === 'PENDING' ? 'PENDING' : 'WON']);
  return id;
};
let server;
try {
  await ledger.initLedgerSchema();
  const admin = await account('ADMIN', 2000), manager = await account('MANAGER', 1000), other = await account('MANAGER', 500);
  const player = await account('PLAYER', 123.45, manager.id), active = await account('PLAYER', 88.12, manager.id);
  const pendingTicket = await ticket(player);
  const roundId = randomUUID();
  await sql.query("insert into app_casino_round(id,user_id,client_request_id,game_id,game_version,bet,denomination,lines,stake,payout,balance_after,result) values($1,$2,$3,'bookofra','test',0.2,1,10,0.2,0,123.45,'{}')", [roundId, player.id, randomUUID()]);
  await sql.query("insert into app_transaction(user_id,amount,type,balance_after) values($1,123.45,'DEPOSIT',123.45)", [player.id]);
  const app = express(); app.use(express.json()); app.use('/app/api', adminRouter);
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/app/api`;
  const remove = async (target, actor, path = 'admin') => {
    const response = await fetch(`${origin}/${path}/users/${target.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${signToken(actor)}` } });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await remove(player, other, 'manager')).status, 403);
  assert.equal((await remove(admin, admin)).status, 400);
  assert.equal((await remove(player, player)).status, 403);
  assert.equal(await balance(player.id), 123.45, 'rejected callers cannot move funds');
  assert.equal((await remove(player, manager, 'manager')).status,403,'only administrators can remove accounts');
  const removed = await remove(player, admin);
  assert.equal(removed.status, 200); assert.equal(removed.body.transferred, 123.45);
  assert.equal(await balance(manager.id), 1000); assert.equal(await balance(player.id), 0);
  assert.equal(await ledger.getUserById(player.id), null);
  assert.equal(await ledger.findUserByUsername(player.username), null);
  assert.equal(await authenticate(player.username, 'test-only'), null);
  assert.ok(!(await ledger.listUsers()).some(user => user.id === player.id));
  assert.equal((await sql.query('select user_id from app_ticket where id=$1', [pendingTicket])).rows[0].user_id, player.id);
  assert.equal(Number((await sql.query('select count(*) n from app_casino_round where user_id=$1', [player.id])).rows[0].n), 1);
  assert.equal(Number((await sql.query("select sum(amount) n from app_transaction where type like 'PLAYER_DELETE_TRANSFER_%'")).rows[0].n), 0, 'paired transfer conserves total money');
  assert.equal((await removePlayer(player.id, admin)).alreadyDeleted, true);
  assert.equal((await remove(player, admin)).status, 200, 'HTTP retries recognize the same deleted owner without transferring twice');
  assert.equal(await balance(manager.id), 1000, 'repeated deletion cannot credit twice');
  const twice = await account('PLAYER', 10.12, manager.id);
  const replay = await Promise.all([removePlayer(twice.id, admin), removePlayer(twice.id, admin)]);
  assert.equal(replay.filter(result => !result.alreadyDeleted).length, 1);
  assert.equal(await balance(manager.id), 1000);
  console.log('PASS player deletion: real role guards, exact transfer, retained history, revoked login, idempotent repeated/concurrent requests');

  // A request authenticated before removal cannot debit the archived account.
  const placer = createColumnsPlacer({ database, runQuery: (...args) => database.query(...args),
    resolve: async pick => { const [matchId,marketKey,line,outcomeKey]=pick.outcomeId.split('|'); return { matchId,marketKey,line,outcomeKey,price:2,marketName:marketKey==='total'?'Total Goals':'1X2',outcomeName:outcomeKey,matchName:'Home vs Away' }; },
    assertRisk: async () => {}, assertPlayer: async () => {}, lockRisk: async () => ({}) });
  await assert.rejects(placer({ user: player, totalStake: 100, clientRequestId: randomUUID(), selections: [{ outcomeId: '99|result||1', oddsAtPlacement: 2 }, { outcomeId: '99|total|2.5|over', oddsAtPlacement: 2 }] }), error => error.status === 403);
  assert.equal(await balance(player.id), 0);
  await sql.query("update app_ticket_line set status='WON' where ticket_id=$1", [pendingTicket]);
  await recalcTicket(pendingTicket);
  assert.equal(await balance(player.id), 200, 'future settlement stays on the original account, as requested');
  assert.equal(await balance(manager.id), 1000, 'later player payout and commission reporting never change the manager wallet');
  const afterSettlementReport=await managerCommissionReport((...args)=>sql.query(...args));
  assert.equal(afterSettlementReport.managers.get(manager.id).sportCommission,3,'the retained ticket reports its original owner commission');
  assert.equal(afterSettlementReport.managers.get(manager.id).casinoCommission,0,'casino and sports commission are separate');
  assert.equal(afterSettlementReport.players.get(player.id).sportCommission,3,'archived player history remains available for person-by-person accounting');
  await ledger.moveMoney(player.id, -200, { type: 'WITHDRAWAL', description: 'Isolated recovery of later payout' });
  assert.equal(await balance(player.id), 0);
  console.log('PASS removal races and pending settlements: no post-removal stake, original liabilities and later payout retained');

  const pending = await account('PLAYER', 0, manager.id); await ticket(pending); await removePlayer(pending.id, admin);
  const bonus = await account('PLAYER', 0, manager.id); await removePlayer(bonus.id, admin);
  await sql.query("insert into app_casino_original_state(user_id,game_id,session_id,state) values($1,'fruit-queen',$2,'{\"pending\":0,\"remaining\":5}')", [bonus.id, randomUUID()]);
  const recent = await account('PLAYER', 0, manager.id); await removePlayer(recent.id, admin);
  await sql.query("update app_user set deleted_at='2026-10-20T12:00:00Z' where id=any($1::uuid[])", [[player.id, twice.id, pending.id, bonus.id]]);
  await sql.query("update app_user set deleted_at='2026-11-02T23:01:00Z' where id=$1", [recent.id]);
  assert.equal(deletedHistoryCutoff(new Date('2026-11-02T22:59:59Z')).toISOString(), '2026-10-02T22:00:00.000Z');
  assert.equal(deletedHistoryCutoff(new Date('2026-11-02T23:00:00Z')).toISOString(), '2026-11-02T23:00:00.000Z');
  assert.equal(deletedHistoryCutoff(new Date('2026-04-03T01:00:00Z')).toISOString(), '2026-04-02T22:00:00.000Z');
  assert.equal((await purgeDeletedPlayerHistory({ now: new Date('2026-11-02T22:59:59Z') })).purged, 0, 'history survives all of day two');
  const staffBefore = await balance(manager.id);
  const clean = await purgeDeletedPlayerHistory({ now: new Date('2026-11-02T23:00:00Z') });
  assert.equal(clean.purged, 0);
  assert.equal(Number((await sql.query('select count(*) n from app_user where id=$1', [player.id])).rows[0].n), 1);
  assert.equal(Number((await sql.query('select count(*) n from app_ticket where user_id=$1', [player.id])).rows[0].n), 1);
  assert.equal(Number((await sql.query('select count(*) n from app_transaction where user_id=$1', [player.id])).rows[0].n), 4,'all original transactions remain');
  assert.equal(Number((await sql.query('select count(*) n from app_casino_round where user_id=$1', [player.id])).rows[0].n), 1);
  assert.equal(Number((await sql.query('select count(*) n from app_manager_commission where player_id=$1',[player.id])).rows[0].n),2,'archived commission history is retained');
  assert.equal(Number((await sql.query('select count(*) n from app_user where id=any($1::uuid[])', [[pending.id, bonus.id, recent.id, active.id]])).rows[0].n), 4);
  assert.equal(await balance(active.id), 88.12); assert.equal(await balance(manager.id), staffBefore);
  assert.equal((await purgeDeletedPlayerHistory({ now: new Date('2026-11-03T12:00:00Z') })).purged, 0, 'cleanup retries do not change live accounts or repeat transfers');
  const rollbackPlayer = await account('PLAYER', 17.77, manager.id), adminBefore = await balance(admin.id);
  const failingDatabase = { async connect() { const client = await database.connect(); return { release: client.release, query: (text, params) => {
    if (text.includes('insert into app_transaction')) throw new Error('Isolated transfer record failure');
    return client.query(text, params);
  } }; } };
  await assert.rejects(removePlayer(rollbackPlayer.id, admin, { database: failingDatabase }), /Isolated transfer record failure/);
  assert.equal(await balance(rollbackPlayer.id), 17.77); assert.equal(await balance(admin.id), adminBefore);
  assert.equal((await sql.query('select deleted_at from app_user where id=$1', [rollbackPlayer.id])).rows[0].deleted_at, null, 'failure rolls back deletion and both balances together');
  const managerBeforeAdminDelete = await balance(manager.id);
  assert.equal((await remove(rollbackPlayer, admin)).status, 200);
  assert.equal(await balance(admin.id), Number((adminBefore + 17.77).toFixed(2)));
  assert.equal(await balance(manager.id), managerBeforeAdminDelete, 'administrator deletion credits the administrator who performed it');
  assert.equal((await ledger.ledgerStats()).players, 1, 'deleted login rows are excluded from live player counts');
  console.log('PASS monthly deleted-player cleanup: Albanian calendar/DST boundary, finalized history only, pending tickets/bonuses and active accounts preserved');
  console.log('PASS transfer rollback and administrator ownership: no partial balances, active counts exclude deleted players');
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  pool.query = originalQuery; pool.connect = originalConnect; await sql.close(); await pool.end();
}
