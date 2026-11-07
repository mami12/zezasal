// Play'n GO — Book of Dead protocol adapter (demo + real wallet).
//
// Mirrors the Book of Ra Deluxe adapter (`bookofra.mjs`) because the two games
// share the same public protocol shape: `init`, `spin`, `initfreespin`,
// `freespin`, `collect`, `get_double`, `set_double`.
//
// If your `www.playngo.com` folder contains a different title, copy this file
// to `playngo-<slug>.mjs` and only swap the engine import; the router shape
// stays the same.
import { Router, raw } from 'express';
import jwt from 'jsonwebtoken';
import { randomInt, randomBytes, randomUUID, createHash } from 'node:crypto';
import { config } from '../config.mjs';
import { requireAuth } from '../ledger/auth.mjs';
import { getUserById, isLedgerReady } from '../ledger/store.mjs';
import { query } from '../db.mjs';
import {
  LINES, PAYTABLE, SCATTER_PAY, FREE_SPINS, BET_OPTIONS, DENOMINATIONS,
  randomGrid, gradeGrid, pickMudSymbol, symbolMatrix,
} from './playngo-bookofdead-engine.mjs';
import { CASINO_MIN_STAKE, walletPixiRanges } from './bet-limits.mjs';

const money = v => Number(Number(v).toFixed(2));

// ---------------------------------------------------------------- helpers ---

export function decodeRequest(req) {
  if (req.body && !Buffer.isBuffer(req.body) && typeof req.body === 'object') {
    return typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body;
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (req.body || '');
  const ctype = String(req.headers['content-type'] ?? '').toLowerCase();
  if (ctype.includes('multipart/form-data')) {
    const m = /(?:^|\r?\n)Content-Disposition:\s*form-data;\s*name="data"[^\r\n]*\r?\n(?:Content-Type:[^\r\n]*\r?\n)?\r?\n([\s\S]*?)\r?\n--/i.exec(rawBody);
    if (!m) throw new Error('Missing multipart data field');
    return JSON.parse(m[1]);
  }
  if (ctype.includes('application/x-www-form-urlencoded')) {
    return JSON.parse(new URLSearchParams(rawBody).get('data') ?? '{}');
  }
  if (rawBody) {
    const parsed = JSON.parse(rawBody);
    return typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed;
  }
  return {};
}

export function initResponse({ credits, requestId = 1, walletLimits = false }) {
  const grid = randomGrid();
  return {
    balance: { before: money(credits), after: money(credits) },
    denomination: walletLimits ? CASINO_MIN_STAKE / LINES.length : 1,
    available_actions: ['spin'],
    init: {
      bet: '1', lines: LINES.length, multiplier: 1, currency: 'EUR',
      restorestate: false, next_request_id: requestId,
      ranges: walletLimits ? walletPixiRanges(LINES.length) : {
        bet: Object.fromEntries(Object.values(DENOMINATIONS).map(v => [v, [...BET_OPTIONS]])),
        denomination: DENOMINATIONS,
      },
      directory: {
        lines: LINES.map(row => Object.fromEntries(row.map((pos, i) => [i, pos]))),
        available_lines_count: Array.from({ length: LINES.length }, (_, i) => i + 1),
        paytable: PAYTABLE,
      },
      start_symbols: symbolMatrix(grid),
      collect: 1,
      extra: { symbol_types: { scatters: [0], wilds: [0] } },
    },
  };
}

export function spinResponse({ credits, stake, payout, bet, lines, grid, grading, requestId, free }) {
  const total = money(payout).toFixed(2);
  const body = {
    balance: { before: money(credits), after: money(money(credits) - stake) },
    denomination: 1,
    macro_round: { wins: { total } },
    available_actions: payout > 0 ? ['collect', 'gamble', 'spin'] : ['spin'],
    spin: {
      bet, lines, multiplier: 1, next_multiplier: 1, next_request_id: requestId + 1,
      type: 'spin', symbols: symbolMatrix(grid),
      wins: { line_wins: grading.line_wins, total },
    },
  };
  if (free) body.spin.freespins = free;
  return body;
}

export function freespinResponse({ credits, payout, bet, lines, grid, grading, left, done, mud, requestId }) {
  const total = money(payout).toFixed(2);
  const freespins = { left, done, add: 0, mud, wins: { total, win_before_chain: 0 }, type: 'freespins' };
  return {
    balance: { before: money(credits), after: money(credits) },
    denomination: 1,
    available_actions: left > 0 ? ['freespin'] : ['collect'],
    spin: {
      bet, lines, multiplier: 1, next_multiplier: 1,
      type: 'freespin', next_request_id: (Number(requestId) || 0) + 1,
      symbols: symbolMatrix(grid),
      wins: { line_wins: grading.line_wins, total: money(grading.total).toFixed(2) },
      freespins,
    },
    freespins,
  };
}

// ----------------------------------------------------------------- demo ----

const SESSION_COOKIE = 'playngo_bookofdead_demo_session';
const SESSION_TTL = 4 * 3600 * 1000;
const MAX_SESSIONS = 2000;
const DEFAULT_BALANCE = 100_000;
const sessions = new Map();

function getSession(req, res) {
  const cookie = /(?:^|;\s*)playngo_bookofdead_demo_session=([a-f0-9-]{36})/.exec(String(req.headers.cookie || ''))?.[1];
  let id = cookie;
  if (!id) {
    id = randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}`);
  }
  let state = sessions.get(id);
  if (!state) {
    state = { credits: DEFAULT_BALANCE, pending: 0, free: null, requestId: 1, lastRequestId: null, lastResponse: null };
    sessions.set(id, state);
    if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  }
  return state;
}

export function createPlayNGoDemoRouter() {
  const router = Router();
  router.post('/play', raw({ type: () => true, limit: '128kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const state = getSession(req, res);
      const request = decodeRequest(req);
      const action = String(request.action ?? 'init');
      const requestId = request.request_id == null ? null : String(request.request_id);
      if (requestId && requestId === state.lastRequestId && state.lastResponse) return res.json(state.lastResponse);
      if (requestId != null && (!/^\d+$/.test(requestId) || Number(requestId) > 1e9)) {
        return res.status(400).json({ error: 'INVALID_REQUEST_ID' });
      }
      let response;
      switch (action) {
        case 'init':
          state.free = null; state.pending = 0;
          response = initResponse({ credits: state.credits, requestId: state.requestId });
          break;
        case 'spin': {
          if (state.pending > 0) {
            response = { ...initResponse({ credits: state.credits, requestId: state.requestId }), available_actions: ['collect', 'gamble'] };
            break;
          }
          const bet = Number(request.bet), lines = Number(request.lines), den = Number(request.denomination ?? 1);
          if (!BET_OPTIONS.includes(bet) || lines !== LINES.length || !Object.values(DENOMINATIONS).includes(den)) {
            throw new Error('Invalid Play\'n GO bet / lines / denomination');
          }
          const stake = money(bet * lines * den);
          if (state.credits < stake) {
            response = { ...initResponse({ credits: state.credits, requestId: state.requestId }), error: 'INSUFFICIENT_DEMO_CREDITS' };
            break;
          }
          const grid = randomGrid();
          const graded = gradeGrid(grid, bet, lines);
          state.credits = money(state.credits - stake);
          state.pending = graded.total;
          const books = grid.flat().filter(s => s === 0).length;
          let free = null;
          if (books >= 3 && process.env.PLAY_NGO_FREE_SPINS === '1') {
            const mud = pickMudSymbol();
            state.free = { left: FREE_SPINS, done: 0, mud };
            free = { left: FREE_SPINS, done: 0, add: 0, mud, wins: { total: 0, win_before_chain: 0 }, type: 'freespins' };
          }
          response = spinResponse({ credits: state.credits + stake, stake, payout: graded.total, bet,
            lines, grid, grading: graded, requestId: state.requestId, free });
          if (free) response.available_actions = ['initfreespin'];
          break;
        }
        case 'initfreespin': {
          if (!state.free) { response = initResponse({ credits: state.credits, requestId: state.requestId }); break; }
          const grid = randomGrid();
          response = {
            ...initResponse({ credits: state.credits, requestId: state.requestId }),
            available_actions: ['freespin'],
            initfreespin: {
              symbols: symbolMatrix(grid),
              freespins: { left: state.free.left, done: state.free.done, add: 0, mud: state.free.mud,
                wins: { total: state.pending, win_before_chain: 0 }, type: 'freespins' },
            },
          };
          break;
        }
        case 'freespin': {
          if (!state.free) { response = initResponse({ credits: state.credits, requestId: state.requestId }); break; }
          const grid = randomGrid();
          const graded = gradeGrid(grid, 1, LINES.length, state.free.mud);
          state.free.left -= 1;
          state.free.done += 1;
          state.pending = money(state.pending + graded.total);
          response = freespinResponse({ credits: state.credits, payout: state.pending, bet: 1, lines: LINES.length,
            grid, grading: graded, left: state.free.left, done: state.free.done, mud: state.free.mud,
            requestId: Number(requestId) || 0 });
          if (state.free.left <= 0) state.free = null;
          break;
        }
        case 'collect': {
          const collected = state.pending;
          state.credits = money(state.credits + collected);
          state.pending = 0; state.free = null;
          response = { balance: { before: money(state.credits - collected), after: money(state.credits) },
            denomination: 1, available_actions: ['spin'], collect: { total: money(collected).toFixed(2) } };
          break;
        }
        default:
          return res.status(400).json({ error: 'INVALID_ACTION' });
      }
      state.requestId += 1;
      if (response.init) response.init.next_request_id = state.requestId;
      if (response.spin) response.spin.next_request_id = state.requestId;
      if (requestId) { state.lastRequestId = requestId; state.lastResponse = response; }
      return res.json(response);
    } catch (e) {
      console.warn('[playngo-demo] invalid demo request:', e.message);
      return res.status(400).json({ error: 'INVALID_DEMO_REQUEST' });
    }
  });
  router.get('/status', (_req, res) => res.json({
    mode: 'DEMO', realMoney: false, frontend: 'playngo-client', backend: 'local-node-demo',
  }));
  return router;
}

// ------------------------------------------------------------ real wallet ---

const WALLET_COOKIE = 'casino_playngo_bookofdead_session';
const WALLET_TTL = 60 * 60 * 2;

const cookieValue = req => String(req.headers.cookie || '').split(';').map(s => s.trim())
  .find(s => s.startsWith(WALLET_COOKIE + '='))?.slice(WALLET_COOKIE.length + 1);
const fault = (status, message) => Object.assign(new Error(message), { status });
const deny = (res, error, action = 'unknown') => {
  const status = Number(error?.status) || 500;
  const message = status >= 500 ? 'CASINO_SERVICE_ERROR' : String(error.message || 'CASINO_REQUEST_REJECTED');
  if (status >= 500) console.error('[casino playngo] failed action=' + action, error);
  else console.warn('[casino playngo] rejected action=' + action + ' status=' + status + ' code=' + message);
  return res.status(status < 500 ? 200 : status).json({ error: { code: status, message } });
};

function uuidFromId(nonce, requestId) {
  const h = createHash('sha256').update(nonce + ':' + requestId).digest();
  h[6] = (h[6] & 0x0f) | 0x40; h[8] = (h[8] & 0x3f) | 0x80;
  const a = h.toString('hex').slice(0, 32);
  return [a.slice(0, 8), a.slice(8, 12), a.slice(12, 16), a.slice(16, 20), a.slice(20)].join('-');
}

export function createPlayNGoRealRouter(dependencies = {}) {
  const router = Router();
  router.post('/play', raw({ type: () => true, limit: '128kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let action = 'unknown';
    try {
      const ledger = await import('../ledger/store.mjs');
      const wallet = await import('./transactions.mjs');
      const gamble = await import('./gamble.mjs');
      const getUser = dependencies.getUserById ?? ledger.getUserById;
      const ready = dependencies.isLedgerReady ?? ledger.isLedgerReady;
      const settlePendingWin = dependencies.settlePendingWin ?? wallet.settlePendingWin;
      const casinoGambleAction = dependencies.casinoGambleAction ?? gamble.casinoGambleAction;
      if (!ready()) throw fault(503, 'LEDGER_UNAVAILABLE');
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (origin.host !== req.headers.host) throw fault(403, 'CROSS_ORIGIN_DENIED');
      }
      const token = cookieValue(req);
      if (!token) throw fault(401, 'CASINO_SESSION_REQUIRED');
      let claim;
      try { claim = jwt.verify(token, config.jwtSecret); } catch { throw fault(401, 'CASINO_SESSION_EXPIRED'); }
      if (claim.kind !== 'casino-playngo-wallet' || typeof claim.jti !== 'string') throw fault(401, 'CASINO_SESSION_INVALID');
      const user = await getUser(claim.sub);
      if (!user || user.role !== 'PLAYER' || user.status !== 'ACTIVE') throw fault(403, 'PLAYER_BLOCKED');
      if (Number(claim.epoch ?? 0) !== Number(user.financialEpoch ?? user.financial_epoch ?? 0)) throw fault(401, 'CASINO_SESSION_EXPIRED');
      const request = decodeRequest(req);
      action = String(request.action || 'init');
      const rawId = request.request_id;
      const id = rawId == null ? null : Number(rawId);
      if (rawId != null && (!Number.isSafeInteger(id) || id < 0 || id > 1e9)) throw fault(400, 'INVALID_REQUEST_ID');

      if (action === 'init') {
        await settlePendingWin(user.id);
        const fresh = await getUser(user.id);
        const init = initResponse({ credits: Number(fresh?.balance ?? user.balance), requestId: id == null ? 1 : id + 1, walletLimits: true });
        init.init.currency = 'LEK';
        return res.json(init);
      }
      if (action === 'spin' || action === 'freespin') {
        if (id == null) throw fault(400, 'SPIN_REQUEST_ID_REQUIRED');
        const place = dependencies.placePlayNGoSpin ?? wallet.placePlayNGoSpin;
        if (typeof place !== 'function') throw fault(500, 'PLAYER_WALLET_NOT_READY');
        const bet = Number(request.bet ?? 1), lines = Number(request.lines ?? LINES.length);
        const denomination = Number(request.denomination ?? 1);
        const round = await place({ userId: user.id, requestId: uuidFromId(claim.jti, id),
          bet, denomination, lines, mathVersion: claim.mathVersion });
        if (action === 'freespin') {
          // Free spins do not debit the player again; the pending win already
          // includes any earlier balance. The shared helper recorded the spin.
          const grid = round.result?.symbols ? null : randomGrid();
          const graded = round.result?.line_wins ? { total: round.payout, line_wins: round.result.line_wins } : gradeGrid(grid, bet, lines);
          const free = round.result?.free ?? { left: 0, done: 0, mud: null };
          return res.json(freespinResponse({
            credits: round.balance, payout: round.payout, bet, lines,
            grid: grid ?? randomGrid(), grading: graded,
            left: free.left, done: free.done, mud: free.mud, requestId: id,
          }));
        }
        // Regular spin: rebuild the grid for the response from result.symbols
        const matrix = round.result?.symbols;
        const grid = matrix
          ? Object.keys(matrix).sort((a,b)=>a-b).map(col =>
              Object.keys(matrix[col]).sort((a,b)=>a-b).map(row => matrix[col][row].code))
          : randomGrid();
        const graded = { total: round.payout, line_wins: round.result?.line_wins ?? [] };
        const free = round.result?.free;
        const freeFlag = free?.trigger
          ? { left: free.left, done: free.done, add: 0, mud: free.mud,
              wins: { total: 0, win_before_chain: 0 }, type: 'freespins' }
          : null;
        const body = spinResponse({
          credits: round.balance + round.stake, stake: round.stake, payout: round.payout,
          bet, lines, grid, grading, requestId: id, free: freeFlag,
        });
        if (freeFlag) body.available_actions = ['initfreespin'];
        return res.json(body);
      }
      if (action === 'collect' || action === 'get_double' || action === 'set_double') {
        if (id == null) throw fault(400, 'ACTION_REQUEST_ID_REQUIRED');
        const reply = await casinoGambleAction({
          userId: user.id, requestId: uuidFromId(claim.jti, id), action, choice: request.choice,
        });
        return res.json(reply);
      }
      throw fault(400, 'INVALID_ACTION');
    } catch (error) { deny(res, error, action); }
  });
  return router;
}

export function createPlayNGoSessionRouter(dependencies = {}) {
  const router = Router();
  router.post('/casino/playngo-bookofdead/session', dependencies.auth ?? requireAuth, async (req, res) => {
    try {
      if (req.user.role !== 'PLAYER' || req.user.status !== 'ACTIVE') throw fault(403, 'PLAYER_BLOCKED');
      const { rows } = await (dependencies.runQuery ?? query)('select enabled,game_profiles,game_controls from app_casino_settings where id=1');
      if (!rows[0]?.enabled) throw fault(403, 'CASINO_DISABLED');
      const { assertCasinoMathAcknowledged } = await import('./casino-controls.mjs');
      const mathVersion = assertCasinoMathAcknowledged('playngo', rows[0], req.body?.mathVersion);
      const claim = { sub: req.user.id, jti: randomUUID(), kind: 'casino-playngo-wallet', mathVersion, epoch: Number(req.user.financialEpoch ?? 0) };
      const token = jwt.sign(claim, config.jwtSecret, { expiresIn: WALLET_TTL });
      res.cookie(WALLET_COOKIE, token, {
        httpOnly: true, sameSite: 'strict', secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
        path: '/app/api/casino/playngo-bookofdead/real', maxAge: WALLET_TTL * 1000,
      });
      res.set('Cache-Control', 'no-store');
      res.json({ ready: true, gameUrl: '/app/casino-original/playngo-bookofdead/index-real.html', expiresIn: WALLET_TTL, mathVersion });
    } catch (error) { deny(res, error); }
  });
  return router;
}
export const casinoPlayNGoSessionRouter = createPlayNGoSessionRouter();
