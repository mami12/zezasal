import assert from 'node:assert/strict';
import {
  FIREJOKER_DATA, FIREJOKER_DEFAULT_RTP, FIREJOKER_LINES,
  FIREJOKER_LINE_PAY, FIREJOKER_SCATTER_PAY, FIREJOKER_FREE_SPINS,
  gradeFireJokerGrid, spinFireJokerRound, initialFireJokerGrid,
} from '../server/casino/firejoker-engine.mjs';
import { createFireJokerProtocol, fireJokerConfig } from '../server/casino/firejoker-protocol.mjs';
import { walletCtDenoms, CT_LINE_BETS } from '../server/casino/bet-limits.mjs';

console.log('Testing Fire Joker engine and protocol...');

// 1. Data configuration verification
assert(FIREJOKER_DATA.reels, 'Reel profiles must exist');
const rtpKeys = Object.keys(FIREJOKER_DATA.reels);
assert.equal(rtpKeys.length, 8, 'Must have 8 RTP profiles from Slotopol');
assert(rtpKeys.includes(String(FIREJOKER_DEFAULT_RTP)), 'Default RTP profile must be present');
assert.equal(FIREJOKER_DEFAULT_RTP, 96.305284, 'Default RTP should be 96.305284%');
assert.deepEqual(FIREJOKER_DATA.bonusReel, [1, 2, 3, 4, 5, 6, 7], 'Bonus reel must exclude scatter (8) and joker (9)');
assert.equal(FIREJOKER_LINES.length, 5, 'Must have exactly 5 paylines');

// 2. Grader test cases
const stakeCents = 2000;
const lineBetCents = 400; // 2000 / 5 lines

// Test Line 1 (middle row: row index 1) 5 of Symbol 9 (Joker jackpot)
const jackpotGrid = [
  [1, 9, 1],
  [2, 9, 2],
  [3, 9, 3],
  [4, 9, 4],
  [5, 9, 5],
];
const jackpotResult = gradeFireJokerGrid(jackpotGrid, { lineBetCents, stakeCents });
assert.equal(jackpotResult.wins.length, 1);
assert.equal(jackpotResult.wins[0].line, 1); // line 1 is [1, 1, 1, 1, 1] (0-indexed)
assert.equal(jackpotResult.wins[0].symbol, 9);
assert.equal(jackpotResult.wins[0].multiplier, 100000);
assert.equal(jackpotResult.winCents, lineBetCents * 100000);

// Test 3 Scatters (Symbol 8)
const scatterGrid = [
  [8, 1, 1],
  [1, 8, 2],
  [2, 3, 8],
  [4, 5, 6],
  [7, 1, 2],
];
const scatterResult = gradeFireJokerGrid(scatterGrid, { lineBetCents, stakeCents });
const scatterWin = scatterResult.wins.find(w => w.line === 0);
assert(scatterWin, 'Scatter win must be recorded at line 0');
assert.equal(scatterWin.count, 3);
assert.equal(scatterWin.multiplier, 3);
assert.equal(scatterWin.amountCents, stakeCents * 3);
assert.equal(scatterWin.freeSpins, 10);
assert.equal(scatterResult.freeSpins, 10);

// Test 2 Scatters
const twoScatterGrid = [
  [8, 1, 1],
  [1, 8, 2],
  [2, 3, 1],
  [4, 5, 6],
  [7, 1, 2],
];
const twoScatterResult = gradeFireJokerGrid(twoScatterGrid, { lineBetCents, stakeCents });
const twoScatterWin = twoScatterResult.wins.find(w => w.line === 0);
assert(twoScatterWin, '2 Scatters must record a win');
assert.equal(twoScatterWin.multiplier, 0.5);
assert.equal(twoScatterWin.amountCents, stakeCents * 0.5);
assert.equal(twoScatterWin.freeSpins, 0);

// 3. Round simulation and free-spins chain
let mockCounter = 0;
// Test deterministically triggered free spins
const riggedRandom = max => {
  // Return fixed indices
  mockCounter++;
  return 0;
};
const roundWithScatter = spinFireJokerRound({
  stakeCents: 2000,
  random: riggedRandom,
});
assert(roundWithScatter.games.length >= 1, 'Round must include games array');
assert.equal(roundWithScatter.winCents, roundWithScatter.games.reduce((sum, g) => sum + g.winCents, 0));

// 4. CT Protocol integration
const protocol = createFireJokerProtocol();
const state = protocol.initialState('FireJoker', { walletLimits: true });
assert.equal(state.credit, 10000000);

// Command: create_session
const sessionResp = protocol.run(state, [{ command: 'create_session', sequence_number: 0 }])[0];
assert.equal(sessionResp.status.status, 'ok');
assert.equal(sessionResp._req_command, 'create_session');
assert.deepEqual(sessionResp.enabled_denoms, walletCtDenoms(5));

// Command: init_game
const initResp = protocol.run(state, [{ command: 'init_game', sequence_number: 1 }])[0];
assert.equal(initResp.status.status, 'ok');
assert.equal(initResp.game_config.app_name, 'Fire Joker');
assert.equal(initResp.game_config.columns, 5);
assert.equal(initResp.game_config.rows, 3);
assert.equal(initResp.game_config.lines.length, 5);
assert.deepEqual(initResp.game_config.line_step_bet_numbers, CT_LINE_BETS);
assert.equal(initResp.game_config.double.double_enable, 0, 'Gamble must be disabled');

// Command: play (5 lines * 100 = 500 total_bet; denom 1 => 4 cents each => 2000 cents = 20 ALL)
const playResp = protocol.run(state, [{
  command: 'play',
  sequence_number: 2,
  lines: 5,
  line_bet: 100,
  total_bet: 500,
  game_denom: 1,
}])[0];
assert.equal(playResp.status.status, 'ok');
assert(Array.isArray(playResp.result), 'Result must be an array of subgames');
assert(playResp.result.length >= 1, 'At least 1 subgame for main game');
const mainGame = playResp.result[0];
assert.equal(mainGame.type, 'slot_subgame');
assert.equal(mainGame.subgame_label, 'main');
assert.equal(mainGame.result_reels.length, 3, 'Result reels must have 3 rows');
assert.equal(mainGame.result_reels[0].length, 5, 'Each row must have 5 columns');
assert(state.pending >= 0, 'Pending win must be non-negative');

// Command: game_finished
const finishResp = protocol.run(state, [{
  command: 'game_finished',
  sequence_number: 3,
  gameplay_id: playResp.gameplay_id,
}])[0];
assert.equal(finishResp.status.status, 'ok');
assert.equal(state.phase, 'finished');
assert.equal(state.pending, 0);

// Validation: invalid bets
const badResp = protocol.run(state, [{
  command: 'play',
  sequence_number: 4,
  lines: 3, // must be 5
  line_bet: 100,
  total_bet: 300,
  game_denom: 1,
}])[0];
assert.equal(badResp.status.status, 'user_error');
assert.equal(badResp.status.msg, 'Invalid bet or insufficient credit.');

console.log('PASS Fire Joker engine and CT protocol tests all succeeded!');
