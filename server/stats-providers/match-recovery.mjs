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
import {persistHistoricalGoalFacts,validateHistoricalGoals} from '../ledger/historical-event-facts.mjs';
import {persistHistoricalTimedEvents} from '../ledger/historical-timed-events.mjs';
import {fotMobTimedIncidents} from './historical-incidents.mjs';

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
export async function findFotMobFixture(home,away,targetDates,expectedKickoff=null){
  const matches=new Map();
  const expected=Date.parse(expectedKickoff??'');
  for(const dateStr of targetDates){
    const data=await fetchFotMobDate(dateStr);
    if(!Array.isArray(data?.leagues))continue;
    for(const league of data.leagues){
      for(const match of league.matches??[]){
        const homeName=match.home?.name??match.home?.shortName;
        const awayName=match.away?.name??match.away?.shortName;
        if(!teamsMatch(home,homeName)||!teamsMatch(away,awayName))continue;
        const kickoff=Date.parse(match.time?.utcTime??match.time?.utc??match.time??'');
        if(Number.isFinite(expected)&&Number.isFinite(kickoff)&&Math.abs(kickoff-expected)>7200000)continue;
        if(match.id!=null)matches.set(String(match.id),{match,league:league.name,dateStr});
      }
    }
  }
  // Ambiguous team/date matches must never authorize a financial result.
  return matches.size===1?[...matches.values()][0]:null;
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
  const timed=fotMobTimedIncidents(rawEvents);
  let yellowVerified=false,redVerified=false;
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
        if (s0!==null&&s1!==null){yellowH=s0;yellowA=s1;yellowVerified=true;}
      } else if (/red card/i.test(title)) {
        if (s0!==null&&s1!==null){redH=s0;redA=s1;redVerified=true;}
      }
    }
  }

  const totalCardsH = yellowH + redH;
  const totalCardsA = yellowA + redA;

  // Normalized goal events for player scorer grading
  const goalEvents = events
    .filter(e => e.type === 'Goal' && e.isPenaltyShootoutEvent !== true &&
      e.isDisallowed!==true && e.cancelled!==true && e.canceled!==true &&
      !/cancel|disallow|overturn/i.test(String(e.status??e.goalDescription??'')))
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
    cardsHome: yellowVerified&&redVerified ? totalCardsH : null,
    cardsAway: yellowVerified&&redVerified ? totalCardsA : null,
    statistics: {
      shots: (shotsH != null && shotsA != null) ? { home: shotsH, away: shotsA } : {},
      shotsOnTarget: (sOnTargetH != null && sOnTargetA != null) ? { home: sOnTargetH, away: sOnTargetA } : {},
      fouls: (foulsH != null && foulsA != null) ? { home: foulsH, away: foulsA } : {},
      possession: (possessionH != null && possessionA != null) ? { home: possessionH, away: possessionA } : {}
    },
    goalEvents,
    ...timed,
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
  const priorResult=existing.rows[0];
  const alreadyHasFt=priorResult?.home_score!=null&&priorResult?.away_score!=null;
  if(alreadyHasFt){
    // First migrate complete historical event snapshots written by older
    // releases into the frozen-contract grading tables without new API calls.
    try{
      const saved=(await runQuery('select payload from app_match_event_evidence where match_id=$1',[id])).rows[0]?.payload;
      if(saved?.complete===true&&saved?.goalsAvailable===true){
        const old={...saved,final:saved.final??true};
        if(validateHistoricalGoals(old))await persistHistoricalGoalFacts(id,old);
      }
    }catch(error){console.warn('[recovery] prior goal history backfill:',error.message);}
    // An existing FT score is not enough for corner/card contracts. Retry
    // historical incident lookup until each PENDING kind has confirmed facts.
    const needed=(await runQuery(`select distinct l.live_contract->>'event' as kind
      from app_ticket_line l join app_ticket t on t.id=l.ticket_id
      where l.match_id=$1 and l.status='PENDING' and t.status='PENDING'
        and l.live_contract->>'event' in ('goal','corner','card')`,[id]))
      .rows.map(row=>row.kind);
    let allVerified=true;
    for(const kind of needed){
      const prefix=kind==='corner'?'corners_':kind==='card'?'cards_':'';
      const home=kind==='goal'?priorResult.home_score:priorResult[prefix+'home'];
      const away=kind==='goal'?priorResult.away_score:priorResult[prefix+'away'];
      if(home==null||away==null){allVerified=false;break;}
      const confirmed=(await runQuery(`select 1 from app_match_event_coverage
        where match_id=$1 and kind=$2 and complete=true and confirmed_at is not null
          and count_home=$3 and count_away=$4 limit 1`,
        [id,kind,Number(home),Number(away)])).rows.length>0;
      if(!confirmed){allVerified=false;break;}
    }
    if(allVerified){
      const outcome=await settleMatch(id);
      return {recovered:true,source:'EXISTING_VERIFIED_EVENT_FACTS',outcome};
    }
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
  const found = await findFotMobFixture(home, away, dates, targetDate);
  let parsed=null, source=null;
  if(found?.match){
    const details=await fetchFotMobDetails(found.match.id);
    const candidate=parseFotMobPayload(found.match,details);
    if(candidate.finished&&candidate.homeScore!==null&&candidate.awayScore!==null){
      parsed=candidate;source='fotmob';
    }
  }

  // 2. Query pending incident kinds, then ask a backup source for evidence
  // FotMob lacks. A valid FT score alone must not end the fallback cascade.
  const requested=(await runQuery(`select distinct l.live_contract->>'event' as kind
    from app_ticket_line l join app_ticket t on t.id=l.ticket_id
    where l.match_id=$1 and l.status='PENDING' and t.status='PENDING'
      and l.live_contract->>'event' in ('goal','corner','card')`,[id]))
    .rows.map(row=>row.kind);
  const hasTimeline=(candidate,kind)=>{
    if(!candidate)return false;
    if(kind==='goal'){
      const goals=candidate.goalEvents??[];
      return candidate.goalTimelineAvailable===true&&
        goals.filter(e=>e.type==='goal'&&e.team==='home').length===Number(candidate.homeScore)&&
        goals.filter(e=>e.type==='goal'&&e.team==='away').length===Number(candidate.awayScore);
    }
    const prefix=kind==='corner'?'corners':'cards';
    const events=candidate[kind+'Events']??[];
    return candidate[kind+'TimelineAvailable']===true&&
      candidate[prefix+'Home']!=null&&candidate[prefix+'Away']!=null&&
      events.length===Number(candidate[prefix+'Home'])+Number(candidate[prefix+'Away']);
  };
  const missing=requested.filter(kind=>!hasTimeline(parsed,kind));
  const supplemental=[];
  if(!parsed||missing.length){
    try{
      const {statsProviders}=await import('./index.mjs');
      const backup=await statsProviders.recoverHistoricalMatch?.(
        {home,away,start_at:targetDate,service:'PREMATCH'},
        {neededKinds:missing,expectedScore:parsed?{home:parsed.homeScore,away:parsed.awayScore}:
          alreadyHasFt?{home:priorResult.home_score,away:priorResult.away_score}:null}
      );
      if(backup){
        const candidate={homeScore:backup.homeScore,awayScore:backup.awayScore,
          halfHomeScore:null,halfAwayScore:null,
          cornersHome:backup.cornersHome,cornersAway:backup.cornersAway,
          cardsHome:backup.cardsHome,cardsAway:backup.cardsAway,
          statistics:backup.statistics??{},
          cornerEvents:backup.cornerEvents??[],cardEvents:backup.cardEvents??[],
          cornerTimelineAvailable:backup.cornerTimelineAvailable===true,
          cardTimelineAvailable:backup.cardTimelineAvailable===true,
          goalEvents:backup.evidence.events.filter(event=>event.type==='goal'&&!event.shootout),
          goalTimelineAvailable:backup.evidence.complete===true&&backup.evidence.goalsAvailable===true};
        if(!parsed){parsed=candidate;source=backup.source;}
        else if(backup.source!==source&&backup.homeScore===parsed.homeScore&&
          backup.awayScore===parsed.awayScore)supplemental.push({source:backup.source,parsed:candidate});
      }
    }catch(error){console.warn('[recovery] configured history providers unavailable:',error.message);}
  }
  if(!parsed)return {recovered:false,reason:'MATCH_NOT_FINISHED_OR_FOUND'};
  // Preserve independent provider identities. Fill only wholly missing FT
  // total PAIRS from an agreeing secondary result, never mix half a pair or
  // silently replace a conflicting FotMob count.
  for(const {parsed:extra} of supplemental){
    for(const prefix of ['corners','cards']){
      const home=prefix+'Home',away=prefix+'Away';
      if(parsed[home]==null&&parsed[away]==null&&
         extra[home]!=null&&extra[away]!=null&&
         [extra[home],extra[away]].every(n=>Number.isSafeInteger(Number(n))&&Number(n)>=0)){
        parsed[home]=Number(extra[home]);parsed[away]=Number(extra[away]);
      }
    }
    for(const field of ['shots','shotsOnTarget','fouls','possession']){
      if(parsed.statistics?.[field]?.home==null&&parsed.statistics?.[field]?.away==null&&
        extra.statistics?.[field]?.home!=null&&extra.statistics?.[field]?.away!=null){
        parsed.statistics??={};
        parsed.statistics[field]=extra.statistics[field];
      }
    }
  }
  const {homeScore,awayScore}=parsed;
  if(alreadyHasFt&&(Number(priorResult.home_score)!==homeScore||
    Number(priorResult.away_score)!==awayScore))
    return {recovered:false,reason:'HISTORICAL_SCORE_DISAGREEMENT'};
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

  // Provider identities stay separate; never merge event lists into an
  // invented chronology. Each source must reconcile independently to FT.
  for(const evidence of [{source,parsed},...supplemental]){
    const src=evidence.source,details=evidence.parsed;
    const goals=details.goalEvents??[];
    const scoreMatches=goals.filter(e=>e.team==='home').length===homeScore &&
      goals.filter(e=>e.team==='away').length===awayScore;
    const ids=new Set(goals.map(e=>String(e.id)));
    const fullTimeline=details.goalTimelineAvailable===true&&scoreMatches&&
      !goals.some(event=>event.own===true&&src==='fotmob')&&
      ids.size===goals.length&&goals.every(e=>
        (e.team==='home'||e.team==='away')&&Number.isInteger(e.minute)&&
        e.minute>=0&&e.minute<=130);
    if(fullTimeline){
      const payload={source:src,complete:true,final:true,homeScore,awayScore,
        goalsAvailable:true,events:goals,observedAt:new Date().toISOString()};
      try{
        await persistHistoricalGoalFacts(id,payload);
        await runQuery(`insert into app_match_event_evidence(match_id,payload)
          values($1,$2::jsonb) on conflict(match_id) do nothing`,
          [id,JSON.stringify(payload)]);
      }catch(error){console.warn('[recovery] historical goal verification:',error.message);}
    }
    for(const [kind,eventKey,flag,prefix] of [
      ['corner','cornerEvents','cornerTimelineAvailable','corners'],
      ['card','cardEvents','cardTimelineAvailable','cards']
    ]){
      const homeCount=details[prefix+'Home'],awayCount=details[prefix+'Away'];
      if(details[flag]!==true||homeCount==null||awayCount==null)continue;
      try{
        await persistHistoricalTimedEvents(id,{source:src,kind,final:true,complete:true,
          timelineAvailable:true,homeCount,awayCount,events:details[eventKey]??[]});
      }catch(error){console.warn('[recovery] timed',kind,'verification:',error.message);}
    }
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
       and (
         not exists (
           select 1 from app_match_result r where r.match_id=l.match_id
             and r.home_score is not null and r.away_score is not null
         )
         or (
           l.live_contract->>'event' in ('goal','corner','card')
           and exists(select 1 from app_match_result r where r.match_id=l.match_id
             and r.home_score is not null and r.away_score is not null)
           and not exists (
             select 1 from app_match_event_coverage e
             join app_match_result r on r.match_id=e.match_id
             where e.match_id=l.match_id and e.kind=l.live_contract->>'event'
               and e.complete=true and e.confirmed_at is not null
               and e.count_home=case l.live_contract->>'event'
                 when 'goal' then r.home_score when 'corner' then r.corners_home
                 when 'card' then r.cards_home end
               and e.count_away=case l.live_contract->>'event'
                 when 'goal' then r.away_score when 'corner' then r.corners_away
                 when 'card' then r.cards_away end
           )
         )
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
