/**
 * In-memory match store.
 *
 * The match list is rebuilt from the public feed every poll cycle (10s), so keeping it
 * in the database was only buying durability for something the feed re-sends anyway.
 * Holding it in RAM means the board (matches + odds) keeps serving while the database
 * is unreachable - the database is now only needed for the ledger (users, tickets,
 * results) and for the optional raw-frame archive.
 *
 * Field-for-field compatible with the old `matches` table: the poll only overwrites the
 * columns it owns, so score/clock/stats written by match-info frames survive an upsert,
 * exactly like the `on conflict ... do update` did. The one import is the pure scheduling
 * helper, so the subscription tiers are defined in exactly one place.
 */
import { splitByKickoff, DEFAULT_SOON_MS } from './subscribe-plan.mjs';
import {mergeTeamStats} from './match-statistics.mjs';

const MATCH_COLUMNS = [
  'match_id', 'sport_id', 'sport_tag', 'category_id', 'category_slug', 'category_name',
  'tournament_id', 'tournament_slug', 'tournament_name', 'home', 'away', 'service',
  'start_at', 'is_hot', 'is_real', 'live_minute', 'phase', 'status', 'raw',
];

/** columns that only match-info frames write */
const FEED_COLUMNS = {
  home_score: null,
  away_score: null,
  periods_score: null,
  odds_count: null,
  stats: null,
  match_time_ms: null,
  clock_at: null,
  score_at: null,
  feed_status: null,
  feed_status_at: null,
  has_open_odds: null,
  provider_id: null,
  broadcast_url: null,
};

const byId = new Map(); // match_id -> row (snake_case, same shape the board serializer reads)
let lastUpdatedAt = null;
let upserts = 0;
const competitionOrder = new Map();
const competitionKey = row => `${row.sport_id ?? ''}|${row.tournament_id ?? row.category_slug ?? ''}`;

const time = (v) => (v instanceof Date ? v.getTime() : v ? new Date(v).getTime() : 0);

/**
 * Applies one poll cycle. Only the polled columns are written; anything a match-info
 * frame set (score, clock, stats, stream URL) is preserved, and a match that reappears
 * becomes active again.
 */
export function upsert(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const at = new Date();
  let written = 0;

  for (const row of rows) {
    const id = Number(row.match_id);
    if (!Number.isFinite(id)) continue;

    let match = byId.get(id);
    if (!match) {
      match = { ...FEED_COLUMNS, first_seen_at: at };
      byId.set(id, match);
    }

    for (const col of MATCH_COLUMNS) match[col] = row[col] ?? null;
    if (match.service === 'LIVE' && !match.live_first_seen_at) match.live_first_seen_at = at;
    if (match.service === 'PREMATCH' && !match.prematch_first_seen_at) match.prematch_first_seen_at = at;
    const phaseKey = `${match.service}|${competitionKey(match)}`;
    if (!competitionOrder.has(phaseKey)) competitionOrder.set(phaseKey, at);
    match.competition_first_seen_at = competitionOrder.get(phaseKey);
    match.listing_stale = false;
    match.raw = row.raw ?? {};
    match.active = true;
    match.last_seen_at = at;
    match.updated_at = at;
    written++;
  }

  upserts++;
  lastUpdatedAt = at;
  return written;
}

/** Missing one poll page is not a final result. Keep fresh pushed matches and
 * retain temporarily missing fixtures as suspended instead of declaring FT. */
export function expireStale(graceSeconds = 150, at = Date.now()) {
  const cutoff = at - graceSeconds * 1000;
  const expired = [];

  for (const match of byId.values()) {
    if (!match.active) continue;
    const freshAt = Math.max(time(match.last_seen_at), time(match.updated_at), time(match.score_at), time(match.clock_at), time(match.feed_status_at));
    if (freshAt >= cutoff) continue;
    match.listing_stale = true;
    const confirmedEnd = match.status === 'ended' || /^(?:finished|ended|ft|full time)$/i.test(String(match.feed_status ?? ''));
    if (!confirmedEnd && freshAt >= at - 6 * 60 * 60 * 1000) continue;
    match.active = false;
    if (confirmedEnd) match.status = 'ended';
    match.updated_at = new Date(at);
    expired.push(match.match_id);
  }

  return expired;
}

/** Server-owned order is immutable while a fixture stays in its section. */
export function getMatches({ service = null, league = null, tournamentId = null, sportId = null, q = null, limit = 500, offset = 0, includeEnded = false,catalog=false } = {}) {
  const wantService = service ? String(service).toUpperCase() : null;
  const needle = q ? String(q).toLowerCase() : null;
  const out = [];

  for (const match of byId.values()) {
    if (!match.active) continue;
    if (wantService && match.service !== wantService) continue;
    if (league && match.category_slug !== league) continue;
    if (tournamentId != null && String(match.tournament_id) !== String(tournamentId)) continue;
    if (sportId != null && String(match.sport_id) !== String(sportId)) continue;
    if (!includeEnded && match.status === 'ended') continue;
    if (needle) {
      const hay = `${match.home ?? ''} ${match.away ?? ''} ${match.category_name ?? ''} ${match.tournament_name ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    out.push(match);
  }

  out.sort(
    (a, b) =>
      (b.service === 'LIVE' ? 1 : 0) - (a.service === 'LIVE' ? 1 : 0) ||
      time(a.competition_first_seen_at ?? a.first_seen_at) - time(b.competition_first_seen_at ?? b.first_seen_at) ||
      Number(a.tournament_id ?? a.category_id ?? 0) - Number(b.tournament_id ?? b.category_id ?? 0) ||
      time(a.service === 'LIVE' ? a.live_first_seen_at : a.prematch_first_seen_at ?? a.first_seen_at) - time(b.service === 'LIVE' ? b.live_first_seen_at : b.prematch_first_seen_at ?? b.first_seen_at) || Number(a.match_id) - Number(b.match_id),
  );

  const from = Math.max(0, Number(offset) || 0);
  return catalog?out:out.slice(from, from + Math.min(Number(limit) || 500, 2000));
}

export function getById(matchId) {
  return byId.get(Number(matchId)) ?? null;
}

/** leagues with their live/prematch counts (what /api/leagues serves) */
export function getLeagues() {
  const groups = new Map();

  for (const match of byId.values()) {
    if (!match.active) continue;
    const slug = match.category_slug ?? '';
    let group = groups.get(slug);
    if (!group) {
      group = { slug, name: match.category_name ?? null, live: 0, prematch: 0, total: 0 };
      groups.set(slug, group);
    }
    if (!group.name && match.category_name) group.name = match.category_name;
    group.total++;
    if (match.service === 'LIVE') group.live++;
    else if (match.service === 'PREMATCH') group.prematch++;
  }

  return [...groups.values()]
    .sort((a, b) => b.live - a.live || b.total - a.total)
    .map(({ slug, name, live, prematch }) => ({ slug, name, live, prematch }));
}

export function getCounts() {
  let live = 0;
  let prematch = 0;
  let finished = 0;

  for (const match of byId.values()) {
    if (!match.active) continue;
    if (match.status === 'ended') finished++;
    else if (match.service === 'LIVE') live++;
    else if (match.service === 'PREMATCH') prematch++;
  }

  return { live, prematch, finished, updatedAt: lastUpdatedAt };
}

/**
 * ids the push channel should be subscribed to, oldest kickoff first.
 *
 * Prematch is returned twice: `prematch` (everything we track, what the pusher uses to decide
 * how many fixtures are visible) and, split by kickoff distance, `prematchSoon` / `prematchLater`
 * so the pusher can refresh the fixtures that are about to start far more often than the rest.
 */
export function getSubscriptionIds({
  liveLimit = 0,
  prematchLimit = 0,
  feedEvidenceMs = 900000,
  soonMs = DEFAULT_SOON_MS,
} = {}) {
  const cutoff = Date.now() - feedEvidenceMs;
  const pick = (service, limit) =>
    [...byId.values()]
      .filter((m) => {
        if (!m.active || m.service !== service) return false;
        // A match whose derived clock already says full time must stay subscribed while the
        // feed keeps reporting a clock for it - unsubscribing there froze its minute, its
        // score and its prices for the rest of the game (matches "disappeared" around 70').
        if (m.status !== 'ended') return true;
        return time(m.clock_at) >= cutoff;
      })
      .sort((a, b) => time(a.start_at) - time(b.start_at))
      .slice(0, Number(limit)>0?Math.floor(Number(limit)):undefined);

  const liveRows = pick('LIVE', liveLimit);
  const prematchRows = pick('PREMATCH', prematchLimit);
  const kickoff = {};
  for (const m of prematchRows) kickoff[m.match_id] = time(m.start_at);
  const { soon, later } = splitByKickoff(
    prematchRows.map((m) => m.match_id),
    kickoff,
    { soonMs },
  );

  return {
    live: liveRows.map((m) => m.match_id),
    prematch: prematchRows.map((m) => m.match_id),
    prematchSoon: soon,
    prematchLater: later,
    full: boostedIds(),
  };
}

/* ------------------------------------------------------------------- market boost
 * Full markets (corners, cards, all totals) are only subscribed for a slice of the live
 * list, so most matches used to show base markets only. Opening a match in the app adds it
 * to that slice for a few minutes, which keeps the frame volume flat because a user looks
 * at one match at a time.
 * ------------------------------------------------------------------------------- */
const boosted = new Map(); // matchId -> expires at (ms)

/** full markets for this match for the next `ttlMs` (5 min by default) */
export function boost(matchId, ttlMs = 5 * 60 * 1000) {
  const id = Number(matchId);
  if (!Number.isFinite(id)) return false;
  boosted.set(id, Date.now() + Math.max(5000, Number(ttlMs) || 0));
  return true;
}

/** boosted ids that have not expired yet (also drops the expired ones) */
export function boostedIds(at = Date.now()) {
  const out = [];
  for (const [id, until] of boosted) {
    if (until <= at) boosted.delete(id);
    else out.push(id);
  }
  return out;
}

/** which of the given ids we track (used to drop third-party matches from ingest) */
export function knownIds(ids = []) {
  return new Set(ids.filter((id) => byId.has(Number(id))));
}

/**
 * Applies a decoded match-info (score / clock / stats / stream). A frame without a score
 * or a clock leaves the stored value alone - only the freshness anchor moves when the
 * feed really reported it. Returns the updated row (what the socket broadcasts).
 */
export function applyInfo(info) {
  if (!info?.matchId) return null;
  const match = byId.get(Number(info.matchId));
  if (!match) return null;

  const at = new Date();
  const hasClock = Number.isFinite(info.matchTimeMs);
  const hasScore = Number.isFinite(info.homeScore) && Number.isFinite(info.awayScore);
  if (hasClock || hasScore || info.feedStatus != null) { match.listing_stale = false; match.active = true; }

  if (hasScore) {
    match.home_score = info.homeScore;
    match.away_score = info.awayScore;
    match.score_at = at;
  }
  if (Array.isArray(info.periodsScore) && info.periodsScore.length) match.periods_score = info.periodsScore;
  if (Number.isFinite(info.enabledOddsCount)) match.odds_count = info.enabledOddsCount;
  if (info.stats && Object.keys(info.stats).length) match.stats = mergeTeamStats(match.stats,info.stats,{observedAt:at});
  if (hasClock) {
    match.match_time_ms = info.matchTimeMs;
    match.clock_at = info.providerClockAt && Number.isFinite(Date.parse(info.providerClockAt)) ? new Date(info.providerClockAt) : at;
  }
  if (typeof info.feedStatus === 'string') {
    match.feed_status = info.feedStatus;
    match.feed_status_at = at;
  }
  if (typeof info.hasOpenOdds === 'boolean') match.has_open_odds = info.hasOpenOdds;
  // the book the site itself sells this match from (match-info.providerId)
  if (info.providerId !== null && info.providerId !== undefined && Number.isFinite(Number(info.providerId))) {
    match.provider_id = Number(info.providerId);
  }
  if (typeof info.broadcastUrl === 'string') match.broadcast_url = info.broadcastUrl;
  match.updated_at = at;

  return match;
}

/** how fresh the push feed's clock/score are for the live board (drives /health) */
export function getFeedFreshness(olderThanSeconds = 90, at = Date.now()) {
  const cutoff = at - olderThanSeconds * 1000;
  let live = 0;
  let staleClock = 0;
  let staleScore = 0;

  for (const match of byId.values()) {
    if (!match.active || match.service !== 'LIVE') continue;
    live++;
    if (time(match.clock_at) < cutoff) staleClock++;
    if (time(match.score_at) < cutoff) staleScore++;
  }

  return { live, staleClock, staleScore, olderThanSeconds };
}

export function stats(at = Date.now()) {
  let active = 0;
  let live = 0;
  for (const match of byId.values()) {
    if (!match.active) continue;
    active++;
    if (match.service === 'LIVE') live++;
  }
  return {
    matches: byId.size,
    active,
    live,
    upserts,
    lastUpdatedAt: lastUpdatedAt ? lastUpdatedAt.toISOString() : null,
  };
}

/** test helper */
export function clear() {
  byId.clear();
  lastUpdatedAt = null;
  upserts = 0;
  competitionOrder.clear();
}
