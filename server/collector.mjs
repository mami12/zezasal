import {statsProviders} from './stats-providers/index.mjs';
import {observeMarket,marketIsEnabled} from './market-catalog.mjs';
import {isBoardOddsRow} from './ledger/board-projection.mjs';
import {isExcludedOfferMarket} from './market-policy.mjs';
import { config, dbErrorHint } from './config.mjs';
import { liveClock } from './minute.mjs';
import { fetchRealFootball } from './upstream.mjs';
import { upsertMatches, expireStaleMatches, getCounts, getMatches, getMatchById } from './matches.mjs';
import { getOddsForMatches as getOddsFromDb } from './db.mjs';
import { getOddsForMatches as getOddsFromMemory } from './odds-store.mjs';
import { marketColumn } from './odds.mjs';
import { isHandicapOfferMarket } from './market-policy.mjs';
import { isResultBttsMarket } from './ledger/result-btts.mjs';
import { isResultTotalMarket, isTotalBttsMarket } from './ledger/mixed-combos.mjs';
import { liveBoardFacts } from './feed-sync.mjs';
import {teamStatisticsFromRow} from './match-statistics.mjs';

/** a line we invented ourselves because the feed's odds id carried none (see buildMarkets) */
const isSyntheticLine = (line) => line === '' || /^#\d+$/.test(String(line));

/** a market name that is just a render-type label because the feed omitted the real name */

/** Do not expose unresolved labels from old stored odds or older decoder frames. */
/** Every original provider market name, including "Total", "Corners", "Cards"
 * and "Result", is a real named market. Only synthetic placeholders are hidden.
 */
export function isIdentifiedMarketName(name) {
  const raw = String(name ?? '').trim();
  return !!raw && !/^(?:market|unknown|unverified market(?:\b.*)?|cols-?\d+|total-2|fora-2|match market)$/i.test(raw);
}
const isSyntheticName = (name) => /^(cols-?\d+|total-2|fora-2|market|unknown)$/i.test(String(name).trim());

/** hide the invented duplicate markets: ODDS_HIDE_SYNTHETIC_LINES=false shows them again */
const hideSyntheticLines = config.oddsHideSyntheticLines;

/** First-goal timing is a multi-selection market, NOT a 1X2 or total line. */
export function isGoalTimeMarket(name) {
  return /(?:\b(?:1st|first|next|last)\s+goal\s+time\b|\btime\s+of\s+(?:the\s+)?(?:1st|first|next|last)\s+goal\b|\btime\s+of\s+scoring\b)/i.test(String(name ?? ''));
}

/** groups odds_current rows into markets for the UI */
export function buildMarkets(oddsRows,{includeRemoved=false}={}) {
  const markets = new Map();

  for (const o of oddsRows) {
    // Zizobet emits null-price tombstones for removed/deduplicated offers.
    // Keep those in the store for stale-ticket validation, not on the board.
    if (!includeRemoved&&/^zz\d+@/.test(String(o.market_key)) && o.price == null && o.suspended === true) continue;
    if (!isIdentifiedMarketName(o.market_name, o.subgames, o.market_key)) continue;
    const key = `${o.market_key}|${o.line}`;
    if (!markets.has(key)) {
      // classify from the name at read time; the provider stops re-sending
      // unchanged markets, so a stored column can go stale. market-map.json
      // overrides still apply because they set the market *name*.
      const name = String(o.market_name ?? '').trim();
      const byName = marketColumn(o.market_key, name);
      const named = !/^(cols-?\d+|total-2|fora-2|market|unknown)$/i.test(String(name).trim());
      const column = /handicap|fora|asian/i.test(String(name))
        ? 'other'
        : byName !== 'other'
          ? byName
          : named
            ? 'other'
            : o.board_column ?? 'other';
      markets.set(key, {
        key: o.market_key,
        name,
        line: o.line,
        column,
        period: Number(o.period ?? 0),
        isBase: o.is_base === true,
        order: Number(o.grp_order ?? 0),
        renderType: o.render_type ?? null,
        subgames: o.subgames ?? null,
        suspended: false,
        outcomes: [],
      });
    }
    const outcomes = markets.get(key).outcomes;
    const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s*:\s*/g, ':').replace(/\s+/g, ' ');
    const oNormName = norm(o.outcome_name);
    const oNormKey = norm(o.outcome_key);
    const isMixed = isResultBttsMarket(o.market_name ?? markets.get(key).name) || isResultTotalMarket(o.market_name ?? markets.get(key).name) || isTotalBttsMarket(o.market_name ?? markets.get(key).name);
    const isGoalTime = isGoalTimeMarket(o.market_name ?? markets.get(key).name);

    // prevent duplicate outcome keys or outcome names inside the same market group
    const existing = outcomes.find(
      (eo) => isGoalTime
        ? eo.name && oNormName && norm(eo.name) === oNormName
        : (eo.key && oNormKey && norm(eo.key) === oNormKey) ||
          (!isMixed && eo.name && oNormName && norm(eo.name) === oNormName)
    );

    if (existing) {
      // Same outcome in the same market from a different provider: update the price.
      // This prevents duplicates like 1:2 or Home appearing multiple times.
      if (o.price !== null && o.price !== undefined && (existing.price === null || o.price > 0)) {
        existing.price = Number(o.price);
        existing.priceUpdatedAt = o.updated_at instanceof Date?o.updated_at.toISOString():o.updated_at??null;
      }
      if (o.suspended === true) existing.suspended = true;
    } else {
      outcomes.push({
        key: o.outcome_key,
        name: o.outcome_name,
        price: o.price === null ? null : Number(o.price),
        suspended: o.suspended === true,
        priceUpdatedAt: o.updated_at instanceof Date?o.updated_at.toISOString():o.updated_at??null,
      });
    }
  }

  const list = [...markets.values()];
  for(const market of list)observeMarket(market);
  for (const m of list) {
    // Secondary pass to guarantee zero duplicates inside the market outcomes
    const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s*:\s*/g, ':').replace(/\s+/g, ' ');
    const canon = (oc) => {
      const k = String(oc.key ?? '').trim().toLowerCase();
      const n = norm(oc.name);
      if (isGoalTimeMarket(m.name)) return n || k;
      if (isResultBttsMarket(m.name) || isResultTotalMarket(m.name) || isTotalBttsMarket(m.name)) return k || n;
      if (k === '1' || n === '1' || n === 'home' || n === 'w1') return '1';
      if (k === 'x' || n === 'x' || n === 'draw' || n === 'tie') return 'x';
      if (k === '2' || n === '2' || n === 'away' || n === 'w2') return '2';
      return k || n;
    };
    const seen = new Set();
    const cleanOutcomes = [];
    for (const oc of m.outcomes) {
      const ocKey = canon(oc);
      if (!seen.has(ocKey)) {
        seen.add(ocKey);
        cleanOutcomes.push(oc);
      } else {
        const found = cleanOutcomes.find((x) => canon(x) === ocKey);
        if (found && oc.price !== null && (found.price === null || oc.price > 0)) {
          found.price = Number(oc.price);
          found.priceUpdatedAt = oc.priceUpdatedAt;
        }
        if (found && oc.suspended) found.suspended = true;
      }
    }
    const OUTCOME_RANK = (k, n) => {
      const c = String(k ?? '').trim().toLowerCase();
      const nm = String(n ?? '').trim().toLowerCase();
      if (c === '1' || nm === '1' || nm === 'home' || nm === 'w1') return 1;
      if (c === 'x' || nm === 'x' || nm === 'draw' || nm === 'tie') return 2;
      if (c === '2' || nm === '2' || nm === 'away' || nm === 'w2') return 3;
      if (c === '1x' || nm === '1x') return 4;
      if (c === '12' || nm === '12') return 5;
      if (c === 'x2' || nm === 'x2') return 6;
      if (c === 'over' || nm === 'over') return 7;
      if (c === 'under' || nm === 'under') return 8;
      if (c === 'yes' || nm === 'yes') return 9;
      if (c === 'no' || nm === 'no') return 10;
      // HT/FT outcomes (HH, HD, HA, DH, DD, DA, AH, AD, AA)
      if (/^(hh|1\/1)$/i.test(c) || /^(hh|1\/1)$/i.test(nm)) return 20;
      if (/^(hd|1\/x)$/i.test(c) || /^(hd|1\/x)$/i.test(nm)) return 21;
      if (/^(ha|1\/2)$/i.test(c) || /^(ha|1\/2)$/i.test(nm)) return 22;
      if (/^(dh|x\/1)$/i.test(c) || /^(dh|x\/1)$/i.test(nm)) return 23;
      if (/^(dd|x\/x)$/i.test(c) || /^(dd|x\/x)$/i.test(nm)) return 24;
      if (/^(da|x\/2)$/i.test(c) || /^(da|x\/2)$/i.test(nm)) return 25;
      if (/^(ah|2\/1)$/i.test(c) || /^(ah|2\/1)$/i.test(nm)) return 26;
      if (/^(ad|2\/x)$/i.test(c) || /^(ad|2\/x)$/i.test(nm)) return 27;
      if (/^(aa|2\/2)$/i.test(c) || /^(aa|2\/2)$/i.test(nm)) return 28;
      return 99;
    };

    const mName = String(m.name ?? '').toLowerCase();

    // --- HT/FT detection (must come BEFORE is1X2 because is1X2 excludes "half") ---
    // Matches: "Halftime/Fulltime", "Half Time / Full Time", "HT/FT", "HTFT"
    const isHTFT = /halftime\s*\/?\s*fulltime|ht\s*\/?\s*ft|half\s*time\s*\/\s*full\s*time|htft/i.test(mName);

    const isCombo = isResultBttsMarket(m.name) || isResultTotalMarket(m.name) || isTotalBttsMarket(m.name);
    const is1X2 = !isHTFT && !isCombo &&
                  (m.column === 'result' || /1x2|match result|full time result|\bwinner\b|moneyline|3way|3-way/i.test(mName)) &&
                  !/half|score|rezultat|both|corner|card|handicap|chance/i.test(mName);
    const isBTTS = !isHTFT && !isCombo && /both teams? to score|both score|\bbtts\b/i.test(mName) && !/half|halves|result|1x2|winner/i.test(mName);
    const isOU = !isHTFT && !isCombo && m.column === 'total' && /total|over\/?under/i.test(mName) && !/corner|card|half|team/i.test(mName);
    const isOddEven = !isHTFT && /odd\/even/i.test(mName);
    const isDoubleChance = !isHTFT && /double chance/i.test(mName);

    let filteredOutcomes = cleanOutcomes;

    if (/^(?:yb|zz)\d+@/.test(m.key)) {
      // Native provider identities are already resolved from the complete
      // provider specifier. Do not apply LuckyBet positional-code filters.
      filteredOutcomes = cleanOutcomes;
    } else if (isHTFT) {
      // HT/FT: 9 outcomes. Accept both short codes (HH, HD, HA, DH, DD, DA, AH, AD, AA)
      // and slash form (1/1, 1/X, 1/2, X/1, X/X, X/2, 2/1, 2/X, 2/2).
      filteredOutcomes = cleanOutcomes.filter((o) => {
        const k = String(o.key ?? '').trim().toLowerCase().replace(/\s+/g, '');
        const n = String(o.name ?? '').trim().toLowerCase().replace(/\s+/g, '');
        const validShort = /^(hh|hd|ha|dh|dd|da|ah|ad|aa)$/;
        const validSlash = /^(1\/1|1\/x|1\/2|x\/1|x\/x|x\/2|2\/1|2\/x|2\/2)$/;
        return validShort.test(k) || validShort.test(n) || validSlash.test(k) || validSlash.test(n);
      });
      // If the filter above dropped everything (feed uses an unexpected code format),
      // fall back to keeping the raw outcomes so the market is not silently emptied.
      if (filteredOutcomes.length === 0) filteredOutcomes = cleanOutcomes;
    } else if (is1X2) {
      // 1X2 MUST strictly only contain 1, X, 2 (or Home, Draw, Away) — drop phantom 3, 4, 5 etc.
      filteredOutcomes = cleanOutcomes.filter((o) => {
        const k = String(o.key ?? '').trim().toLowerCase();
        const n = String(o.name ?? '').trim().toLowerCase();
        return ['1', 'x', '2', 'home', 'draw', 'away', 'w1', 'w2', 'tie'].includes(k) ||
               ['1', 'x', '2', 'home', 'draw', 'away', 'w1', 'w2', 'tie'].includes(n);
      });
    } else if (isBTTS) {
      // Both Teams to Score MUST strictly only contain Yes, No (drop phantom Home/Away/numbers)
      filteredOutcomes = cleanOutcomes.filter((o) => {
        const k = String(o.key ?? '').trim().toLowerCase();
        const n = String(o.name ?? '').trim().toLowerCase();
        return /^(yes|no|gg|ng)$/i.test(k) || /^(yes|no|gg|ng)$/i.test(n);
      });
    } else if (isOU) {
      // Over/Under MUST strictly only contain Over, Under
      filteredOutcomes = cleanOutcomes.filter((o) => {
        const k = String(o.key ?? '').trim().toLowerCase();
        const n = String(o.name ?? '').trim().toLowerCase();
        return /^(over|under|o|u)$/i.test(k) || /^(over|under|o|u)$/i.test(n);
      });
    } else if (isOddEven) {
      filteredOutcomes = cleanOutcomes.filter((o) => {
        const k = String(o.key ?? '').trim().toLowerCase();
        const n = String(o.name ?? '').trim().toLowerCase();
        return /^(odd|even)$/i.test(k) || /^(odd|even)$/i.test(n);
      });
    } else if (isDoubleChance) {
      filteredOutcomes = cleanOutcomes.filter((o) => {
        const k = String(o.key ?? '').trim().toLowerCase();
        const n = String(o.name ?? '').trim().toLowerCase();
        return /^(1x|12|x2)$/i.test(k) || /^(1x|12|x2)$/i.test(n);
      });
    }

    filteredOutcomes.sort((a, b) => OUTCOME_RANK(a.key, a.name) - OUTCOME_RANK(b.key, b.name));
    m.outcomes = filteredOutcomes;
    m.suspended = m.outcomes.length > 0 && m.outcomes.every((o) => o.suspended);
  }

  // The feed frames some groups twice: once with the line in the odds id / vars ("Total 2.5")
  // and once with no line at all, where we can only key the rows by inventing "#1". Both were
  // shown, so one selection appeared twice with two prices that updated independently - which
  // reads as "different odds for a while, and then the same again". The invented rows are our
  // own artefact, so they are hidden as soon as the group has a real line to show instead. A
  // group that is only ever line-less keeps them, otherwise there would be no market at all.
  const HIDDEN = hideSyntheticLines ? list : [];
  if (hideSyntheticLines) {
    const families = new Map();
    for (const m of list) {
      if (!families.has(m.key)) families.set(m.key, []);
      families.get(m.key).push(m);
    }
    for (const rows of families.values()) {
      if (!rows.some((m) => !isSyntheticLine(m.line))) continue;
      for (const m of rows) if (isSyntheticLine(m.line)) m.hidden = true;
    }
    // Hide entire families that ONLY have synthetic line numbers
    // (#1, #2, #3) — no real counterpart at all
    for (const rows of families.values()) {
      if (rows.every((m) => /^#\d+$/.test(String(m.line)))) {
        for (const m of rows) m.hidden = true;
      }
    }
    // Also hide markets whose OUTCOME names are all synthetic (#1, #2, #3)
    // regardless of the line value — these are positional placeholders with no real name
    for (const m of list) {
      if (m.hidden) continue;
      if (m.outcomes.length > 0 && m.outcomes.every((o) => /^#\d+$/.test(String(o.name || '')))) {
        m.hidden = true;
      }
    }
  }

  let visible = hideSyntheticLines ? list.filter((m) => !m.hidden) : list;

  // --- Hide markets whose name is only a render-type when a real counterpart exists ---
  // When the feed sends a group without a name, describeMarket() falls back to
  // "cols-2", "cols-3", "total-2", etc. If a real market in the same column carries
  // the same outcomes, the synthetic-name market is only noise.
  if (hideSyntheticLines && visible.length > 1) {
    for (const m of visible) {
      if (m.hidden || !isSyntheticName(m.name)) continue;
      // look for a real market in the same column with matching outcomes
      const real = visible.find(
        (r) =>
          !r.hidden &&
          r !== m &&
          r.column === m.column &&
          !isSyntheticName(r.name) &&
          r.outcomes.length === m.outcomes.length &&
          // outcomes match by position — cross-provider keys may differ
          r.outcomes.every((ro, idx) => {
            const mo = m.outcomes[idx];
            return mo && (ro.key === mo.key || (ro.name && mo.name && ro.name === mo.name));
          }),
      );
      if (real) m.hidden = true;
    }
    visible = visible.filter((m) => !m.hidden);
  }

  // Keep every distinct provider group. The Map above already coalesces rows
  // with the SAME market_key + line. A duplicate display name is not proof
  // that two different provider IDs are interchangeable betting contracts.

  // Hide handicap and early payout offers from every public market view, never from stored
  // provider odds or historical ticket settlement.
  visible = visible.filter((m) => !isExcludedOfferMarket({ name: m.name, marketType: m.column, nativeMarketId: String(m.key).split('@')[0].replace(/^zz/, '') }));

  visible.sort(
    (a, b) =>
      Number(b.isBase) - Number(a.isBase) ||
      a.order - b.order ||
      String(a.key).localeCompare(String(b.key)) ||
      String(a.line).localeCompare(String(b.line)),
  );
  return visible;
}

/** converts normalised (camelCase) odds rows to the DB row shape buildMarkets expects */
export const toDbOddsShape = (rows) =>
  rows.map((r) => ({
    match_id: r.matchId,
    market_key: r.marketKey,
    market_name: r.marketName,
    line: r.line ?? '',
    outcome_key: r.outcomeKey,
    outcome_name: r.outcomeName,
    price: r.price,
    suspended: r.suspended === true,
    is_base: r.isBase === true,
    grp_order: Number(r.order ?? 0),
    render_type: r.renderType ?? null,
    period: Number(r.period ?? 0),
    board_column: r.column ?? null,
    subgames: r.subgames ?? null,
    // This adapter receives newly ingested rows for socket publication only.
    // REST projections retain the actual stored updated_at instead.
    updated_at:r.updated_at??r.priceUpdatedAt??new Date(Date.now()-1000).toISOString(),
  }));

/**
 * match-info pushes per-team stats keyed by competitor id:
 *   {"87150":{"corners":2,"yellow":1,"red":0}, ...}
 * This maps them onto home/away using the competitor ids stored in `raw`.
 */
export function statsFromRow(row) {
  const map = row?.stats;
  if (!map || typeof map !== 'object') return null;
  const {home,away}=teamStatisticsFromRow(row);
  if (!home && !away) return null;

  // if the feed ever reports goals per team, surface them as a usable score
  let goals = null;
  if (home && away) {
    const key = Object.keys(home).find((k) => k.startsWith('goals:'));
    if (key && home[key] !== null && away[key] !== null) goals = { home: home[key], away: away[key] };
  }
  return { home, away, goals };
}

/** "Break Time" / H1 / H2 / Finished -> board phase */
export function phaseFromStatus(status) {
  const s = String(status ?? '').toLowerCase();
  if (!s) return null;
  if (/break|half.?time|interval|\bht\b/.test(s)) return 'HT';
  if (/(^|[^a-z])h1\b|\b1st|first half/.test(s)) return '1H';
  if (/(^|[^a-z])h2\b|\b2nd|second half/.test(s)) return '2H';
  if (/finish|ended|full.?time|\bft\b|after (match|penalt)/.test(s)) return 'FT';
  if (/not.?started|prepar|upcoming|scheduled/.test(s)) return 'pre';
  return null;
}

/**
 * Score priority: explicit home_score/away_score (from periodsScore) first,
 * then a goals value inside scoreBoard if the feed ever sends one.
 */
export function scoreFromRow(row) {
  if (row?.home_score !== null && row?.home_score !== undefined) {
    return { home: row.home_score, away: row.away_score };
  }
  const stats = statsFromRow(row);
  return stats?.goals ?? null;
}

/** the feed clock is a snapshot: anything older than this gets extrapolated against kickoff */
const STALE_CLOCK_MS = 6 * 60 * 1000;

/** the board never shows more than 90', and the break holds at 45' */
function clampMinute(minute, phase) {
  if (minute === null || minute === undefined) return null;
  if (phase === 'HT') return 45;
  if (phase === 'FT') return 90;
  if (phase === '1H') return Math.min(Math.max(1, minute), 45);
  if (phase === '2H') return Math.min(Math.max(46, minute), 90);
  return Math.max(0, minute);
}

export function serializeMatch(row, oddsRows = [], now = Date.now()) {
  const startAt = row.start_at instanceof Date ? row.start_at : new Date(row.start_at);
  const derived = row.service === 'LIVE' ? liveClock(startAt, now) : { minute: null, phase: 'pre', status: 'scheduled' };

  // match-info gives the real clock (matchTime in ms) and feed state ("Break Time", H1/H2, Finished).
  // That frame is a snapshot - it only arrives on subscribe - so anchor it to the moment it was
  // stored and run it forward: a missing or stale clock must never freeze the minute, and
  // `Number(null)` must never turn "no clock" into a permanent 0'.
  const hasFeedClock = row.match_time_ms !== null && row.match_time_ms !== undefined;
  const clockAt = row.clock_at ? new Date(row.clock_at).getTime() : null;
  const anchoredMinute = hasFeedClock
    ? Math.floor(Number(row.match_time_ms) / 60000) +
      (clockAt === null ? 0 : Math.max(0, Math.floor((now - clockAt) / 60000)))
    : null;
  const feedPhase = phaseFromStatus(row.feed_status);
  // A kickoff-based clock is an estimate, never evidence that a listed LIVE
  // fixture finished (delays, extra time and long stoppages are common).
  const phase = feedPhase ?? (row.service === 'LIVE' && derived.phase === 'FT' ? '2H' : derived.phase);
  const clockStale = clockAt === null || now - clockAt > STALE_CLOCK_MS;

  let minute = anchoredMinute ?? derived.minute;
  let minuteSource = anchoredMinute === null ? 'derived' : clockStale ? 'feed+drift' : 'feed';
  if (clockStale && derived.minute !== null && (minute === null || derived.minute > minute)) {
    minute = derived.minute;
    minuteSource = 'derived';
  }
  minute = clampMinute(minute, phase);

  const clock = {
    minute,
    phase,
    status: feedPhase === 'FT' ? 'ended' : row.service === 'LIVE' ? 'live' : derived.status,
  };
  // When the feed reports no open odds, every price is unbettable — hide markets entirely
  // so the board never shows placeholder prices (41.00 / 41.00 / 1.29) as bettable odds.
  const oddsClosed = row.has_open_odds === false || feedPhase === 'FT';
  const knownMarkets = buildMarkets(oddsRows);
  const markets = oddsClosed ? [] : knownMarkets;

  return {
    id: row.match_id,
    events:(function(){
      const rawEvents = row.raw?.eventTimeline;
      const scorers = statsProviders.displayScorers?.(row) ?? [];
      const baseEvents = Array.isArray(rawEvents) && rawEvents.length ? rawEvents : scorers.map(s => ({
        id: 'scorer-' + s.minute + '-' + s.team,
        matchId: String(row.match_id),
        type: 'goal',
        minute: s.minute,
        minuteLabel: String(s.minute),
        team: s.team,
        player: s.player,
        text: 'Goal: ' + s.player
      }));
      if(!baseEvents.length || !scorers.length) return baseEvents;
      return baseEvents.map(ev => {
        if(ev.type !== 'goal') return ev;
        const match = scorers.find(s => s.team === ev.team && Math.abs(s.minute - ev.minute) <= 2);
        if(!match || !match.player) return ev;
        return { ...ev, player: match.player, text: 'Goal: ' + match.player };
      });
    })(),
    provider: row.raw?.provider === 'YBETS' ? 'YBETS' : undefined,
    service: row.service,
    displayOrder: row.first_seen_at ? new Date((row.service === 'LIVE' ? row.live_first_seen_at : row.prematch_first_seen_at) ?? row.first_seen_at).getTime() : undefined,
    competitionOrder: row.competition_first_seen_at ? new Date(row.competition_first_seen_at).getTime() : undefined,
    listingStale: row.listing_stale === true,
    live: row.service === 'LIVE',
    status: clock.status,
    phase: clock.phase,
    minute: clock.minute,
    currentMinute: clock.minute,
    currentSecond:
      hasFeedClock && clockAt
        ? Math.floor(((Number(row.match_time_ms) + Math.max(0, now - clockAt)) % 60000) / 1000)
        : 0,
    minuteSource,
    clockAt: row.clock_at ? new Date(row.clock_at).toISOString() : null,
    scoreAt: row.score_at ? new Date(row.score_at).toISOString() : null,
    phaseAt: row.feed_status_at ? new Date(row.feed_status_at).toISOString() : null,
    feedStatus: row.feed_status ?? null,
    hasOpenOdds: row.has_open_odds ?? null,
    watchUrl: row.broadcast_url ?? null,
    startAt: startAt.toISOString(),
    league: { slug: row.category_slug, name: row.category_name },
    tournament: { id: row.tournament_id, name: row.tournament_name },
    home: row.home,
    away: row.away,
    score: scoreFromRow(row),
    periodsScore: row.periods_score ?? null,
    stats: statsFromRow(row),
    oddsCount: row.odds_count ?? null,
    isHot: row.is_hot === true,
    listingPriority:row.listing_priority,
    protectedPrematch:row.protected_prematch,
    suspended: row.listing_stale === true || oddsClosed || (markets.length > 0 && markets.every((m) => m.suspended)),
    hasSuspended: markets.some((m) => m.suspended),
    marketCount: knownMarkets.length,
    markets,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    snapshotAt: new Date(now).toISOString(),
  };
}

/** loads current odds for the given match rows and serialises everything */
export async function withOdds(rows, now = Date.now(),{board=false,displayStats=false}={}) {
  if(displayStats&&!board)for(const row of rows)statsProviders.warm(row);
  const ids = rows.map((r) => r.match_id);
  // prices are served from memory by default (no DB read on the board path);
  // ODDS_STORE=db restores the previous behaviour
  const byMatch = new Map(),counts=new Map(),decisions=new Map(),rowsById=new Map(rows.map((r)=>[r.match_id,r]));
  const inspect=board?o=>{if(o.price==null&&o.suspended===true)return;const key=o.match_id+'|'+o.market_key+'|'+o.market_name;let allowed=decisions.get(key);if(allowed===undefined){allowed=!isExcludedOfferMarket(o)&&marketIsEnabled(o,rowsById.get(o.match_id));decisions.set(key,allowed);}if(allowed){if(!counts.has(o.match_id))counts.set(o.match_id,new Set());counts.get(o.match_id).add(o.market_key+'|'+o.line);}}:undefined;
  const odds = config.oddsStore === 'db' ? await getOddsFromDb(ids) : getOddsFromMemory(ids,board?isBoardOddsRow:undefined,inspect);
  decisions.clear();
  for (const o of odds) {
    const key=o.match_id+'|'+o.market_key+'|'+o.market_name,decision=decisions.get(key)??{allowed:!isExcludedOfferMarket(o)&&marketIsEnabled(o,rowsById.get(o.match_id)),board:isBoardOddsRow(o)};decisions.set(key,decision);
    if(!decision.allowed||o.price==null&&o.suspended===true)continue;
    if(!counts.has(o.match_id))counts.set(o.match_id,new Set());counts.get(o.match_id).add(o.market_key+'|'+o.line);
    if(board&&!decision.board)continue;
    if (!byMatch.has(o.match_id)) byMatch.set(o.match_id, []);
    byMatch.get(o.match_id).push(o);
  }
  return rows.map((r) => ({...serializeMatch({...r,stats:statsProviders.displayStatistics(r)}, byMatch.get(r.match_id) ?? [], now),marketCount:counts.get(r.match_id)?.size??0}));
}

export function startCollector({ io } = {}) {
  const state = {
    syncedAt: null, lastError: null, received: 0, kept: 0, skipped: 0, cycles: 0, running: false,
    // idle mode (server/idle-mode.mjs): while paused there is no upstream polling at all
    paused: false, pauses: 0, resumes: 0,
  };
  let timer = null;

  const tick = async () => {
    if (state.running || state.paused) return;
    state.running = true;
    try {
      const { rows, received, skipped, complete } = await fetchRealFootball();
      const now = Date.now();

      // refresh the derived live clock on every cycle
      for (const r of rows) {
        if (r.service !== 'LIVE') continue;
        const c = liveClock(r.start_at, now);
        r.live_minute = c.minute;
        r.phase = c.phase;
        r.status = 'live';

        // Kickoff + 105 minutes is only an approximation of full time: a delayed kickoff, a
        // long break or heavy stoppage makes it say "finished" while the feed is still
        // reporting the match in play. That status is what hid the match from the board and
        // dropped it from the push subscription, so its minute and its prices froze and the
        // match seemed to vanish around 70'. Only the feed ends a match it still reports.
        if (c.phase === 'FT') {
          const known = await getMatchById(r.match_id);
          const confirmedPhase = phaseFromStatus(known?.feed_status);
          if (confirmedPhase === 'FT') r.status = 'ended';
          r.phase = confirmedPhase ?? '2H';
        }
      }

      await upsertMatches(rows);
      const expired = await expireStaleMatches(Math.max(150, Math.round((config.pollIntervalMs / 1000) * 6)));

      state.syncedAt = new Date().toISOString();
      state.received = received;
      state.kept = rows.length;
      state.skipped = skipped;
      state.catalogComplete = complete !== false;
      state.cycles++;
      state.lastError = null;

      console.log(
        `[collector] ${state.syncedAt} received=${received} real=${rows.length} filtered=${skipped} expired=${expired.length}`,
      );

      if (io) {
        const liveRows = await getMatches({ service: 'LIVE', catalog:true });
        const matches = await withOdds(liveRows, now,{board:true});
        const counts = await getCounts();
        io.emit('matches:live', { at: state.syncedAt, counts, matches: liveBoardFacts(matches) });
        io.emit('meta', {
          ...counts,
          at: state.syncedAt,
          received,
          kept: rows.length,
          skipped,
          oddsMode: config.subscribeFrames.length || process.env.ODDS_SOCKET === 'true' ? 'socket' : 'ingest',
        });
      }
    } catch (e) {
      state.lastError = e.message;
      console.error('[collector] error:', dbErrorHint(e.message));
    } finally {
      state.running = false;
    }
  };

  const arm = () => {
    clearInterval(timer);
    timer = setInterval(tick, config.pollIntervalMs);
  };

  arm();
  tick();

  return {
    state,
    stop() {
      state.paused = true;
      clearInterval(timer);
      timer = null;
    },
    /** idle mode: stop polling upstream - with no visitor the board is not being read */
    pause() {
      if (state.paused) return false;
      state.paused = true;
      state.pauses++;
      clearInterval(timer);
      timer = null;
      console.log('[collector] paused (idle mode): no upstream polling');
      return true;
    },
    /** idle mode: poll now (one cycle) and keep polling on the interval again */
    resume() {
      if (!state.paused) return false;
      state.paused = false;
      state.resumes++;
      console.log('[collector] resuming (a visitor is back)');
      arm();
      return tick();
    },
    isPaused: () => state.paused,
    tick,
  };
}
