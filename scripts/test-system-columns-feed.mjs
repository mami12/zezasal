import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { LEDGER_SQL } from '../server/ledger/schema.mjs';
import { createColumnsPlacer, toClientTicket, placeBet } from '../server/ledger/bets.mjs';
import { DEFAULT_LIVE_RISK_SETTINGS } from '../server/live-risk-settings.mjs';
import { upsert, getById } from '../server/match-store.mjs';
import { applyRows, getOddsForMatches } from '../server/odds-store.mjs';
import { snapshot } from '../server/ledger/overrides.mjs';
import { setFeedMode, FEED_LIVE, FEED_WAKING } from '../server/idle-mode.mjs';
import { config } from '../server/config.mjs';

assert.equal(config.matchStore, 'memory', 'isolated feed tests require in-memory matches');
assert.equal(config.databaseUrl, 'postgresql://unused:unused@127.0.0.1:1/casino_test');
// Freeze the empty override cache: this test must not schedule any network SQL.
snapshot().at = Number.MAX_SAFE_INTEGER;
const sql = new PGlite(); await sql.exec(LEDGER_SQL);
await sql.query('insert into app_live_risk_settings(id,settings) values(1,$1::jsonb)', [JSON.stringify(DEFAULT_LIVE_RISK_SETTINGS)]);
const id = randomUUID(), user = { id, role: 'PLAYER', status: 'ACTIVE' };
await sql.query("insert into app_user(id,username,password_hash,balance) values($1,$2,'test-only',1000)", [id, 'isolated-feed-player']);
const rows = [
  { matchId: 1101, marketKey: 'result', marketName: '1X2', line: '', outcomeKey: '1', outcomeName: 'Home', price: 5 },
  { matchId: 1101, marketKey: 'total', marketName: 'Total Goals', line: '3.5', outcomeKey: 'over', outcomeName: 'Over', price: 2.1 },
  { matchId: 1102, marketKey: 'result', marketName: '1X2', line: '', outcomeKey: '1', outcomeName: 'Home', price: 15.18 },
];
const selections = rows.map(row => ({ outcomeId: `${row.matchId}|${row.marketKey}|${row.line}|${row.outcomeKey}`, oddsAtPlacement: row.price }));
const refresh = () => {
  upsert([1101, 1102].map(match_id => ({ match_id, home: 'Home', away: 'Away', service: 'PREMATCH', start_at: new Date(Date.now() + 3600000) })));
  getById(1101).home_score = 0; getById(1101).away_score = 0;
  applyRows(rows); setFeedMode(FEED_LIVE);
};
let beforeTransaction = null;
const database = { async connect() {
  const hook = beforeTransaction; beforeTransaction = null;
  if (hook) hook();
  return { query: (...args) => sql.query(...args), release() {} };
} };
const runQuery = (...args) => sql.query(...args);
const getTicket = async id => toClientTicket(
  (await sql.query('select * from app_ticket where id=$1', [id])).rows[0],
  (await sql.query('select * from app_ticket_line where ticket_id=$1', [id])).rows,
);
const place = createColumnsPlacer({ database, runQuery, getTicket });
const input = () => ({ user, totalStake: 100, selections, clientRequestId: randomUUID() });
const funds = async () => Number((await sql.query('select balance from app_user where id=$1', [id])).rows[0].balance);
const tickets = async () => Number((await sql.query('select count(*) n from app_ticket')).rows[0].n);
async function rejected(prepare, check) {
  refresh(); prepare();
  const beforeFunds = await funds(), beforeTickets = await tickets();
  await assert.rejects(place(input()), check);
  assert.equal(await funds(), beforeFunds); assert.equal(await tickets(), beforeTickets);
}
try {
  refresh();
  const batch = await place(input()); assert.deepEqual(batch.system.columns.map(ticket => ticket.potentialPayout), [3795, 1593.9]);
  await rejected(() => applyRows([{ ...rows[1], suspended: true }]), /pezulluar/);
  await rejected(() => applyRows([{ ...rows[1], price: 2.11 }]), error => error.code === 'ODDS_CHANGED');
  await rejected(() => { getOddsForMatches([1101]).find(row => row.market_key === 'total').updated_at = new Date(0); }, /rifreskohen/);
  await rejected(() => { getById(1101).status = 'ended'; }, /përfunduar/);
  await rejected(() => { getById(1101).feed_status = 'Full Time'; }, /përfunduar/);
  getById(1101).feed_status = null;
  await rejected(() => setFeedMode(FEED_WAKING), /rifreskohen/);
  await rejected(() => snapshot().match.set('1101', { suspended: true }), /administrata/);
  snapshot().match.clear();
  // A feed change while the transaction waits for its wallet/risk lock must
  // cancel the entire slip, even though every preflight check was successful.
  await rejected(() => { beforeTransaction = () => applyRows([{ ...rows[1], price: 2.11 }]); }, error => error.code === 'ODDS_CHANGED');
  await rejected(() => { beforeTransaction = () => applyRows([{ ...rows[1], suspended: true }]); }, /pezulluar/);
  await rejected(() => { beforeTransaction = () => { getById(1101).status = 'ended'; }; }, /përfunduar/);
  // The ordinary endpoint shares the same under-lock check.
  refresh(); beforeTransaction = () => applyRows([{ ...rows[0], price: 5.01 }]);
  const beforeFunds = await funds();
  await assert.rejects(placeBet({ user, stake: 100, selections: [selections[0]], clientRequestId: randomUUID() }, { database, runQuery, getTicket }), error => error.code === 'ODDS_CHANGED');
  assert.equal(await funds(), beforeFunds);
  // Feed values with more precision must use the exact same four-decimal
  // contract as the preview and stored line, including a decimal half-tie.
  refresh(); applyRows([{ ...rows[1], price: 2.10005 }]);
  const precision = await place({ ...input(), selections: selections.map((pick, index) => index === 1 ? { ...pick, oddsAtPlacement: 2.1001 } : pick) });
  assert.equal(precision.system.columns[1].potentialPayout, 1593.98);
  assert.equal(precision.system.columns[1].lines.find(line => line.marketName === 'Total Goals').oddsAtPlacement, 2.1001);
  // One under-lock resolver rejects immediately while another still owns a
  // queued transaction read. Rollback/release must wait until that read drains.
  let unblockRead, enteredRead;
  const readGate = new Promise(resolve => { unblockRead = resolve; });
  const readEntered = new Promise(resolve => { enteredRead = resolve; });
  let rollbackStarted = false, released = false, settled = false, readFinished = false;
  const trackedDatabase = { async connect() {
    return { query: (text, params) => {
      if (text === 'rollback') rollbackStarted = true;
      assert.equal(released, false, 'no transaction query may use a released client');
      return sql.query(text, params);
    }, release() { released = true; } };
  } };
  const delayedResolver = async (selection, { executor } = {}) => {
    const index = selections.findIndex(pick => pick.outcomeId === selection.outcomeId);
    if (executor && index === 0) throw Object.assign(new Error('first revalidation rejected'), { status: 400, code: 'DRAIN_TEST' });
    if (executor && index === 1) {
      enteredRead(); await readGate;
      assert.equal(rollbackStarted, false, 'rollback must not run ahead of an outstanding read');
      const result = await executor('select 42 as answer');
      assert.equal(result.rows[0].answer, 42);
      readFinished = true;
    }
    return { ...rows[index], matchId: String(rows[index].matchId), matchName: 'Home vs Away' };
  };
  const drainingPlace = createColumnsPlacer({ database: trackedDatabase, runQuery, getTicket, resolve: delayedResolver });
  const fundsBeforeDrain = await funds(), ticketsBeforeDrain = await tickets();
  const pending = drainingPlace(input()).then(
    () => { settled = true; throw new Error('expected revalidation rejection'); },
    error => { settled = true; return error; },
  );
  await readEntered;
  // Yield one event-loop turn so every rejection microtask can propagate.
  // No timing-dependent delay: the pending resolver remains on a manual gate.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false); assert.equal(rollbackStarted, false); assert.equal(released, false);
  unblockRead();
  const drainedError = await pending;
  assert.equal(drainedError.code, 'DRAIN_TEST');
  assert.equal(readFinished, true); assert.equal(rollbackStarted, true); assert.equal(released, true);
  assert.equal(await funds(), fundsBeforeDrain); assert.equal(await tickets(), ticketsBeforeDrain);
  console.log('PASS real feed placement: native prices, strict consent, stale/ended/suspended/idle/admin refusals, lock-wait changes and draining every transaction read before rollback/client release');
} finally { snapshot().match.clear(); setFeedMode(FEED_LIVE); await sql.close(); }
