import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA_SQL } from '../server/schema.mjs';
import * as memory from '../server/match-store.mjs';
import * as database from '../server/db.mjs';
import { serializeMatch } from '../server/collector.mjs';
import { toClientMatch } from '../server/ledger/view.mjs';
import { loadUiModule } from './fixtures/load-ui-module.mjs';
import { isDecidedLiveMarket, isDecidedLiveOutcome } from '../server/ledger/decided-markets.mjs';
const { compareMatchDisplay } = loadUiModule(new URL('../web/src/utils/matchOrder.ts', import.meta.url));
const sql = new PGlite(); await sql.exec(SCHEMA_SQL);
const originalQuery = database.pool.query;
database.pool.query = (text, params) => sql.query(text, params);
const row = (id, competition = 1, kickoff = Date.now() - 30 * 60000) => ({
  match_id: id, sport_id: 18, sport_tag: 'football', category_id: competition, category_slug: `league-${competition}`,
  category_name: `League ${competition}`, tournament_id: competition, tournament_name: `League ${competition}`,
  home: id === 500 ? 'Juventus' : `Home ${id}`, away: `Away ${id}`, service: 'LIVE', status: 'live',
  start_at: new Date(kickoff), raw: {}, is_real: true, is_hot: false, live_minute: 30, phase: '1H',
});
const ids = rows => rows.map(item => Number(item.match_id ?? item.id));
try {
  memory.clear();
  const initial = [row(500), row(600, 2)];
  memory.upsert(initial); await database.upsertMatches(initial);
  assert.deepEqual(ids(memory.getMatches()), [500, 600]);
  await new Promise(resolve => setTimeout(resolve, 8));
  const changed = [row(200, 0, Date.now() - 5 * 3600000), row(100, 1, Date.now() - 4 * 3600000), row(500, 1, Date.now() + 3 * 3600000), row(600, 2)];
  memory.upsert(changed); await database.upsertMatches(changed);
  const warm = memory.getMatches(), persisted = await database.getMatches({});
  assert.deepEqual(ids(warm), [500, 100, 600, 200], 'new earlier-kickoff fixtures cannot push Juventus to the bottom');
  assert.deepEqual(ids(persisted), ids(warm), 'database and memory serve the same relative listing order');
  const first = warm.map(item => toClientMatch(serializeMatch(item)));
  const cold = [...first].reverse().sort(compareMatchDisplay);
  assert.deepEqual(ids(cold), ids(first), 'a new client reconstructs the authoritative order independently');
  const refreshed = first.map((item, index) => ({ ...item, startTime: new Date(Date.now() + index * 7 * 3600000).toISOString(), homeScore: index + 1 }));
  assert.deepEqual(ids(refreshed.sort(compareMatchDisplay)), ids(first), 'score/kickoff/arrival changes cannot reorder existing fixtures');
  console.log('PASS global listing order: memory/SQL parity, new fixtures append, kickoff corrections and independently opened client order');
  const future = Date.now() + 4 * 60000;
  memory.getById(500).score_at = new Date(future); memory.getById(500).home_score = 3; memory.getById(500).away_score = 0;
  memory.expireStale(150, future);
  assert.equal(memory.getById(500).listing_stale, false, 'fresh live push preserves a fixture missing from a poll page');
  assert.equal(memory.getById(600).active, true); assert.equal(memory.getById(600).status, 'live');
  assert.equal(memory.getById(600).listing_stale, true, 'missing listing suspends without inventing FT');
  assert.equal(toClientMatch(serializeMatch(memory.getById(600))).isSuspended, true);
  const live = { status: 'LIVE', homeScore: 3, awayScore: 0, scoreAt: new Date().toISOString() };
  assert.equal(isDecidedLiveMarket(live, { name: 'Total Goals', line: '1.5' }), true);
  assert.equal(isDecidedLiveOutcome(live, { name: 'Total Goals', outcomeName: 'Under 1.5', outcomeCode: '102' }), true);
  assert.equal(isDecidedLiveMarket({ ...live, homeScore: 0, awayScore: 3 }, { name: 'Total Goals Home', line: '1.5' }), false, 'away goals cannot settle the home team total');
  const offered = toClientMatch(serializeMatch(memory.getById(500), ['Over','Under'].map((name,index) => ({
    match_id: 500,market_key:'total',market_name:'Total Goals',line:'1.5',outcome_key:String(index+1),outcome_name:name,
    price:2,suspended:false,is_base:true,grp_order:1,period:0,board_column:'total',
  }))));
  assert.ok(offered.markets.length && offered.markets[0].outcomes.every(outcome => outcome.decided === true && outcome.status === 'SUSPENDED'), 'server marks the same expired numeric-code quotes before any client can bet');
  await sql.query("update matches set last_seen_at=now()-interval '4 minutes',updated_at=now()-interval '4 minutes'");
  await sql.query('update matches set score_at=now(),home_score=3,away_score=0 where match_id=500');
  await database.expireStaleMatches(150);
  assert.equal((await database.getMatchById(500)).listing_stale, false);
  assert.equal((await database.getMatchById(600)).listing_stale, true);
  assert.equal((await database.getMatches({})).length, 4);
  await database.applyMatchInfo({ matchId: 600, homeScore: 1, awayScore: 1 });
  assert.equal((await database.getMatchById(600)).listing_stale, false, 'a real feed update reopens a temporarily missing listing');
  console.log('PASS temporary feed omissions: real push presence wins; stale listings suspend, remain findable and recover without false full-time results');
  memory.clear(); await sql.query('delete from matches');
  for (const fixture of [row(91,1), {...row(92,2),service:'PREMATCH',status:'scheduled'}, {...row(93,1),service:'PREMATCH',status:'scheduled'}]) {
    memory.upsert([fixture]); await database.upsertMatches([fixture]);
    await new Promise(resolve=>setTimeout(resolve,8));
  }
  assert.deepEqual(ids(memory.getMatches({service:'PREMATCH'})),[92,93]);
  assert.deepEqual(ids(await database.getMatches({service:'PREMATCH'})),[92,93], 'LIVE history cannot give a new prematch competition an earlier position');
  const transition = row(92,2); memory.upsert([transition]); await database.upsertMatches([transition]);
  const replacement = {...row(94,2),service:'PREMATCH',status:'scheduled'};
  memory.upsert([replacement]); await database.upsertMatches([replacement]);
  assert.deepEqual(ids(memory.getMatches({service:'PREMATCH'})),[94,93]);
  assert.deepEqual(ids(await database.getMatches({service:'PREMATCH'})),[94,93], 'prematch competition position survives its earlier fixture starting live');
  console.log('PASS independent LIVE/prematch positions and stable competition anchors after transition');
} finally { database.pool.query = originalQuery; memory.clear(); await sql.close(); await database.pool.end(); }
