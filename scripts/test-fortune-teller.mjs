import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {FORTUNE_DATA,FORTUNE_LINES,FORTUNE_PAY,gradeFortuneLine,gradeFortuneGrid,fortuneCardsWin,spinFortuneRound} from '../server/casino/fortune-teller-engine.mjs';
import {fortuneTellerReturn} from '../server/casino/fortune-teller-return.mjs';
import {createFortuneTellerProtocol} from '../server/casino/fortune-teller-protocol.mjs';
import {getGameProfile,getGameProfiles} from '../server/casino/game-rtp-profiles.mjs';
assert.equal(FORTUNE_LINES.length,20);assert.equal(FORTUNE_PAY.length,12);assert.equal(Object.keys(FORTUNE_DATA.reels).length,13);
for(const[name,expected]of Object.entries({fortuneteller_cards:'47bb67fad5d78b6429d72a640854d2d2d2bc388c',fortuneteller_rule:'b4a58f4064a2ffeef828334981a1093bfb7066b9',fortuneteller_scan:'fc1ac52835c5cfc6509512b0803a39c57d8ac37f'})){
 const content=readFileSync(new URL(`../server/casino/slotopol-source/${name}.go`,import.meta.url));
 assert.equal(createHash('sha1').update('blob '+content.length+'\0').update(content).digest('hex'),expected,'pinned upstream source '+name);
}
assert.deepEqual(gradeFortuneLine([1,1,1,4,4]),{symbol:4,count:5,multiplier:1000},'highest substituted win beats the leading-wild win');
assert.deepEqual(gradeFortuneLine([1,1,1,2,2]),{symbol:1,count:3,multiplier:50});
assert.deepEqual(gradeFortuneLine([2,1,1,4,4],true),{symbol:4,count:5,multiplier:1000});
assert.equal(gradeFortuneLine([2,1,1,1,3],true),null,'a leading cat does not become a pure-wild jackpot');
assert.deepEqual(gradeFortuneLine([1,1,1,1,1]),{symbol:1,count:5,multiplier:5000});
const grid=Array.from({length:5},()=>[2,8,9]);
const trigger=gradeFortuneGrid(grid,{stakeCents:2000});assert.equal(trigger.freeSpins,25);assert.equal(trigger.wins.find(win=>win.symbol===2).amountCents,600000);
assert.equal(gradeFortuneGrid(grid,{stakeCents:2000,free:true}).freeSpins,0,'free games never retrigger');
let sum=0;for(let a=1;a<=4;a++)for(let b=1;b<=4;b++)for(let c=1;c<=4;c++)sum+=fortuneCardsWin([a,b,c]);
assert.equal(sum/64,40.703125);assert.equal(fortuneCardsWin([1,1,1]),1000);assert.equal(fortuneCardsWin([2,2,2]),200);assert.equal(fortuneCardsWin([3,3,3]),50);assert.equal(fortuneCardsWin([4,4,4]),20);
assert.equal(fortuneCardsWin([1,1,3]),100);assert.equal(fortuneCardsWin([2,3,4]),5);
for(const[key,reels]of Object.entries(FORTUNE_DATA.reels)){
 const one=fortuneTellerReturn(reels,1),twenty=fortuneTellerReturn(reels,20);
 assert.ok(Math.abs(one.rtp-Number(key))<.00001,'all upstream one-line scan results match');
 assert.ok(Math.abs(twenty.rtp-FORTUNE_DATA.returns[key].twentyLines.rtp)<1e-10,'packaged twenty-line return matches actual line-bet Tarot awards');
}
assert.equal(getGameProfiles('fortune-teller').length,13);
assert.ok(Math.abs(getGameProfile('fortune-teller').theoreticalRtp-67.49826275592544)<1e-10,'admin reports the effective 20-line return');
const reels=FORTUNE_DATA.reels[String(FORTUNE_DATA.defaultRtp)],stops=reels.map(reel=>reel.indexOf(2));let draw=0;
const round=spinFortuneRound({stakeCents:2000,random:bound=>{const stop=stops[draw++%5];assert.ok(stop<bound);return stop;}});
assert.equal(round.games.length,26);assert.equal(round.awardedFreeSpins,25);assert.ok(round.games.slice(1).every(game=>game.free&&game.freeSpins===0));
assert.equal(round.winCents,round.games.reduce((sum,game)=>sum+game.winCents,0));
for(const value of [0,1999,500001,Infinity])assert.throws(()=>spinFortuneRound({stakeCents:value}));
const protocol=createFortuneTellerProtocol(),state=protocol.initialState('FortuneTeller',{walletLimits:true});
const created=protocol.run(state,[{command:'create_session',sequence_number:0}])[0];assert.equal(created.enabled_denoms[0].cents,1);
const play={command:'play',sequence_number:1,lines:20,line_bet:100,total_bet:2000,game_denom:1};
const reply=protocol.run(state,[play])[0];assert.equal(reply.status.status,'ok');assert.equal(state.credit,9998000);
assert.deepEqual(protocol.run(state,[play])[0],reply,'same sequence replays the same spin');
protocol.run(state,[{command:'game_finished',sequence_number:2,gameplay_id:reply.gameplay_id}]);assert.equal(state.pending,0);
console.log('PASS Fortune Teller: pinned Go source, wild/cat rules, all 64 Tarot outcomes, all 13 reel sets and exact returns, 25-free-game chain, stake limits and protocol replay');
