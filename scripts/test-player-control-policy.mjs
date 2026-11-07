import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { assertBetWithinLimits, planLimitChanges } from '../server/ledger/player-control-policy.mjs';
import { assertPlayerCanBet } from '../server/ledger/player-controls.mjs';
import { LEDGER_SQL } from '../server/ledger/schema.mjs';

const now = Date.parse('2026-10-12T12:00:00.000Z');
const current = {
  dailyLimit: 100,
  weeklyLimit: 500,
  monthlyLimit: 1000,
  pendingLimits: null,
  limitsEffectiveAt: null,
};

const reduction = planLimitChanges(current, { dailyLimit: 50 }, now);
assert.equal(reduction.immediate.dailyLimit, 50, 'a lower cap applies immediately');
assert.equal(reduction.effectiveAt, null);

const increase = planLimitChanges(current, { dailyLimit: 150 }, now);
assert.equal(increase.immediate.dailyLimit, undefined);
assert.equal(increase.pending.dailyLimit, 150);
assert.equal(increase.effectiveAt.getTime(), now + 7 * 24 * 60 * 60 * 1000, 'a cap increase has a seven-day delay');

const removal = planLimitChanges(current, { dailyLimit: null }, now);
assert.equal(removal.pending.dailyLimit, null, 'removing a cap is also delayed');

const used = { daily_used: 40, weekly_used: 490, monthly_used: 990 };
assert.doesNotThrow(() => assertBetWithinLimits({ stake: 10, controls: current, used, now }));
assert.throws(
  () => assertBetWithinLimits({ stake: 10.01, controls: current, used, now }),
  /kufirin javor/,
  'a bet above any configured period cap is refused',
);
assert.throws(
  () => assertBetWithinLimits({
    stake: 1,
    controls: { ...current, selfExcludedUntil: new Date(now + 1000).toISOString() },
    used,
    now,
  }),
  (error) => error.status === 403 && /vetëpërjashtim/.test(error.message),
);

// Exercise the real wager check and SQL against an isolated PostgreSQL engine.
// The executor supplies a fixed SQL clock for calendar-boundary cases only.
const sql = new PGlite();
await sql.exec(LEDGER_SQL);
const user = randomUUID(), other = randomUUID();
for (const id of [user, other]) {
  await sql.query('insert into app_user(id,username,password_hash) values($1,$2,$3)', [id, id, 'test-only']);
}
let sqlClock = null, statements = [], lastUsage = null;
const executor = {
  async query(text, params) {
    statements.push(text);
    const timed = sqlClock ? text.replace(/\bnow\(\)/g, `'${sqlClock}'::timestamptz`) : text;
    const result = await sql.query(timed, params);
    if (text.includes('as daily_used')) lastUsage = result.rows[0];
    return result;
  },
};
const check = async stake => {
  statements = []; lastUsage = null;
  return assertPlayerCanBet(executor, user, stake);
};
const usageNumbers = () => Object.fromEntries(Object.entries(lastUsage).map(([key, value]) => [key, Number(value)]));
const reset = async () => {
  sqlClock = null;
  await sql.exec('delete from app_transaction; delete from app_player_controls;');
};
const movement = async (amount, at, type = 'CASINO_SPIN', account = user) => {
  await sql.query('insert into app_transaction(user_id,amount,type,balance_after,created_at) values($1,$2,$3,0,$4)', [account, amount, type, at]);
};
try {
  await check(1);
  assert.equal(statements.length, 2, 'a player without controls keeps the update/read checks and skips history');
  assert.equal(lastUsage, null);
  await sql.query('insert into app_player_controls(user_id) values($1)', [user]);
  await check(1);
  assert.equal(statements.length, 2, 'explicitly unlimited players also skip history');
  await sql.query("update app_player_controls set self_excluded_until=now()+interval '1 day' where user_id=$1", [user]);
  await assert.rejects(check(1), error => error.status === 403 && /vetëpërjashtim/.test(error.message));
  assert.equal(statements.length, 2, 'self-exclusion remains enforced on the no-history path');

  await reset();
  await sql.query("insert into app_player_controls(user_id,daily_limit,pending_limits,limits_effective_at) values($1,5,'{\"dailyLimit\":50}',now()-interval '1 second')", [user]);
  await movement(-20, new Date().toISOString(), 'BET_PLACED');
  await check(1);
  assert.equal(statements.length, 3, 'a mature limit increase is applied before checking usage');
  assert.equal(Number(lastUsage.daily_used), 20);
  let controls = (await sql.query('select * from app_player_controls where user_id=$1', [user])).rows[0];
  assert.equal(Number(controls.daily_limit), 50);
  assert.equal(controls.pending_limits, null);
  await sql.query("update app_player_controls set pending_limits='{\"dailyLimit\":null}',limits_effective_at=now()-interval '1 second' where user_id=$1", [user]);
  await check(1000);
  assert.equal(statements.length, 2, 'a mature limit removal immediately uses the no-history path');
  controls = (await sql.query('select * from app_player_controls where user_id=$1', [user])).rows[0];
  assert.equal(controls.daily_limit, null);
  await sql.query("update app_player_controls set daily_limit=5,pending_limits='{\"dailyLimit\":50}',limits_effective_at=now()+interval '1 day' where user_id=$1", [user]);
  await assert.rejects(check(1), error => error.status === 400 && /kufirin ditor/.test(error.message));
  assert.equal(statements.length, 3, 'a pending increase cannot bypass the currently effective cap');
  await sql.query("update app_player_controls set self_excluded_until=now()+interval '1 day' where user_id=$1", [user]);
  await assert.rejects(check(1), error => error.status === 403 && /vetëpërjashtim/.test(error.message));
  assert.equal(statements.length, 3, 'exclusion also takes priority over cap errors for limited players');

  // Compare actual totals in both relative calendar orders, including local
  // midnight falling on the previous UTC date. Old/positive/unrelated entries
  // must not contribute, while both sportsbook and casino debits must count.
  for (const fixture of [
    { zone: 'Europe/Berlin', clock: '2026-11-01T12:00:00Z', current: '2026-11-01T11:00:00Z', earlier: '2026-10-27T12:00:00Z', old: '2026-10-01T12:00:00Z', expected: [5,25,5] },
    { zone: 'Europe/Berlin', clock: '2026-11-20T12:00:00Z', current: '2026-11-20T11:00:00Z', earlier: '2026-11-02T12:00:00Z', old: '2026-10-27T12:00:00Z', expected: [5,5,25] },
    { zone: 'Pacific/Kiritimati', clock: '2026-10-31T10:30:00Z', current: '2026-10-31T10:10:00Z', earlier: '2026-10-31T09:59:00Z', old: '2026-10-01T12:00:00Z', expected: [5,25,5] },
  ]) {
    await reset();
    await sql.exec(`set time zone '${fixture.zone}'`);
    sqlClock = fixture.clock;
    await sql.query('insert into app_player_controls(user_id,daily_limit,weekly_limit,monthly_limit) values($1,1000,1000,1000)', [user]);
    await movement(-5, fixture.current);
    await movement(-20, fixture.earlier, 'BET_PLACED');
    await movement(-5000, fixture.old);
    await movement(-5000, fixture.current, 'DEPOSIT');
    await movement(5000, fixture.current, 'CASINO_SPIN');
    await movement(-5000, fixture.current, 'BET_PLACED', other);
    await check(1);
    assert.equal(statements.length, 3, 'limited players still run the history check');
    assert.deepEqual(usageNumbers(), Object.fromEntries(['daily_used','weekly_used','monthly_used'].map((key, index) => [key, fixture.expected[index]])), `${fixture.zone} ${fixture.clock}`);
    for (const [column, label, index] of [['daily_limit','ditor',0],['weekly_limit','javor',1],['monthly_limit','mujor',2]]) {
      await sql.query('update app_player_controls set daily_limit=null,weekly_limit=null,monthly_limit=null where user_id=$1', [user]);
      await sql.query(`update app_player_controls set ${column}=$2 where user_id=$1`, [user, fixture.expected[index]]);
      await check(0);
      await assert.rejects(check(0.01), error => error.status === 400 && error.message.includes(`kufirin ${label}`));
    }
  }
} finally {
  await sql.close();
}
console.log('PASS player controls: policy, 2-query unlimited path, exclusion, mature limits, bounded SQL totals across week/month/timezone boundaries');
