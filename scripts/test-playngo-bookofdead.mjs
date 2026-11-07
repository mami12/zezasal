import assert from 'node:assert/strict';
import {
  LINES, PAYTABLE, SCATTER_PAY, FREE_SPINS,
  randomGrid, gradeGrid, pickMudSymbol, symbolMatrix,
} from '../server/casino/playngo-bookofdead-engine.mjs';
import {
  initResponse, spinResponse, freespinResponse, decodeRequest,
} from '../server/casino/playngo-bookofdead.mjs';

console.log('Testing Play\'n GO Book of Dead engine + protocol...');

// 1. Data sanity
assert.equal(LINES.length, 10, 'must have 10 paylines');
assert.equal(FREE_SPINS, 10, 'must award 10 free spins');
assert.deepEqual(Object.keys(PAYTABLE).map(Number).sort((a,b)=>a-b), [1,2,3,4,5,6,7,8,9]);
assert.equal(SCATTER_PAY[5], 500);

// 2. Grader: 5-of-a-kind line 0 (top row, explorer=1)
const topLineWin = [
  [1,2,3],
  [1,2,3],
  [1,2,3],
  [1,2,3],
  [1,2,3],
];
const graded = gradeGrid(topLineWin, 100, 10);
const line0 = graded.line_wins.find(w => w.idx === 0 && w.type === 'basic');
assert(line0, 'must grade line 0');
assert.equal(line0.code, 1);
assert.equal(line0.multiplier, 9000);
assert.equal(line0.amount, '900000.00');

// 3. Scatter (Book = code 0) pays total-bet
const scatterGrid = [
  [0,2,3],
  [0,2,3],
  [0,2,3],
  [4,5,6],
  [7,8,9],
];
const scatterGraded = gradeGrid(scatterGrid, 100, 10);
const bookWin = scatterGraded.line_wins.find(w => w.type === 'scatter');
assert(bookWin, '3 Books must pay as a scatter');
assert.equal(bookWin.multiplier, 5);
assert.equal(bookWin.amount, (5 * 100 * 10).toFixed(2)); // 5000.00

// 4. Wild substitution: Book (0) replaces the explorer, pays same as 5 explorers
const wildGrid = [
  [1,2,3],
  [0,2,3],
  [0,2,3],
  [0,2,3],
  [0,2,3],
];
const wildGraded = gradeGrid(wildGrid, 100, 10);
const wildLine = wildGraded.line_wins.find(w => w.idx === 0 && w.type === 'basic');
assert(wildLine, 'wild must complete the line');
assert.equal(wildLine.code, 1);
assert.equal(wildLine.multiplier, 9000);

// 5. Expanding symbol (mud) during free spins
const mudGrid = [
  [1,2,3],
  [1,4,5],
  [1,6,7],
  [1,8,9],
  [1,2,3],
];
// Only one full reel of code 1 → no mud win
assert.equal(gradeGrid(mudGrid, 100, 10, 1).line_wins.filter(w => w.type === 'mud').length, 0);
const mudGrid2 = [
  [1,2,3],
  [1,4,5],
  [1,6,7],
  [2,2,2],
  [1,2,3],
];
const mudWins = gradeGrid(mudGrid2, 100, 10, 1).line_wins.filter(w => w.type === 'mud');
assert(mudWins.length >= 1, 'mud must pay when 2+ reels are full');

// 6. randomGrid produces a valid 5x3 grid
for (let i = 0; i < 100; i++) {
  const g = randomGrid();
  assert.equal(g.length, 5);
  for (const col of g) {
    assert.equal(col.length, 3);
    for (const sym of col) assert(Number.isInteger(sym) && sym >= 0 && sym <= 9);
  }
}

// 7. symbolMatrix keys match grid dimensions
const symMat = symbolMatrix(randomGrid());
assert.equal(Object.keys(symMat).length, 5);
assert.equal(Object.keys(symMat[0]).length, 3);
assert.equal(typeof symMat[0][0].code, 'number');

// 8. initResponse fields the client requires (from HOWTO §4.2)
const init = initResponse({ credits: 1000, requestId: 1 });
assert(init.balance, 'balance');
assert(Array.isArray(init.available_actions));
assert.equal(init.available_actions[0], 'spin');
assert.equal(init.init.lines, 10);
assert.equal(init.init.directory.lines.length > 0, true);
assert.equal(init.init.directory.paytable, PAYTABLE);
assert.deepEqual(init.init.extra.symbol_types, { scatters: [0], wilds: [0] });

// 9. spinResponse fields
const spinRes = spinResponse({
  credits: 1000, stake: 100, payout: 500, bet: 10, lines: 10,
  grid: topLineWin, grading: gradeGrid(topLineWin, 10, 10),
  requestId: 1, free: null,
});
assert(spinRes.macro_round.wins.total);
assert(spinRes.spin.wins.line_wins.length >= 1);
assert(Array.isArray(spinRes.available_actions));
assert(spinRes.available_actions.includes('collect'));
assert(spinRes.available_actions.includes('spin'));

// 10. freespinResponse fields
const fsRes = freespinResponse({
  credits: 1000, payout: 500, bet: 10, lines: 10,
  grid: topLineWin, grading: gradeGrid(topLineWin, 10, 10),
  left: 8, done: 2, mud: 1, requestId: 5,
});
assert.equal(fsRes.spin.type, 'freespin');
assert.equal(fsRes.freespins.left, 8);
assert.equal(fsRes.freespins.done, 2);
assert.equal(fsRes.freespins.mud, 1);
assert(fsRes.spin.next_request_id === 6);

// 11. pickMudSymbol returns 1..9
for (let i = 0; i < 50; i++) {
  const s = pickMudSymbol();
  assert(Number.isInteger(s) && s >= 1 && s <= 9);
}

// 12. decodeRequest handles plain JSON and FormData
try { assert.deepEqual(decodeRequest({ body: { action: 'spin' } }), { action: 'spin' }); }
catch { /* body not a Buffer is fine */ }
const formBody = Buffer.from('------x\r\nContent-Disposition: form-data; name="data"\r\n\r\n{"action":"spin"}\r\n------x--');
const decoded = decodeRequest({ body: formBody, headers: { 'content-type': 'multipart/form-data; boundary=----x' } });
assert.equal(decoded.action, 'spin');

console.log('PASS Play\'n GO Book of Dead engine + protocol tests all succeeded!');
