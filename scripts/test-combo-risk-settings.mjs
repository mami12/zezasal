import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { LEDGER_SQL } from '../server/ledger/schema.mjs';
import {
  DEFAULT_LIVE_RISK_SETTINGS, liveRiskSettings, setLiveRiskSettings,
  subscribeLiveRiskSettings, validateLiveRiskSettings,
} from '../server/live-risk-settings.mjs';
import {
  refreshLiveRiskSettings, lockLiveRiskSettings, writeLiveRiskSettings,
} from '../server/ledger/live-risk-store.mjs';

const initial = structuredClone(liveRiskSettings());
const legacy = structuredClone(DEFAULT_LIVE_RISK_SETTINGS);
delete legacy.combosEnabled;
assert.equal(validateLiveRiskSettings(legacy).combosEnabled, true,
  'existing database JSON migrates without unexpectedly disabling combos');
for (const enabled of [false, true]) {
  for (const combosEnabled of [false, true]) {
    const checked = validateLiveRiskSettings({ ...legacy, enabled, combosEnabled });
    assert.equal(checked.enabled, enabled);
    assert.equal(checked.combosEnabled, combosEnabled,
      'combos switch works independently of the LIVE risk master switch');
  }
}
for (const combosEnabled of [null, 0, 1, '', 'false', [], {}]) {
  assert.throws(() => validateLiveRiskSettings({ ...legacy, combosEnabled }),
    error => error.status === 400, 'non-boolean combo flags must be rejected');
}

// Real SQL and transactions in an isolated in-memory PostgreSQL. This suite
// never connects to the PostgreSQL pool or reads production credentials.
const sql = new PGlite();
await sql.exec(LEDGER_SQL);
const actor = { id: randomUUID(), username: 'combo-risk-test-admin', role: 'ADMIN' };
await sql.query('insert into app_user(id,username,password_hash,role) values($1,$2,$3,$4)',
  [actor.id, actor.username, 'test-only', actor.role]);
let queue = Promise.resolve();
const statements = [];
const database = {
  query: (...args) => sql.query(...args),
  async connect() {
    let release;
    const before = queue;
    queue = new Promise(resolve => { release = resolve; });
    await before;
    return {
      query: (text, params) => {
        statements.push(text);
        return sql.query(text, params);
      },
      release,
    };
  },
};
const events = [];
const unsubscribe = subscribeLiveRiskSettings(settings => events.push(structuredClone(settings)));
const stored = async () => (await sql.query('select settings from app_live_risk_settings where id=1')).rows[0].settings;
const audit = async () => (await sql.query('select * from app_admin_audit order by id')).rows;
try {
  const boot = await refreshLiveRiskSettings({ initialize: true, database });
  assert.equal(boot.combosEnabled, true);
  assert.equal((await stored()).combosEnabled, true);

  // A pre-upgrade database row is read safely before any admin has saved it.
  await sql.query('update app_live_risk_settings set settings=$1::jsonb where id=1', [JSON.stringify(legacy)]);
  assert.equal((await lockLiveRiskSettings({ query: database.query })).combosEnabled, true);
  assert.equal((await refreshLiveRiskSettings({ initialize: true, database })).combosEnabled, true);
  assert.equal((await stored()).combosEnabled, undefined,
    'initialization never overwrites an existing settings row');

  const disabled = await writeLiveRiskSettings({ ...legacy, enabled: false, combosEnabled: false }, actor, { database });
  assert.equal(disabled.settings.enabled, false);
  assert.equal(disabled.settings.combosEnabled, false);
  assert.equal(liveRiskSettings().combosEnabled, false);
  assert.equal((await stored()).combosEnabled, false);
  assert.equal((await lockLiveRiskSettings({ query: database.query })).combosEnabled, false);
  const lockIndex = statements.findIndex(text => /for update/i.test(text));
  const updateIndex = statements.findIndex(text => /update app_live_risk_settings/i.test(text));
  assert.ok(lockIndex >= 0 && updateIndex > lockIndex,
    'admin edits take the same row lock as bet placement before changing the switch');
  const firstAudit = (await audit())[0];
  assert.equal(firstAudit.action, 'UPDATE LIVE_RISK');
  assert.equal(firstAudit.actor_id, actor.id);
  assert.equal(firstAudit.details.settings.combosEnabled, false);

  const oldClient = await writeLiveRiskSettings({ ...legacy, enabled: true }, actor, { database });
  assert.equal(oldClient.settings.enabled, true);
  assert.equal(oldClient.settings.combosEnabled, false,
    'an older admin client cannot re-enable combos by omitting the switch');
  assert.equal((await stored()).combosEnabled, false);

  // Two queued edits represent concurrent clients. The legacy update reads the
  // latest locked row, not a stale process-local snapshot or the default true.
  await Promise.all([
    writeLiveRiskSettings({ ...legacy, combosEnabled: false }, actor, { database }),
    writeLiveRiskSettings({ ...legacy, lowOddsRules: [] }, actor, { database }),
  ]);
  assert.equal((await stored()).combosEnabled, false);
  assert.deepEqual((await stored()).lowOddsRules, []);

  const beforeRollback = structuredClone(await stored());
  const auditBefore = (await audit()).length;
  const eventsBefore = events.length;
  const failAudit = {
    async connect() {
      const client = await database.connect();
      return {
        ...client,
        query: (text, params) => /insert into app_admin_audit/i.test(text)
          ? Promise.reject(new Error('isolated audit failure')) : client.query(text, params),
      };
    },
  };
  await assert.rejects(writeLiveRiskSettings({ ...legacy, combosEnabled: true }, actor,
    { database: failAudit }), /isolated audit failure/);
  assert.deepEqual(await stored(), beforeRollback, 'failed audit rolls back the switch update');
  assert.equal((await audit()).length, auditBefore);
  assert.equal(events.length, eventsBefore, 'uncommitted settings never reach subscribers');
  assert.equal(liveRiskSettings().combosEnabled, false);

  // Explicitly re-enable, including when the LIVE risk master switch is OFF.
  const enabled = await writeLiveRiskSettings({ ...legacy, enabled: false, combosEnabled: true }, actor, { database });
  assert.equal(enabled.settings.combosEnabled, true);
  assert.equal(enabled.settings.enabled, false);
  assert.equal((await audit()).at(-1).details.settings.combosEnabled, true);

  // Simulate a change committed by another server instance and its refresh.
  await sql.query('update app_live_risk_settings set settings=$1::jsonb where id=1',
    [JSON.stringify({ ...enabled.settings, combosEnabled: false })]);
  const beforeRefresh = events.length;
  assert.equal((await refreshLiveRiskSettings({ database })).combosEnabled, false);
  assert.equal(events.length, beforeRefresh + 1);
  await refreshLiveRiskSettings({ database });
  assert.equal(events.length, beforeRefresh + 1, 'unchanged refresh does not emit redundant settings events');

  const beforeInvalid = (await audit()).length;
  await assert.rejects(writeLiveRiskSettings({ ...legacy, combosEnabled: 'false' }, actor, { database }),
    error => error.status === 400);
  assert.equal((await audit()).length, beforeInvalid);
  assert.equal((await stored()).combosEnabled, false);
  console.log('PASS combo risk switch: legacy migration, independent toggle, locked persistence, audit, legacy-client preservation, concurrent edits, rollback and cross-instance refresh');
} finally {
  unsubscribe();
  setLiveRiskSettings(initial);
  await sql.close();
}
