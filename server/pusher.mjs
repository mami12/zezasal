/**
 * Server-side subscription to the push channel (the one the browser uses).
 *
 * Verified protocol:
 *   <- 0{"sid":…}                         engine.io open
 *   -> 40                                 open the namespace
 *   <- 40{"sid":…,"pid":…}
 *   -> 42["subscribe",{"messageType":"subscribe-match-odds","data":{"matchIds":[ids…],"isBaseOddsGroups":true|false}}]
 *   -> 42["subscribe",{"messageType":"subscribe-match-info","data":{"matchIds":[ids…]}}]
 *   <- 42["u",{"messageType":"match-odds-snapshot"|"match-odds"|"match-info-snapshot"|"match-info",…},id]
 *   <- 2 / -> 3                           heartbeat every ~25s
 *
 * Subscriptions must be repeated every ~20s; ids are chunked by 50.
 *
 * The repeat cadence is no longer uniform (see subscribe-plan.mjs): live matches keep the
 * ~20s cadence because a re-subscribe is what makes the feed resend their clock and score,
 * prematch follows two tiers (kickoff within 30 min = "soon", everything else = "later") and
 * a fixture the feed has not priced yet is asked for every minute until it gets a price -
 * without that last group it would stay hidden by the "hide matches without prices" rule.
 * One cadence for everything is what made 150 fixtures kicking off hours from now cost as
 * much (on Railway: as much CPU) as the live board.
 *
 * pause()/resume() remain manual lifecycle controls; visitor inactivity never calls them.
 */
import WebSocket from 'ws';
import { config, dbErrorHint } from './config.mjs';
import { decodePushBatch } from './push-decode.mjs';
import {
  SUBSCRIBE_GROUPS,
  DEFAULT_SOON_REFRESH_MS,
  DEFAULT_REFRESH_MS,
  DEFAULT_UNPRICED_MS,
  dueGroups,
  retryIntervals,
  withoutDuplicates,
} from './subscribe-plan.mjs';

const CHUNK = 50;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const HEADERS = {
  'user-agent': UA,
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.9',
  origin: 'https://bitgames6205.com',
  referer: 'https://bitgames6205.com/',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
};

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

export function startPusher({
  getIds,
  onOdds,
  onInfo,
  onStatus,
  fullMarkets = false,
  fullMarketsLiveLimit = 60,
  fullMarketsOrder = 'recent',
  resubscribeMs = 20000,
  prematchSoonMs = DEFAULT_SOON_REFRESH_MS,
  prematchLaterMs = DEFAULT_REFRESH_MS,
  prematchUnpricedMs = DEFAULT_UNPRICED_MS,
  tickMs = 5000,
  verbose = true,
  socketFactory = (url, options) => new WebSocket(url, options),
} = {}) {
  const url = `wss://api-gateway.gw-lucky-bet.com/push-server-v2/?Language=${encodeURIComponent(
    config.lang,
  )}&externalPartnerId=${encodeURIComponent(config.partnerId)}&EIO=4&transport=websocket`;

  let ws = null;
  let closed = false;
  let ready = false;
  let sending = false;
  let attempt = 0;
  let timer = null;
  const counts = {
    connect: 0, frames: 0, oddsMessages: 0, infoMessages: 0, subscribedIds: 0,
    snapshots: 0, clockFrames: 0, scoreFrames: 0, subscribeCalls: 0, lastSnapshotAt: null,
    subscribeCallsByGroup: { live: 0, soon: 0, later: 0, unpriced: 0 },
    groupIds: { live: 0, soon: 0, later: 0, unpriced: 0 },
    lastSubscribeAt: null, pauses: 0, resumes: 0, paused: false,
    fullMarketsIds: 0, fullPrematchIds: 0, boostedIds: 0,
  };
  const intervals = {
    live: Number(resubscribeMs) || 0,
    soon: Number(prematchSoonMs) || 0,
    later: Number(prematchLaterMs) || 0,
    unpriced: Number(prematchUnpricedMs) || 0,
  };
  const lastSent = {};

  const subscribeGroups = async (groups = SUBSCRIBE_GROUPS, why = 'tick') => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    let ids;
    try {
      ids = (await getIds?.()) ?? {};
    } catch (e) {
      console.error('[pusher] subscription ids failed:', dbErrorHint(e.message));
      return;
    }

    const live = (ids.live ?? []).map(Number);
    const pendingResults = withoutDuplicates(ids.pendingResults ?? [], live).map(Number);
    const soon = (ids.prematchSoon ?? ids.prematch ?? []).map(Number);
    const later = (ids.prematchLater ?? []).map(Number);
    const unpriced = withoutDuplicates(ids.unpriced ?? [], [...live, ...soon, ...later]).map(Number);

    const send = (messageType, list, isBaseOddsGroups) => {
      for (const part of chunk(list, CHUNK)) {
        const data = { matchIds: part };
        if (messageType === 'subscribe-match-odds') data.isBaseOddsGroups = isBaseOddsGroups;
        ws.send(`42["subscribe",${JSON.stringify({ messageType, data })}]`);
      }
    };

    const at = Date.now();
    const sizeOf = { live: live.length, soon: soon.length, later: later.length, unpriced: unpriced.length };

    for (const group of groups) {
      counts.subscribeCalls++;
      counts.subscribeCallsByGroup[group] = (counts.subscribeCallsByGroup[group] ?? 0) + 1;
      counts.groupIds[group] = sizeOf[group] ?? 0;
      lastSent[group] = at;

      if (group === 'live') {
        // full market list (corners, cards, every total) for a slice of the live list, base
        // markets (1X2 / handicap / total) for the rest. `live` is ordered oldest kickoff
        // first, so taking the tail puts the quota on the matches that just started - the ones
        // a user is most likely to open. Matches the app has opened are always included (`full`).
        const ordered = fullMarketsOrder === 'oldest' ? live : [...live].reverse();
        const boostedLive = new Set((ids.full ?? []).map(Number).filter((id) => live.includes(id)));
        const fullLive = fullMarkets
          ? [...new Set([...ordered.slice(0, fullMarketsLiveLimit), ...boostedLive])]
          : [];
        const fullSet = new Set(fullLive);
        const baseLive = fullMarkets ? live.filter((id) => !fullSet.has(id)) : live;

        send('subscribe-match-odds', fullLive, false);
        send('subscribe-match-odds', baseLive, true);
        send('subscribe-match-info', live);
        // Keep result snapshots flowing for actual tickets after a fixture
        // leaves the visible catalog or falls outside its subscription limit.
        send('subscribe-match-info', pendingResults);
        counts.pendingResultIds = pendingResults.length;
        counts.fullMarketsIds = fullLive.length;
        counts.boostedIds = boostedLive.size;
      } else if (group === 'soon') {
        // Kicks off within PREMATCH_SOON_MIN. FULL markets (corners, cards, all totals) so
        // the detail page shows corners/bookings the moment a user opens it — this is the
        // tier that makes prematch corners visible, at the cost of extra frames. The clock
        // snapshot is sent too, so the minute is right the moment the match goes live.
        send('subscribe-match-odds', soon, false);   // false = FULL markets
        send('subscribe-match-info', soon.slice(0, 25));
        counts.fullPrematchIds = soon.length;
      } else if (group === 'later') {
        // hours away: base markets only (1X2 / handicap / total). Full markets here would
        // multiply the frame traffic for fixtures nobody is betting on yet.
        send('subscribe-match-odds', later, true);   // true = base markets
      } else {
        // no price yet -> the board hides it, so ask again every minute until one arrives
        send('subscribe-match-odds', unpriced, true);
      }
    }

    for (const frame of config.subscribeFrames) ws.send(frame);

    counts.subscribedIds = live.length + soon.length + later.length;
    counts.lastSubscribeAt = new Date(at).toISOString();
    if (verbose) {
      console.log(
        `[pusher] subscribe(${why}) ${groups.join('+')} live=${live.length}` +
          `${groups.includes('soon') ? ` soon=${soon.length}(full)` : ''}` +
          `${groups.includes('later') ? ` later=${later.length}` : ''}` +
          `${groups.includes('unpriced') ? ` unpriced=${unpriced.length}` : ''}`,
      );
    }
  };

  const pump = async () => {
    if (closed || counts.paused || sending || !ready) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const empty = SUBSCRIBE_GROUPS.filter((group) => (counts.groupIds[group] ?? 0) === 0);
    const due = dueGroups({ lastSent, intervals: retryIntervals(intervals, empty) });
    if (!due.length) return;
    sending = true;
    try {
      await subscribeGroups(due, 'tick');
    } catch (e) {
      console.error('[pusher] subscribe failed:', dbErrorHint(e.message));
    } finally {
      sending = false;
    }
  };

  const connect = () => {
    if (closed) return;
    ws = socketFactory(url, { headers: HEADERS, handshakeTimeout: 20000 });

    ws.on('open', () => {
      attempt = 0;
      counts.connect++;
      onStatus?.({ connected: true });
      console.log('[pusher] socket open');
    });

    ws.on('message', (data) => {
      const text = data.toString();

      if (text === '2') {
        ws.send('3');
        return;
      }
      if (text.startsWith('0')) {
        ws.send('40');
        return;
      }
      if (text.startsWith('40')) {
        ready = true;
        subscribeGroups(SUBSCRIBE_GROUPS, 'open');
        clearInterval(timer);
        timer = setInterval(pump, Math.max(1000, Number(tickMs) || 5000));
        return;
      }
      if (!text.startsWith('42')) return;

      counts.frames++;
      const { infos, odds } = decodePushBatch([text]);
      for (const o of odds) {
        counts.oddsMessages++;
        onOdds?.(o.rows);
      }
      for (const i of infos) {
        counts.infoMessages++;
        if (Number.isFinite(i.matchTimeMs)) counts.clockFrames++;
        if (Number.isFinite(i.homeScore)) counts.scoreFrames++;
        if (Number.isFinite(i.matchTimeMs) || Number.isFinite(i.homeScore)) {
          counts.snapshots++;
          counts.lastSnapshotAt = new Date().toISOString();
        }
        onInfo?.(i);
      }
    });

    ws.on('error', (e) => onStatus?.({ connected: false, error: e.message }));
    ws.on('close', () => {
      ready = false;
      clearInterval(timer);
      timer = null;
      onStatus?.({ connected: false });
      if (closed || counts.paused) return;
      const delay = Math.min(30000, 3000 * 2 ** attempt++);
      console.log(`[pusher] closed, reconnecting in ${Math.round(delay / 1000)}s`);
      setTimeout(connect, delay);
    });
  };

  connect();

  return {
    stats: () => ({ ...counts, intervals, lastSent }),
    // A detail-page open must not wait for the hourly prematch subscription.
    // Request only this fixture's complete list, leaving the cheap board tiers intact.
    subscribeFull(matchId) {
      const id = Number(matchId);
      if (!Number.isSafeInteger(id) || id <= 0 || !ready || !ws || ws.readyState !== WebSocket.OPEN) return false;
      const data = { matchIds: [id], isBaseOddsGroups: false };
      ws.send(`42["subscribe",${JSON.stringify({ messageType: 'subscribe-match-odds', data })}]`);
      return true;
    },
    pause() {
      if (counts.paused) return false;
      counts.paused = true;
      counts.pauses++;
      ready = false;
      clearInterval(timer);
      timer = null;
      const socket = ws;
      ws = null;
      try {
        socket?.removeAllListeners();
        socket?.close();
      } catch {}
      onStatus?.({ connected: false, paused: true });
      console.log('[pusher] paused (idle mode)');
      return true;
    },
    resume() {
      if (!counts.paused) return false;
      counts.paused = false;
      counts.resumes++;
      attempt = 0;
      console.log('[pusher] resuming (a visitor is back)');
      connect();
      return true;
    },
    close() {
      closed = true;
      clearInterval(timer);
      timer = null;
      try {
        ws?.close();
      } catch {}
    },
  };
}
