import {eventContract} from './event-contract.mjs';
/**
 * Conservative LIVE contract-expiry guard, shared by synthetic Bet Builders
 * and ordinary ticket validation. This is intentionally narrower than the
 * frontend's visual expiry rules: never guess a market's outcome from a
 * current leader, a missing score, or an uncertain period.
 *
 * Score/phase facts must be real (not odds, labels or browser input).
 */
import { isImpossibleLiveCombination } from './combo-feasibility.mjs';
/** Native provider offers use separate identity namespaces. This permits testing the
 * provider's native contracts without pretending our aggregate-score grader
 * can settle event/player props. Settlement evidence is checked separately. */
export function isYbetsNativeOffer(market = {}, match = {}) {
  const key = String(market.market_key ?? market.marketKey ?? market.key ?? market.extId ?? '');
  const id = String(market.id ?? '');
  return /^(?:yb|zz)\d+@/.test(key) || /(?:^|\|)(?:yb|zz)\d+@/.test(id) ||
    ['YBETS','ZIZOBET'].includes(String(match.raw?.provider ?? match.provider ?? '').toUpperCase());
}
const norm = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const safeNumber = value => {
  if (value === '' || value == null) return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function currentScore(match) {
  const service = String(match?.service ?? match?.status ?? '').toUpperCase();
  if (service !== 'LIVE' && match?.live !== true) return null;
  // Raw match rows carry score_at. A missing timestamp means a default
  // 0-0 placeholder, not confirmed feed evidence.
  if (('score_at' in (match ?? {}) && !match.score_at) ||
      ('scoreAt' in (match ?? {}) && !match.scoreAt)) return null;
  const h = safeNumber(match?.home_score ?? match?.homeScore ?? match?.score?.home);
  const a = safeNumber(match?.away_score ?? match?.awayScore ?? match?.score?.away);
  return h === null || a === null ? null : { home: h, away: a };
}

const htftContract = name => /\bhalf[ .-]?time\s*\/\s*full[ .-]?time\b|\bht\s*\/\s*ft\b/.test(norm(name));
const firstHalfContract = market => !htftContract(market?.name ?? market?.market_name) && (
  Number(market?.period ?? 0) === 1 ||
  /\b(?:first|1st)\s*half\b|\b(?:half time|halftime)\b(?!\s*\/?\s*(?:fulltime|ft))/.test(norm(market?.name ?? market?.market_name)));

function firstHalfElapsed(match) {
  const phase = norm(match?.period ?? match?.phase ?? match?.feed_status);
  return /^(?:2h|ht|ft|2nd half|second half|break time|half time|halftime|ended|finished)\b/.test(phase);
}

function elapsedTimedContract(match, market) {
  const live = String(match?.service ?? match?.status ?? '').toUpperCase() === 'LIVE' || match?.live === true;
  if (!live || ('clock_at' in match && !match.clock_at) || ('clockAt' in match && !match.clockAt)) return false;
  const name = norm(market?.name ?? market?.market_name);
  // The match clock is absolute; do not apply it to a second-half-relative window.
  if (Number(market?.period ?? 0) === 2 || /\b(?:second|2nd)\s*half\b/.test(name)) return false;
  const minute = safeNumber(match.currentMinute ?? match.minute ?? match.live_minute ??
    (Number.isFinite(match.match_time_ms) ? Math.floor(match.match_time_ms / 60000) : null));
  if (minute === null) return false;
  const contract=eventContract(market);if(contract.valid&&contract.window&&minute>contract.window.to)return true;
  let end = name.match(/\b(?:before|within|by|until|till)\s+(?:the\s+)?(\d{1,3})(?:st|nd|rd|th)?\s*(?:min(?:ute)?s?)\b/)?.[1];
  end ??= name.match(/\b(?:before|within|by|until|till)\s+(?:the\s+)?min(?:ute)?s?\s+(\d{1,3})\b/)?.[1];
  end ??= name.match(/\b(?:first|opening)\s+(\d{1,3})\s+min(?:ute)?s?\b/)?.[1];
  end ??= name.match(/\b(?:in|during|at)\s+(?:the\s+)?(\d{1,3})(?:st|nd|rd|th)?\s+minute\b/)?.[1];
  end ??= name.match(/\b(?:in|during|at)\s+(?:the\s+)?minute\s+(\d{1,3})\b/)?.[1];
  end ??= name.match(/\b(?:between|from)\s+\d{1,3}\s*(?:and|to|[-–])\s*(\d{1,3})\s*(?:min(?:ute)?s?)\b/)?.[1];
  end ??= name.match(/\b(?:in|during)\s+(?:the\s+)?(?:minutes?\s*)?\d{1,3}\s*[-–]\s*(\d{1,3})\s*(?:min(?:ute)?s?)\b/)?.[1];
  end ??= name.match(/\b(?:in|during)\s+(?:the\s+)?minutes?\s+\d{1,3}\s*[-–]\s*(\d{1,3})\b/)?.[1];
  if (end != null) return minute > Number(end);
  const clockEnd = name.match(/\b\d{1,3}:\d{2}\s*[-–]\s*(\d{1,3}):(\d{2})\b/);
  return !!clockEnd && minute > Number(clockEnd[1]) + Number(clockEnd[2]) / 60;
}

// Some goal-time offers keep each time window in its outcome label rather
// than in the market name. Read only these explicit timing contracts: a score
// range in an unrelated market is never a clock window.
function elapsedTimedOutcome(match, market) {
  const live = String(match?.service ?? match?.status ?? '').toUpperCase() === 'LIVE' || match?.live === true;
  if (!live || ('clock_at' in match && !match.clock_at) || ('clockAt' in match && !match.clockAt)) return false;
  const name = norm(market?.name ?? market?.market_name);
  if (!/^(?:when will (?:the )?(?:next goal|goal \d+) be scored|(?:first|next|last) goal (?:time|interval)|time of (?:the )?(?:first|next|last) goal)(?:\b|$)/.test(name)) return false;
  if (Number(market?.period ?? 0) !== 0 || /\b(?:first|1st|second|2nd) half\b/.test(name)) return false;
  const minute = safeNumber(match.currentMinute ?? match.minute ?? match.live_minute ??
    (Number.isFinite(match.match_time_ms) ? Math.floor(match.match_time_ms / 60000) : null));
  if (minute === null) return false;
  const label = norm(market?.outcomeName ?? market?.outcome_name);
  const range = label.match(/^(?:min(?:ute)?s?\s*)?(\d{1,3})\s*[-–]\s*(\d{1,3})(?:\s*min(?:ute)?s?)?$/);
  if (!range || Number(range[2]) < Number(range[1])) return false;
  // These displayed ranges include stoppage time at the half boundary.
  if (Number(range[2]) === 45 && !firstHalfElapsed(match)) return false;
  if (Number(range[2]) === 90) return false;
  return minute > Number(range[2]);
}

// A team total must not be judged using the sum of BOTH teams. Only these
// explicit whole-match families may consume the whole-match goal counter.
function simpleGoalTotalName(value) {
  const name = norm(value).replace(/^(?:full[ .-]*time|match)[ .:-]*/, '')
    .replace(/\s*\(?\d+(?:[.,]\d+)?\)?\s*$/, '').replace(/[.:-]+$/g, '').trim()
    .replace(/\s*\/\s*/g, '/').replace(/\s*[-.:]\s*/g, ' ').replace(/\s+/g, ' ');
  return /^(?:total(?: goals?)?|goals? total|over\/?under|under\/?over|over under|under over|goal line|total(?: goals?)? over\/?under|total(?: goals?)? over under)$/.test(name);
}

/** True only once a confirmed LIVE fact irreversibly decides the contract. */
export function isDecidedLiveMarket(match, market) {
  if (elapsedTimedContract(match, market)) return true;
  if (firstHalfContract(market) && firstHalfElapsed(match)) return true;
  const score = currentScore(match);
  if (!score) return false;
  const name = norm(market?.name ?? market?.market_name);
  const numberedGoalTime = name.match(/^when will goal (\d+) be scored(?: \(\d+-minute intervals\))?$/);
  if (numberedGoalTime && Number(market?.period ?? 0) === 0 && score.home + score.away >= Number(numberedGoalTime[1])) return true;
  // No guessing about half-specific or combined propositions.
  if (/\b(?:first|1st|second|2nd)\s*half\b|\b(?:ht|ft)\s*\/|halftime\s*\/?\s*fulltime|\b(?:players?|corners?|cards?|bookings?|next|last|first goal|race|handicap|asian|team total)\b|[&+]/.test(name) ||
      Number(market?.period ?? 0) !== 0) return false;

  if (/^(?:both teams to score|both teams score|both score|btts)(?:\s*[-(].*)?$/.test(name)) {
    return score.home > 0 && score.away > 0;
  }

  if (!simpleGoalTotalName(name)) return false;
  const rawLine = market?.line ?? market?.specifier;
  const suffix = name.match(/(?:^|[\s(])(\d+(?:[.,]\d+)?)\)?$/);
  const line = safeNumber(rawLine !== '' && rawLine != null ? rawLine : suffix?.[1]);
  // In a whole-goal line, exactly 2 goals at 2.0 is not necessarily final.
  return line !== null && score.home + score.away > line;
}

/**
 * A mixed price is not sellable as soon as ANY non-reversible constituent
 * (the total threshold or the both-teams-score condition) is completed.
 * Do not settle the 1X2/DC winner before full time, and do not infer unknown
 * provider contracts. This protects placement even from stale browser tabs.
 */
export function isDecidedLiveOutcome(match, market) {
  if (elapsedTimedOutcome(match, market)) return true;
  if (isImpossibleLiveCombination(match,market)) return true;
  if (isDecidedLiveMarket(match, market)) return true;
  const score = currentScore(match);
  if (!score) return false;
  const name = norm(market?.name ?? market?.market_name);
  if (Number(market?.period ?? 0) === 2 ||
      /\b(?:second|2nd)\s*half\b|\b(?:ht|ft)\s*\//.test(name) || htftContract(name)) return false;
  if (firstHalfContract(market) && firstHalfElapsed(match)) return false;

  const rawName = String(market?.outcomeName ?? market?.outcome_name ?? '').trim();
  const rawCode = String(market?.outcomeCode ?? market?.outcome_key ?? '').trim();
  const labels = [rawName, rawCode].filter(Boolean);
  const all = labels.join(' | ').toLowerCase();
  const countName = name.replace(/^(?:1st|first)\s+half[.\s:-]*/, '');
  const numberedGoal = countName.match(/^(\d+)\s+goal\s+to\s+score$/);
  if (numberedGoal && score.home + score.away >= Number(numberedGoal[1])) return true;
  // Explicit exact/band totals are common native provider contracts. Remove
  // only ranges already exceeded; matching the current score is not final.
  const goalCount = countName.match(/^(?:(team [12]|home team|away team)\s+)?(?:total goals?\s*\((?:exact|bands)\)|exact goals|number of goals|multigoals)(?:\s+(home team|away team))?$/);
  if (goalCount) {
    const side = goalCount[1] ?? goalCount[2];
    const value = /^(?:team 1|home team)$/.test(side) ? score.home : /^(?:team 2|away team)$/.test(side) ? score.away : score.home + score.away;
    for (const label of labels) {
      const exact = label.match(/^\d+$/);
      if (exact && value > Number(exact[0])) return true;
      const band = label.match(/^(\d+)\s*(?:or|to|[-–])\s*(\d+)$/i);
      if (band && value > Number(band[2])) return true;
      const lowerBound = label.match(/^(\d+)\s*(?:\+|or more)$/i);
      if (lowerBound && value >= Number(lowerBound[1])) return true;
    }
  }
  // A correct-score selection below a confirmed score can no longer win.
  // Reaching the target itself is still reversible until the final whistle.
  if (/^(?:(?:full time|match)\s+)?correct score$|^exact score$/.test(name)) {
    const exact = labels.map(label => label.match(/^(\d+)\s*[-:]\s*(\d+)$/)).find(Boolean);
    if (exact && (score.home > Number(exact[1]) || score.away > Number(exact[2]))) return true;
  }
  if (simpleGoalTotalName(name)) {
    for (const label of labels) {
      const explicit = label.match(/\b(?:over|under)\s*\(?\s*(\d+(?:[.,]\d+)?)\s*\)?/i);
      if (explicit && score.home + score.away > Number(explicit[1].replace(',', '.'))) return true;
    }
  }
  const namedCombo = /^bet builder\s*:/.test(name) ||
    /\b(?:result|1\s*x\s*2|double chance|total|goals|btts|both teams)\b.*\b(?:and|with)\b.*\b(?:result|total|goals|both teams|btts|score)\b/.test(name) ||
    /\b(?:result|1x2|double chance|total|btts)\s*[&+]\s*(?:total|btts|goals|result|1x2|both)/.test(name);
  const explicitLegs = /\b(?:1x2|dc|btts|total)\s+\S+\s+\+\s+(?:1x2|dc|btts|total)\b/i.test(rawName) ||
    /\b(?:g\/g|n\/g)\s*[&+]\s*(?:p_|l_|[+-]?\d)/i.test(rawName) ||
    /\b(?:1\/x|x\/2|1\/2|[12x])\s*&\s*(?:g\/g|n\/g|p_|l_)/i.test(rawName);
  if (!namedCombo && !explicitLegs) return false;

  const totals = [];
  for (const label of labels) {
    for (const m of label.matchAll(/\b(?:over|under)\s*(\d+(?:[.,]\d+)?)\b/gi)) {
      const threshold = safeNumber(m[1]);
      if (threshold !== null) totals.push(threshold);
    }
    if (explicitLegs) {
      for (const m of label.matchAll(/(?:[&+]\s*)(?:p_|l_|\+|-)?\s*(\d+[.,]\d+)\b/gi)) {
        const threshold = safeNumber(m[1]);
        if (threshold !== null) totals.push(threshold);
      }
    }
  }
  if (!totals.length && /\b(?:total|goals)\b/.test(name) &&
      /\b(?:over|under)\b/i.test(all)) {
    const threshold = safeNumber(market?.line ?? market?.specifier);
    if (threshold !== null) totals.push(threshold);
  }
  if (totals.some(threshold => score.home + score.away > threshold)) return true;

  const bttsLeg = /\bbtts\s+(?:yes|no)\b|\b(?:g\/g|n\/g)\b/i.test(all) ||
    /\b(?:both (?:teams? )?(?:not )?to score|both (?:teams? )?to score|to nil)\b/i.test(all) ||
    (/\b(?:btts|both teams(?: to)? score)\b/.test(name) &&
     /\b(?:yes|no|gg|ng)\b/i.test(all));
  return bttsLeg && score.home > 0 && score.away > 0;
}
