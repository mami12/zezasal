/**
 * Standalone, play-money demo slot engine. This is not a provider game implementation,
 * a wagering service, or a claim about the provider's actual paytables/RTP.
 * Never use browser-generated outcomes to debit or credit real money.
 */
export type GameId =
  | 'aladdin' | 'big-bass' | 'book-ra' | 'five-reel' | 'gates'
  | 'jewels-ra' | 'atlantis' | 'sizzling' | 'anubis';

export interface CasinoGame {
  id: GameId;
  title: string;
  icon: string;
  subtitle: string;
  colors: [string, string];
  symbols: string[];
  reels: number;
  rows: number;
  mode: 'lines' | 'tumble' | 'hold';
}

export const GAMES: CasinoGame[] = [
  { id: 'aladdin', title: "Aladdin's Treasure", icon: '🧞', subtitle: 'Thesare dhe rrotullime falas', colors: ['#6342a4', '#191034'], symbols: ['💎', '🪔', '👑', '🗝️', '💰', '🧿', '🐪', '✨'], reels: 5, rows: 3, mode: 'lines' },
  { id: 'big-bass', title: 'Big Bass - Hold and Spinner', icon: '🐟', subtitle: 'Bonus Hold & Respin', colors: ['#137e9e', '#092d49'], symbols: ['🐟', '🎣', '🚤', '💎', '🦈', '🌊', '🪙', '✨'], reels: 5, rows: 3, mode: 'hold' },
  { id: 'book-ra', title: 'Book of Ra Deluxe', icon: '📕', subtitle: 'Tempuj dhe thesare', colors: ['#b67f2d', '#302006'], symbols: ['📕', '👑', '🗿', '🦅', '🧭', '💍', '🏺', '✨'], reels: 5, rows: 3, mode: 'lines' },
  { id: 'five-reel', title: 'FreeSlots 5 Reel', icon: '🎰', subtitle: 'Klasik me pesë rrotulla', colors: ['#af3167', '#270a30'], symbols: ['7️⃣', '🍒', '🍋', '🍇', '🔔', '⭐', '🍉', '✨'], reels: 5, rows: 3, mode: 'lines' },
  { id: 'gates', title: 'Gates of Olympus Super Scatter', icon: '⚡', subtitle: 'Fitore sipas simboleve dhe bonus', colors: ['#a66ae0', '#241244'], symbols: ['⚡', '👑', '💍', '💜', '💎', '💚', '🟡', '✨'], reels: 6, rows: 5, mode: 'tumble' },
  { id: 'jewels-ra', title: 'Jewels of Ra', icon: '💠', subtitle: 'Thesare të Egjiptit', colors: ['#13a393', '#093939'], symbols: ['💠', '💍', '👑', '🏺', '🧿', '🔱', '💎', '✨'], reels: 5, rows: 3, mode: 'lines' },
  { id: 'atlantis', title: 'Queen of Atlantis', icon: '🧜', subtitle: 'Perla dhe mistere nënujore', colors: ['#207eb0', '#081d45'], symbols: ['🧜', '🔱', '🐚', '🐬', '💎', '🪸', '🐙', '✨'], reels: 5, rows: 3, mode: 'lines' },
  { id: 'sizzling', title: 'Sizzling Hot Deluxe', icon: '🍒', subtitle: 'Fruta klasike', colors: ['#bb2e33', '#370a0b'], symbols: ['7️⃣', '🍒', '🍋', '🍊', '🍇', '🍉', '🔔', '✨'], reels: 5, rows: 3, mode: 'lines' },
  { id: 'anubis', title: 'Wrath of Anubis', icon: '🐺', subtitle: 'Legjendat e Anubisit', colors: ['#8b5e24', '#201a14'], symbols: ['🐺', '👁️', '⚱️', '🦂', '💎', '🏺', '🐍', '✨'], reels: 5, rows: 3, mode: 'lines' },
];

export const BET_OPTIONS = [1, 2, 5, 10, 20, 50] as const;
export type Grid = string[][];
export interface GameSession {
  freeSpins: number;
  respins: number;
  held: number[];
  lastGrid: Grid;
  lastWin: number;
  lastMessage: string;
  winningCells: number[];
  totalSpins: number;
}
export interface CasinoDemoState {
  credits: number;
  sessions: Partial<Record<GameId, GameSession>>;
}

export const freshState = (): CasinoDemoState => ({ credits: 1000, sessions: {} });
const round2 = (n: number) => Math.round(n * 100) / 100;

const pick = (game: CasinoGame): string => {
  // Deliberately simple demo distribution; not real game math.
  const values = game.symbols;
  const weights = [18, 17, 15, 14, 12, 10, 9, 5];
  let roll = Math.random() * weights.reduce((sum, n) => sum + n, 0);
  for (let i = 0; i < values.length; i += 1) {
    roll -= weights[i] ?? 1;
    if (roll < 0) return values[i];
  }
  return values[0];
};

export function makeGrid(game: CasinoGame): Grid {
  return Array.from({ length: game.rows }, () =>
    Array.from({ length: game.reels }, () => pick(game)));
}

export function newSession(game: CasinoGame): GameSession {
  return {
    freeSpins: 0, respins: 0, held: [], lastGrid: makeGrid(game),
    lastWin: 0, lastMessage: 'Zgjidh bastin dhe shtyp SPIN',
    winningCells: [], totalSpins: 0,
  };
}

export function readDemoStorage(key: string): CasinoDemoState {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved || typeof saved !== 'object' || !Number.isFinite(saved.credits) ||
        saved.credits < 0 || !saved.sessions || typeof saved.sessions !== 'object') return freshState();
    return { credits: Math.min(saved.credits, 1000000), sessions: saved.sessions };
  } catch {
    return freshState();
  }
}

const paths = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0], [2, 1, 0, 1, 2], [0, 0, 1, 0, 0],
  [2, 2, 1, 2, 2], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1],
];

function evaluate(game: CasinoGame, grid: Grid, stake: number) {
  const winningCells = new Set<number>();
  let amount = 0;
  if (game.mode === 'tumble') {
    // Demo "ways": groups of 8+ matching visible symbols.
    for (const symbol of game.symbols.slice(0, -1)) {
      const locations: number[] = [];
      grid.forEach((row, r) => row.forEach((item, c) => {
        if (item === symbol) locations.push(r * game.reels + c);
      }));
      if (locations.length >= 8) {
        amount += stake * (locations.length >= 12 ? 10 : locations.length >= 10 ? 4 : 1.5);
        locations.forEach(cell => winningCells.add(cell));
      }
    }
  } else {
    for (const line of paths) {
      const symbol = grid[line[0]][0];
      if (symbol === game.symbols[7]) continue;
      let length = 1;
      for (let c = 1; c < game.reels; c += 1) {
        if (grid[line[c]][c] !== symbol) break;
        length += 1;
      }
      if (length >= 3) {
        amount += stake * ({ 3: 1, 4: 3, 5: 12 }[length] ?? 0) / paths.length;
        for (let c = 0; c < length; c += 1) winningCells.add(line[c] * game.reels + c);
      }
    }
  }
  return { win: round2(amount), winningCells: Array.from(winningCells) };
}

export function playDemoRound(state: CasinoDemoState, game: CasinoGame, stake: number): CasinoDemoState {
  if (!BET_OPTIONS.includes(stake as typeof BET_OPTIONS[number])) return state;
  const old = state.sessions[game.id] ?? newSession(game);
  const free = old.freeSpins > 0;
  const respin = game.mode === 'hold' && old.respins > 0;
  if (!free && !respin && state.credits < stake) return state;

  const grid = makeGrid(game);
  const held = [...old.held];
  let respins = old.respins;
  let freeSpins = Math.max(0, old.freeSpins - (free ? 1 : 0));
  let win = 0;
  let winningCells: number[] = [];
  let message = '';

  if (respin) {
    let newCoins = 0;
    for (let cell = 0; cell < game.rows * game.reels; cell += 1) {
      const row = Math.floor(cell / game.reels), col = cell % game.reels;
      if (held.includes(cell)) grid[row][col] = '🪙';
      else if (grid[row][col] === '🪙') { held.push(cell); newCoins += 1; }
    }
    respins = newCoins ? 3 : respins - 1;
    winningCells = [...held];
    if (!respins || held.length === game.rows * game.reels) {
      win = round2(held.length * stake * 0.5);
      message = 'Bonus Hold & Respin: +' + win.toFixed(2) + ' kredite';
      respins = 0;
      held.length = 0;
    } else message = 'Hold & Respin: ' + respins + ' tentativa të mbetura';
  } else {
    const base = evaluate(game, grid, stake);
    win = base.win;
    winningCells = base.winningCells;
    const scatterCount = grid.flat().filter(symbol => symbol === game.symbols[7]).length;
    const scatterTarget = game.mode === 'tumble' ? 4 : 3;
    if (scatterCount >= scatterTarget) {
      freeSpins += 6;
      message = '+6 rrotullime falas!';
    }
    if (game.mode === 'hold') {
      const coins: number[] = [];
      grid.forEach((row, r) => row.forEach((symbol, c) => {
        if (symbol === '🪙') coins.push(r * game.reels + c);
      }));
      if (coins.length >= 4) {
        respins = 3;
        held.push(...coins);
        message = 'BONUS: 3 Hold & Respin!';
      }
    }
    if (!message) message = win > 0 ? 'Fitove ' + win.toFixed(2) + ' kredite!' : 'Provo sërish';
  }
  const credits = round2(state.credits - (free || respin ? 0 : stake) + win);
  return {
    credits: Math.max(0, credits),
    sessions: {
      ...state.sessions,
      [game.id]: {
        freeSpins, respins, held, lastGrid: grid, lastWin: win,
        lastMessage: message, winningCells, totalSpins: old.totalSpins + 1,
      },
    },
  };
}
