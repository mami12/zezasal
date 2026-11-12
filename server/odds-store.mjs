/**
 * In-memory odds store.
 *
 * Prices are by far the hottest data in this app (thousands of row changes per minute)
 * and the browser already receives them by push (`io.emit('odds:update')`), so they do
 * not need to travel through Postgres at all. They live here, and every board payload
 * reads them from here. The database keeps only what must survive a restart: matches
 * and - the reason this change was made - users, tickets and results.
 *
 * Trade-off: prices are lost on restart, so a fresh process shows matches without
 * prices for the ~1-3s until the feed resends its snapshots (the pusher re-subscribes
 * on boot). Set ODDS_STORE=db to mirror prices into odds_current/odds_history again.
 *
 * No imports on purpose: this module is pure and trivially testable.
 */

const MAX_MATCHES = 3000; // matches tracked at most (oldest price update evicted first)
const MATCH_TTL_MS = 6 * 60 * 60 * 1000; // ...or dropped after 6h without a price update
const HISTORY_PER_MATCH = 200; // price-change entries kept per match
const HISTORY_MATCHES = 500; // matches whose history we keep
const EVICT_EVERY_MS = 60 * 1000; // how often the TTL sweep runs

const byMatch = new Map(); // matchId -> Map("market|line|outcome" -> stored row)
const historyByMatch = new Map(); // matchId -> [ price-change entries ]
const counters = { applied: 0, changed: 0, evictedMatches: 0, lastChangeAt: null };

/* --------------------------------------------------------------- provider pinning
 * The feed prices one selection from more than one book at a time (odds ids are prefixed
 * "10:…" and "12:L:…") and both used to write the same market|line|outcome key, so the board
 * showed whichever frame arrived last - a price that changed and then changed back on the
 * next 20s snapshot. Now a single provider owns each selection: the first one to price it,
 * unless match-info reports which book the site itself sells from, which then takes over.
 * Rows that lose the pin are dropped (counting as a conflict), so nothing is invented.
 * ------------------------------------------------------------------------------------ */
const TAKEOVER_MS = Number(process.env.ODDS_PROVIDER_TAKEOVER_MS ?? 60000);
const pinByKey = new Map(); // `${matchId}|${keyOf}` -> providerId that owns that selection
const preferredByMatch = new Map(); // matchId -> providerId the site's own match-info reports
const providerSeen = new Map(); // `${matchId}|${providerId}` -> last ms we received a price
const conflicts = []; // newest last, capped at CONFLICTS_MAX
const CONFLICTS_MAX = 500;

let pinProvider = true;
let lastEvict = 0;

const normalizeProvider = (v) => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s ? s : null;
};

/**
 * Turns the pin on/off (ODDS_PROVIDER_PIN, and off for a store used on its own in tests).
 * "off" restores the old last-writer-wins behaviour.
 */
export function configure(options = {}) {
  if (options.pinProvider !== undefined) pinProvider = options.pinProvider !== false;
}

/**
 * The book the site's own feed reports for a match (match-info.providerId). Preferring it is
 * what makes our displayed prices match the source site's, not just one book's.
 */
export function setProvider(matchId, providerId) {
  const id = Number(matchId);
  const provider = normalizeProvider(providerId);
  if (!Number.isFinite(id) || !provider) return false;
  if (preferredByMatch.get(id) === provider) return true;
  preferredByMatch.set(id, provider);
  return true;
}

export const getProvider = (matchId) => preferredByMatch.get(Number(matchId)) ?? null;

/** who owns what, and where two books disagreed - for /health and the odds history view */
export function providerReport(limit = 20) {
  const n = Math.min(Math.max(1, Number(limit) || 20), 200);
  return {
    pinning: pinProvider,
    preferredMatches: preferredByMatch.size,
    pinnedSelections: pinByKey.size,
    conflicts: conflicts.length,
    ignoredForeignRows: counters.ignoredForeignRows ?? 0,
    recent: conflicts.slice(-n).reverse(),
  };
}

/** forgets the pin bookkeeping of one match (eviction / clearMatch) */
function dropProviderState(matchId) {
  const prefix = `${matchId}|`;
  for (const k of [...pinByKey.keys()]) if (k.startsWith(prefix)) pinByKey.delete(k);
  for (const k of [...providerSeen.keys()]) if (k.startsWith(prefix)) providerSeen.delete(k);
  preferredByMatch.delete(Number(matchId));
}

const keyOf = (row) => `${row.marketKey ?? row.market_key}|${row.line ?? ''}|${row.outcomeKey ?? row.outcome_key}`;

const OUTCOME_ORDER = (key) => {
  const k = String(key ?? '').toLowerCase();
  if (k === '1') return 1;
  if (k === 'x') return 2;
  if (k === '2') return 3;
  if (k === 'under') return 4;
  if (k === 'over') return 5;
  return 9;
};

/** normalises one decoded row (camelCase) into the shape the board expects (snake_case) */
function toStored(row, at) {
  return {
    match_id: Number(row.matchId),
    market_key: row.marketKey,
    market_name: row.marketName,
    line: row.line ?? '',
    outcome_key: row.outcomeKey,
    outcome_name: row.outcomeName,
    price: row.price ?? null,
    suspended: row.suspended === true,
    is_base: row.isBase === true,
    grp_order: Number.isFinite(Number(row.order)) ? Number(row.order) : 0,
    render_type: row.renderType ?? null,
    period: Number.isFinite(Number(row.period)) ? Number(row.period) : 0,
    board_column: row.column ?? null,
    subgames: row.subgames ?? null,
    provider_id: normalizeProvider(row.providerId),
    // Preserve the real native offer identity at the price-validation boundary.
    // Display translations do not define the settlement contract.
    native_market_id: row.nativeMarketId ?? row.native_market_id ?? null,
    native_outcome_id: row.nativeOutcomeId ?? row.native_outcome_id ?? null,
    native_market_name: row.nativeMarketName ?? row.native_market_name ?? null,
    native_outcome_name: row.nativeOutcomeName ?? row.native_outcome_name ?? null,
    native_parameters: row.nativeParameters ?? row.native_parameters ?? null,
    updated_at: at,
  };
}

function pushHistory(matchId, row) {
  let list = historyByMatch.get(matchId);
  if (!list) {
    list = [];
    historyByMatch.set(matchId, list);
    if (historyByMatch.size > HISTORY_MATCHES) {
      // Map keeps insertion order, so the first key is the oldest tracked match
      historyByMatch.delete(historyByMatch.keys().next().value);
    }
  }
  list.push({
    market_key: row.market_key,
    market_name: row.market_name,
    line: row.line,
    outcome_key: row.outcome_key,
    outcome_name: row.outcome_name,
    price: row.price,
    suspended: row.suspended,
    provider_id: row.provider_id ?? null,
    at: row.updated_at,
  });
  if (list.length > HISTORY_PER_MATCH) list.splice(0, list.length - HISTORY_PER_MATCH);
}

function lastUpdate(bucket) {
  let last = 0;
  for (const row of bucket.values()) {
    const t = row.updated_at instanceof Date ? row.updated_at.getTime() : 0;
    if (t > last) last = t;
  }
  return last;
}

function evictIfNeeded() {
  const now = Date.now();
  if (byMatch.size <= MAX_MATCHES && now - lastEvict < EVICT_EVERY_MS) return;
  lastEvict = now;

  const cutoff = now - MATCH_TTL_MS;
  for (const [id, bucket] of byMatch) {
    if (lastUpdate(bucket) < cutoff) {
      byMatch.delete(id);
      historyByMatch.delete(id);
      counters.evictedMatches++;
    }
  }
  while (byMatch.size > MAX_MATCHES) {
    let oldestId = null;
    let oldest = Infinity;
    for (const [id, bucket] of byMatch) {
      const last = lastUpdate(bucket);
      if (last < oldest) {
        oldest = last;
        oldestId = id;
      }
    }
    if (oldestId === null) break;
    byMatch.delete(oldestId);
    historyByMatch.delete(oldestId);
    dropProviderState(oldestId);
    counters.evictedMatches++;
  }
}

/**
 * Applies decoded/normalised odds rows (camelCase) and returns the subset whose price
 * or suspension actually moved - the same contract saveOdds() had, so the caller can
 * broadcast exactly the changed markets.
 */
export function applyRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { changed: [] };

  const at = new Date();
  const changed = [];

  for (const row of rows) {
    const matchId = Number(row.matchId);
    if (!Number.isFinite(matchId) || !row.outcomeKey) continue;

    let bucket = byMatch.get(matchId);
    if (!bucket) {
      bucket = new Map();
      byMatch.set(matchId, bucket);
    }

    const key = keyOf(row);
    const provider = normalizeProvider(row.providerId);

    // One book owns each selection, so two providers can never trade the same key back and
    // forth. Rows from the losing book are dropped rather than stored: we never invent a
    // price, we just keep showing the same book's.
    if (provider && pinProvider) {
      const atMs = at.getTime();
      providerSeen.set(`${matchId}|${provider}`, atMs);

      const pinKey = `${matchId}|${key}`;
      const pinned = pinByKey.get(pinKey) ?? null;
      if (!pinned) {
        pinByKey.set(pinKey, provider);
      } else if (pinned !== provider) {
        const preferred = preferredByMatch.get(matchId) ?? null;
        const pinnedLastSeen = providerSeen.get(`${matchId}|${pinned}`) ?? 0;
        // the book the site itself reports always wins; otherwise only take the selection
        // over once the pinned book has gone quiet (it stopped pricing this match)
        if (preferred === provider || atMs - pinnedLastSeen > TAKEOVER_MS) {
          pinByKey.set(pinKey, provider);
        } else {
          counters.ignoredForeignRows = (counters.ignoredForeignRows ?? 0) + 1;
          if (conflicts.length < CONFLICTS_MAX) {
            conflicts.push({
              match_id: matchId,
              market_key: row.marketKey,
              line: row.line ?? '',
              outcome_key: row.outcomeKey,
              price: row.price,
              kept: pinned,
              dropped: provider,
              at: at.toISOString(),
            });
          }
          continue;
        }
      }
    } else if (provider) {
      providerSeen.set(`${matchId}|${provider}`, at.getTime());
    }

    const prev = bucket.get(key);
    const priceChanged = !prev || Number(prev.price) !== Number(row.price);
    const suspendedChanged = !prev || prev.suspended !== (row.suspended === true);

    const stored = toStored(row, at);
    bucket.set(key, stored);
    counters.applied++;

    if (!priceChanged && !suspendedChanged) continue;
    counters.changed++;
    counters.lastChangeAt = at;
    changed.push(row); // camelCase: broadcastOdds() -> toDbOddsShape() expects this
    if (priceChanged) pushHistory(matchId, stored);
  }

  evictIfNeeded();
  return { changed };
}

/** board-shaped odds (snake_case) for the given match ids, ordered like the old query */
export function getOddsForMatches(matchIds = [], accept, inspect) {
  const out = [];
  for (const id of matchIds) {
    const bucket = byMatch.get(Number(id));
    if (bucket) for(const row of bucket.values()){inspect?.(row);if(!accept||accept(row))out.push(row);}
  }

  out.sort(
    (a, b) =>
      a.match_id - b.match_id ||
      Number(b.is_base) - Number(a.is_base) ||
      a.grp_order - b.grp_order ||
      a.period - b.period ||
      String(a.market_key).localeCompare(String(b.market_key)) ||
      String(a.line).localeCompare(String(b.line)) ||
      OUTCOME_ORDER(a.outcome_key) - OUTCOME_ORDER(b.outcome_key) ||
      String(a.outcome_key).localeCompare(String(b.outcome_key)),
  );
  return out;
}

/**
 * True when this match has at least one row with a real price. Used to keep the board honest:
 * a match with no price is hidden, so a fixture the feed has not sent yet has to be asked for
 * immediately instead of waiting for the next scheduled pass (see subscribe-plan.mjs).
 * Cheap on purpose - it stops at the first priced row, unlike getOddsForMatches() which sorts.
 */
export function hasPricedRows(matchId) {
  const bucket = byMatch.get(Number(matchId));
  if (!bucket) return false;
  for (const row of bucket.values()) {
    if (row.price !== null && row.price !== undefined) return true;
  }
  return false;
}

/** the ids among these that have no price at all yet */
export function missingPrices(matchIds = []) {
  const out = [];
  for (const id of matchIds) if (!hasPricedRows(id)) out.push(id);
  return out;
}

/** recent price changes for one match, newest first (only since this process started) */
export function getHistory(matchId, limit = 200) {
  const list = historyByMatch.get(Number(matchId)) ?? [];
  const n = Math.min(Math.max(1, Number(limit) || 200), HISTORY_PER_MATCH);
  return list.slice(-n).reverse();
}

export function clearMatch(matchId) {
  const id = Number(matchId);
  const had = byMatch.delete(id);
  historyByMatch.delete(id);
  dropProviderState(id);
  return had;
}

export function stats() {
  let rows = 0;
  for (const bucket of byMatch.values()) rows += bucket.size;
  let historyEntries = 0;
  for (const list of historyByMatch.values()) historyEntries += list.length;
  return {
    mode: 'memory',
    matches: byMatch.size,
    rows,
    historyEntries,
    applied: counters.applied,
    changed: counters.changed,
    evictedMatches: counters.evictedMatches,
    lastChangeAt: counters.lastChangeAt ? counters.lastChangeAt.toISOString() : null,
    // provider pinning: who owns the prices, and where two books disagreed
    pinnedSelections: pinByKey.size,
    preferredMatches: preferredByMatch.size,
    ignoredForeignRows: counters.ignoredForeignRows ?? 0,
    providerConflicts: conflicts.length,
  };
}
