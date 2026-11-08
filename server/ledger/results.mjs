/**
 * Final results.
 *
 * The board keeps matches in memory, so when a match is seen finished its result is copied
 * here immediately. Settlement then never depends on the live feed: it works after a
 * restart, and later (admin "settle") for matches that have long left the board.
 */
import { query } from '../db.mjs';
import {loadEventEvidence} from './event-evidence.mjs';
import { getMatches, getMatchById } from '../matches.mjs';
import {matchSnapshots} from './match-snapshots.mjs';
import {eventMarketRequirement} from './event-market-policy.mjs';
import {teamStatisticsFromRow,verifiedFinalStatistics} from '../match-statistics.mjs';
import {isStatisticMarket,hasStatisticEvidence} from './statistic-markets.mjs';
import {recoverAllPendingMatches} from '../stats-providers/match-recovery.mjs';

/**
 * Do not settle bets from a made-up 0-0 or a kickoff timer. A final score
 * requires a genuine score observed from the provider (score_at) and a
 * definitive final feed phase. The catalogue's service can lag behind play.
 * The absence of evidence deliberately leaves the ticket pending for review.
 */
export const isFinished = (row) => {
  if (!row) return false;
  if(row.raw?.provider==='YBETS'&&row.raw.ybetsFinalScoreVerified!==true)return false;
  if (!row.score_at || row.home_score == null || row.away_score == null) return false;
  const score = [Number(row.home_score), Number(row.away_score)];
  if (!score.every(n => Number.isInteger(n) && n >= 0)) return false;
  // Apply the same verification to live rows AND durable restart recovery.
  // A new FT-only flag must never turn an old partial score into a final result.
  if(row.raw?.provider==='YBETS'&&row.feed_status_at!=null){
    const scoreAt=new Date(row.score_at).getTime(),phaseAt=new Date(row.feed_status_at).getTime();
    if(!Number.isFinite(scoreAt)||!Number.isFinite(phaseAt)||Math.abs(scoreAt-phaseAt)>120000)return false;
  }
  // Collector expiry and kickoff extrapolation also set status='ended'!
  // Only a provider-delivered FT signal proves the final score.
  const feed = String(row.feed_status ?? '').trim().toLowerCase();
  return /^(?:ft|full.?time|finished|ended|after (?:match|penalt(?:y|ies)))(?:\b|$)/.test(feed);
};

const statNum = (v) => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);

/** Safely take first-period scores only from a complete two-half breakdown.
 * With a single unlabeled period we cannot know whether it is a first-half score.
 */
export function verifiedFirstHalf(periodsScore) {
  let periods = periodsScore;
  if (typeof periods === 'string') {
    try { periods = JSON.parse(periods); } catch { return null; }
  }
  if (!Array.isArray(periods) || periods.length < 2) return null;
  const first = periods[0];
  const home = first?.t1, away = first?.t2;
  if (home === null || home === undefined || away === null || away === undefined) return null;
  if (!/^[0-9]+$/.test(String(home)) || !/^[0-9]+$/.test(String(away))) return null;
  return { home: Number(home), away: Number(away) };
}

/**
 * Each stored column has a matching parameter. The old nine-placeholder statement
 * accidentally received eleven parameters once half-time scores were added;
 * PostgreSQL refused every automatic result capture, leaving tickets PENDING.
 *
 * Preserve previously confirmed half scores when the next frame omits them.
 */
export const FINISHED_RESULT_INSERT = `
  insert into app_match_result
    (match_id, home_team, away_team, home_score, away_score,
     corners_home, corners_away, cards_home, cards_away,
     half_home_score, half_away_score, statistics)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
  on conflict (match_id) do update set
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    corners_home = coalesce(excluded.corners_home, app_match_result.corners_home),
    corners_away = coalesce(excluded.corners_away, app_match_result.corners_away),
    cards_home = coalesce(excluded.cards_home, app_match_result.cards_home),
    cards_away = coalesce(excluded.cards_away, app_match_result.cards_away),
    half_home_score = coalesce(excluded.half_home_score, app_match_result.half_home_score),
    half_away_score = coalesce(excluded.half_away_score, app_match_result.half_away_score),
    statistics = coalesce(app_match_result.statistics,'{}'::jsonb) || jsonb_build_object(
      'shots',coalesce(app_match_result.statistics->'shots','{}'::jsonb)||coalesce(excluded.statistics->'shots','{}'::jsonb),
      'shotsOnTarget',coalesce(app_match_result.statistics->'shotsOnTarget','{}'::jsonb)||coalesce(excluded.statistics->'shotsOnTarget','{}'::jsonb),
      'fouls',coalesce(app_match_result.statistics->'fouls','{}'::jsonb)||coalesce(excluded.statistics->'fouls','{}'::jsonb))
  -- A verified admin correction or already-settled result must not be
  -- overwritten by a later stale or conflicting provider frame.
  where app_match_result.source = 'FEED' and app_match_result.settled_at is null
  returning (xmax = 0) as inserted
`;

export function finishedResultParameters(row) {
  // The push feed stores stats under its competitor IDs, e.g.
  // { "87150": {corners:3}, "87155": {corners:4} }, NOT under
  // stats.home/stats.away. Failing to map this made corner/card tickets
  // VOID or eternally pending even when full-time stats were available.
  const {home:homeTeam,away:awayTeam}=teamStatisticsFromRow(row);
  const home = homeTeam ? statNum(homeTeam.corners) : null;
  const away = awayTeam ? statNum(awayTeam.corners) : null;
  const cards = team => {
    if (!team) return null;
    const yellow = statNum(team.yellow);
    const red = statNum(team.red);
    return yellow === null && red === null ? null : (yellow ?? 0) + (red ?? 0);
  };
  const half = verifiedFirstHalf(row.periods_score);
  return [row.match_id, row.home, row.away, Number(row.home_score), Number(row.away_score),
    home, away, cards(homeTeam), cards(awayTeam), half?.home ?? null, half?.away ?? null,JSON.stringify(verifiedFinalStatistics(row))];
}

/**
 * Persist the verified FT snapshot immediately, before the volatile LIVE match
 * map is discarded or the server restarts. The regular settlement pass can
 * later grade tickets against this durable score without relying on the feed.
 * Returns {recorded, inserted}, including no-op for unconfirmed scores.
 */
export async function archiveFinishedMatch(row) {
  if (!isFinished(row)) return { recorded: false, inserted: false };
  const result = await query(FINISHED_RESULT_INSERT, finishedResultParameters(row));
  const inserted = result.rows[0]?.inserted === true;
  return { recorded: result.rowCount > 0, inserted };
}

/** copies every verified FT result into the durable result table (idempotent) */
export async function captureFinishedMatches() {
  const rows = await getMatches({ includeEnded: true, limit: 2000 });

  // Specifically check matches from any currently pending ticket lines
  const pendingLines = await query(`select distinct l.match_id from app_ticket_line l
    join app_ticket t on t.id=l.ticket_id
    where l.status='PENDING' and t.status='PENDING' order by l.match_id`);
  const pendingMatchIds = new Set(pendingLines.rows.map((r) => Number(r.match_id)));

  const candidateMatches = new Map(rows.map(row => [Number(row.match_id), row]));
  for(const persisted of await matchSnapshots.load([...pendingMatchIds])){
    if(isFinished(persisted))candidateMatches.set(Number(persisted.match_id),persisted);
  }
  for (const matchId of pendingMatchIds) {
    if (!candidateMatches.has(matchId)) {
      const match = await getMatchById(matchId);
      if (match) candidateMatches.set(matchId, match);
    }
  }

  const finished = [...candidateMatches.values()].filter(
    (r) => isFinished(r) && r.home_score !== null && r.away_score !== null,
  );
  let stored = 0;
  for (const row of finished) {
    try {
      const result = await archiveFinishedMatch(row);
      if (result.inserted) stored++;
    } catch (e) {
      // A single malformed feed record may not block settlement of hundreds
      // of unrelated football fixtures already saved to the ledger.
      console.error('[settle] result archive failed for match', row.match_id, e.message);
    }
  }

  // Auto-recover any remaining pending ticket matches whose results were missed due to downtime
  try {
    const recoveryResult = await recoverAllPendingMatches();
    if (recoveryResult?.recovered) stored += recoveryResult.recovered;
  } catch (e) {
    console.warn('[settle] external match recovery failed:', e.message);
  }

  return stored;
}

let evidenceWarningAt=0;
export async function getResult(matchId,{execute=query,readEvidence=loadEventEvidence,onEvidenceError}={}) {
  const res = await execute('select * from app_match_result where match_id = $1', [Number(matchId)]);
  const result=res.rows[0];if(!result)return null;
  const review=(await execute('select payload from app_stat_review where match_id=$1',[Number(matchId)])).rows[0]?.payload;
  result.statistics_review=review??null;
  result.statistics_review_pending=process.env.STATS_PROVIDERS_ENABLED==='true'&&!review;
  if(review?.complete){
    result.statistics={...(result.statistics??{})};
    for(const field of ['shots','shotsOnTarget','fouls'])if(review.consensus?.[field]&&!review.conflicts?.[field]){
      const pair=result.statistics[field]??{},verified=review.consensus[field];
      result.statistics[field]={home:pair.home??verified.home,away:pair.away??verified.away};
    }
    for(const [field,prefix]of [['corners','corners'],['cards','cards']])if(review.consensus?.[field]&&!review.conflicts?.[field]){
      result[prefix+'_home']??=review.consensus[field].home;
      result[prefix+'_away']??=review.consensus[field].away;
    }
  }
  // Optional timeline storage must not stop ordinary result/statistics tickets.
  try{result.event_evidence=await readEvidence(matchId);}catch(error){
    result.event_evidence=null;
    if(onEvidenceError)onEvidenceError(error);
    else if(Date.now()-evidenceWarningAt>60000){evidenceWarningAt=Date.now();console.warn('[settle] optional event evidence unavailable; event selections remain pending');}
  }
  return result;
}

/** manual result (admin "settle" button): stores the score the admin entered */
export async function storeResult(matchId, homeScore, awayScore, { homeTeam = null, awayTeam = null } = {}) {
  await query(
    `insert into app_match_result (match_id, home_team, away_team, home_score, away_score, source)
     values ($1, $2, $3, $4, $5, 'ADMIN')
     on conflict (match_id) do update set
       home_score = excluded.home_score,
       away_score = excluded.away_score,
       source = 'ADMIN',
       home_team  = coalesce(excluded.home_team, app_match_result.home_team),
       away_team  = coalesce(excluded.away_team, app_match_result.away_team)`,
    [Number(matchId), homeTeam, awayTeam, Number(homeScore), Number(awayScore)],
  );
  return getResult(matchId);
}

/** results for a set of matches (used by the settler to find work) */
export async function resultsFor(matchIds = []) {
  if (!matchIds.length) return new Map();
  const res = await query('select * from app_match_result where match_id = any($1::bigint[])', [matchIds]);
  return new Map(res.rows.map((r) => [String(r.match_id), r]));
}

export async function recentResults(limit = 50) {
  const res = await query(
    `select r.*, (select count(*)::int from app_ticket_line l where l.match_id = r.match_id) as lines
       from app_match_result r order by r.finished_at desc limit $1`,
    [Math.min(Number(limit) || 50, 200)],
  );
  return res.rows;
}

/**
 * Administrator-only review queue: why tickets cannot yet be graded.
 * The short ticket codes users see are prefixes of UUIDs; we join on the
 * stored provider match IDs, not on fuzzy team names or user-supplied scores.
 */
export async function pendingSettlementReview(limit = 100) {
  const max = Math.min(300, Math.max(1, Math.trunc(Number(limit) || 100)));
  const { rows } = await query(
    `select l.match_id,
            min(l.match_name) as match_name,
            count(*)::int as pending_lines,
            count(distinct l.ticket_id)::int as pending_tickets,
            min(t.placed_at) as oldest_ticket_at,
            array_agg(distinct l.market_name) as market_names
       from app_ticket_line l
       join app_ticket t on t.id = l.ticket_id
      where t.status = 'PENDING' and l.status = 'PENDING'
      group by l.match_id
      order by min(t.placed_at) asc
      limit $1`,
    [max],
  );
  if (!rows.length) return [];

  const recorded = await resultsFor(rows.map(r => Number(r.match_id)));
  return Promise.all(rows.map(async row => {
    const stored = recorded.get(String(row.match_id));
    const current = await getMatchById(Number(row.match_id));
    const kickoff = current?.start_at ? new Date(current.start_at).toISOString() : null;
    const timestamp = new Date(row.oldest_ticket_at).getTime();
    const ageHours = Number.isFinite(timestamp) ? Math.max(0, Math.round((Date.now() - timestamp) / 3600000)) : null;
    const finalScore = stored ? `${stored.home_score}-${stored.away_score}` : null;
    const marketNames = row.market_names ?? [];
    const incompleteStats = !!stored && marketNames.some(name =>
      eventMarketRequirement({name}) ||
      (/\b(?:first|1st)\s*half\b/i.test(name) &&
        (stored.half_home_score == null || stored.half_away_score == null)) ||
      (isStatisticMarket({market_name:name}) && !hasStatisticEvidence({market_name:name},stored)) ||
      (/\bcorners?\b/i.test(name) && (stored.corners_home == null || stored.corners_away == null)) ||
      (/\bcards?\b|booking/i.test(name) && (stored.cards_home == null || stored.cards_away == null)) ||
      /early\s*payout/i.test(name));
    const reason = stored
      ? (incompleteStats ? 'MISSING_MARKET_STATS' : 'RESULT_STORED')
      : current && isFinished(current) ? 'FINAL_FRAME_NOT_ARCHIVED'
      : current?.active && isStillCurrentFixture(current) ? 'NO_FINAL_FEED_SIGNAL'
      : 'FINAL_RESULT_MISSING';
    return {
      matchId: String(row.match_id), matchName: row.match_name,
      pendingLines: Number(row.pending_lines), pendingTickets: Number(row.pending_tickets),
      oldestTicketAt: row.oldest_ticket_at, ageHours,
      kickoff, finalScore, reason,
      marketNames,
      feedStatus: current?.feed_status ?? null,
      feedScoreAt: current?.score_at ?? null,
    };
  }));
}

/** A fixture seen recently and not already beyond a day past kickoff. */
function isStillCurrentFixture(match) {
  if (match.active === false || /^(?:ended|finished|cancelled)$/i.test(String(match.status ?? ''))) return false;
  if (!match.start_at) return true;
  const kickoff = new Date(match.start_at).getTime();
  return !Number.isFinite(kickoff) || Date.now() - kickoff <= 24 * 3600000;
}

/** results that still have unsettled lines (the settler's work queue) */
export async function unsettledMatchIds() {
  const res = await query(
    `select distinct l.match_id
       from app_ticket_line l
       join app_match_result r on r.match_id = l.match_id
       join app_ticket t on t.id = l.ticket_id
      where l.status = 'PENDING' and t.status = 'PENDING'
      order by l.match_id`,
  );
  return res.rows.map((r) => r.match_id);
}
