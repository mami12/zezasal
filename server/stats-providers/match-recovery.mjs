/**
 * Multi-API Match Recovery & Result Historical Collector.
 * Automatically resolves finished matches that were missed during server downtime
 * or lack live FT signals from the primary provider.
 * Uses FotMob for historical results, then the configured secondary providers
 * through their own verified, quota-aware fixture matching. Zizobet remains
 * the sole bookmaker odds and live-market source.
 */
import { query } from '../db.mjs';
import { teamsMatch, canonical } from './adapters.mjs';
import { settleMatch } from '../ledger/settler.mjs';

const fotmobDailyCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const recoveryCooldowns=new Map();
let recoveryCursor=0;
const RECOVERY_RETRY_MS=8 * 60 * 1000;

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

  // Number('') is zero: never manufacture a 0-0 when FotMob omits its score.
  const scoreStr = header?.status?.scoreStr || summary?.status?.scoreStr || null;
  const scoreParts = typeof scoreStr==='string'?scoreStr.match(/^\s*(\d{1,2})\s*[-:]\s*(\d{1,2})\s*$/):null;
  const scoreNumber=value=>value!=null&&value!==''&&Number.isSafeInteger(Number(value))&&
    Number(value)>=0&&Number(value)<=99?Number(value):null;
  const homeScore = scoreNumber(scoreParts?.[1] ?? summary?.home?.score);
  const awayScore = scoreNumber(scoreParts?.[2] ?? summary?.away?.score);

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

  const rawEvents = details?.content?.matchFacts?.events?.events;
  const events = Array.isArray(rawEvents)?rawEvents:[];
  let cardTotalsVerified=false;
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
      const statNumber=value=>value!=null&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
      const s0 = statNumber(item.stats?.[0]);
      const s1 = statNumber(item.stats?.[1]);
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
        if (s0!==null&&s1!==null){yellowH=s0;yellowA=s1;cardTotalsVerified=true;}
      } else if (/red card/i.test(title)) {
        if (s0!==null&&s1!==null){redH=s0;redA=s1;cardTotalsVerified=true;}
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
      minute: /^\d{1,3}(?:\s*\+\s*\d{1,2})?$/.test(String(e.time??''))?parseInt(String(e.time),10):NaN,
      injury: Number(String(e.time??'').match(/\+\s*(\d{1,2})/)?.[1]??0),
      player: e.player?.name || e.nameStr || e.fullName || null,
      playerId: e.player?.id || e.playerId || null,
      own: e.ownGoal === true || e.shotmapEvent?.isOwnGoal === true,
      header: e.shotmapEvent?.shotType === 'Header',
      penalty: e.penalty === true || /penalty/i.test(e.goalDescription ?? ''),
      shootout: false
    }))
    .filter(e => Number.isInteger(e.minute) && e.minute>=0 && e.minute<=130);

  return {
    finished: isFinished,
    homeScore,
    awayScore,
    halfHomeScore: halfHome,
    halfAwayScore: halfAway,
    cornersHome: cornersH,
    cornersAway: cornersA,
    cardsHome: cardTotalsVerified ? totalCardsH : null,
    cardsAway: cardTotalsVerified ? totalCardsA : null,
    statistics: {
      shots: (shotsH != null && shotsA != null) ? { home: shotsH, away: shotsA } : {},
      shotsOnTarget: (sOnTargetH != null && sOnTargetA != null) ? { home: sOnTargetH, away: sOnTargetA } : {},
      fouls: (foulsH != null && foulsA != null) ? { home: foulsH, away: foulsA } : {},
      possession: (possessionH != null && possessionA != null) ? { home: possessionH, away: possessionA } : {}
    },
    goalEvents,
    goalTimelineAvailable: Array.isArray(rawEvents)
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

  const targetDate = fixture?.start_at || fixture?.startAt;
  if(!targetDate||!Number.isFinite(Date.parse(targetDate)))return {recovered:false,reason:'KICKOFF_DATE_NOT_VERIFIED'};
  // Historical APIs must not be polled for matches still in progress.
  if(Date.now()-Date.parse(targetDate)<2*60*60*1000)return {recovered:false,reason:'MATCH_NOT_YET_FINISHED'};
  const dates = candidateDateStrings(targetDate);

  // 1. FotMob is the historical fallback, never an odds source.
  const found = await findFotMobFixture(home, away, dates);
  let parsed=null, source=null;
  if(found?.match){
    const details=await fetchFotMobDetails(found.match.id);
    const candidate=parseFotMobPayload(found.match,details);
    if(candidate.finished&&candidate.homeScore!==null&&candidate.awayScore!==null){
      parsed=candidate;source='fotmob';
    }
  }

  // 2. If FotMob has no verified FT, try configured, quota-limited history APIs.
  // Each adapter must match both teams and kickoff within two hours.
  if(!parsed){
    try{
      const {statsProviders}=await import('./index.mjs');
      const backup=await statsProviders.recoverHistoricalMatch?.({home,away,start_at:targetDate,service:'PREMATCH'});
      if(backup){
        parsed={homeScore:backup.homeScore,awayScore:backup.awayScore,
          halfHomeScore:null,halfAwayScore:null,cornersHome:null,cornersAway:null,
          cardsHome:null,cardsAway:null,statistics:{},
          goalEvents:backup.evidence.events.filter(event=>event.type==='goal'&&!event.shootout),
          goalTimelineAvailable:backup.evidence.complete===true};
        source=backup.source;
      }
    }catch(error){console.warn('[recovery] configured history providers unavailable:',error.message);}
  }
  if(!parsed)return {recovered:false,reason:'MATCH_NOT_FINISHED_OR_FOUND'};
  const {homeScore,awayScore}=parsed;
  if(![homeScore,awayScore].every(value=>Number.isSafeInteger(value)&&value>=0&&value<=99))
    return {recovered:false,reason:'UNVERIFIED_FINAL_SCORE'};

  // Never replace an already recorded primary FT score in a concurrent update.
  await runQuery(`
    insert into app_match_result (
      match_id, home_team, away_team, home_score, away_score,
      half_home_score, half_away_score, corners_home, corners_away,
      cards_home, cards_away, statistics, source, finished_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,'RECOVERY',now())
    on conflict(match_id) do update set
      home_score=coalesce(app_match_result.home_score,excluded.home_score),
      away_score=coalesce(app_match_result.away_score,excluded.away_score),
      half_home_score=coalesce(app_match_result.half_home_score,excluded.half_home_score),
      half_away_score=coalesce(app_match_result.half_away_score,excluded.half_away_score),
      corners_home=coalesce(app_match_result.corners_home,excluded.corners_home),
      corners_away=coalesce(app_match_result.corners_away,excluded.corners_away),
      cards_home=coalesce(app_match_result.cards_home,excluded.cards_home),
      cards_away=coalesce(app_match_result.cards_away,excluded.cards_away),
      statistics=coalesce(app_match_result.statistics,'{}'::jsonb) || excluded.statistics
  `,[id,home,away,homeScore,awayScore,
    parsed.halfHomeScore,parsed.halfAwayScore,parsed.cornersHome,parsed.cornersAway,
    parsed.cardsHome,parsed.cardsAway,JSON.stringify({...parsed.statistics,recoverySource:source})]);

  // A list of some goals is not a complete timeline. Only reconcile every
  // scoring incident to FT before letting event-window or player props grade.
  const goals=parsed.goalEvents??[];
  const scoreMatches=goals.filter(e=>e.team==='home').length===homeScore &&
    goals.filter(e=>e.team==='away').length===awayScore;
  const uniqueIds=new Set(goals.map(e=>String(e.id)));
  const fullTimeline=parsed.goalTimelineAvailable===true&&scoreMatches&&
    uniqueIds.size===goals.length&&goals.every(e=>
      (e.team==='home'||e.team==='away')&&Number.isInteger(e.minute)&&e.minute>=0&&e.minute<=130);
  if(fullTimeline){
    const evidencePayload={source,complete:true,final:true,homeScore,awayScore,
      goalsAvailable:true,events:goals,observedAt:new Date().toISOString()};
    try{
      // Do not overwrite a previously collected primary-provider timeline.
      await runQuery(`insert into app_match_event_evidence(match_id,payload)
        values($1,$2::jsonb) on conflict(match_id) do nothing`,
        [id,JSON.stringify(evidencePayload)]);
    }catch(error){console.warn('[recovery] historical goal evidence unavailable:',error.message);}
  }
  const outcome=await settleMatch(id);
  return {recovered:true,source:source.toUpperCase(),score:`${homeScore}-${awayScore}`,
    settled:outcome.settled,tickets:outcome.tickets?.length??0};
}

/**
 * Scan all pending tickets whose matches have no stored FT result,
 * recover results from external sources, and trigger settlement.
 */
export async function recoverAllPendingMatches({ runQuery = query } = {}) {
  const scanPage=offset=>runQuery(`
    select l.match_id,min(l.match_name) as match_name,
           min(t.placed_at) as placed_at,
           array_agg(distinct l.market_name) as market_names
      from app_ticket_line l
      join app_ticket t on t.id=l.ticket_id
     where l.status='PENDING' and t.status='PENDING'
       and not exists (
         select 1 from app_match_result r where r.match_id=l.match_id
           and r.home_score is not null and r.away_score is not null
       )
     group by l.match_id
     order by min(t.placed_at),l.match_id
     limit 25 offset $1`,[offset]);
  let pending=await scanPage(recoveryCursor);
  if(!pending.rows.length&&recoveryCursor>0){
    recoveryCursor=0;
    pending=await scanPage(recoveryCursor);
  }
  recoveryCursor+=pending.rows.length;
  if(!pending.rows.length)return {examined:0,recovered:0};

  let recoveredCount=0, attempted=0;
  for(const row of pending.rows){
    const id=Number(row.match_id),at=Date.now();
    if((recoveryCooldowns.get(id)??0)>at)continue;
    // Bounded work per settlement pass, even during a provider outage.
    if(attempted>=3)break;
    attempted++;
    try{
      const result=await recoverPendingMatch(id,{
        matchName:row.match_name,placedAt:row.placed_at,runQuery
      });
      if(result.recovered){
        recoveredCount++;
        recoveryCooldowns.delete(id);
        console.log(`[recovery] match ${id} restored from ${result.source}: ${result.score??'FT'}`);
      }else recoveryCooldowns.set(id,Date.now()+RECOVERY_RETRY_MS);
    }catch(error){
      recoveryCooldowns.set(id,Date.now()+RECOVERY_RETRY_MS);
      console.error('[recovery] match',id,error.message);
    }
  }
  if(recoveryCooldowns.size>2000)recoveryCooldowns.clear();
  return { examined: pending.rows.length, recovered: recoveredCount };
}
