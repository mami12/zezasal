/**
 * Same-origin Sizzling Hot Deluxe protocol adapter for the ORIGINAL
 * mami12/New-folder Pixi/Spine browser client.
 *
 * The actual graphics, audio, animation and UI logic run in the supplied
 * Novomatic browser bundle. This adapter handles init/spin/collect/gamble
 * JSON and only virtual DEMO credits. It never touches app users, wallets,
 * ticket tables, real payment routes, or the legacy Goldsvet PHP backend.
 */
import { Router, raw } from 'express';
import { randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {CASINO_MIN_STAKE,walletPixiRanges} from './bet-limits.mjs';

const SESSION_COOKIE = 'sizzling_demo_session';
const SESSION_TTL = 4 * 3600 * 1000;
const MAX_SESSIONS = 2000;
const DEFAULT_BALANCE = 100_000; // 100,000 DEMO credits (the original cabinet)
const LINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
];
// Symbol mapping is from the original client's atlas, not visual guesses.
// 0=Star scatter, 1=7, 2=Watermelon, 3=Grapes, 4=Plum,
// 5=Orange, 6=Lemon, 7=Cherry.
const PAYTABLE = {
  0: { 3: 2, 4: 10, 5: 50 }, // scatter, multiplies total bet
  1: { 3: 100, 4: 1000, 5: 5000 },
  2: { 3: 50, 4: 200, 5: 500 },
  3: { 3: 50, 4: 200, 5: 500 },
  4: { 3: 20, 4: 50, 5: 200 },
  5: { 3: 20, 4: 50, 5: 200 },
  6: { 3: 20, 4: 50, 5: 200 },
  7: { 2: 2, 3: 5, 4: 20, 5: 50 }, // cherry (original Novomatic paytable)
};
const BET_OPTIONS = [1, 2, 3, 5, 10, 20, 30, 50, 100];
const DENOMINATIONS = { 0: .5, 1: 1, 2: 2, 3: 5, 4: 10 };

function loadReels() {
  const text = readFileSync(fileURLToPath(new URL('./sizzling-reels.txt', import.meta.url)), 'utf8');
  const reelMap = new Map();
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    reelMap.set(line.slice(0, idx), line.slice(idx + 1).split(',').map(s => s.trim()).filter(Boolean));
  }
  return Array.from({ length: 5 }, (_, i) => {
    const tokens = reelMap.get('reelStrip' + (i + 1));
    if (!tokens || tokens.length < 30) throw new Error('Missing Goldsvet reelStrip' + (i + 1));
    return tokens.map(token => {
      if (token === 'SCAT') return 0;
      if (!/^P_[1-7]$/.test(token)) throw new Error('Invalid reel token: ' + token);
      return Number(token.slice(2));
    });
  });
}
export const REELS = loadReels();
export const paytable = PAYTABLE;
export const paylines = LINES;

const money = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const balance = session => money(session.credits);
const cell = code => ({ code });
export const symbolMatrix = grid => Object.fromEntries(grid.map((reel, col) =>
  [col, Object.fromEntries(reel.map((code, row) => [row, cell(code)]))]));

export function randomGrid(randomStop = (length => randomInt(length)), reels = REELS) {
  return reels.map(reel => {
    const pos = randomStop(reel.length);
    if (!Number.isInteger(pos) || pos < 0 || pos >= reel.length) throw new Error('Bad random stop');
    return [reel[pos], reel[(pos + 1) % reel.length], reel[(pos + 2) % reel.length]];
  });
}

export function gradeGrid(grid, perLine, denomination = 1) {
  if (!Array.isArray(grid) || grid.length !== 5 || grid.some(c => !Array.isArray(c) || c.length !== 3)) {
    throw new Error('Invalid 5x3 Sizzling grid');
  }
  const lineWins = [];
  let won = 0;
  for (let l = 0; l < LINES.length; l++) {
    const rows = LINES[l], symbol = grid[0][rows[0]];
    if (symbol === 0) continue; // scatter is not a line symbol
    let count = 1;
    while (count < 5 && grid[count][rows[count]] === symbol) count++;
    const mult = PAYTABLE[symbol]?.[count] ?? 0;
    if (!mult) continue;
    const amount = money(mult * perLine * denomination);
    lineWins.push({
      // The Pixi client indexes its own linesConfig array with this value:
      // it must be the 0-based line index, NOT the 1-based line number,
      // otherwise the winning line is drawn one row above/below the symbols.
      idx: l,
      code: symbol,
      pos: rows.slice(0, count).map((row, reel) => [reel, row]),
      multiplier: mult,
      amount: amount.toFixed(2),
      type: 'basic',
      extra: {},
    });
    won = money(won + amount);
  }

  const scatters = [];
  for (let col = 0; col < 5; col++) for (let row = 0; row < 3; row++) {
    if (grid[col][row] === 0) scatters.push([col, row]);
  }
  const scatterMult = PAYTABLE[0][scatters.length] ?? 0;
  if (scatterMult) {
    const amount = money(scatterMult * perLine * LINES.length * denomination);
    lineWins.push({
      idx: 0, code: 0, pos: scatters, multiplier: scatterMult,
      amount: amount.toFixed(2), type: 'scatter', extra: {},
    });
    won = money(won + amount);
  }
  return { total: won, line_wins: lineWins };
}

const sessions = new Map();
function clearExpired(now = Date.now()) {
  for (const [id, session] of sessions) if (now - session.lastSeen > SESSION_TTL) sessions.delete(id);
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
}
function parseCookie(text, key) {
  return String(text ?? '').split(';').map(x => x.trim()).find(x => x.startsWith(key + '='))?.slice(key.length + 1);
}
function getSession(req, res) {
  const now = Date.now();
  if (sessions.size >= MAX_SESSIONS) clearExpired(now);
  const token = parseCookie(req.headers.cookie, SESSION_COOKIE);
  let state = token && /^[a-f0-9]{48}$/.test(token) ? sessions.get(token) : null;
  if (state && now - state.lastSeen > SESSION_TTL) state = null;
  if (!state) {
    const id = randomBytes(24).toString('hex');
    state = {
      credits: DEFAULT_BALANCE, pending: 0, round: 0,
      requestId: 1, lastSeen: now, gambleStep: 0, gamblePlayer: null,
      lastRequestId: null, lastResponse: null,
    };
    sessions.set(id, state);
    res.append('Set-Cookie', SESSION_COOKIE + '=' + id +
      '; HttpOnly; SameSite=Lax; Path=/app; Max-Age=' + Math.trunc(SESSION_TTL / 1000) +
      (req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''));
  }
  state.lastSeen = now;
  return state;
}

function decodeRequest(req) {
  const payload = req.body;
  if (payload && !Buffer.isBuffer(payload) && typeof payload === 'object') {
    if (typeof payload.data === 'string') return JSON.parse(payload.data);
    return payload;
  }
  const raw = Buffer.isBuffer(payload) ? payload.toString('utf8') : '';
  const ctype = String(req.headers['content-type'] ?? '').toLowerCase();
  if (ctype.includes('multipart/form-data')) {
    // The original bundle POSTs a FormData field named "data".
    const match = /(?:^|\r?\n)Content-Disposition:\s*form-data;\s*name="data"[^\r\n]*\r?\n(?:Content-Type:[^\r\n]*\r?\n)?\r?\n([\s\S]*?)\r?\n--/i.exec(raw);
    if (!match) throw new Error('Missing multipart data field');
    return JSON.parse(match[1]);
  }
  if (ctype.includes('application/x-www-form-urlencoded')) {
    const form = new URLSearchParams(raw);
    return JSON.parse(form.get('data') ?? '{}');
  }
  if (raw) {
    const parsed = JSON.parse(raw);
    return typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed;
  }
  return {};
}

const basicResponse = (state, before) => ({
  balance: { before: money(before), after: balance(state) },
  denomination: state.walletLimits ? CASINO_MIN_STAKE/5 : 1,
});

function initResponse(state) {
  const grid = randomGrid();
  return {
    ...basicResponse(state, state.credits),
    available_actions: ['spin'],
    init: {
      bet: '1', lines: 5, multiplier: 1, currency: 'EUR',
      restorestate: false, next_request_id: state.requestId,
      ranges: state.walletLimits ? walletPixiRanges(5) : {
        bet: Object.fromEntries(Object.values(DENOMINATIONS).map(value => [value, [...BET_OPTIONS]])),
        denomination: DENOMINATIONS,
      },
      directory: { lines: LINES.map(row => Object.fromEntries(row.map((pos, i) => [i, pos]))),
        paytable: PAYTABLE },
      start_symbols: symbolMatrix(grid),
      collect: 1,
      extra: { symbol_types: { scatters: [0], wilds: [] } },
    },
  };
}

function handleSpin(state, request) {
  if (state.pending > 0) return { ...basicResponse(state, state.credits),
    available_actions: ['collect','gamble'], error:'COLLECT_FIRST' };
  const bet = Number(request.bet);
  const lines = Number(request.lines);
  const denomination = Number(request.denomination ?? 1);
  if (!BET_OPTIONS.includes(bet) || lines !== 5 || !Object.values(DENOMINATIONS).includes(denomination)) {
    throw new Error('Invalid Sizzling bet / lines / denomination');
  }
  const stake = money(bet * lines * denomination);
  if (state.credits < stake) return {
    ...basicResponse(state, state.credits),
    available_actions: ['spin'],
    error: 'INSUFFICIENT_DEMO_CREDITS',
  };
  const before = state.credits;
  const grid = randomGrid();
  const wins = gradeGrid(grid, bet, denomination);
  // The cabinet debits the stake on spin and pays the win on collect, so the
  // demo must not add the win to the meter before the player collects it.
  state.credits = money(state.credits - stake);
  state.pending = wins.total;
  state.gambleStep = 0;
  state.gamblePlayer = null;
  return {
    ...basicResponse(state, before),
    macro_round: { wins: { total: wins.total.toFixed(2) } },
    available_actions: wins.total > 0 ? ['collect','gamble','spin'] : ['spin'],
    spin: {
      bet, lines, multiplier: 1, next_multiplier: 1, type: 'spin',
      symbols: symbolMatrix(grid),
      wins: { line_wins: wins.line_wins, total: wins.total.toFixed(2) },
    },
  };
}

function getGamble(state) {
  if (!(state.pending > 0)) return {
    ...basicResponse(state,state.credits), available_actions: ['spin'],
    error:'NOTHING_TO_GAMBLE',
  };
  if (!state.gamblePlayer) state.gamblePlayer = randomCard();
  return {
    ...basicResponse(state,state.credits),
    available_actions: ['collect','set_double'],
    gamble: {
      start_bet: money(state.pending), bet: money(state.pending),
      win: money(state.pending * 2), status:'idle',
      current_step:state.gambleStep, max_step:5,
      history: { items: { 0: state.gamblePlayer } },
    },
  };
}
function randomCard() {
  return {
    rank: randomInt(2,15), suit: ['hearts','diamonds','clubs','spades'][randomInt(4)],
  };
}
function setGamble(state, req) {
  if (!(state.pending > 0)) return {
    ...basicResponse(state, state.credits), available_actions: ['spin'],
    error: 'NOTHING_TO_GAMBLE',
  };
  const choice = Number(req.choice);
  if (choice !== 0 && choice !== 1) throw new Error('Invalid gamble color');
  const before = state.credits;
  const player = state.gamblePlayer ?? randomCard();
  const dealer = randomCard();
  const red = ['hearts','diamonds'].includes(dealer.suit);
  const won = (choice === 0) === red;
  // The stake already left the meter and the win is still pending: gambling
  // only doubles or forfeits that pending amount.
  state.pending = won ? money(state.pending * 2) : 0;
  state.gambleStep++;
  state.gamblePlayer = dealer;
  const nextActions = state.pending > 0 ? ['collect', ...(state.gambleStep < 5 ? ['get_double'] : []), 'spin'] : ['spin'];
  return {
    ...basicResponse(state, before),
    available_actions: nextActions,
    macro_round: { wins: { total: state.pending.toFixed(2) } },
    gamble: {
      start_bet: money(won ? state.pending / 2 : 0),
      bet: money(state.pending), win: money(state.pending * 2),
      status: won ? 'win' : 'lose',
      current_step: state.gambleStep, max_step: 5,
      history: { items: { 0: player, 1: dealer } },
    },
  };
}

export function createSizzlingDemoRouter() {
  const router = Router();
  router.post('/play', raw({ type: () => true, limit: '128kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const state = getSession(req,res);
      const request = decodeRequest(req);
      const action = String(request.action ?? 'init');
      const requestId = request.request_id == null ? null : String(request.request_id);
      if (requestId && requestId === state.lastRequestId && state.lastResponse) {
        return res.json(state.lastResponse); // retry-safe: no double debit
      }
      if (requestId != null && (!/^\d+$/.test(requestId) || Number(requestId) > 1e9)) {
        return res.status(400).json({ error:'INVALID_REQUEST_ID' });
      }
      if (requestId != null && action !== 'init' && Number(requestId) < state.requestId - 1) {
        return res.status(409).json({ error:'STALE_REQUEST_ID' });
      }
      const before = state.credits;
      let response;
      switch (action) {
        case 'init':
          response = initResponse(state); break;
        case 'spin':
          response = handleSpin(state,request); break;
        case 'collect': {
          const collected = state.pending;
          state.credits = money(state.credits + collected);
          state.pending = 0; state.gambleStep = 0; state.gamblePlayer = null;
          response = { ...basicResponse(state,before), available_actions:['spin'],
            macro_round:{ wins:{total:'0'} }, collect:{total:money(collected).toFixed(2)} };
          break;
        }
        case 'get_double':
          response = getGamble(state); break;
        case 'set_double':
          response = setGamble(state,request); break;
        default: return res.status(400).json({ error:'INVALID_ACTION' });
      }
      state.requestId = Math.max(state.requestId + 1, requestId ? Number(requestId) + 1 : 0);
      if (response.init) response.init.next_request_id = state.requestId;
      if (response.spin) response.spin.next_request_id = state.requestId;
      if (requestId) { state.lastRequestId = requestId; state.lastResponse = response; }
      return res.json(response);
    } catch (e) {
      console.warn('[sizzling-demo] invalid demo request:', e.message);
      return res.status(400).json({ error:'INVALID_DEMO_REQUEST' });
    }
  });
  // Demo credits must never be mistaken for the sportsbook ledger.
  router.get('/status', (_req,res) => res.json({
    mode:'DEMO', realMoney:false,
    frontend:'original-pixi-spine', backend:'local-node-demo',
  }));
  return router;
}

// Reuse the original Pixi protocol format without duplicating demo mechanics.
export { decodeRequest, initResponse, basicResponse };
