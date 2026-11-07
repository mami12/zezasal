import {managerCasinoSettings} from './manager-settings.mjs';
import jwt from 'jsonwebtoken';
import {config} from '../config.mjs';
import {requireAuth} from '../ledger/auth.mjs';
import {query} from '../db.mjs';
import {createHash} from 'node:crypto';
/**
 * Book of Ra Deluxe — original Novomatic client protocol adapter.
 *
 * 5 reels x 3 rows, 10 lines (ids 0..9, same order as the client's
 * data/linesConfig-hd JSON), Book = wild + scatter, 10 free spins with one
 * expanding symbol. Server-authoritative grading; the client only animates.
 */
import { Router, raw } from 'express';
import {CASINO_MIN_STAKE,walletPixiRanges} from './bet-limits.mjs';
import { randomInt, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [1, 2, 2, 2, 1], [1, 0, 0, 0, 1], [2, 2, 1, 0, 0], [0, 0, 1, 2, 2], [2, 1, 1, 1, 0],
];
export const PAYTABLE = {
  1: { 2: 10, 3: 250, 4: 2500, 5: 9000 }, // explorer
  2: { 2: 2, 3: 25, 4: 125, 5: 750 },     // pharaoh
  3: { 2: 2, 3: 25, 4: 125, 5: 750 },     // anubis
  4: { 2: 2, 3: 15, 4: 75, 5: 250 },      // scarab
  5: { 3: 10, 4: 50, 5: 125 },            // A
  6: { 3: 10, 4: 50, 5: 125 },            // K
  7: { 3: 5, 4: 25, 5: 100 },             // Q
  8: { 3: 5, 4: 25, 5: 100 },             // J
  9: { 3: 5, 4: 25, 5: 100 },             // 10
};
export const SCATTER_PAY = { 3: 5, 4: 20, 5: 500 };
export const FREE_SPINS = 10;
export const BET_OPTIONS = [1, 2, 3, 5, 10, 20, 30, 50, 100];
export const DENOMINATIONS = { 0: .5, 1: 1, 2: 2, 3: 5, 4: 10 };
const CODE = { SCAT: 0, P_1: 1, P_2: 2, P_3: 3, P_4: 4, A: 5, K: 6, Q: 7, J: 8, 10: 9 };

function loadReels() {
  const text = readFileSync(fileURLToPath(new URL('./bookofra-reels.txt', import.meta.url)), 'utf8');
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0) continue;
    map.set(line.slice(0, i).trim(), line.slice(i + 1).split(',').map(s => s.trim()).filter(Boolean));
  }
  return Array.from({ length: 5 }, (_, r) => {
    const tokens = map.get('reelStrip' + (r + 1));
    if (!tokens || tokens.length < 30) throw new Error('Missing Book of Ra reelStrip' + (r + 1));
    return tokens.map(t => {
      const code = CODE[t];
      if (code === undefined) throw new Error('Invalid Book of Ra token: ' + t);
      return code;
    });
  });
}
export const REELS = loadReels();

const money = v => Number(Number(v).toFixed(2));
const cell = code => ({ code });
export const symbolMatrix = grid => Object.fromEntries(grid.map((reel, c) =>
  [c, Object.fromEntries(reel.map((code, r) => [r, cell(code)]))]));

export function randomGrid(random = bound => randomInt(bound),reels=REELS) {
  return reels.map(reel => {
    const stop = random(reel.length);
    if(!Number.isInteger(stop)||stop<0||stop>=reel.length)throw new Error('Invalid reel stop');
    return [reel[stop], reel[(stop + 1) % reel.length], reel[(stop + 2) % reel.length]];
  });
}

/** Left-to-right line win; the Book (0) substitutes any line symbol. */
function lineWin(codes) {
  let base = null, count = 0;
  for (const c of codes) {
    if (base === null) {
      if (c === 0) { count++; continue; }
      base = c; count++; continue;
    }
    if (c === base || c === 0) { count++; } else break;
  }
  if (!base || count < 2) return null;
  const factor = PAYTABLE[base]?.[count] ?? 0;
  if (!factor) return null;
  return { code: base, count, factor };
}

/**
 * Grades a 5x3 grid. `mud` (expanding symbol during free spins) pays extra on
 * every reel where it appears 3+ times, independent of the paylines.
 */
export function gradeGrid(grid, perLine, lines = 10, mud = null) {
  if (!Array.isArray(grid) || grid.length !== 5 || grid.some(c => !Array.isArray(c) || c.length !== 3)) {
    throw new Error('Invalid 5x3 Book of Ra grid');
  }
  const lineWins = [];
  let total = 0;
  for (let l = 0; l < Math.min(lines, LINES.length); l++) {
    const rows = LINES[l];
    const codes = rows.map((row, reel) => grid[reel][row]);
    const win = lineWin(codes);
    if (!win) continue;
    const amount = money(win.factor * perLine);
    total = money(total + amount);
    lineWins.push({
      idx: l, code: win.code, pos: rows.slice(0, win.count).map((row, reel) => [reel, row]),
      multiplier: win.factor, amount: amount.toFixed(2), type: 'basic', extra: {},
    });
  }
  // Scatter (Book) pays on total bet: 3+ anywhere.
  const books = [];
  for (let c = 0; c < 5; c++) for (let r = 0; r < 3; r++) if (grid[c][r] === 0) books.push([c, r]);
  const scatterFactor = SCATTER_PAY[books.length] ?? 0;
  if (scatterFactor) {
    const amount = money(scatterFactor * perLine * LINES.length);
    total = money(total + amount);
    lineWins.push({
      idx: 0, code: 0, pos: books, multiplier: scatterFactor,
      amount: amount.toFixed(2), type: 'scatter', extra: {},
    });
  }
  // Expanding symbol: 3+ of the chosen symbol on a reel fills that reel and
  // pays PAYTABLE[symbol][count] x per line x lines (sent as pos_wins/mud).
  if (mud !== null && mud > 0) {
    const fullReels = [];
    for (let c = 0; c < 5; c++) if (grid[c].filter(s => s === mud).length >= 3) fullReels.push(c);
    if (fullReels.length >= 2) {
      const factor = PAYTABLE[mud]?.[fullReels.length] ?? 0;
      if (factor) {
        const amount = money(factor * perLine * LINES.length);
        const pos = [];
        for (const c of fullReels) for (let r = 0; r < 3; r++) pos.push([c, r]);
        total = money(total + amount);
        lineWins.push({
          idx: 0, code: mud, pos, multiplier: factor, amount: amount.toFixed(2),
          type: 'mud', extra: {},
        });
      }
    }
  }
  return { total, line_wins: lineWins };
}

/* --------------------------------------------------------------- helpers --- */

export function decodeRequest(req) {
  if(req.body&&!Buffer.isBuffer(req.body)&&typeof req.body==='object'){
    return typeof req.body.data==='string'?JSON.parse(req.body.data):req.body;
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
    denomination: walletLimits ? CASINO_MIN_STAKE/LINES.length : 1,
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
    // Gamble/Collect may only be offered when the spin actually won something;
    // otherwise the cabinet shows "0 won" and Gamble answers NOTHING_TO_GAMBLE.
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
  const freespins={left,done,add:0,mud,wins:{total,win_before_chain:0},type:'freespins'};
  return {
    balance: { before: money(credits), after: money(credits) },
    denomination: 1,
    available_actions: left > 0 ? ['freespin'] : ['collect'],
    spin: {
      bet, lines, multiplier: 1, next_multiplier: 1,
      // The Pixi client keys its reel stop / next-request logic off these two
      // fields: without next_request_id the reels keep spinning and Start
      // stays disabled, and the type must be the free-spin enum.
      type: 'freespin', next_request_id: (Number(requestId) || 0) + 1,
      symbols: symbolMatrix(grid),
      wins: { line_wins: grading.line_wins, total: money(grading.total).toFixed(2) },
      freespins,
    },
    freespins,
  };
}

export function pickMudSymbol(random = bound => randomInt(bound)) {
  // Any paying symbol can be the expanding symbol of the round.
  return 1 + random(9);
}

/* ----------------------------------------------------------------- demo ---- */

const SESSION_COOKIE = 'bookofra_demo_session';
const SESSION_TTL = 4 * 3600 * 1000;
const MAX_SESSIONS = 2000;
const DEFAULT_BALANCE = 100_000;
const sessions = new Map();

function getSession(req, res) {
  const cookie = /(?:^|;\s*)bookofra_demo_session=([a-f0-9-]{36})/.exec(String(req.headers.cookie || ''))?.[1];
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

export function createBookOfRaDemoRouter() {
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
            throw new Error('Invalid Book of Ra bet / lines / denomination');
          }
          const stake = money(bet * lines * den);
          if (state.credits < stake) {
            response = { ...initResponse({ credits: state.credits, requestId: state.requestId }), error: 'INSUFFICIENT_DEMO_CREDITS' };
            break;
          }
          // QA hook: CASINO_FS_TEST=1 makes the first spin trigger the free
          // spins so the intro/stop flow can be tested without waiting.
          const grid = process.env.CASINO_FS_TEST === '1' && !state.free && state.requestId <= 2
            ? [[0, 1, 2], [0, 3, 4], [0, 5, 6], [7, 8, 9], [2, 3, 4]]
            : randomGrid();
          const graded = gradeGrid(grid, bet, lines);
          state.credits = money(state.credits - stake);
          state.pending = graded.total;
          const books = grid.flat().filter(s => s === 0).length;
          let free = null;
          // Free spins stay OFF until the client FS handshake is finished; the
          // scatter still pays. Enable with BOOKOFRA_FREE_SPINS=1.
          if (books >= 3 && process.env.BOOKOFRA_FREE_SPINS === '1') {
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
      console.warn('[bookofra-demo] invalid demo request:', e.message);
      return res.status(400).json({ error: 'INVALID_DEMO_REQUEST' });
    }
  });
  router.get('/status', (_req, res) => res.json({
    mode: 'DEMO', realMoney: false, frontend: 'original-pixi-spine', backend: 'local-node-demo',
  }));
  return router;
}

/* ------------------------------------------------------------ real wallet --- */

const WALLET_COOKIE='casino_bookofra_session';
const WALLET_TTL=60*60*2;

const cookieValue=req=>String(req.headers.cookie||'').split(';').map(s=>s.trim())
  .find(s=>s.startsWith(WALLET_COOKIE+'='))?.slice(WALLET_COOKIE.length+1);
const fault=(status,message)=>Object.assign(new Error(message),{status});
const deny=(res,error,action='unknown')=>{
  const status=Number(error?.status)||500;
  const message=status>=500?'CASINO_SERVICE_ERROR':String(error.message||'CASINO_REQUEST_REJECTED');
  if(status>=500)console.error('[casino bookofra] failed action='+action,error);
  else console.warn('[casino bookofra] rejected action='+action+' status='+status+' code='+message);
  return res.status(status<500?200:status).json({error:{code:status,message}});
};

function uuidFromId(nonce,requestId){
  const h=createHash('sha256').update(nonce+':'+requestId).digest();
  h[6]=(h[6]&0x0f)|0x40;h[8]=(h[8]&0x3f)|0x80;
  const a=h.toString('hex').slice(0,32);
  return [a.slice(0,8),a.slice(8,12),a.slice(12,16),a.slice(16,20),a.slice(20)].join('-');
}

export function createBookOfRaRealRouter(dependencies={}){
  const router=Router();
  router.post('/play',raw({type:()=>true,limit:'128kb'}),async(req,res)=>{
    res.set('Cache-Control','no-store');
    let action='unknown';
    try{
      const ledger=await import('../ledger/store.mjs'),wallet=await import('./transactions.mjs'),gamble=await import('./gamble.mjs'),book=await import('./bookofra-transactions.mjs');
      const getUserById=dependencies.getUserById??ledger.getUserById,isLedgerReady=dependencies.isLedgerReady??ledger.isLedgerReady;
      const settlePendingWin=dependencies.settlePendingWin??wallet.settlePendingWin,casinoGambleAction=dependencies.casinoGambleAction??gamble.casinoGambleAction;
      const bookOfRaFreeState=dependencies.bookOfRaFreeState??book.bookOfRaFreeState,placeBookOfRaSpin=dependencies.placeBookOfRaSpin??book.placeBookOfRaSpin;
      if(!isLedgerReady())throw fault(503,'LEDGER_UNAVAILABLE');
      if(req.headers.origin){
        const origin=new URL(req.headers.origin);
        if(origin.host!==req.headers.host)throw fault(403,'CROSS_ORIGIN_DENIED');
      }
      const token=cookieValue(req);
      if(!token)throw fault(401,'CASINO_SESSION_REQUIRED');
      let claim;
      try{claim=jwt.verify(token,config.jwtSecret);}catch{throw fault(401,'CASINO_SESSION_EXPIRED');}
      if(claim.kind!=='casino-bookofra-wallet'||typeof claim.jti!=='string')throw fault(401,'CASINO_SESSION_INVALID');
      const user=await getUserById(claim.sub);
      if(!user||user.role!=='PLAYER'||user.status!=='ACTIVE')throw fault(403,'PLAYER_BLOCKED');
      if(Number(claim.epoch??0)!==Number(user.financialEpoch??user.financial_epoch??0))throw fault(401,'CASINO_SESSION_EXPIRED');
      const request=decodeRequest(req);
      action=String(request.action||'init');
      const rawId=request.request_id;
      const id=rawId==null?null:Number(rawId);
      if(rawId!=null&&(!Number.isSafeInteger(id)||id<0||id>1e9))throw fault(400,'INVALID_REQUEST_ID');

      if(action==='init'){
        const fs=await bookOfRaFreeState(user.id);
        if(Number(fs?.left_spins)>0){
          const init=initResponse({credits:Number(user.balance),requestId:id==null?1:id+1,walletLimits:true});
          init.denomination=Number(fs.paid_denomination||1);
          init.init.bet=String(Number(fs.paid_bet||1));init.init.lines=Number(fs.paid_lines||LINES.length);
          init.init.currency='LEK';init.available_actions=['initfreespin'];
          return res.json(init);
        }
        await settlePendingWin(user.id);
        const fresh=await getUserById(user.id);
        const init=initResponse({credits:Number(fresh?.balance??user.balance),requestId:id==null?1:id+1,walletLimits:true});
        init.init.currency='LEK';
        return res.json(init);
      }
      if(action==='initfreespin'){
        const fs=await bookOfRaFreeState(user.id);
        if(!fs)throw fault(409,'NO_FREE_SPINS');
        const symbols=fs.paid_result?.symbols??symbolMatrix(randomGrid());
        const init=initResponse({credits:Number(user.balance),requestId:id==null?1:id+1,walletLimits:true});
        init.denomination=Number(fs.paid_denomination||1);
        init.init.bet=String(Number(fs.paid_bet||1));init.init.lines=Number(fs.paid_lines||LINES.length);
        return res.json({
          ...init,
          available_actions:['freespin'],
          initfreespin:{
            symbols,
            freespins:{left:Number(fs.left_spins),done:Number(fs.done_spins),add:0,mud:Number(fs.mud),
              wins:{total:Number(fs.pending??0),win_before_chain:0},type:'freespins'},
          },
        });
      }
      if(action==='spin'||action==='freespin'){
        if(id==null)throw fault(400,'SPIN_REQUEST_ID_REQUIRED');
        const bet=Number(request.bet??1),lines=Number(request.lines??LINES.length);
        const denomination=Number(request.denomination??1);
        const round=await placeBookOfRaSpin({userId:user.id,requestId:uuidFromId(claim.jti,id),
          bet,denomination,lines,mode:action==='freespin'?'freespin':'spin',mathVersion:claim.mathVersion});
        if(action==='freespin'){
          return res.json(freespinResponse({
            credits:round.balance,payout:round.pending,bet,lines:lines,
            grid:round.grid,grading:round.graded,
            left:round.free.left,done:round.free.done,mud:round.free.mud,requestId:id,
          }));
        }
        const body=spinResponse({
          credits:round.balance+round.stake,stake:round.stake,payout:round.payout,bet,lines,
          grid:round.grid,grading:round.graded,requestId:id,free:round.free,
        });
        if(round.free)body.available_actions=['initfreespin'];
        return res.json(body);
      }
      if(action==='collect'||action==='get_double'||action==='set_double'){
        if(id==null)throw fault(400,'ACTION_REQUEST_ID_REQUIRED');
        const reply=await casinoGambleAction({
          userId:user.id,requestId:uuidFromId(claim.jti,id),action,choice:request.choice,
        });
        return res.json(reply);
      }
      throw fault(400,'INVALID_ACTION');
    }catch(error){deny(res,error,action);}
  });
  return router;
}


export function createBookOfRaSessionRouter(dependencies={}){
const router=Router();
router.post('/casino/bookofra/session',dependencies.auth??requireAuth,async(req,res)=>{
  try{
    if(req.user.role!=='PLAYER'||req.user.status!=='ACTIVE')throw fault(403,'PLAYER_BLOCKED');
    const {bookOfRaFreeState}=dependencies.bookOfRaFreeState?dependencies:await import('./bookofra-transactions.mjs');
    const owed=await bookOfRaFreeState(req.user.id);
    const {rows}=await (dependencies.runQuery??query)('select enabled,game_profiles,game_controls from app_casino_settings where id=1');
    rows[0]=await managerCasinoSettings(dependencies.runQuery??query,rows[0],req.user.managerId??req.user.manager_id??req.user.agentId??req.user.agent_id);
    if(!rows[0]?.enabled&&!Number(owed?.left_spins))throw fault(403,'CASINO_DISABLED');
    const {assertCasinoMathAcknowledged}=await import('./casino-controls.mjs');
    let mathVersion;
    if(Number(owed?.left_spins)>0){
      if(req.body?.mathVersion)try{mathVersion=assertCasinoMathAcknowledged('bookofra',rows[0],req.body.mathVersion);}catch{}
    }else mathVersion=assertCasinoMathAcknowledged('bookofra',rows[0],req.body?.mathVersion);
    const claim={sub:req.user.id,jti:randomUUID(),kind:'casino-bookofra-wallet',mathVersion,epoch:Number(req.user.financialEpoch??0)};
    const token=jwt.sign(claim,config.jwtSecret,{expiresIn:WALLET_TTL});
    res.cookie(WALLET_COOKIE,token,{
      httpOnly:true,sameSite:'strict',secure:req.secure||req.headers['x-forwarded-proto']==='https',
      path:'/app/api/casino/bookofra/real',maxAge:WALLET_TTL*1000,
    });
    res.set('Cache-Control','no-store');
    res.json({ready:true,gameUrl:'/app/casino-original/bookofra/index-real.html',expiresIn:WALLET_TTL,mathVersion});
  }catch(error){deny(res,error);}
});
return router;
}
export const casinoBookOfRaSessionRouter=createBookOfRaSessionRouter();
