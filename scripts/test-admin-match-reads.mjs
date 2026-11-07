import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';

// Dynamic imports ensure inherited deployment storage settings cannot affect this
// isolated API test. No real database, upstream feed or financial action is used.
process.env.MATCH_STORE = 'memory';
process.env.ODDS_STORE = 'memory';
const [{ pool }, ledger, auth, { adminRouter }, matches, odds, overrides] = await Promise.all([
  import('../server/db.mjs'), import('../server/ledger/store.mjs'),
  import('../server/ledger/auth.mjs'), import('../server/ledger/admin.mjs'),
  import('../server/match-store.mjs'), import('../server/odds-store.mjs'),
  import('../server/ledger/overrides.mjs'),
]);
const sql = new PGlite();
const originalQuery = pool.query;
const statements = [];
pool.query = (text, params) => {
  statements.push(text);
  if (text.includes('create table if not exists app_user')) {
    return sql.exec(text).then(() => ({ rows: [] }));
  }
  return sql.query(text, params);
};
let server;
try {
  await ledger.initLedgerSchema();
  const tokens = {};
  for (const role of ['ADMIN', 'MANAGER', 'PLAYER']) {
    const user = { id: randomUUID(), username: `read-test-${role}`, role };
    await sql.query('insert into app_user(id,username,password_hash,role) values($1,$2,$3,$4)',
      [user.id, user.username, 'test-only', role]);
    tokens[role] = auth.signToken(user);
  }
  const now = Date.now();
  matches.upsert(Array.from({ length: 30 }, (_, index) => ({
    match_id: 710000 + index, sport_id: 18, sport_tag: 'football',
    category_slug: 'read-test-league', category_name: 'Read Test League',
    tournament_id: 900, tournament_name: 'Read Test Tournament',
    home: `Home ${index}`, away: `Away ${index}`,
    service: index % 2 ? 'LIVE' : 'PREMATCH',
    start_at: new Date(now + (index % 2 ? -30 : 60) * 60000),
    status: 'scheduled', raw: {},
  })));
  matches.applyInfo({ matchId: 710001, homeScore: 2, awayScore: 1,
    matchTimeMs: 31 * 60000, feedStatus: 'H1', hasOpenOdds: true });
  matches.applyInfo({ matchId: 710003, homeScore: 1, awayScore: 0,
    feedStatus: 'Finished', hasOpenOdds: false });
  odds.configure({ pinProvider: false });
  odds.applyRows(Array.from({ length: 30 }).flatMap((_, matchIndex) =>
    Array.from({ length: 35 }).flatMap((_, marketIndex) =>
      ['over', 'under'].map((outcomeKey) => ({
        matchId: 710000 + matchIndex, marketKey: `total-${marketIndex}`,
        marketName: `Total Goals ${marketIndex}`, line: `${marketIndex}.5`,
        outcomeKey, outcomeName: outcomeKey === 'over' ? 'Over' : 'Under',
        price: 1.95, suspended: false, order: marketIndex,
      })))));
  await overrides.upsert('match', '710001', { suspended: true });
  await overrides.upsert('market', '710001|total-0|0.5', { suspended: true });
  await overrides.upsert('outcome', '710001|total-0|0.5|over', { price: 2.25 });
  await overrides.upsert('match', '710002', { suspended: true });
  await overrides.upsert('outcome', '7100010|other||1', { price: 4.5 });

  const app = express();
  app.use('/app/api', adminRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/app/api`;
  const get = async (path, role = 'ADMIN') => {
    const response = await fetch(origin + path, {
      headers: role ? { authorization: `Bearer ${tokens[role]}` } : {},
    });
    return { status: response.status, body: await response.json() };
  };
  statements.length = 0;

  // An odds getter that throws proves summary does not load/build even one
  // full market catalog while its real fixture metadata still remains intact.
  const storedOdd = odds.getOddsForMatches([710001])[0];
  const savedPrice = storedOdd.price;
  Object.defineProperty(storedOdd, 'price', {
    configurable: true, get() { throw new Error('summary read a full odds catalog'); },
  });
  const summary = await get('/admin/matches?summary=true&limit=2000&includeEnded=true');
  Object.defineProperty(storedOdd, 'price', { configurable: true, writable: true, value: savedPrice });
  assert.equal(summary.status, 200);
  assert.equal(summary.body.summary, true);
  assert.equal(summary.body.items.length, 30);
  assert.ok(summary.body.items.every(item => item.markets.length === 0 && item.marketCount === null));
  assert.equal(summary.body.overrides.length, 5);
  const liveSummary = summary.body.items.find(item => item.id === '710001');
  assert.equal(liveSummary.homeTeam, 'Home 1');
  assert.equal(liveSummary.homeScore, 2);
  assert.equal(liveSummary.awayScore, 1);
  assert.equal(liveSummary.status, 'LIVE');
  assert.equal(liveSummary.isSuspended, true);
  assert.ok(liveSummary.scoreAt && liveSummary.snapshotAt);
  assert.equal(summary.body.items.find(item => item.id === '710003').status, 'ENDED');
  assert.equal(summary.body.items.find(item => item.id === '710003').isSuspended, true);

  const detail = await get('/admin/matches/710001');
  assert.equal(detail.status, 200);
  assert.deepEqual(Object.keys(detail.body).sort(), ['item', 'overrides']);
  assert.equal(detail.body.item.id, '710001');
  assert.equal(detail.body.item.markets.length, 35);
  assert.equal(detail.body.item.marketCount, 35);
  assert.equal(detail.body.item.markets[0].outcomes.find(item => item.code === 'over').odds, 2.25);
  assert.ok(detail.body.item.markets.every(market => market.status === 'SUSPENDED'));
  assert.equal(detail.body.overrides.length, 3);
  assert.ok(detail.body.overrides.every(item => item.ref === '710001' || item.ref.startsWith('710001|')));
  assert.ok(matches.boostedIds().includes(710001), 'selected detail requests full-market subscriptions');

  const legacy = await get('/admin/matches');
  assert.equal(legacy.status, 200);
  assert.deepEqual(Object.keys(legacy.body).sort(), ['items', 'overrides']);
  assert.equal(legacy.body.items.length, 30);
  assert.ok(legacy.body.items.some(item => item.markets.length === 35));
  assert.ok(JSON.stringify(legacy.body).length > JSON.stringify(summary.body).length * 8,
    'summary payload drops complete catalogs for all unselected fixtures');

  const searched = await get('/admin/matches?summary=true&q=Home%201&limit=2');
  assert.equal(searched.body.items.length, 2);
  assert.ok(searched.body.items.every(item => item.homeTeam.includes('Home 1')));
  const liveOnly = await get('/admin/matches?summary=true&status=LIVE');
  assert.ok(liveOnly.body.items.every(item => ['LIVE', 'ENDED'].includes(item.status)));
  assert.equal((await get('/manager/matches?summary=true', 'MANAGER')).status, 200);
  assert.equal((await get('/manager/matches/710001', 'MANAGER')).status, 200);
  assert.equal((await get('/admin/matches?summary=true', 'MANAGER')).status, 403);
  assert.equal((await get('/admin/matches/710001', 'MANAGER')).status, 403);
  assert.equal((await get('/admin/matches?summary=true', 'PLAYER')).status, 403);
  assert.equal((await get('/admin/matches/710001', 'PLAYER')).status, 403);
  assert.equal((await get('/admin/matches/710001', null)).status, 401);
  for (const id of ['999999999', 'invalid', '-1', '1.5', '0', '9007199254740992']) {
    assert.equal((await get(`/admin/matches/${id}`)).status, 404, `${id} has no selected fixture`);
  }
  assert.ok(statements.every(text => /^\s*select\b/i.test(text)),
    'every read route stays free of SQL writes, including financial and audit changes');
  assert.equal((await sql.query('select count(*)::int as count from app_transaction')).rows[0].count, 0);
  console.log('PASS admin match read API: lightweight catalog-free summary, selected full detail, exact overrides, legacy compatibility, search/limit, role guards, 404 and no writes');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  pool.query = originalQuery;
  await pool.end();
  await sql.close();
}
