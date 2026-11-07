/**
 * Server-owned, display-only and placement-time suspension policy.
 * This is a rule-based risk guard, NOT a calibrated win-probability estimator.
 *
 * All the thresholds can be tuned via Railway environment variables.
 * Never use browser odds, browser score or client-provided IDs as authority.
 */
import { config } from './config.mjs';
import { liveRiskSettings } from './live-risk-settings.mjs';

const num = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function riskMinute(match, now = Date.now()) {
  const explicit = num(match?.minute ?? match?.currentMinute);
  const fallback = num(match?.live_minute);
  const rawClock = num(match?.match_time_ms);
  const clockAt = match?.clock_at ? new Date(match.clock_at).getTime() : null;
  const phase = String(match?.feed_status ?? match?.feedStatus ?? match?.phase ?? '').trim();
  const paused = /^(?:ht|half[ -]?time|break[ -]?time)$/i.test(phase);
  const anchored = rawClock !== null && clockAt !== null && Number.isFinite(clockAt)
    ? Math.floor(rawClock / 60000) + (paused ? 0 : Math.max(0, Math.floor((now - clockAt) / 60000)))
    : rawClock !== null ? Math.floor(rawClock / 60000) : null;
  const options = (paused ? [explicit, anchored] : [explicit, fallback, anchored])
    .filter((v) => v !== null && v >= 0);
  return options.length ? Math.max(...options) : null;
}

export function isFullTimeWinnerMarket(marketName, marketKey) {
  const name = String(marketName ?? '').toLowerCase().trim();
  const key = String(marketKey ?? '').toLowerCase().trim();
  // A generic feed "result" column also includes corners, next goal, HT/FT, etc.
  const excluded = /\b(?:corners?|cards?|bookings?|goal(?:s|scorer)?|correct|score|half|period|quarter|next|handicap|both|btts|minute|double chance|asian|penalty|to qualify|race to)\b/i;
  if (excluded.test(name)) return false;
  const recognized = /^(?:full\s*time\s*result|fulltime\s*result|match\s*result|match\s*winner|full\s*time\s*winner|1\s*x\s*2|moneyline|match\s*odds|three\s*way|result(?:\s*of\s*match)?)$/i;
  return recognized.test(name) ||
    (!name || /^(?:market|unknown|cols-?\d+)$/i.test(name)) &&
    /^(?:1x2|ft[.-]?1x2|match[-_]?result|result|moneyline)$/i.test(key);
}

export function isLeaderWinChoice(outcomeKey, outcomeName, leader) {
  if (!leader) return false;
  const code = String(outcomeKey ?? '').toLowerCase().trim();
  const label = String(outcomeName ?? '').toLowerCase().trim();
  const candidates = leader === 'home'
    ? new Set(['1', 'home', 'home team', 'home win', 'w1', 'h', 'vendas'])
    : new Set(['2', 'away', 'away team', 'away win', 'w2', 'a', 'udhetues']);
  return candidates.has(code) || candidates.has(label);
}

/**
 * Deliberately narrow market classification. A full-market closure must not
 * accidentally lock a similarly named but unrelated provider market.
 */
export function isRiskMarketCategory(marketName, marketKey, category) {
  if (category === 'ALL') return true;
  if (category === '1X2') return isFullTimeWinnerMarket(marketName, marketKey);
  const name = String(marketName ?? '').toLowerCase().trim();
  const key = String(marketKey ?? '').toLowerCase().trim();
  if (category === 'DOUBLE_CHANCE') return /\bdouble\s*chance\b|\b1x\s*\/\s*x2\b|\bdouble\s*result\b/i.test(name);
  if (category === 'BTTS') return /\bboth\s*teams?\s*(?:to\s*)?score\b|\bbtts\b|\bboth\s*score\b/i.test(name);
  if (category === 'CORNERS') return /\bcorners?\b/i.test(name);
  if (category === 'CARDS') return /\bcards?\b|\bbookings?\b/i.test(name);
  if (category === 'TOTAL_GOALS') {
    if (/\bcorners?|cards?|bookings?|player|scorer|team\s*total\b/i.test(name)) return false;
    return /\btotal\s*(?:goals?)?\b|\bgoals?\s*total\b|\bover\s*\/\s*under\b|\bunder\s*\/\s*over\b|\bgoals?\s*over\b/i.test(name) ||
      (/^(?:over_under|total_goals)$/i.test(key) && !name);
  }
  return false;
}

export function marketClosureReason(match, selection, minute, settings) {
  const rules = settings.marketClosureRules ?? [];
  if (!rules.length) return null;
  const scoreAt = match?.score_at ?? match?.scoreAt ?? null;
  const home = num(match?.home_score ?? match?.homeScore ?? match?.score?.home);
  const away = num(match?.away_score ?? match?.awayScore ?? match?.score?.away);
  const hasScore = Boolean(scoreAt) && home !== null && away !== null && home >= 0 && away >= 0;
  for (const rule of rules) {
    if (minute < rule.minute) continue;
    if (rule.score !== 'ANY' && !hasScore) continue;
    if (rule.score === 'DRAW' && home !== away) continue;
    if (rule.score === 'LEADING' && home === away) continue;
    if (isRiskMarketCategory(selection?.marketName ?? selection?.market_name,
        selection?.marketKey ?? selection?.market_key, rule.market)) return 'market_closed';
  }
  return null;
}

/**
 * All rules are driven by the persisted Admin policy. The most restrictive
 * matching threshold wins; these are suspension heuristics, not certainty.
 */
export function liveRiskReason(match, selection, now = Date.now(), settings = liveRiskSettings()) {
  if (config.liveRiskEnabled === false || settings.enabled === false) return null;
  const service = String(match?.service ?? '').toUpperCase();
  const live = service === 'LIVE' || match?.live === true || match?.status === 'LIVE';
  if (!live) return null;
  const minute = riskMinute(match, now);
  if (minute === null) return null;

  // Entire market suspension comes first: high-priced outcomes must not slip
  // through just because the old low-odds rules only caught the draw.
  const closed = marketClosureReason(match, selection, minute, settings);
  if (closed) return closed;

  const price = num(selection?.price ?? selection?.odds);
  if (price === null || price <= 0) return null;

  // Every market: any ultra-short selection is blocked, including Draw, totals,
  // corners, cards, combined providers and Bet Builder constituent legs.
  if (settings.lowOddsRules.some(rule => minute >= rule.minute && price <= rule.maxOdds)) {
    return 'low_live_odds';
  }

  // Only the leading team in ordinary FULL-TIME 1X2 is suspended. Draw and
  // the trailing team's choice remain open unless another rule catches them.
  if (!isFullTimeWinnerMarket(selection?.marketName ?? selection?.market_name,
      selection?.marketKey ?? selection?.market_key)) return null;

  const scoreAt = match?.score_at ?? match?.scoreAt ?? null;
  if (!scoreAt) return null; // Never infer a score from a default 0-0 placeholder.
  const home = num(match?.home_score ?? match?.homeScore ?? match?.score?.home);
  const away = num(match?.away_score ?? match?.awayScore ?? match?.score?.away);
  if (home === null || away === null || home < 0 || away < 0 || home === away) return null;
  const lead = Math.abs(home - away);
  const leader = home > away ? 'home' : 'away';
  if (!isLeaderWinChoice(selection?.outcomeKey ?? selection?.outcome_key,
      selection?.outcomeName ?? selection?.outcome_name, leader)) return null;

  return settings.leaderRules.some(rule =>
    minute >= rule.minute && lead >= rule.goals && price <= rule.maxOdds
  ) ? 'leader_low_odds' : null;
}
