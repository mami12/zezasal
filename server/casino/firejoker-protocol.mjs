import { createCtProtocol } from './ct-protocol.mjs';
import { CT_LINE_BETS, walletCtDenoms } from './bet-limits.mjs';
import {
  FIREJOKER_DATA, FIREJOKER_DEFAULT_RTP, FIREJOKER_LINE_PAY, FIREJOKER_LINES,
  FIREJOKER_SCATTER_PAY, FIREJOKER_FREE_SPINS, initialFireJokerGrid, spinFireJokerRound,
} from './firejoker-engine.mjs';

const symbolName = symbol => `symbol${Number(symbol) - 1}`;
const gridRows = grid => Array.from({ length: 3 }, (_, row) => grid.map(reel => symbolName(reel[row])));
const reelSet = rtp => {
  const reels = FIREJOKER_DATA.reels[String(Number(rtp))];
  if (!reels) throw new Error('Unsupported Fire Joker reel profile');
  return { reels: reels.map(reel => reel.map(symbolName)), symbols: Array.from({ length: 9 }, (_, index) => symbolName(index + 1)) };
};

export function fireJokerConfig(grid, options = {}) {
  const rtp = Number(options.mathProfile?.rtp ?? FIREJOKER_DEFAULT_RTP);
  const denoms = options.walletLimits ? walletCtDenoms(5) : [{ id: 1, label: '1.00', cents: 100 }];
  const paytable = {};
  for (let symbol = 1; symbol <= 9; symbol++) {
    const entries = {};
    for (let count = 1; count <= 5; count++) {
      const factor = FIREJOKER_LINE_PAY[symbol - 1][count - 1];
      if (factor) entries[count] = { factor };
    }
    if (Object.keys(entries).length) paytable[symbolName(symbol)] = entries;
  }
  const scatterTable = Object.fromEntries([2, 3].map(count => [count, {
    factor: FIREJOKER_SCATTER_PAY[count - 1],
    bonus_type: count === 3 ? 'free_games' : 'none',
    bonus_value: FIREJOKER_FREE_SPINS[count - 1],
  }]));
  const reels = reelSet(rtp);
  return {
    app_name: 'Fire Joker', directory_name: 'FireJoker', base_game_id: 0, columns: 5, rows: 3,
    main_subgame_label: 'main', main_subgame_reels_set: 'main',
    subgames_labels: { main: { subgame_id: 'main' }, free: { subgame_id: 'free' } },
    reels_sets: { main: reels, free: reels },
    paytables: { main: { paytable, paytable_wilds: {}, paytable_scatters: { [symbolName(8)]: scatterTable } }, free: { paytable, paytable_wilds: {}, paytable_scatters: {} } },
    lines: FIREJOKER_LINES.map(line => line.map(row => row + 1)), lines_mode: 1, lines_per_credit: 1,
    lines_min_number: 5, lines_max_number: 5, lines_step_numbers: [5],
    line_min_bet: options.walletLimits ? CT_LINE_BETS[0] : 1,
    line_max_bet: options.walletLimits ? CT_LINE_BETS.at(-1) : 100,
    line_default_bet: options.walletLimits ? CT_LINE_BETS[0] : 1,
    line_step_bet_numbers: options.walletLimits ? [...CT_LINE_BETS] : [1, 2, 3, 5, 10, 20, 50, 100],
    line_step_bet_numbers_quick: options.walletLimits ? [100, 500, 2500, 12500, 25000] : [1, 5, 10, 25],
    game_denoms: Object.fromEntries(denoms.map(denom => [denom.label, true])),
    init_screen: gridRows(grid),
    double: { double_enable: 0, double_enter_limit: 0, double_limit: 0 },
    autoplay: 0, autoplay_steps: [], show_autoplay_settings: 'show_game_and_main_screen',
    reel_rotate_mintime: 900, skill_stop_enabled: 0, allow_client_demo_request: 0,
    pjp_enabled: 0, diamond_bonus_enabled: 0, extra_bet_enabled: 0, win_limit: 0,
    RTP: Object.fromEntries(denoms.map(denom => [denom.label, [{ percent: String(rtp) }]])),
  };
}

export function mapFireJokerRound(round, _command, denom) {
  let totalWinCents = 0;
  return round.games.map((game, index) => {
    totalWinCents += game.winCents;
    const lineWins = game.wins.filter(win => win.line).map(win => ({
      line_number: win.line - 1,
      symbol: symbolName(win.symbol),
      symbols: win.cells.map(([reel, row]) => symbolName(game.grid[reel][row])),
      symbol_count: win.count,
      win: win.amountCents / denom.cents,
      positions: win.cells.map(([reel]) => reel),
      subgame_win_factor: 1,
      paytable_factor: win.multiplier,
      wilds: [],
    }));
    const scatters = game.wins.filter(win => !win.line).map(win => ({
      symbol: symbolName(win.symbol),
      count: win.count,
      symbol_count: win.count,
      win: win.amountCents / denom.cents,
      positions: win.cells.map(([reel, row]) => [row, reel]),
      paytable_factor: win.multiplier,
      subgame_win_factor: 1,
      bonus_type: win.freeSpins ? 'free_games' : 'none',
      bonus_value: win.freeSpins,
    }));
    return {
      type: 'slot_subgame',
      type_descr: game.free ? 'FREE GAME' : 'NORMAL GAME',
      step_number: index,
      subgame_label: game.free ? 'free' : 'main',
      reels_sets_name: game.free ? 'free' : 'main',
      subgame_label_game_number: game.freeGameNumber,
      subgame_label_game_total: game.free ? game.freeGameTotal : 1,
      stop_reels: game.grid.map(reel => reel.map(symbolName)),
      result_reels: gridRows(game.grid),
      lines_win: lineWins,
      scatters_win: scatters,
      subgame_bonus: [],
      win: game.winCents / denom.cents,
      total_win: totalWinCents / denom.cents,
      subgame_factor: 1,
      is_free: game.free ? 1 : 0,
      is_last: index === round.games.length - 1,
      free_games: game.freeSpins,
      free_game_number: game.freeGameNumber,
      free_game_total: game.free ? game.freeGameTotal : 0,
      expanded_wilds: [],
    };
  });
}

export function createFireJokerProtocol({ random } = {}) {
  return createCtProtocol({
    spinFn: (bet, _lines, options = {}) => spinFireJokerRound({
      // createCtProtocol passes wallet-limited wagers to spinFn in cents.
      // Multiplying here again inflated each paid spin and its payout basis.
      stakeCents: Number(bet),
      mathProfile: options.mathProfile,
      ...(random ? { random } : {}),
    }),
    configFn: fireJokerConfig,
    initialGrid: options => initialFireJokerGrid({ ...(random ? { random } : {}), ...options }),
    selectedLines: 5,
    mapRound: mapFireJokerRound,
    allowGamble: false,
  });
}
