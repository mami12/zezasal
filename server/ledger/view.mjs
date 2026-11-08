/**
 * Shapes our live board for the React app.
 *
 * The app was written against a backend with Match/Market/Outcome rows; we keep matches
 * and prices in memory instead, so this module translates our serialised board into that
 * exact shape. Nothing here writes anything - it is a pure view.
 *
 * Identifiers: the app sends only an `outcomeId` when placing a bet, so it has to carry
 * everything needed to resolve the bet. Ours is `matchId|marketKey|line|outcomeKey`.
 */
const FOOTBALL = { id: 18, name: 'Football', slug: 'football', iconName: 'Activity', sortOrder: 1, isActive: true };
import {marketIsEnabled,marketRank} from '../market-catalog.mjs';
import * as overrides from './overrides.mjs';
import { isResultBttsMarket } from './result-btts.mjs';
import { liveRiskReason } from '../live-risk.mjs';
import { frozenSelectionPrice } from './system-columns.mjs';
import { isDecidedLiveOutcome, isYbetsNativeOffer } from './decided-markets.mjs';
import {isExcludedOfferMarket} from '../market-policy.mjs';
import {marketDiagnosticAll} from '../market-diagnostic.mjs';
import {trackerTeamStatistics} from '../match-statistics.mjs';
import {statsProviders} from '../stats-providers/index.mjs';
import {quoteValidUntil,quoteExpired} from './quote-validity.mjs';
import {config} from '../config.mjs';
import {feedIsRefreshing} from '../idle-mode.mjs';

export const outcomeIdOf = (matchId, marketKey, line, outcomeKey) =>
  `${matchId}|${marketKey}|${line ?? ''}|${outcomeKey}`;

export const marketIdOf = (matchId, marketKey, line) => `${matchId}|${marketKey}|${line ?? ''}`;

/** "12|g6257||1" -> { matchId: '12', marketKey: 'g6257', line: '', outcomeKey: '1' } */
export function parseOutcomeId(id) {
  const parts = String(id ?? '').split('|');
  if (parts.length < 4) return null;
  const [matchId, marketKey, line, ...rest] = parts;
  return { matchId, marketKey, line, outcomeKey: rest.join('|') };
}

const MARKET_TYPE_BY_COLUMN = {
  result: '1X2',
  total: 'OVER_UNDER',
  corners: 'CORNERS',
  cards: 'CARDS',
  other: 'OTHER',
};

/** Maps outcome code to display name, strictly preserving descriptive names (scores, players, descriptions) */
function outcomeName(key, fallback, marketType, marketName) {
  const fb = String(fallback ?? '').trim();
  const k = String(key ?? '').trim().toLowerCase();
  const mName = String(marketName ?? '').toLowerCase();

  // 1) Double Chance (1X, 12, X2)
  if (/double chance/i.test(mName) || k === '1x' || k === '12' || k === 'x2') {
    if (k === '1x' || /^1x$/i.test(fb)) return '1X';
    if (k === '12' || /^12$/i.test(fb)) return '12';
    if (k === 'x2' || /^x2$/i.test(fb)) return 'X2';
  }

  // 2) 1X2 / Result markets: strictly 1, X, 2 (regardless of whether feed passed team names)
  // HT/FT is a nine-outcome contract. Do not collapse provider keys to ordinary 1X2.
  const isHTFT = /halftime\s*\/?\s*fulltime|ht\s*\/?\s*ft|half\s*time\s*\/\s*full\s*time|htft/i.test(mName);
  const is1X2 = !isHTFT && !isResultBttsMarket(marketName) && (marketType === '1X2' || /1x2|match result|full time result|\bwinner\b|moneyline|3way|3-way/i.test(mName));
  if (is1X2 && !/score|rezultat/i.test(mName)) {
    if (k === '1' || k === 'home' || k === 'h' || k === 'w1' || /^(home|w1)$/i.test(fb)) return '1';
    if (k === 'x' || k === 'draw' || k === 'tie' || k === 'wx' || /^(draw|tie|wx)$/i.test(fb)) return 'X';
    if (k === '2' || k === 'away' || k === 'a' || k === 'w2' || /^(away|w2)$/i.test(fb)) return '2';
  }

  // 3) Over / Under
  if (k === 'over' || k === 'o' || /^over$/i.test(fb)) return 'Over';
  if (k === 'under' || k === 'u' || /^under$/i.test(fb)) return 'Under';

  // 4) Both Teams to Score / Yes / No
  if (k === 'yes' || k === 'gg' || /^yes$/i.test(fb)) return 'Yes';
  if (k === 'no' || k === 'ng' || /^no$/i.test(fb)) return 'No';

  // 5) Odd / Even
  if (k === 'odd' || /^odd$/i.test(fb)) return 'Odd';
  if (k === 'even' || /^even$/i.test(fb)) return 'Even';

  // Clean synthetic "#1", "#2" lines or keys
  if (/^#\d+$/.test(fb)) {
    return String(key ?? '');
  }

  // Preserve descriptive scores ("1:0", "2:1"), Halftime/Fulltime ("Draw / Draw"), Goalscorers, etc.
  return fb || String(key ?? '');
}

const CLIENT_STATUS = (m) => (m.status === 'ended' ? 'ENDED' : m.live ? 'LIVE' : 'PREMATCH');

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** one serialised board match (see collector.serializeMatch) -> the app's Match shape */
export function toClientMatch(m) {
  const matchId = String(m.id);
  const matchOverride = overrides.matchOverride(matchId);
  // a suspended match makes every one of its prices unbettable
  const matchSuspended = m.suspended === true || matchOverride?.suspended === true;
  const markets = [];

  for (const mk of m.markets ?? []) {
    const diagnostic=marketDiagnosticAll();
    if((!diagnostic&&isExcludedOfferMarket(mk))||!marketIsEnabled(mk,m))continue;
    const nativeOffer=isYbetsNativeOffer(mk,m);
    const line = mk.line ?? '';
    const isResultMarket = mk.column === 'result' || /1x2|match result|full time result|\bwinner\b|moneyline/i.test(mk.name ?? '');
    const mType = isResultMarket ? '1X2' : (MARKET_TYPE_BY_COLUMN[mk.column] ?? 'OTHER');
    const marketOverride = overrides.marketOverride(matchId, mk.key, line);
    const outcomes = (mk.outcomes ?? [])
      .map((o) => {
        // an admin override wins over the feed: a pinned price, or a forced suspension
        const forced = overrides.outcomeOverride(matchId, mk.key, line, o.key);
        const rawPrice = o.price !== null && o.price !== undefined
          ? (forced?.price ?? Number(o.price))
          : null;
        const price = Number.isFinite(rawPrice) && rawPrice >= 1 && rawPrice <= 9999999999.9999
          ? frozenSelectionPrice(rawPrice) : null;
        const providerSuspended = Boolean(
          o.suspended || mk.suspended || matchSuspended || marketOverride?.suspended || forced?.suspended
        );
        const riskSuspended = liveRiskReason(m, {
          marketName: mk.name,
          marketKey: mk.key,
          outcomeName: o.name,
          outcomeKey: o.key,
          price,
        }) !== null;
        const decided = isDecidedLiveOutcome(m, {
          name: mk.name, line, period: mk.period ?? 0,
          outcomeName: o.name, outcomeCode: o.key,
        });
        const priceValidUntil=quoteValidUntil(o.priceUpdatedAt,m,config.prematchStaleMs);
        const quoteSuspended=feedIsRefreshing()||quoteExpired(priceValidUntil);
        return {
          id: outcomeIdOf(matchId, mk.key, line, o.key),
          marketId: marketIdOf(matchId, mk.key, line),
          name: o.name ?? String(o.key),
          code: String(o.key),
          odds: price,
          quotedAt: m.snapshotAt ?? m.updatedAt ?? null,
          priceUpdatedAt:o.priceUpdatedAt??null,
          priceValidUntil,
          quoteSuspended,
          // Differentiate provider/admin suspensions from this server-owned,
          // reversible risk lock, so score changes may reopen only our own lock.
          feedSuspended: providerSuspended,
          riskSuspended,
          decided,
          status: providerSuspended || riskSuspended || decided || quoteSuspended ? 'SUSPENDED' : 'ACTIVE',
        };
      }).filter(o=>!nativeOffer||!o.decided);

    // Sort outcomes in canonical sportsbook order: 1 always first, X second, 2 third
    const OUTCOME_RANK = (code, name) => {
      const c = String(code ?? '').trim().toLowerCase();
      const n = String(name ?? '').trim().toLowerCase();
      if (c === '1' || n === '1' || n === 'home' || n === 'w1') return 1;
      if (c === 'x' || n === 'x' || n === 'draw' || n === 'tie') return 2;
      if (c === '2' || n === '2' || n === 'away' || n === 'w2') return 3;
      if (c === '1x' || n === '1x') return 4;
      if (c === '12' || n === '12') return 5;
      if (c === 'x2' || n === 'x2') return 6;
      if (c === 'over' || n === 'over') return 7;
      if (c === 'under' || n === 'under') return 8;
      if (c === 'yes' || n === 'yes') return 9;
      if (c === 'no' || n === 'no') return 10;
      return 99;
    };
    outcomes.sort((a, b) => OUTCOME_RANK(a.code, a.name) - OUTCOME_RANK(b.code, b.name));

    if (!outcomes.length) continue;
    markets.push({
      id: marketIdOf(matchId, mk.key, line),
      matchId,
      extId: String(mk.key),
      marketType: MARKET_TYPE_BY_COLUMN[mk.column] ?? 'OTHER',
      name: mk.name ?? mk.column ?? 'Market',
      specifier: line === '' ? undefined : String(line),
      line: String(line),
      status: mk.suspended || matchSuspended || marketOverride?.suspended ? 'SUSPENDED' : 'ACTIVE',
      sortOrder: Number(mk.order ?? 0),
      isBase: mk.isBase === true,
      period: Number(mk.period ?? 0),
      outcomes,
    });
  }

  // base markets first, then by the feed's own order
  markets.sort((a, b) => marketRank(a)-marketRank(b)||Number(b.isBase) - Number(a.isBase) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const leagueName = m.league?.name ?? m.tournament?.name ?? '';
  const stats=trackerTeamStatistics({stats:m.stats});
  const pair=field=>stats.home[field]!=null&&stats.away[field]!=null?{home:stats.home[field],away:stats.away[field]}:null;
  const cardPair=['home','away'].every(side=>stats[side].yellow!=null&&stats[side].red!=null)
    ?{home:stats.home.yellow+stats.home.red,away:stats.away.yellow+stats.away.red}:null;

  return {
    id: matchId,
    events:(function(){
      const scorers = statsProviders.displayScorers?.(m) ?? [];
      const baseEvents = Array.isArray(m.events) && m.events.length ? m.events : scorers.map(s => ({
        id: 'scorer-' + s.minute + '-' + s.team,
        matchId: String(matchId),
        type: 'goal',
        minute: s.minute,
        minuteLabel: String(s.minute),
        team: s.team,
        player: s.player,
        text: 'Goal: ' + s.player
      }));
      if(!baseEvents.length || !scorers.length) return baseEvents;
      return baseEvents.map(ev => {
        if(ev.type !== 'goal'||ev.player) return ev;
        const match = scorers.find(s => s.team === ev.team && Math.abs(s.minute - ev.minute) <= 2);
        if(!match || !match.player) return ev;
        return { ...ev, player: match.player, text: 'Goal: ' + match.player };
      });
    })(),
    displayOrder: m.displayOrder,
    listingPriority:m.listingPriority,
    protectedPrematch:m.protectedPrematch,
    competitionOrder: m.competitionOrder,
    listingStale: m.listingStale === true,
    tournamentId: String(m.tournament?.id ?? m.league?.slug ?? ''),
    homeTeam: m.home,
    awayTeam: m.away,
    startTime: m.startAt,
    status: CLIENT_STATUS(m),
    homeScore: num(m.score?.home) ?? 0,
    awayScore: num(m.score?.away) ?? 0,
    currentMinute: num(m.minute) ?? 0,
    currentSecond: num(m.currentSecond) ?? 0,
    // Preserve feed-score evidence so synthetic combos cannot rely on placeholders.
    scoreAt: m.scoreAt ?? null,
    clockAt: m.clockAt ?? null,
    phaseAt: m.phaseAt ?? null,
    updatedAt: m.updatedAt ?? undefined,
    snapshotAt: m.snapshotAt ?? undefined,
    period: m.phase ?? m.feedStatus ?? null,
    isSuspended: m.suspended === true || matchOverride?.suspended === true,
    isSimulated: false,
    isHidden: matchOverride?.hidden === true,
    // extra context our board has and the app can show
    liveMinuteSource: m.minuteSource ?? null,
    corners: pair('corners'),
    cards: cardPair,
    shots: pair('shots'),
    shotsOnTarget: pair('shotsOnTarget'),
    fouls: pair('fouls'),
    goalIntervals:statsProviders.displayGoalIntervalStats(m),
    watchUrl: m.watchUrl ?? null,
    marketCount: m.marketCount ?? m.markets?.length ?? 0,
    tournament: {
      id: m.tournament?.id ?? 0,
      name: m.tournament?.name ?? leagueName,
      category: {
        id: m.league?.slug ?? '',
        name: leagueName,
        slug: m.league?.slug ?? '',
        sport: FOOTBALL,
      },
    },
    markets,
  };
}

export const toClientMatches = (list) => (list ?? []).map(toClientMatch);

/**
 * The sidebar's sport tree, built from the leagues and tournaments our feed actually
 * carries (we only track football, so there is a single sport at the root).
 * `rawRows` are rows straight from the match store.
 */
export function sportsTree(rawRows = []) {
  const categories = new Map();

  for (const row of rawRows) {
    const slug = row.category_slug ?? '';
    if (!slug) continue;

    if (!categories.has(slug)) {
      categories.set(slug, {
        id: slug,
        sportId: FOOTBALL.id,
        name: row.category_name ?? slug,
        slug,
        countryCode: null,
        sortOrder: categories.size,
        tournaments: new Map(),
        count: 0,
      });
    }

    const category = categories.get(slug);
    category.listingPriority=Math.min(category.listingPriority??100,Number(row.listing_priority??100));
    category.count++;
    if (row.tournament_name) {
      const key = String(row.tournament_id ?? row.tournament_name);
      if (!category.tournaments.has(key)) {
        category.tournaments.set(key, {
          id: key,
          categoryId: slug,
          name: row.tournament_name,
          slug: row.tournament_slug ?? key,
          sortOrder: category.tournaments.size,
          protectedPrematch:false,
          matchCount:0,
        });
      }
      const tour=category.tournaments.get(key);
      tour.protectedPrematch ||= row.protected_prematch===true;
      tour.matchCount++;
    }
  }

  const list = [...categories.values()]
    .sort((a, b) => (a.listingPriority??100)-(b.listingPriority??100)||b.count-a.count||a.name.localeCompare(b.name))
    .map((c) => ({ ...c, tournaments: [...c.tournaments.values()] }));

  return [{ ...FOOTBALL, categories: list }];
}
