/**
 * Live market visibility policy. A market disappears only when its contract is
 * irreversible from the *available* live facts. In particular a current 1X2
 * leader, correct-score hit, or an unknown provider market is NOT final.
 *
 * Presentation-only: placement/settlement continue to rely on server rules.
 */

import {marketIsEnabled} from '../../../server/market-catalog.mjs';
import { isImpossibleLiveCombination } from '../../../server/ledger/combo-feasibility.mjs';
import { isDecidedLiveMarket, isDecidedLiveOutcome, isYbetsNativeOffer } from '../../../server/ledger/decided-markets.mjs';
import { isExcludedOfferMarket } from '../../../server/market-policy.mjs';
import { eventMarketRequirement } from '../../../server/ledger/event-market-policy.mjs';
import { statisticMarketContract } from '../../../server/ledger/statistic-markets.mjs';
import { repairDisplayText } from './repairDisplayText';
type Score = { home: number; away: number };
type MarketLike = {
  id?: string; extId?: string; key?: string;
  name?: string; line?: string; specifier?: string; marketType?: string;
  period?: number; status?: string; suspended?: boolean;
  outcomes?: OutcomeLike[];
  /** Actual underlying prices in a synthetic Bet Builder. */
  builderLegs?: { marketId: string; outcomeId: string }[];
};
type OutcomeLike = {
  id?: string; name?: string; code?: string; odds?: number;
  status?: string; suspended?: boolean; feedSuspended?: boolean; riskSuspended?: boolean; decided?: boolean;
};
type MatchLike = {
  homeTeam?: string; awayTeam?: string;
  status?: string; period?: string | null; currentMinute?: number;
  homeScore?: number; awayScore?: number;
  corners?: Score | null; cards?: Score | null;
};

/** A displayed price must have an implemented, verifiable event contract. */
export const marketDiagnosticAll = (): boolean => ['1','true','yes','on','all'].includes(String((import.meta as any)?.env?.VITE_MARKET_DIAGNOSTIC_ALL ?? '0').trim().toLowerCase());

export const isMarketOfferSupported = (market: MarketLike,match?:MatchLike): boolean => {
  if(isExcludedOfferMarket(market)||!marketIsEnabled(market,match))return false;
  if(marketDiagnosticAll())return true;
  if(isYbetsNativeOffer(market,match))return true;
  const statsContract=statisticMarketContract(market);
  return !eventMarketRequirement(market,match)&&(!statsContract||statsContract.supported);
};

const norm = (s: unknown) => repairDisplayText(s).toLowerCase().trim().replace(/\s+/g, ' ');
const number = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const scoreOf = (home: unknown, away: unknown): Score | null => {
  const h = number(home), a = number(away);
  return h !== null && a !== null ? { home: h, away: a } : null;
};
const isLive = (m: MatchLike) => norm(m.status) === 'live';

export const isFirstHalfMarket = (name: string): boolean =>
  /\b(?:1st|first)\s*half\b|half\s*1\b|\b1h\b|pjes(?:a|ë)\s*e\s*par(?:e|ë)/i.test(name);

export const isSecondHalfMarket = (name: string): boolean =>
  /\b(?:2nd|second)\s*half\b|half\s*2\b|\b2h\b|pjes(?:a|ë)\s*e\s*dyte/i.test(name);

export const isHTFTMarket = (name: string): boolean =>
  /halftime\s*\/?\s*fulltime|ht\s*\/?\s*ft|half.?time\s*\/\s*full.?time/i.test(name);

export const isFirstHalfResultMarket = (name: string): boolean =>
  /1st half.*result|first half.*result|half.?time\s*(result|winner|score)|ht\s*(result|winner|score)/i.test(name);

export const isFirstEventMarket = (name: string): boolean =>
  /\b(?:first|1st)\b.*\b(?:goal|corner|card|booking|point|scorer)\b/i.test(name);

const isMatchFinished = (m: MatchLike): boolean =>
  /^(?:ended|finished|ft|cancelled)$/.test(norm(m.status)) ||
  /^(?:ft|ended|finished)$/.test(norm(m.period));

const isSecondHalfOrLater = (m: MatchLike): boolean => {
  const phase = norm(m.period);
  return /^(?:2h|ht|ft|2nd half|second half|break time|half time|halftime|ended|finished)\b/.test(phase);
};

const isFirstHalf = (market: MarketLike): boolean => {
  const name = norm(market.name);
  if (isHTFTMarket(name)) return false;
  return Number(market.period ?? 0) === 1 ||
    isFirstHalfMarket(name) || isFirstHalfResultMarket(name) ||
    /\b(?:half time|halftime|ht)\b(?!\s*\/?\s*(?:fulltime|ft))/.test(name);
};
const isSecondHalf = (market: MarketLike): boolean =>
  Number(market.period ?? 0) === 2 || isSecondHalfMarket(norm(market.name));

const counter = (m: MatchLike, family: 'goals' | 'corners' | 'cards'): Score | null => {
  if (family === 'goals') return scoreOf(m.homeScore, m.awayScore);
  const stats = m[family];
  return stats ? scoreOf(stats.home, stats.away) : null;
};

const familyOf = (market: MarketLike): 'goals' | 'corners' | 'cards' => {
  const name = norm(market.name);
  const type = norm(market.marketType);
  if (/corner|korners?|kënd/.test(name) || type === 'corners') return 'corners';
  if (/\bcards?\b|booking|yellow|red card/.test(name) || type === 'cards') return 'cards';
  return 'goals';
};

/** A period-specific market must never use full-time aggregate stats from an
 * already-started second half. First-half counts are valid during 1H only.
 */
const observedCounter = (m: MatchLike, market: MarketLike): Score | null => {
  if (!isLive(m)) return null;
  if (isSecondHalf(market)) return null; // no separate 2H score/corners/cards
  if (isFirstHalf(market) && isSecondHalfOrLater(m)) return null;
  return counter(m, familyOf(market));
};

const fullTimeCounter = (m: MatchLike, family: 'goals' | 'corners' | 'cards'): Score | null =>
  isLive(m) ? counter(m, family) : null;

const isStandaloneBtts = (market: MarketLike): boolean => {
  const n = norm(market.name);
  // Mixed result/BTTS and half-by-half contracts remain independent.
  if (/&|\+|and (?:total|result|score)|either half|each half|both halves/.test(n)) return false;
  return /^(?:both teams to score|btts|both teams score|both score)(?:\s*[-(].*)?$/.test(n) ||
    /^(?:1st|first|2nd|second) half[.: -]+(?:both teams to score|btts)$/.test(n);
};

const totalLine = (market: MarketLike): number | null => {
  for (const candidate of [market.line, market.specifier]) {
    const value = number(candidate);
    if (value !== null) return value;
  }
  // The provider sometimes carries "2.5" in the name, with no line field.
  const n = norm(market.name);
  const last = n.match(/(?:^|[\s(])(\d+(?:[.,]\d+)?)\)?$/);
  return last ? number(last[1]) : null;
};

const isSimpleTotal = (market: MarketLike): boolean => {
  const name = norm(market.name);
  // Interval totals refer only to that window, never all goals in the match.
  if (/\b(?:minutes?|interval|rest of)\b/.test(name)) return false;
  if (/bet builder|both teams|btts|correct|exact|result|winner|1x2|odd.?even|handicap|asian|next|last|race|score in|goal in|time of|&|\+|\b(?:first|1st)\s+(?:goal|corner|card|scorer)\b/.test(name)) return false;
  const o = market.outcomes ?? [];
  const hasOverUnder = o.some(item => [item.code, item.name].some(label =>
    /^(?:over|under|o|u)(?:\b|$)/i.test(String(label ?? '').trim())));
  const type = norm(market.marketType);
  return hasOverUnder && (
    /\b(?:total|goals?|corners?|cards?|over\s*\/?\s*under|under\s*\/?\s*over|goal line)\b/.test(name) ||
    ['over_under', 'totals', 'corners', 'cards'].includes(type)
  );
};

const teamSide = (name: string, match?: MatchLike): 'home' | 'away' | null => {
  const n = norm(name);
  const home = /\b(?:home(?: team)?|team 1|1st team)\b/.test(n) || !!(match?.homeTeam && n.includes(norm(match.homeTeam)));
  const away = /\b(?:away(?: team)?|team 2|2nd team)\b/.test(n) || !!(match?.awayTeam && n.includes(norm(match.awayTeam)));
  return home !== away ? (home ? 'home' : 'away') : null;
};

const observedTotal = (m: MatchLike, market: MarketLike): number | null => {
  const counts = observedCounter(m, market);
  if (!counts) return null;
  const side = teamSide(String(market.name ?? ''), m);
  return side ? counts[side] : counts.home + counts.away;
};

/** Examples: "Race to 3 Goals" and "First Corner". Do not infer from a
 * whole-match total for a second-half first-event contract.
 */
const completedEvent = (m: MatchLike, market: MarketLike): boolean => {
  const name = norm(market.name);
  // One team goal does not prove the first eligible player scored; it may be
  // an own goal, and participation/scorer evidence is separate from the score.
  if (/\b(?:player|goalscorer|scorer)\b/.test(name)) return false;
  if (isSecondHalf(market)) return false;
  const first = /\b(?:first|1st)\s+(?:team\s+to\s+score|goal|corner|card|booking|goalscorer|scorer)\b/.test(name) ||
    /\b(?:time of|minute of)\s+(?:the\s+)?first\s+goal\b/.test(name) ||
    /\b(?:first|1st)\s+(?:goal|corner|card)\s+(?:time|minute)\b/.test(name);
  const ordinal = name.match(/\b(?:2nd|second|3rd|third|4th|fourth|5th|fifth)\s+(goal|corner|card)\b/);
  const race = name.match(/\brace\s+to\s+(\d+)\s+(goals?|corners?|cards?)\b/);
  if (!first && !ordinal && !race) return false;
  const counts = observedCounter(m, market);
  if (!counts) return false;
  const total = counts.home + counts.away;
  if (first) return total >= 1;
  if (race) return Math.max(counts.home, counts.away) >= Number(race[1]);
  const required = ordinal ? ({ '2nd': 2, second: 2, '3rd': 3, third: 3, '4th': 4, fourth: 4, '5th': 5, fifth: 5 } as Record<string, number>)[ordinal[0].split(/\s+/)[0]] : null;
  return required !== null && total >= required;
};

/** "Goal before 20 minutes" expires after that clock window. */
const elapsedWindow = (m: MatchLike, market: MarketLike): boolean => {
  if (isSecondHalf(market)) return false;
  const name = norm(market.name);
  if (!/\b(?:goal|score|corner|card)\b/.test(name)) return false;
  const limit = name.match(/\b(?:before|within|by)\s+(\d{1,3})\s*(?:min(?:ute)?s?)\b/);
  const minute = number(m.currentMinute);
  return !!limit && minute !== null && minute > Number(limit[1]);
};

/**
 * The synthetic offer has no direct goal line: read its verified leg labels.
 * Once any leg has irreversibly completed (e.g. Total 2.5 at three goals,
 * BTTS after both teams score), the whole builder offer closes.
 */
/**
 * A combo market can still have a valid 1X2/Double Chance leg even though
 * another leg is already settled. Such an offer must stop accepting new bets.
 * Only decode explicitly named contract families; unknown provider outcomes
 * remain visible rather than guessing what they mean.
 *
 * Recognized provider labels:
 *   Result and Total       -> "Draw And Under 2.5"
 *   Total and BTTS         -> "Over 2.5 And Yes"
 *   Result and BTTS        -> "Home And Yes", "X/GG"
 *   DC and Total           -> "X/2&P_2.5", "1/X&L_2.5"
 *   Result and BTTS        -> "2&G/G"
 *   BTTS and Total         -> "G/G&+2.5"
 * Synthetic builders use "DC X2 + TOTAL Under 2.5" etc.
 */
export function isCompletedCombinationOutcome(m: MatchLike, market: MarketLike, outcome: OutcomeLike): boolean {
  if (isImpossibleLiveCombination(m,{...market,outcomeName:outcome.name,outcomeCode:outcome.code})) return true;
  if (!isLive(m)) return false;
  const score = scoreOf(m.homeScore, m.awayScore);
  if (!score) return false;
  // 1H/2H require period-specific evidence; full-time score cannot grade them.
  const marketName = norm(market.name);
  if (isSecondHalf(market) || isHTFTMarket(marketName)) return false;
  // Current aggregate score is valid for 1H contracts ONLY while still
  // in the first half; 1H contracts disappear entirely at halftime.
  if (isFirstHalf(market) && isSecondHalfOrLater(m)) return false;

  const rawName = String(outcome.name ?? '').trim();
  const rawCode = String(outcome.code ?? '').trim();
  const labels = [rawName, rawCode].filter(Boolean);
  const names = labels.join(' | ').toLowerCase();

  const marketIsCombo =
    /^bet builder\s*:/.test(marketName) ||
    /\b(?:result|1\s*x\s*2|double chance|total|goals|btts|both teams)\b.*\b(?:and|with)\b.*\b(?:result|total|goals|both teams|btts|score)\b/.test(marketName) ||
    /\b(?:result|1x2|double chance|total|btts)\s*[&+]\s*(?:total|btts|goals|result|1x2|both)/.test(marketName);
  const explicitLegs = /\b(?:1x2|dc|btts|total)\s+\S+\s+\+\s+(?:1x2|dc|btts|total)\b/i.test(rawName) ||
    /\b(?:g\/g|n\/g)\s*[&+]\s*(?:p_|l_|[+-]?\d)/i.test(rawName) ||
    /\b(?:1\/x|x\/2|1\/2|[12x])\s*&\s*(?:g\/g|n\/g|p_|l_)/i.test(rawName);
  if (!marketIsCombo && !explicitLegs) return false;

  const total = score.home + score.away;
  const totalLines: number[] = [];
  for (const text of labels) {
    for (const match of text.matchAll(/\b(?:over|under)\s*(\d+(?:[.,]\d+)?)\b/gi)) {
      const line = number(match[1]);
      if (line !== null) totalLines.push(line);
    }
    // Provider's compact P_2.5/L_2.5 and +2.5 notation. Only present
    // on validated multi-leg labels, never on arbitrary score names.
    if (explicitLegs) {
      for (const match of text.matchAll(/(?:[&+]\s*)(?:p_|l_|\+|-)?\s*(\d+[.,]\d+)\b/gi)) {
        const line = number(match[1]);
        if (line !== null) totalLines.push(line);
      }
    }
  }
  // Some provider markets keep the line in market.line and only "Over"
  // in the outcome label. Never take the line of an unrelated market.
  if (totalLines.length === 0 && /\b(?:total|goals)\b/.test(marketName) &&
      /\b(?:over|under)\b/i.test(names)) {
    const line = totalLine(market);
    if (line !== null) totalLines.push(line);
  }
  if (totalLines.some(line => total > line)) return true;

  const bttsLeg = /\bbtts\s+(?:yes|no)\b|\b(?:g\/g|n\/g)\b/i.test(names) ||
    /\b(?:both (?:teams? )?(?:not )?to score|both (?:teams? )?to score|to nil)\b/i.test(names) ||
    (/\b(?:btts|both teams(?: to)? score)\b/.test(marketName) &&
     /\b(?:yes|no|gg|ng)\b/i.test(names));
  return bttsLeg && score.home > 0 && score.away > 0;
};

const builderCompleted = (m: MatchLike, market: MarketLike): boolean =>
  /^bet builder\s*:/i.test(String(market.name ?? '')) &&
  (market.outcomes ?? []).some(outcome => isCompletedCombinationOutcome(m, market, outcome));

export function isMarketExpired(m: MatchLike, market: MarketLike): boolean {
  if (!market) return false;
  if (isMatchFinished(m)) return true;
  if (!isLive(m)) return false;
  if (isDecidedLiveMarket(m, market)) return true;
  if (builderCompleted(m, market)) return true;
  if ((isFirstHalf(market) || (!isYbetsNativeOffer(market, m) && isHTFTMarket(String(market.name ?? '')))) && isSecondHalfOrLater(m)) return true;

  if (completedEvent(m, market) || elapsedWindow(m, market)) return true;

  if (isStandaloneBtts(market)) {
    const counts = observedCounter(m, market);
    return !!counts && counts.home >= 1 && counts.away >= 1;
  }
  const name = norm(market.name);
  // Outcome "Yes/No" on a standalone team's scoring-one-goal market is
  // already settled as soon as that side scores.
  if (/^(?:(?:home(?: team)?|away(?: team)?|team [12])\s+(?:to score|scores?(?: a goal)?)|(?:to score|scores?)\s+(?:home|away)(?: team)?)$/.test(name)) {
    const counts = observedCounter(m, market);
    const side = teamSide(name);
    if (counts && side && counts[side] > 0) return true;
  }

  if (isSimpleTotal(market)) {
    const line = totalLine(market);
    const value = observedTotal(m, market);
    // Strict '>' handles quarter/whole lines safely: at exactly 2.0,
    // another event can still change push into win, so keep the market.
    if (line !== null && value !== null && value > line) return true;
  }
  return false;
}

/** A price may stay on screen as a grey lock even when it cannot be bet on.
 * Keep this separate from isOutcomeAvailable, which means actually tradable.
 * Settled/void outcomes and empty unquoted offers are not visible.
 */
export const isOutcomeDisplayable = (o: OutcomeLike): boolean => {
  if (!o || o.decided === true || ['SETTLED', 'VOID'].includes(String(o.status ?? '').toUpperCase())) return false;
  const hasPrice = typeof o.odds === 'number' && Number.isFinite(o.odds) && o.odds > 0;
  const locked = o.suspended === true || o.feedSuspended === true || o.riskSuspended === true ||
    String(o.status ?? '').toUpperCase() === 'SUSPENDED';
  return hasPrice || locked;
};

export const isOutcomeAvailable = (o: OutcomeLike): boolean =>
  !!o && o.decided !== true && typeof o.odds === 'number' && Number.isFinite(o.odds) && o.odds > 0 &&
  o.suspended !== true && o.feedSuspended !== true && o.riskSuspended !== true &&
  !['SUSPENDED', 'SETTLED', 'VOID'].includes(String(o.status ?? '').toUpperCase());

export const isMarketSuspended = (
  market: MarketLike,
  lockedMarkets?: Record<string, boolean>,
  lockedOutcomes?: Record<string, boolean>,
  riskLockedOutcomes?: Record<string, boolean>,
): boolean => {
  if (!market) return false;
  const liveLock = lockedMarkets?.[String(market.id ?? '')];
  const marketLocked = typeof liveLock === 'boolean' ? liveLock : market.suspended === true ||
    String(market.status ?? '').toUpperCase() === 'SUSPENDED';
  return marketLocked ||
    (market.builderLegs ?? []).some(part =>
      lockedMarkets?.[part.marketId] === true ||
      lockedOutcomes?.[part.outcomeId] === true ||
      riskLockedOutcomes?.[part.outcomeId] === true);
};

const exactScore = (label: string): Score | null => {
  const match = label.trim().match(/^(\d{1,2})\s*[-:]\s*(\d{1,2})$/);
  return match ? { home: Number(match[1]), away: Number(match[2]) } : null;
};

/** Remove only individually impossible outcomes of exact-score / exact-total
 * markets. The *market* stays while some outcomes remain possible.
 */
export function filterDecidedOutcomes<T extends OutcomeLike>(
  outcomes: T[] = [], market: MarketLike = {}, match: MatchLike = {},
): T[] {
  if (!outcomes.length) return outcomes;
  if(!isMarketOfferSupported(market,match))return [];
  if (isMarketExpired(match, market)) return [];
  if (!isLive(match)) return outcomes;
  outcomes = outcomes.filter(outcome => outcome.decided !== true && !isDecidedLiveOutcome(match, {
    ...market, outcomeName: outcome.name, outcomeCode: outcome.code,
  }));
  if (!outcomes.length) return [];

  // A provider combo may contain many outcomes with *different* contracts
  // and thresholds. Remove just those whose goal/BTTS leg has settled.
  outcomes = outcomes.filter(o => !isCompletedCombinationOutcome(match, market, o));
  if (!outcomes.length) return [];

  const name = norm(market.name);
  const counts = observedCounter(match, market);
  if (!counts) return outcomes;

  // Some provider markets put multiple goal/corner/card lines inside one
  // market instead of exposing each line in market.line. Prune the outcomes
  // whose explicit "Over 0.5" / "Under 0.5" threshold is already passed.
  if (isSimpleTotal(market) && totalLine(market) === null) {
    const value = observedTotal(match, market);
    if (value === null) return outcomes;
    return outcomes.filter(o => {
      const label = String(o.name ?? o.code ?? '');
      const embedded = label.match(/\b(?:over|under)\s*\(?\s*(\d+(?:[.,]\d+)?)\s*\)?/i);
      const threshold = embedded ? number(embedded[1]) : null;
      return threshold === null || value <= threshold;
    });
  }

  if (/\bcorrect score\b|\bexact score\b|\bscore exact\b/.test(name)) {
    const baseline=name.match(/\brest of match \(from (\d+):(\d+)\)/);
    const scope=baseline?{home:counts.home-Number(baseline[1]),away:counts.away-Number(baseline[2])}:counts;
    if(scope.home<0||scope.away<0)return outcomes; // score correction needs fresh provider evidence
    return outcomes.filter(o => {
      const target = exactScore(String(o.name ?? o.code ?? ''));
      return !target || (scope.home <= target.home && scope.away <= target.away);
    });
  }
  if (/\b(?:exact(?:ly)?\s+(?:total\s+)?(?:number of )?(?:goals|corners|cards)|number of (?:goals|corners|cards))\b/.test(name)) {
    const total = counts.home + counts.away;
    return outcomes.filter(o => {
      const target = number(String(o.code ?? o.name ?? ''));
      return target === null || total <= target;
    });
  }
  // For complex or provider-specific markets, lack of a proven outcome
  // contract means we keep them rather than hide valid bets by guesswork.
  return outcomes;
}

export function isMarketVisible(
  match: MatchLike, market: MarketLike,
  lockedMarkets?: Record<string, boolean>,
  lockedOutcomes?: Record<string, boolean>,
  riskLockedOutcomes?: Record<string, boolean>,
): boolean {
  if (!market || !market.outcomes?.length) return false;
  if (isMarketExpired(match, market) ||
      isMarketSuspended(market, lockedMarkets, lockedOutcomes, riskLockedOutcomes)) return false;
  // Suspended selections remain visible with the same grey lock icon as the
  // provider-suspended prices. Finished/decided contracts still disappear.
  return filterDecidedOutcomes(market.outcomes.filter(isOutcomeDisplayable), market, match).length > 0;
}
