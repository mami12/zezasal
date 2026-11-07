import WebSocket from 'ws';
import { config } from './config.mjs';
import {saveOdds,logRawFrame,query} from './db.mjs';
import {isLedgerReady} from './ledger/store.mjs';
import {createProviderOfferArchive} from './ledger/provider-offer-archive.mjs';

const providerOfferArchive=createProviderOfferArchive({execute:query,ready:isLedgerReady});
export const providerOfferArchiveHealth=()=>providerOfferArchive.status();
import * as oddsStore from './odds-store.mjs';

/**
 * Odds normalisation.
 *
 * The public REST feed does not expose prices and the upstream push channel
 * needs the app's own subscribe protocol, so this module accepts odds from two
 * places:  (a) POST /ingest/odds  (b) decoded frames of the upstream socket.
 * Both go through normalizeOddsPayload() and then saveOdds().
 *
 * Canonical payload accepted by POST /ingest/odds:
 * {
 *   "matchId": 40337530, "suspended": false,
 *   "markets": [{
 *     "key": "1x2", "name": "Full Time Result", "line": "",
 *     "outcomes": [{ "key": "1", "name": "Home", "price": 2.1, "suspended": false }, ...]
 *   }]
 * }
 * Also accepted: an array of the above, a flat list of outcome rows, or a loose
 * object such as {"matchId":1,"odds":{"1":2.1,"X":3.4,"2":3.0}}.
 */

const PRICE_KEYS = ['price', 'coef', 'coefficient', 'odds', 'kf', 'cf', 'rate', 'value'];
const SUSPEND_KEYS = ['suspended', 'isSuspended', 'is_suspended', 'suspend', 'blocked', 'isBlocked', 'stopped', 'isStopped', 'locked', 'frozen'];
const MATCH_ID_KEYS = ['matchId', 'match_id', 'mid', 'eventId', 'event_id', 'gameId', 'game_id'];
const OUTCOME_LABELS = /^(1|x|2|w1|wx|w2|home|away|draw|tie|over|under|yes|no|\d+(\.\d+)?)$/i;

export const MARKET_LABELS = {
  '1x2': 'Full Time Result',
  'ft.1x2': 'Full Time Result',
  'result': 'Full Time Result',
  'ou': 'Total Goals',
  'total': 'Total Goals',
  'totals': 'Total Goals',
  'corners': 'Total Corners',
  'total-corners': 'Total Corners',
  'cards': 'Total Cards',
  'bookings': 'Total Cards',
  'yellow-cards': 'Yellow Cards',
  'red-cards': 'Red Cards',
  'btts': 'Both Teams To Score',
  'dc': 'Double Chance',
  'ah': 'Asian Handicap',
};

export function marketLabel(key) {
  if (!key) return 'Market';
  const k = String(key).toLowerCase();
  return MARKET_LABELS[k] ?? String(key);
}

/** Which board column a market belongs to (read-time classification). */
export function marketColumn(key = '', name = '') {
  const s = `${key} ${name}`.toLowerCase();
  if (/corner/.test(s)) return 'corners';
  // word boundaries matter: "goals sco-red" must not look like a red card
  if (/\bcards?\b|\bbookings?\b|penalt|yellow|\bred\b/.test(s)) return 'cards';
  if (/1x2|1 ?x ?2|full time result|match result|winner|double chance|moneyline/.test(s)) return 'result';
  if (/handicap|fora|asian/.test(s)) return 'other';
  if (/total|over\/?under|\bgoals?\b|odd\/even/.test(s)) return 'total';
  return 'other';
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function pickPrice(obj) {
  for (const k of PRICE_KEYS) {
    const n = num(obj[k]);
    if (n !== null) return n;
  }
  return null;
}

function pickSuspended(obj) {
  for (const k of SUSPEND_KEYS) if (obj[k] === true || obj[k] === 1) return true;
  return false;
}

function pickMatchId(obj) {
  for (const k of MATCH_ID_KEYS) {
    const v = obj[k];
    if (v !== null && v !== undefined && String(v).length > 0 && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function outcomeName(key) {
  const k = String(key).toLowerCase();
  if (k === '1' || k === 'w1') return 'Home';
  if (k === '2' || k === 'w2') return 'Away';
  if (k === 'x' || k === 'wx') return 'Draw';
  if (k === 'over') return 'Over';
  if (k === 'under') return 'Under';
  return String(key);
}

export function normalizeOddsPayload(payload, defaults = {}) {
  const rows = [];
  const seen = new Set();

  const add = ({ matchId, marketKey, marketName, line, outcomeKey, outcomeName: on, price, suspended, isBase, order, renderType, period }) => {
    const priceNum = num(price);
    if (!matchId || !outcomeKey || priceNum === null) return;
    const mk = String(marketKey ?? 'unknown').toLowerCase();
    const ln = line === null || line === undefined ? '' : String(line);
    const ok = String(outcomeKey);
    const dedupeKey = `${matchId}|${mk}|${ln}|${ok}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    rows.push({
      matchId: Number(matchId),
      marketKey: mk,
      marketName: marketName ?? marketLabel(mk),
      line: ln,
      outcomeKey: ok,
      outcomeName: on ?? outcomeName(ok),
      price: priceNum,
      suspended: suspended === true,
      isBase: isBase === true,
      order: Number.isFinite(Number(order)) ? Number(order) : 0,
      renderType: renderType ?? null,
      period: Number.isFinite(Number(period)) ? Number(period) : 0,
    });
  };

  const fromMarket = (market, ctx) => {
    const matchId = pickMatchId(market) ?? ctx.matchId ?? defaults.matchId ?? null;
    const marketKey = market.marketKey ?? market.market_key ?? market.market ?? market.type ?? market.key ?? ctx.marketKey ?? null;
    const marketName = market.marketName ?? market.market_name ?? market.marketTitle ?? market.name ?? ctx.marketName ?? null;
    const line = market.line ?? market.handicap ?? market.hcp ?? market.total ?? market.points ?? ctx.line ?? '';
    const suspended = pickSuspended(market);

    const outcomes = market.outcomes ?? market.selections ?? market.prices ?? market.odds ?? market.variants;
    const meta = {
      isBase: market.isBase === true || market.is_base === true,
      order: market.order ?? market.grpOrder ?? market.grp_order ?? 0,
      renderType: market.renderType ?? market.render_type ?? null,
      period: market.period ?? ctx.period ?? 0,
    };
    if (Array.isArray(outcomes)) {
      for (const o of outcomes) {
        if (!o || typeof o !== 'object') continue;
        add({
          matchId,
          marketKey,
          marketName,
          line,
          outcomeKey: o.key ?? o.outcomeKey ?? o.outcome_key ?? o.code ?? o.slug ?? o.name ?? o.label,
          outcomeName: o.name ?? o.label ?? o.title ?? o.outcomeName,
          price: pickPrice(o),
          suspended: suspended || pickSuspended(o),
          ...meta,
        });
      }
      return;
    }

    // {"over":1.9,"under":1.9} style
    if (outcomes && typeof outcomes === 'object') {
      for (const [k, v] of Object.entries(outcomes)) {
        const price = typeof v === 'object' ? pickPrice(v) : num(v);
        add({
          matchId, marketKey, marketName, line, outcomeKey: k, price,
          suspended: suspended || (typeof v === 'object' && pickSuspended(v)),
          ...meta,
        });
      }
    }
  };

  const walk = (node, ctx = {}) => {
    if (node === null || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const item of node) {
        if (item && typeof item === 'object' && (Array.isArray(item.outcomes) || Array.isArray(item.selections) || item.marketKey || item.market)) {
          fromMarket(item, ctx);
        } else {
          walk(item, ctx);
        }
      }
      return;
    }

    if (pickMatchId(node) !== null && !node.markets && !node.outcomes && !node.odds) ctx = { ...ctx, matchId: pickMatchId(node) };

    if (Array.isArray(node.markets)) {
      for (const m of node.markets) fromMarket(m, { ...ctx, matchId: pickMatchId(node) ?? ctx.matchId ?? defaults.matchId });
      return;
    }

    // {"matchId":1,"odds":{"1":2.1,"X":3.4,"2":3.0}} or {"1":..,"X":..,"2":..}
    const priceMap = node.odds ?? node.prices ?? node.coefs ?? null;
    if (priceMap && typeof priceMap === 'object' && !Array.isArray(priceMap)) {
      const keys = Object.keys(priceMap);
      if (keys.some((k) => OUTCOME_LABELS.test(k))) {
        const matchId = pickMatchId(node) ?? ctx.matchId ?? defaults.matchId ?? null;
        const marketKey = node.marketKey ?? node.market ?? node.type ?? ctx.marketKey ?? '1x2';
        const line = node.line ?? node.handicap ?? ctx.line ?? '';
        const suspended = pickSuspended(node);
        for (const [k, v] of Object.entries(priceMap)) {
          const price = typeof v === 'object' ? pickPrice(v) : num(v);
          add({ matchId, marketKey, marketName: marketLabel(marketKey), line, outcomeKey: k, price, suspended: suspended || (typeof v === 'object' && pickSuspended(v)) });
        }
        return;
      }
    }

    for (const [k, v] of Object.entries(node)) {
      if (k === 'raw' || k === 'payload') continue;
      if (v && typeof v === 'object') walk(v, { ...ctx, marketKey: ctx.marketKey ?? (/market|odds/i.test(k) ? k : undefined) });
    }
  };

  if (Array.isArray(payload)) {
    // flat row list
    const flat = payload.every((p) => p && typeof p === 'object' && (p.outcomeKey || p.marketKey) && !p.outcomes);
    if (flat) {
      for (const p of payload) {
        add({
          matchId: pickMatchId(p) ?? defaults.matchId,
          marketKey: p.marketKey ?? p.market_key ?? p.market ?? defaults.marketKey,
          marketName: p.marketName ?? p.market_name,
          line: p.line ?? '',
          outcomeKey: p.outcomeKey ?? p.outcome_key ?? p.key,
          outcomeName: p.outcomeName ?? p.outcome_name ?? p.name,
          price: p.price ?? p.odds ?? p.coef,
          suspended: pickSuspended(p),
        });
      }
      return rows;
    }
  }

  walk(payload);
  return rows;
}

/**
 * Stores normalised odds and returns what actually changed.
 *
 * Default (ODDS_STORE=memory): prices stay in RAM and go straight to the browser via
 * io.emit('odds:update') - no DB writes. ODDS_STORE=db keeps the old behaviour of
 * mirroring every price into odds_current/odds_history.
 */
export async function applyOddsRows(rows) {
  if (!rows.length) return [];
  if (config.oddsStore === 'db') {
    const { changed } = await saveOdds(rows);
    oddsStore.applyRows(rows); // keep the in-memory board view warm too
    // Archive native market names, IDs and quoted parameters independently
    // of the board's memory/database mode. It never changes offered prices.
    providerOfferArchive.observe(rows);
    return changed;
  }
  const { changed } = oddsStore.applyRows(rows);
  providerOfferArchive.observe(rows);
  return changed;
}

export function groupByMatch(rows) {
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.matchId)) out.set(r.matchId, []);
    out.get(r.matchId).push(r);
  }
  return out;
}

/**
 * Optional: listens to the upstream push channel.
 *
 * Without the application's own subscribe frames the server stays silent, which
 * is why the raw frames are persisted (raw_frames table, GET /api/raw-frames)
 * and why ODDS_SUBSCRIBE_FRAMES exists — put the exact Socket.IO frames your
 * browser sends (DevTools -> Network -> WS -> copy the "42[...]" messages,
 * separate several with "||") into that env var and decoding kicks in.
 */
export function startOddsSocket({ url, onRows, onStatus } = {}) {
  const target =
    url ??
    `wss://api-gateway.gw-lucky-bet.com/push-server-v2/?Language=${encodeURIComponent(config.lang)}&externalPartnerId=${encodeURIComponent(config.partnerId)}&EIO=4&transport=websocket`;

  let ws = null;
  let closed = false;
  let loggedFrames = 0;
  let attempt = 0;
  const MAX_LOGGED = 300;

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(target, {
      headers: {
        Origin: 'https://bitgames6205.com',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      },
      handshakeTimeout: 15000,
    });

    ws.on('open', () => {
      attempt = 0;
      onStatus?.({ connected: true, url: target });
      console.log('[odds] upstream socket connected');
      setTimeout(() => {
        ws.send('40');
        for (const frame of config.subscribeFrames) ws.send(frame);
        if (config.subscribeFrames.length) console.log(`[odds] sent ${config.subscribeFrames.length} subscribe frame(s)`);
      }, 400);
    });

    ws.on('message', async (data) => {
      const text = data.toString();
      if (text === '2') {
        ws.send('3');
        return;
      }
      if (!text.startsWith('42')) {
        if (text.startsWith('43')) console.log('[odds] upstream error frame:', text.slice(0, 200));
        return;
      }

      let parsed;
      try {
        const body = text.slice(text.indexOf('[') >= 0 ? text.indexOf('[') : 2);
        parsed = JSON.parse(body);
      } catch {
        return;
      }

      const payload = Array.isArray(parsed) && parsed.length > 1 ? parsed[1] : parsed;
      const rows = normalizeOddsPayload(payload);

      if (rows.length) {
        onRows?.(rows);
      } else if (loggedFrames < MAX_LOGGED) {
        loggedFrames++;
        logRawFrame('push-server-v2', { event: Array.isArray(parsed) ? parsed[0] : null, payload }).catch(() => {});
      }
    });

    ws.on('error', (e) => onStatus?.({ connected: false, error: e.message }));
    ws.on('close', () => {
      onStatus?.({ connected: false });
      if (closed) return;
      const delay = Math.min(30000, 2000 * 2 ** attempt++);
      setTimeout(connect, delay);
    });
  };

  connect();

  return {
    close() {
      closed = true;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
  };
}
