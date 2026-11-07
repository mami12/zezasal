import pg from 'pg';
import { config, pgClientOptions } from './config.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import { splitByKickoff, DEFAULT_SOON_MS } from './subscribe-plan.mjs';
import { createLocalPool } from './local-database.mjs';

// bigint + numeric arrive as strings by default; normalise them for JSON output
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

export const pool = config.databaseDriver === 'local'
  ? createLocalPool({ dataDir: config.localDatabaseDir })
  : new pg.Pool(pgClientOptions());

pool.on('error', (e) => console.error('[db] idle client error:', e.message));

export const query = (text, params) => pool.query(text, params);

export async function initSchema() {
  await query(SCHEMA_SQL);
}

export async function dbHealth() {
  const r = await query('select now() as now, current_database() as db');
  return { ok: true, now: r.rows[0].now, db: r.rows[0].db };
}

const MATCH_COLUMNS = [
  'match_id', 'sport_id', 'sport_tag', 'category_id', 'category_slug', 'category_name',
  'tournament_id', 'tournament_slug', 'tournament_name', 'home', 'away', 'service',
  'start_at', 'is_hot', 'is_real', 'live_minute', 'phase', 'status', 'raw',
];

/** Bulk upsert of normalised matches (chunked multi-row insert). */
export async function upsertMatches(rows, chunkSize = 150) {
  if (rows.length === 0) return 0;
  let written = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = [];
    const tuples = chunk.map((row, r) => {
      const placeholders = MATCH_COLUMNS.map((col, c) => {
        const idx = r * MATCH_COLUMNS.length + c + 1;
        values.push(col === 'raw' ? JSON.stringify(row[col] ?? {}) : (row[col] ?? null));
        return `$${idx}`;
      });
      const serviceParameter = `$${r * MATCH_COLUMNS.length + MATCH_COLUMNS.indexOf('service') + 1}`;
      return `(${placeholders.join(',')}, now(), now(), case when ${serviceParameter}='LIVE' then now() end, case when ${serviceParameter}='PREMATCH' then now() end)`;
    });

    const sql = `
      insert into matches (${MATCH_COLUMNS.join(',')}, last_seen_at, updated_at, live_first_seen_at, prematch_first_seen_at)
      values ${tuples.join(',')}
      on conflict (match_id) do update set
        sport_id        = excluded.sport_id,
        sport_tag       = excluded.sport_tag,
        category_id     = excluded.category_id,
        category_slug   = excluded.category_slug,
        category_name   = excluded.category_name,
        tournament_id   = excluded.tournament_id,
        tournament_slug = excluded.tournament_slug,
        tournament_name = excluded.tournament_name,
        home            = excluded.home,
        away            = excluded.away,
        service         = excluded.service,
        start_at        = excluded.start_at,
        is_hot          = excluded.is_hot,
        is_real         = excluded.is_real,
        live_minute     = excluded.live_minute,
        phase           = excluded.phase,
        status          = excluded.status,
        raw             = excluded.raw,
        active          = true,
        listing_stale   = false,
        live_first_seen_at = case when excluded.service='LIVE' then coalesce(matches.live_first_seen_at,now()) else matches.live_first_seen_at end,
        prematch_first_seen_at = case when excluded.service='PREMATCH' then coalesce(matches.prematch_first_seen_at,now()) else matches.prematch_first_seen_at end,
        last_seen_at    = now(),
        updated_at      = now()`;

    const res = await query(sql, values);
    written += res.rowCount ?? chunk.length;
  }
  return written;
}

/** Suspend missing listings first; only real FT or long feed loss retires them. */
export async function expireStaleMatches(graceSeconds = 150) {
  const res = await query(
    `update matches
        set active = false,
            listing_stale = true,
            status = case when lower(coalesce(feed_status,'')) in ('finished','ended','ft','full time') then 'ended' else status end,
            updated_at = now()
      where active
        and greatest(last_seen_at,updated_at,score_at,clock_at,feed_status_at) < now() - make_interval(secs => $1::int)
        and (status='ended' or lower(coalesce(feed_status,'')) in ('finished','ended','ft','full time')
          or greatest(last_seen_at,updated_at,score_at,clock_at,feed_status_at) < now()-interval '6 hours')
      returning match_id`,
    [graceSeconds],
  );
  await query(`update matches set listing_stale=true where active and listing_stale=false
    and greatest(last_seen_at,updated_at,score_at,clock_at,feed_status_at) < now()-make_interval(secs=>$1::int)`, [graceSeconds]);
  return res.rows.map((r) => r.match_id);
}

export async function getMatches({ service = null, league = null, tournamentId = null, sportId = null, q = null, limit = 500, offset = 0, includeEnded = false,catalog=false }) {
  const res = await query(
    `select matches.*, (select min(case when matches.service='LIVE' then all_matches.live_first_seen_at else all_matches.prematch_first_seen_at end)
      from matches all_matches where all_matches.sport_id is not distinct from matches.sport_id
        and all_matches.tournament_id is not distinct from matches.tournament_id) as competition_first_seen_at from matches
      where active
        and ($1::text is null or service = upper($1))
        and ($2::text is null or category_slug = $2)
        and ($3::text is null or home ilike '%' || $3 || '%' or away ilike '%' || $3 || '%'
                            or category_name ilike '%' || $3 || '%'
                            or tournament_name ilike '%' || $3 || '%')
        and ($6::boolean or status <> 'ended')
        and ($7::text is null or tournament_id::text = $7)
        and ($8::text is null or sport_id::text = $8)
      order by (service = 'LIVE') desc, competition_first_seen_at asc nulls last,
        coalesce(tournament_id,category_id,0) asc,
        case when service='LIVE' then coalesce(live_first_seen_at,first_seen_at) else coalesce(prematch_first_seen_at,first_seen_at) end asc, match_id asc
      limit $4 offset $5`,
    [service, league, q, catalog?null:Math.min(limit, 2000), offset, includeEnded === true,
      tournamentId == null ? null : String(tournamentId), sportId == null ? null : String(sportId)],
  );
  return res.rows;
}

export async function getMatchById(matchId) {
  const res = await query('select * from matches where match_id = $1', [matchId]);
  return res.rows[0] ?? null;
}

export async function getLeagues() {
  const res = await query(
    `select category_slug as slug,
            min(category_name) as name,
            count(*) filter (where service = 'LIVE') as live,
            count(*) filter (where service = 'PREMATCH') as prematch
       from matches
      where active
      group by category_slug
      order by (count(*) filter (where service = 'LIVE')) desc, count(*) desc`,
  );
  return res.rows;
}

export async function getCounts() {
  const res = await query(
    `select count(*) filter (where service = 'LIVE' and status <> 'ended')     as live,
            count(*) filter (where service = 'PREMATCH' and status <> 'ended') as prematch,
            count(*) filter (where status = 'ended')                           as finished,
            max(updated_at)                                                    as updated_at
       from matches where active`,
  );
  const r = res.rows[0];
  return {
    live: Number(r.live),
    prematch: Number(r.prematch),
    finished: Number(r.finished),
    updatedAt: r.updated_at,
  };
}

export async function getOddsForMatches(matchIds) {
  if (!matchIds.length) return [];
  const res = await query(
    `select * from odds_current
      where match_id = any($1::bigint[])
      order by match_id, is_base desc, grp_order asc, period asc, market_key, line,
               case outcome_key when '1' then 1 when 'x' then 2 when '2' then 3
                                when 'under' then 4 when 'over' then 5 else 9 end,
               outcome_key`,
    [matchIds],
  );
  return res.rows;
}

/**
 * Writes current odds and records a history row whenever a price actually moves.
 * Returns the rows that changed (price or suspension) for real-time broadcast.
 */
/**
 * Postgres refuses a statement with more than 65535 bind parameters. A subscribe
 * burst holds thousands of odds rows, and without chunking the INSERT failed with
 * "bind message has N parameter formats but 0 parameters" - which aborted the whole
 * flush cycle, throwing away the clock/score snapshots buffered alongside it.
 */
const MAX_BIND_PARAMS = 60000;
const chunkRows = (rows, paramsPerRow) => {
  const size = Math.max(1, Math.floor(MAX_BIND_PARAMS / paramsPerRow));
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

export async function saveOdds(rows) {
  if (!rows.length) return { changed: [] };

  // a buffered batch can hold the same outcome twice (snapshot + delta), and
  // Postgres refuses to update the same row twice in one INSERT..ON CONFLICT
  const dedup = new Map();
  for (const row of rows) {
    dedup.set(`${row.matchId}|${row.marketKey}|${row.line ?? ''}|${row.outcomeKey}`, row);
  }
  rows = [...dedup.values()];

  const matchIds = [...new Set(rows.map((r) => r.matchId))];
  const before = await getOddsForMatches(matchIds);
  const beforeMap = new Map(
    before.map((b) => [`${b.match_id}|${b.market_key}|${b.line}|${b.outcome_key}`, b]),
  );

  for (const part of chunkRows(rows, 14)) {
    const values = [];
    const tuples = part.map((row, i) => {
      const base = i * 14;
      values.push(
        row.matchId, row.marketKey, row.marketName, row.line ?? '', row.outcomeKey,
        row.outcomeName, row.price ?? null, row.suspended === true,
        row.isBase === true, Number.isFinite(Number(row.order)) ? Number(row.order) : 0,
        row.renderType ?? null, Number.isFinite(Number(row.period)) ? Number(row.period) : 0,
        row.column ?? null, row.subgames ?? null,
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14}, now())`;
    });

    await query(
      `insert into odds_current
         (match_id, market_key, market_name, line, outcome_key, outcome_name, price, suspended,
          is_base, grp_order, render_type, period, board_column, subgames, updated_at)
       values ${tuples.join(',')}
       on conflict (match_id, market_key, line, outcome_key) do update set
         market_name  = excluded.market_name,
         outcome_name = excluded.outcome_name,
         price        = excluded.price,
         suspended    = excluded.suspended,
         is_base      = excluded.is_base,
         grp_order    = excluded.grp_order,
         render_type  = excluded.render_type,
         board_column = excluded.board_column,
         subgames     = excluded.subgames,
         updated_at   = now()`,
      values,
    );
  }

  const changed = [];
  const history = [];
  for (const row of rows) {
    const key = `${row.matchId}|${row.marketKey}|${row.line ?? ''}|${row.outcomeKey}`;
    const prev = beforeMap.get(key);
    const priceChanged = !prev || Number(prev.price) !== Number(row.price);
    const suspChanged = !prev || prev.suspended !== (row.suspended === true);
    if (!priceChanged && !suspChanged) continue;
    changed.push(row);
    if (priceChanged) {
      history.push([row.matchId, row.marketKey, row.line ?? '', row.outcomeKey, row.price ?? null, row.suspended === true]);
    }
  }

  if (history.length) {
    for (const part of chunkRows(history, 6)) {
      const params = [];
      const rowsSql = part.map((h, i) => {
        const b = i * 6;
        params.push(...h);
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`;
      });
      await query(
        `insert into odds_history (match_id, market_key, line, outcome_key, price, suspended) values ${rowsSql.join(',')}`,
        params,
      );
    }
  }

  return { changed };
}

let rawFrameWriteFailed = false;

/**
 * Raw frames are an archive, not board data - and the database is only the ledger now, so
 * an insert failure must not break the ingest request that triggered it.
 */
export async function logRawFrame(source, payload) {
  if (!config.logRawFrames) return;
  try {
    await query('insert into raw_frames (source, payload) values ($1, $2)', [source, JSON.stringify(payload ?? {})]);
  } catch (e) {
    if (!rawFrameWriteFailed) {
      rawFrameWriteFailed = true;
      console.warn('[db] raw-frame archive unavailable:', e.message);
    }
  }
}

/**
 * Live score / clock / stats pushed as "match-info" or "match-info-snapshot".
 *
 * Only snapshot frames carry matchTime / matchScore (the periodic deltas never do),
 * so a frame without a clock or a score must leave the stored value untouched - and
 * must NOT bump its freshness anchor either. `clock_at` / `score_at` record when the
 * feed last really reported each value, which is what the board extrapolates from.
 */
export async function applyMatchInfo(info) {
  if (!info?.matchId) return null;

  const hasClock = Number.isFinite(info.matchTimeMs);
  const hasScore = Number.isFinite(info.homeScore) && Number.isFinite(info.awayScore);

  const res = await query(
    `update matches set
        home_score    = case when $10::boolean then $2::int    else home_score end,
        away_score    = case when $10::boolean then $3::int    else away_score end,
        score_at      = case when $10::boolean then now()      else score_at end,
        periods_score = coalesce($4::jsonb, periods_score),
        odds_count    = coalesce($5, odds_count),
        stats         = coalesce($6::jsonb, stats),
        match_time_ms = case when $11::boolean then $7::bigint else match_time_ms end,
        clock_at      = case when $11::boolean then now()      else clock_at end,
        feed_status   = coalesce($8, feed_status),
        feed_status_at = case when $8::text is not null then now() else feed_status_at end,
        has_open_odds = coalesce($9, has_open_odds),
        broadcast_url = coalesce($12, broadcast_url),
        active        = true,
        listing_stale = false,
        updated_at    = now()
      where match_id = $1
      returning match_id, home_score, away_score, periods_score, odds_count, stats, raw,
                match_time_ms, clock_at, score_at, feed_status, feed_status_at, has_open_odds, broadcast_url, updated_at`,
    [
      info.matchId,
      hasScore ? info.homeScore : null,
      hasScore ? info.awayScore : null,
      info.periodsScore?.length ? JSON.stringify(info.periodsScore) : null,
      Number.isFinite(info.enabledOddsCount) ? info.enabledOddsCount : null,
      info.stats && Object.keys(info.stats).length ? JSON.stringify(info.stats) : null,
      hasClock ? info.matchTimeMs : null,
      typeof info.feedStatus === 'string' ? info.feedStatus : null,
      typeof info.hasOpenOdds === 'boolean' ? info.hasOpenOdds : null,
      hasScore,
      hasClock,
      typeof info.broadcastUrl === 'string' ? info.broadcastUrl : null,
    ],
  );
  return res.rows[0] ?? null;
}

/**
 * How fresh the push feed's clock/score are for the live board. A silent freeze
 * (the bug where scores stuck at 0-0 while odds kept moving) shows up here first.
 */
export async function getFeedFreshness(olderThanSeconds = 90) {
  const res = await query(
    `select
        count(*) filter (where active and service = 'LIVE')::int as live,
        count(*) filter (where active and service = 'LIVE'
              and (clock_at is null or clock_at < now() - make_interval(secs => $1::int)))::int as stale_clock,
        count(*) filter (where active and service = 'LIVE'
              and (score_at is null or score_at < now() - make_interval(secs => $1::int)))::int as stale_score
       from matches`,
    [olderThanSeconds],
  );
  const r = res.rows[0];
  return {
    live: r.live,
    staleClock: r.stale_clock,
    staleScore: r.stale_score,
    olderThanSeconds,
  };
}

export async function recentRawFrames(limit = 20) {
  const res = await query(
    'select id, source, payload, at from raw_frames order by at desc limit $1',
    [Math.min(Number(limit) || 20, 200)],
  );
  return res.rows;
}

export async function getOddsHistory(matchId, limit = 200) {
  const res = await query(
    `select market_key, line, outcome_key, price, suspended, at
       from odds_history
      where match_id = $1
      order by at desc
      limit $2`,
    [matchId, Math.min(Number(limit) || 200, 1000)],
  );
  return res.rows;
}

/**
 * ids the push channel should be subscribed to. Prematch comes back split by kickoff distance
 * as well (`prematchSoon` / `prematchLater`), so the DB driver answers exactly what the memory
 * driver answers - the pusher must not care which store is in use.
 */
export async function getSubscriptionIds({
  liveLimit = 0,
  prematchLimit = 0,
  soonMs = DEFAULT_SOON_MS,
} = {}) {
  const live = await query(
    `select match_id from matches
      where active and service = 'LIVE' and status <> 'ended'
      order by start_at limit $1`,
    [Number(liveLimit)>0?Math.floor(Number(liveLimit)):null],
  );
  const prematch = await query(
    `select match_id, start_at from matches
      where active and service = 'PREMATCH' and status <> 'ended'
      order by start_at limit $1`,
    [Number(prematchLimit)>0?Math.floor(Number(prematchLimit)):null],
  );
  const ids = prematch.rows.map((r) => r.match_id);
  const kickoff = {};
  for (const row of prematch.rows) kickoff[row.match_id] = new Date(row.start_at).getTime();
  const { soon, later } = splitByKickoff(ids, kickoff, { soonMs });

  return {
    live: live.rows.map((r) => r.match_id),
    prematch: ids,
    prematchSoon: soon,
    prematchLater: later,
    full: [], // full-market boosts are in-process state: the memory store only
  };
}

export async function closePool() {
  await pool.end().catch(() => {});
}

/** which of the given ids exist in our (football-only) matches table */
export async function knownMatchIds(ids) {
  if (!ids.length) return new Set();
  const res = await query('select match_id from matches where match_id = any($1::bigint[])', [ids]);
  return new Set(res.rows.map((r) => r.match_id));
}
