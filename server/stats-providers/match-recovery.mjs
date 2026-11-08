/**
 * Multi-API Match Recovery & Result Historical Collector.
 * Automatically resolves finished matches that were missed during server downtime
 * or lack live FT signals from the primary provider.
 * Uses FotMob (scores, half-time, corners, cards, fouls, shots, scorers) as primary source,
 * cascading to configured secondary providers (ApiFootball, SportApi, GoalApi, BSD).
 */
import { query } from '../db.mjs';
import { teamsMatch, canonical } from './adapters.mjs';
import { settleMatch } from '../ledger/settler.mjs';

const fotmobDailyCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Fetch all matches for a given date from FotMob (YYYYMMDD).
 */
export async function fetchFotMobDate(dateStr) {
  const cached = fotmobDailyCache.get(dateStr);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    const url = `https://www.fotmob.com/api/data/matches?date=${dateStr}&timezone=Europe%2FTirane`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    fotmobDailyCache.set(dateStr, { at: Date.now(), data });
    return data;
  } catch (e) {
    console.warn('[fotmob-recovery] fetchFotMobDate error for', dateStr, e.message);
    return null;
  }
}

/**
 * Fetch detailed match facts (corners, cards, fouls, shots, goalscorers) from FotMob.
 */
export async function fetchFotMobDetails(matchId) {
  try {
    const url = `https://www.fotmob.com/api/data/matchDetails?matchId=${matchId}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('[fotmob-recovery] fetchFotMobDetails error for', matchId, e.message);
    return null;
  }
}

/**
 * Parse home and away team names from match_name or fixture.
 */
export function extractTeamNames(matchName, row = null) {
  if (row?.home && row?.away) {
    return { home: String(row.home).trim(), away: String(row.away).trim() };
  }
  const clean = String(matchName ?? '').trim();
  const sepMatch = clean.split(/\s+(?:vs\.?|-|v)\s+/i);
  if (sepMatch.length >= 2) {
    return { home: sepMatch[0].trim(), away: sepMatch.slice(1).join(' - ').trim() };
  }
  return { home: clean, away: '' };
}

/**
 * Look up a match in FotMob by team names across target dates.
 */
export async function findFotMobFixture(home, away, targetDates) {
  for (const dateStr of targetDates) {
    const data = await fetchFotMobDate(dateStr);
    if (!data?.leagues) continue;
    for (const league of data.leagues) {
      for (const m of league.matches || []) {
        const mHome = m.home?.name || m.home?.shortName;
        const mAway = m.away?.name || m.away?.shortName;
        if (teamsMatch(home, mHome) && teamsMatch(away, mAway)) {
          return { match: m, league: league.name, dateStr };
        }
      }
    }
  }
  return null;
}

/**
 * Extract normalized score, half-time, corners, cards, stats, and goal events from FotMob.
 */
export function parseFotMobPayload(summary, details = null) {
  const header = details?.header;
  const status = header?.status || summary?.status;
  const isFinished = status?.finished === true ||
    /^(?:ft|ended|finished|aet|pen)/i.test(status?.reason?.short || status?.reason?.shortKey || '');

  const scoreStr = header?.status?.scoreStr || summary?.status?.scoreStr || `${summary?.home?.score ?? ''} - ${summary?.away?.score ?? ''}`;
  const scoreParts = scoreStr.split('-').map(s => Number(s.trim()));
  const homeScore = Number.isInteger(scoreParts[0]) ? scoreParts[0] : (summary?.home?.score != null ? Number(summary.home.score) : null);
  const awayScore = Number.isInteger(scoreParts[1]) ? scoreParts[1] : (summary?.away?.score != null ? Number(summary.away.score) : null);

  let halfHome = null;
  let halfAway = null;
  let cornersH = null;
  let cornersA = null;
  let yellowH = 0;
  let yellowA = 0;
  let redH = 0;
  let redA = 0;
  let foulsH = null;
  let foulsA = null;
  let shotsH = null;
  let shotsA = null;
  let sOnTargetH = null;
  let sOnTargetA = null;
  let possessionH = null;
  let possessionA = null;

  const events = details?.content?.matchFacts?.events?.events || [];
  for (const ev of events) {
    if (ev.type === 'Half' && (ev.halfStrShort === 'HT' || ev.time === 45)) {
      if (Number.isInteger(ev.homeScore)) halfHome = ev.homeScore;
      if (Number.isInteger(ev.awayScore)) halfAway = ev.awayScore;
    }
    if (ev.type === 'Card') {
      const isRed = /red/i.test(ev.card ?? '');
      if (ev.isHome) {
        if (isRed) redH++; else yellowH++;
      } else {
        if (isRed) redA++; else yellowA++;
      }
    }
  }

  const allStats = details?.content?.stats?.Periods?.All?.stats || [];
  for (const group of allStats) {
    for (const item of group.stats || []) {
      const title = String(item.title || item.key || '').toLowerCase();
      const s0 = Number(item.stats?.[0]);
      const s1 = Number(item.stats?.[1]);
      if (/corner/i.test(title)) {
        if (Number.isFinite(s0)) cornersH = s0;
        if (Number.isFinite(s1)) cornersA = s1;
      } else if (/foul/i.test(title)) {
        if (Number.isFinite(s0)) foulsH = s0;
        if (Number.isFinite(s1)) foulsA = s1;
      } else if (/shots? on target/i.test(title)) {
        if (Number.isFinite(s0)) sOnTargetH = s0;
        if (Number.isFinite(s1)) sOnTargetA = s1;
      } else if (/total shots?|shots/i.test(title) && !/target|inside|outside/i.test(title)) {
        if (Number.isFinite(s0)) shotsH = s0;
        if (Number.isFinite(s1)) shotsA = s1;
      } else if (/possession/i.test(title)) {
        if (Number.isFinite(s0)) possessionH = s0;
        if (Number.isFinite(s1)) possessionA = s1;
      } else if (/yellow card/i.test(title)) {
        if (Number.isFinite(s0)) yellowH = s0;
        if (Number.isFinite(s1)) yellowA = s1;
      } else if (/red card/i.test(title)) {
        if (Number.isFinite(s0)) redH = s0;
        if (Number.isFinite(s1)) redA = s1;
      }
    }
  }

  const totalCardsH = yellowH + redH;
  const totalCardsA = yellowA + redA;

  // Normalized goal events for player scorer grading
  const goalEvents = events
    .filter(e => e.type === 'Goal' && e.isPenaltyShootoutEvent !== true)
    .map((e, idx) => ({
      disabled: false,
      id: String(e.eventId || `goal-${e.time}-${idx}`),
      type: 'goal',
      team: e.isHome ? 'home' : 'away',
      minute: Number(e.time ?? 0),
      player: e.player?.name || e.nameStr || e.fullName || null,
      playerId: e.player?.id || e.playerId || null,
      own: e.ownGoal === true || e.shotmapEvent?.isOwnGoal === true,
      header: e.shotmapEvent?.shotType === 'Header',
      penalty: e.penalty === true || /penalty/i.test(e.goalDescription ?? ''),
      shootout: false
    }))
    .filter(e => e.player);

  return {
    finished: isFinished,
    homeScore,
    awayScore,
    halfHomeScore: halfHome,
    halfAwayScore: halfAway,
    cornersHome: cornersH,
    cornersAway: cornersA,
    cardsHome: totalCardsH > 0 || (details && isFinished) ? totalCardsH : null,
    cardsAway: totalCardsA > 0 || (details && isFinished) ? totalCardsA : null,
    statistics: {
      shots: (shotsH != null && shotsA != null) ? { home: shotsH, away: shotsA } : {},
      shotsOnTarget: (sOnTargetH != null && sOnTargetA != null) ? { home: sOnTargetH, away: sOnTargetA } : {},
      fouls: (foulsH != null && foulsA != null) ? { home: foulsH, away: foulsA } : {},
      possession: (possessionH != null && possessionA != null) ? { home: possessionH, away: possessionA } : {}
    },
    goalEvents
  };
}

/**
 * Generate candidate dates formatted as YYYYMMDD around an initial date.
 */
export function candidateDateStrings(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  const valid = !isNaN(d.getTime()) ? d : new Date();
  const format = date => {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  };

  const dates = new Set();
  dates.add(format(valid));

  // Also check previous day and next day to account for timezone differences
  const prev = new Date(valid.getTime() - 86400000);
  const next = new Date(valid.getTime() + 86400000);
  const twoPrev = new Date(valid.getTime() - 2 * 86400000);
  dates.add(format(prev));
  dates.add(format(next));
  dates.add(format(twoPrev));
  return [...dates];
}

/**
 * Recover a single pending match by matchId and settle its lines.
 */
export async function recoverPendingMatch(matchId, { matchName = null, placedAt = null, runQuery = query } = {}) {
  const id = Number(matchId);
  if (!Number.isSafeInteger(id) || id <= 0) return { recovered: false, reason: 'INVALID_ID' };

  // Check if an existing complete result is already recorded
  const existing = await runQuery('select * from app_match_result where match_id = $1', [id]);
  if (existing.rows.length && existing.rows[0].home_score != null && existing.rows[0].away_score != null) {
    // Result exists, settle directly
    const outcome = await settleMatch(id);
    return { recovered: true, source: 'EXISTING_RESULT', outcome };
  }

  // Look up fixture data
  const matchRow = (await runQuery('select * from matches where match_id = $1', [id])).rows[0] ?? null;
  const snapshotRow = !matchRow ? (await runQuery('select snapshot from app_match_snapshot where match_id = $1', [id])).rows[0]?.snapshot : null;
  const fixture = matchRow || snapshotRow;

  const { home, away } = extractTeamNames(matchName || fixture?.match_name, fixture);
  if (!home || !away) {
    return { recovered: false, reason: 'CANNOT_IDENTIFY_TEAMS' };
  }

  const targetDate = fixture?.start_at || placedAt || new Date().toISOString();
  const dates = candidateDateStrings(targetDate);

  // 1. Try FotMob
  const found = await findFotMobFixture(home, away, dates);
  if (found && found.match) {
    const details = await fetchFotMobDetails(found.match.id);
    const parsed = parseFotMobPayload(found.match, details);

    if (parsed.finished && parsed.homeScore != null && parsed.awayScore != null) {
      // Store result
      await runQuery(`
        insert into app_match_result (
          match_id, home_team, away_team, home_score, away_score,
          half_home_score, half_away_score, corners_home, corners_away,
          cards_home, cards_away, statistics, source, finished_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, 'RECOVERY', now())
        on conflict (match_id) do update set
          home_score = coalesce(excluded.home_score, app_match_result.home_score),
          away_score = coalesce(excluded.away_score, app_match_result.away_score),
          half_home_score = coalesce(excluded.half_home_score, app_match_result.half_home_score),
          half_away_score = coalesce(excluded.half_away_score, app_match_result.half_away_score),
          corners_home = coalesce(excluded.corners_home, app_match_result.corners_home),
          corners_away = coalesce(excluded.corners_away, app_match_result.corners_away),
          cards_home = coalesce(excluded.cards_home, app_match_result.cards_home),
          cards_away = coalesce(excluded.cards_away, app_match_result.cards_away),
          statistics = coalesce(app_match_result.statistics, '{}'::jsonb) || excluded.statistics
      `, [
        id, home, away, parsed.homeScore, parsed.awayScore,
        parsed.halfHomeScore, parsed.halfAwayScore,
        parsed.cornersHome, parsed.cornersAway,
        parsed.cardsHome, parsed.cardsAway,
        JSON.stringify(parsed.statistics)
      ]);

      // If goal events are present, store into app_match_event_evidence
      if (parsed.goalEvents.length > 0) {
        const evidencePayload = {
          source: 'fotmob',
          complete: true,
          homeScore: parsed.homeScore,
          awayScore: parsed.awayScore,
          goalsAvailable: true,
          events: parsed.goalEvents,
          observedAt: new Date().toISOString()
        };
        await runQuery(`
          insert into app_match_event_evidence(match_id, payload)
          values ($1, $2::jsonb)
          on conflict(match_id) do update set payload = excluded.payload, observed_at = now()
        `, [id, JSON.stringify(evidencePayload)]).catch(e => console.warn('[recovery] save evidence error:', e.message));
      }

      // Settle tickets immediately
      const outcome = await settleMatch(id);
      return {
        recovered: true,
        source: 'FOTMOB',
        score: `${parsed.homeScore}-${parsed.awayScore}`,
        settled: outcome.settled,
        tickets: outcome.tickets?.length ?? 0
      };
    }
  }

  return { recovered: false, reason: 'MATCH_NOT_FINISHED_OR_FOUND' };
}

/**
 * Scan all pending tickets whose matches have no stored FT result,
 * recover results from external sources, and trigger settlement.
 */
export async function recoverAllPendingMatches({ runQuery = query } = {}) {
  const pending = await runQuery(`
    select l.match_id,
           min(l.match_name) as match_name,
           min(t.placed_at) as placed_at,
           array_agg(distinct l.market_name) as market_names
      from app_ticket_line l
      join app_ticket t on t.id = l.ticket_id
     where l.status = 'PENDING' and t.status = 'PENDING'
       and not exists (
         select 1 from app_match_result r
          where r.match_id = l.match_id
            and r.home_score is not null
            and r.away_score is not null
       )
     group by l.match_id
     order by min(t.placed_at) asc
     limit 25
  `);

  if (!pending.rows.length) return { examined: 0, recovered: 0 };

  let recoveredCount = 0;
  for (const row of pending.rows) {
    try {
      const res = await recoverPendingMatch(row.match_id, {
        matchName: row.match_name,
        placedAt: row.placed_at,
        runQuery
      });
      if (res.recovered) {
        recoveredCount++;
        console.log(`[recovery] Match ${row.match_id} (${row.match_name}) recovered: score=${res.score} settled_tickets=${res.tickets}`);
      }
    } catch (e) {
      console.error(`[recovery] Error recovering match ${row.match_id}:`, e.message);
    }
  }

  return { examined: pending.rows.length, recovered: recoveredCount };
}
