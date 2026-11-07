import assert from 'node:assert/strict';
import { DATA,PAY,SPRITES,evaluate,spin } from '../server/casino/lucky-clover-engine.mjs';
import { existsSync,readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
assert.equal(DATA.lines.length,30);assert.equal(Object.keys(DATA.reels).length,22);
for(const reels of Object.values(DATA.reels)){assert.equal(reels.length,5);reels.forEach(r=>assert.ok(r.length>30&&r.every(s=>s>=1&&s<=11)));}
const blank=()=>[[8,9,10],[9,10,11],[10,11,7],[11,7,8],[7,8,9]];
let g=blank();g[0][1]=g[1][1]=4;
assert.equal(evaluate(g,100,1).winCents,1000,'two sevens pay 10 line bets');
g=[[4,4,4],[1,8,8],[1,9,9],[1,10,10],[4,4,4]];
let result=evaluate(g,100,5);
assert.equal(result.multiplier,3);assert.equal(result.winCents,900000,'three consecutive reel wilds multiply all five seven wins');
g=[[4,8,8],[1,9,9],[1,10,10],[4,7,7],[4,11,11]];
result=evaluate(g,100,5);assert.equal(result.multiplier,2);assert.equal(result.wins.find(w=>w.line===2).amount,120000);
g=[[4,8,8],[7,9,9],[1,10,10],[1,7,7],[4,11,11]];
assert.equal(evaluate(g,100).multiplier,1,'wilds on reels three and four alone do not activate x2');
g=[[2,3,8],[2,7,9],[2,3,10],[7,8,11],[7,3,9]];
result=evaluate(g,100);assert.equal(result.winCents,300);assert.equal(result.wins.length,1);assert.equal(result.wins[0].symbol,2,'star scatter takes precedence over banana');
g=blank();g[0][0]=g[2][0]=g[4][0]=3;
assert.equal(evaluate(g,100).wins.find(w=>w.symbol===3).amount,2000);
g=[[2,8,9],[1,2,9],[1,2,9],[8,9,10],[9,10,11]];
assert.equal(evaluate(g,100).wins.find(w=>w.symbol===2).amount,600,'wild multiplier also applies to scatter');
const fixed=spin(100,5,()=>0);assert.deepEqual(fixed.grid,DATA.reels['96.057605'].map(r=>r.slice(0,3)));
assert.throws(()=>evaluate(blank(),NaN));assert.throws(()=>evaluate(blank(),100,31));
for(const id of SPRITES){assert.ok(existsSync(new URL(`../web/public/casino-assets/lucky-clover-x3/croppedSyms/sym_${String(id).padStart(2,'0')}.webp`,import.meta.url)));}
console.log('PASS Slotopol Lucky Clover paylines, wild multipliers, scatters, reels and sprites');
