/** Anonymous public football transport. It never requests account, chat or private channels. */
export const YBETS_API = 'https://sportsbook.ybets.net/api/v2/';
export const YBETS_SOCKET = 'wss://sportsbook.ybets.net/internal/ws/v2/connection/websocket';
const positiveId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const delay = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason ?? new Error('Request aborted'));
  const abort = () => { clearTimeout(timer); reject(signal.reason ?? new Error('Request aborted')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});

export class YbetsHttpClient {
  constructor({ fetchImpl = globalThis.fetch, baseUrl = YBETS_API, timeoutMs = 15000, retries = 2, retryDelayMs = 400, maxPages = 2000 } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Node.js 22 or newer is required');
    this.fetch = fetchImpl;
    this.baseUrl = String(baseUrl).replace(/\/?$/, '/');
    this.timeoutMs = Math.max(100, Number(timeoutMs) || 15000);
    this.retries = Math.max(0, Math.min(5, Number(retries) || 0));
    this.retryDelayMs = Math.max(0, Number(retryDelayMs) || 0);
    this.maxPages = Math.max(1, Number(maxPages) || 2000);
  }

  async request(relativePath, { signal, method = 'GET', body } = {}) {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const forwardAbort = () => controller.abort(signal.reason);
      if (signal?.aborted) throw signal.reason ?? new Error('Request aborted');
      signal?.addEventListener('abort', forwardAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error('Public API timeout')), this.timeoutMs);
      let retryable = true;
      try {
        const response = await this.fetch(new URL(relativePath, this.baseUrl), {
          method, signal: controller.signal,
          headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (!response.ok) {
          retryable = response.status === 429 || response.status >= 500;
          // Do not include response bodies, URLs containing tokens, or provider messages in errors.
          throw new Error(`Public football API HTTP ${Number(response.status)}`);
        }
        const value = await response.json();
        if (value === null || typeof value !== 'object') throw new Error('Invalid public API response');
        return value;
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? new Error('Request aborted');
        if (!retryable || attempt >= this.retries) {
          if (/^Public football API HTTP \d+$/.test(String(error?.message))) throw error;
          throw new Error('Public football API request failed');
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', forwardAbort);
      }
      await delay(this.retryDelayMs * 2 ** attempt, signal);
    }
  }

  async pages(path, params, { signal, identity = row => String(row.id) } = {}) {
    const collected = new Map();
    let page = 1;
    for (;;) {
      const query = new URLSearchParams({ ...params, limit: '500', page: String(page) });
      const result = await this.request(`${path}?${query}`, { signal });
      if (!Array.isArray(result.data)) throw new Error('Invalid public API page');
      const pagination = result.pagination;
      const last = Number(pagination?.last_page);
      if (!pagination || !Number.isInteger(last) || last < 0 || last > this.maxPages ||
          Number(pagination.page) !== page || !Number.isFinite(Number(pagination.total)) || Number(pagination.total) < 0) {
        throw new Error('Invalid public API pagination');
      }
      if (result.data.length === 0 && page < last) throw new Error('Incomplete public API pagination');
      for (const row of result.data) {
        if (!row || typeof row !== 'object' || !positiveId(row.id)) throw new Error('Invalid public API item');
        collected.set(identity(row), row);
      }
      if (page >= last) break;
      if (++page > this.maxPages) throw new Error('Public API pagination exceeded limit');
    }
    return [...collected.values()];
  }

  /** Returns all pages as an array. Status 0=prematch, 1=live; terminal statuses must be requested explicitly. */
  listMatches({ status, bettable = true, signal } = {}) {
    if (![0, 1, 2, 3, 4, 5].includes(Number(status))) throw new Error('Invalid football status');
    return this.pages('matches', {
      sport_key: 'soccer', type: 'match', match_status: String(status), ...(bettable ? { bettable: 'true' } : {}),
    }, { signal });
  }

  async getMatch(id, { signal } = {}) {
    if (!positiveId(id)) throw new Error('Invalid football match ID');
    const value = await this.request(`matches/${Number(id)}`, { signal });
    if (Number(value.id) !== Number(id)) throw new Error('Public API match identity mismatch');
    return value;
  }

  /** A market ID repeats for separate lines. Preserve its complete specifier in the identity. */
  getMarkets(id, { signal } = {}) {
    if (!positiveId(id)) throw new Error('Invalid football match ID');
    return this.pages(`matches/${Number(id)}/markets`, {}, {
      signal, identity: market => `${market.id}|${String(market.specifier ?? '')}`,
    });
  }

  async getToken({ signal } = {}) {
    const value = await this.request('websocket/token', { method: 'POST', body: {}, signal });
    if (typeof value.token !== 'string' || !value.token) throw new Error('Public socket token unavailable');
    return value.token; // Keep transiently in memory; callers must not archive this response.
  }
}

const EVENTS = new Set(['match_changed', 'markets_changed', 'match_status_changed']);
const invoke = (callback, value, onError = () => {}) => {
  try { Promise.resolve(callback?.(value)).catch(onError); } catch { onError(); }
};

export class YbetsSocket {
  constructor({ http = new YbetsHttpClient(), WebSocketImpl = globalThis.WebSocket,
    socketUrl = YBETS_SOCKET, onEvent, onStatus, onResync, reconnectMs = 1500,
    commandTimeoutMs = 12000, maxSubscriptions = 2000 } = {}) {
    if (typeof WebSocketImpl !== 'function') throw new Error('Node.js 22 or newer is required for the public socket');
    this.http = http; this.WebSocket = WebSocketImpl; this.socketUrl = socketUrl;
    this.onEvent = onEvent; this.onStatus = onStatus; this.onResync = onResync;
    this.reconnectMs = Math.max(10, Number(reconnectMs) || 1500);
    this.commandTimeoutMs = Math.max(50, Number(commandTimeoutMs) || 12000);
    this.maxSubscriptions = Math.max(1, Number(maxSubscriptions) || 2000);
    this.state = { connected: false, connecting: false, connections: 0, frames: 0, events: 0, subscribed: 0, reconnects: 0, lastEventAt: null, lastError: null };
    this.ids = new Set(); this.subscribed = new Set(); this.pending = new Map();
    this.sequence = 0; this.generation = 0; this.running = false; this.failures = 0;
  }

  status(patch) { Object.assign(this.state, patch); invoke(this.onStatus, { ...this.state }); }

  /** Starts transport. A failed initial connection is reported and retried without leaking credentials. */
  async start() {
    if (this.running) return;
    this.running = true;
    await this.connect();
  }

  setMatchIds(ids = []) {
    const next = new Set();
    for (const id of ids) {
      if (positiveId(id)) next.add(Number(id));
      if (next.size >= this.maxSubscriptions) break;
    }
    this.ids = next;
    if (this.state.connected) this.syncSubscriptions().catch(() => this.restart('Public socket subscription failed'));
  }

  wantedChannels() { return new Set(['public:en.updates', ...[...this.ids].map(id => `public:en.updates.match.${id}`)]); }

  async connect() {
    if (!this.running || this.state.connecting || this.state.connected) return;
    const generation = ++this.generation;
    this.status({ connecting: true, lastError: null });
    this.connectionAbort = new AbortController();
    try {
      let token = await this.http.getToken({ signal: this.connectionAbort.signal });
      if (!this.running || generation !== this.generation) return;
      const ws = this.ws = new this.WebSocket(this.socketUrl);
      ws.addEventListener('message', event => {
        if (generation !== this.generation) return;
        const data = event.data;
        if (typeof data === 'string') this.receive(data);
        else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) this.receive(new TextDecoder().decode(data));
        else if (typeof data?.text === 'function') data.text().then(text => { if (generation === this.generation) this.receive(text); });
      });
      ws.addEventListener('close', () => { if (generation === this.generation) this.restart('Public socket disconnected'); });
      ws.addEventListener('error', () => { if (generation === this.generation) this.restart('Public socket connection failed'); });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Public socket opening timeout')), this.commandTimeoutMs);
        ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
        ws.addEventListener('close', () => { clearTimeout(timer); reject(new Error('Public socket closed')); }, { once: true });
        ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Public socket failed')); }, { once: true });
      });
      if (generation !== this.generation || !this.running) return;
      const connected = await this.command('connect', { token });
      token = null;
      if (generation !== this.generation || !this.running) return;
      this.failures = 0;
      this.status({ connected: true, connecting: false, connections: this.state.connections + 1, lastError: null });
      this.lastFrameAt = Date.now();
      const pingSeconds = Number(connected.ping);
      if (pingSeconds > 0) {
        const timeout = (pingSeconds + 10) * 1000;
        this.watchdog = setInterval(() => { if (Date.now() - this.lastFrameAt > timeout) this.restart('Public socket heartbeat timeout'); }, Math.min(timeout, 10000));
        this.watchdog.unref?.();
      }
      if (connected.expires && Number(connected.ttl) > 0) this.armRefresh(Number(connected.ttl));
      await this.syncSubscriptions();
      if (generation === this.generation && this.running) invoke(this.onResync, { reconnect: this.state.connections > 1 }, () => this.status({ lastError: 'Public football snapshot refresh failed' }));
    } catch {
      if (generation === this.generation && this.running) this.restart('Public socket connection failed');
    }
  }

  command(method, payload) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Public socket command timeout')); }, this.commandTimeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, [method]: payload })); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error('Public socket send failed')); }
    });
  }

  async syncSubscriptions() {
    if (this.syncing) { this.syncAgain = true; return; }
    this.syncing = true;
    const generation = this.generation;
    try {
      do {
        this.syncAgain = false;
        const wanted = this.wantedChannels();
        for (const channel of [...this.subscribed]) {
          if (wanted.has(channel)) continue;
          await this.command('unsubscribe', { channel });
          if (generation !== this.generation) return;
          this.subscribed.delete(channel);
        }
        for (const channel of wanted) {
          if (this.subscribed.has(channel)) continue;
          await this.command('subscribe', { channel });
          if (generation !== this.generation) return;
          this.subscribed.add(channel);
        }
      } while (this.syncAgain && this.state.connected && generation === this.generation);
      this.status({ subscribed: this.subscribed.size });
    } finally { this.syncing = false; }
  }

  receive(text) {
    this.lastFrameAt = Date.now();
    for (const line of String(text).split('\n')) {
      if (!line.trim()) continue;
      let packet;
      try { packet = JSON.parse(line); } catch { this.restart('Invalid public socket frame'); return; }
      this.state.frames++;
      if (!packet || typeof packet !== 'object' || Array.isArray(packet)) continue;
      if (!Object.keys(packet).length) { try { this.ws?.send('{}'); } catch {} continue; }
      const pending = this.pending.get(packet.id);
      if (pending) {
        clearTimeout(pending.timer); this.pending.delete(packet.id);
        if (packet.error) pending.reject(new Error(`Public socket command rejected (${Number(packet.error.code) || 0})`));
        else pending.resolve(packet[pending.method] ?? {});
      }
      if (packet.push?.disconnect) { this.restart('Public socket server disconnect'); return; }
      const push = packet.push;
      if (push?.unsubscribe) { this.restart('Public socket subscription interrupted'); return; }
      if (!push?.pub || !this.wantedChannels().has(push.channel)) continue;
      const event = push.pub.data;
      if (!EVENTS.has(event?.event_name) || !event.message || typeof event.message !== 'object') continue;
      const receivedAt = new Date().toISOString();
      this.state.events++; this.state.lastEventAt = receivedAt;
      invoke(this.onEvent, { eventName: event.event_name, message: event.message, channel: push.channel, receivedAt }, () => this.status({ lastError: 'Public football event processing failed' }));
    }
  }

  armRefresh(ttl) {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(async () => {
      const generation = this.generation;
      try {
        const token = await this.http.getToken({ signal: this.connectionAbort?.signal });
        if (generation !== this.generation || !this.running) return;
        const reply = await this.command('refresh', { token });
        if (generation === this.generation && reply.expires && Number(reply.ttl) > 0) this.armRefresh(Number(reply.ttl));
      } catch { if (generation === this.generation) this.restart('Public socket refresh failed'); }
    }, Math.max(1000, (ttl - Math.min(30, ttl / 5)) * 1000));
    this.refreshTimer.unref?.();
  }

  cleanup() {
    this.generation++;
    this.connectionAbort?.abort();
    clearInterval(this.watchdog); clearTimeout(this.refreshTimer); clearTimeout(this.reconnectTimer);
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error('Public socket disconnected')); }
    this.pending.clear(); this.subscribed.clear(); this.syncAgain = false;
    const ws = this.ws; this.ws = null;
    try { ws?.close(); } catch {}
  }

  restart(reason) {
    if (!this.running) return;
    this.cleanup();
    this.status({ connected: false, connecting: false, subscribed: 0, reconnects: this.state.reconnects + 1, lastError: reason });
    const wait = Math.min(60000, this.reconnectMs * 2 ** Math.min(this.failures++, 5));
    this.reconnectTimer = setTimeout(() => this.connect(), wait);
    this.reconnectTimer.unref?.();
  }

  stop() {
    this.running = false; this.cleanup();
    this.status({ connected: false, connecting: false, subscribed: 0 });
  }
}
