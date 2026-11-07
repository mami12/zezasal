export const FEED_LIVE = 'live';
export const FEED_IDLE = 'idle';
export const FEED_WAKING = 'waking';

let mode = FEED_LIVE;

export const getFeedMode = () => mode;

export function setFeedMode(next) {
  if ([FEED_LIVE, FEED_IDLE, FEED_WAKING].includes(next)) mode = next;
  return mode;
}

export const feedIsRefreshing = () => mode !== FEED_LIVE;
export const feedIsStopped = () => mode === FEED_IDLE;

export function shouldSleep({
  mode: current = FEED_LIVE,
  clients = 0,
  visits = 0,
  lastActivityAt = 0,
  now = Date.now(),
  idleAfterMs = 0,
  coldBootIdleMs = 0,
} = {}) {
  if (current !== FEED_LIVE || clients > 0) return false;
  const wait = Number(visits) > 0 ? Number(idleAfterMs) : Number(coldBootIdleMs);
  return Number.isFinite(wait) && wait > 0 && now - Number(lastActivityAt) >= wait;
}

export function shouldWake({ mode: current = FEED_LIVE, requested = false, clients = 0 } = {}) {
  return current === FEED_IDLE && (requested === true || clients > 0);
}

export function createIdleMonitor({
  enabled = true,
  idleAfterMs = 60_000,
  coldBootIdleMs = 60_000,
  tickMs = 5_000,
  onIdle,
  onWake,
  onMode,
  log = console,
} = {}) {
  const state = { clients: 0, visits: 0, lastActivityAt: Date.now(), idleSince: null, sleeps: 0, wakes: 0 };
  let timer = null;

  const snapshot = () => ({
    enabled: enabled === true,
    mode,
    clients: state.clients,
    visits: state.visits,
    idleAfterMs: Number(idleAfterMs) || 0,
    coldBootIdleMs: Number(coldBootIdleMs) || 0,
    lastActivityAt: new Date(state.lastActivityAt).toISOString(),
    idleSince: state.idleSince,
    sleeps: state.sleeps,
    wakes: state.wakes,
  });
  const publish = () => {
    try { onMode?.(snapshot()); }
    catch (error) { log.error?.('[idle] state publish failed:', error?.message ?? error); }
  };
  const wake = (why) => {
    if (!shouldWake({ mode, requested: true, clients: state.clients })) return false;
    setFeedMode(FEED_WAKING);
    state.wakes++;
    state.idleSince = null;
    log.log?.(`[idle] ${why}; resuming odds feed`);
    try { onWake?.(); }
    catch (error) { log.error?.('[idle] wake failed:', error?.message ?? error); }
    publish();
    return true;
  };
  const goIdle = () => {
    if (mode !== FEED_LIVE) return false;
    setFeedMode(FEED_IDLE);
    state.idleSince = new Date().toISOString();
    state.sleeps++;
    log.log?.(`[idle] no active visitors for ${Math.round((Number(idleAfterMs) || 0) / 1000)}s; pausing odds feed`);
    try { onIdle?.(); }
    catch (error) { log.error?.('[idle] pause failed:', error?.message ?? error); }
    publish();
    return true;
  };
  const evaluate = () => enabled === true && shouldSleep({
    mode,
    clients: state.clients,
    visits: state.visits,
    lastActivityAt: state.lastActivityAt,
    idleAfterMs,
    coldBootIdleMs,
  }) ? goIdle() : false;

  return {
    state: snapshot,
    touch() {
      state.lastActivityAt = Date.now();
      return wake('app request');
    },
    clientOpen() {
      state.clients++;
      state.visits++;
      state.lastActivityAt = Date.now();
      return wake('visitor connected');
    },
    clientClose() {
      state.clients = Math.max(0, state.clients - 1);
      state.lastActivityAt = Date.now();
      publish();
      return snapshot();
    },
    evaluate,
    start() {
      if (timer || enabled !== true) return false;
      timer = setInterval(evaluate, Math.max(1_000, Number(tickMs) || 5_000));
      timer.unref?.();
      return true;
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    markLive() {
      if (mode !== FEED_WAKING) return false;
      setFeedMode(FEED_LIVE);
      state.lastActivityAt = Date.now();
      publish();
      return true;
    },
  };
}
