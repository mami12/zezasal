/** Diagnostic Monte Carlo against actual engines; exact-weight tests remain authoritative. */
import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {spin as clover} from '../server/casino/lucky-clover-engine.mjs';
import {spin as vikings,spinRound} from '../server/casino/vikings-engine.mjs';
import {spin as agt} from '../server/casino/agt-engine.mjs';
import {randomGrid as sizzlingGrid,gradeGrid as sizzlingGrade} from '../server/casino/sizzling-demo.mjs';
import {randomGrid as bookGrid,gradeGrid as bookGrade} from '../server/casino/bookofra.mjs';
import {spinFireJokerRound} from '../server/casino/firejoker-engine.mjs';
import {spinFortuneRound} from '../server/casino/fortune-teller-engine.mjs';
import {getGameProfile} from '../server/casino/game-rtp-profiles.mjs';
import {CUSTOM_GAMES} from '../server/casino/custom-native.mjs';
import {validateControls,selectCustomRound,customGameSummary} from '../server/casino/custom-math.mjs';

function seeded(seed){let state=seed>>>0;return bound=>{
 assert.ok(Number.isSafeInteger(bound)&&bound>0&&bound<=4294967296);
 const ceiling=Math.floor(4294967296/bound)*bound;let value;
 do{state^=state<<13;state^=state>>>17;state^=state<<5;value=state>>>0;}while(value>=ceiling);
 return value%bound;
};}
const stake=10000,observations=[];
function measure(id,mode,target,n,sample,hitTarget=null){
 let sum=0,squares=0,hits=0;
 for(let i=0;i<n;i++){
  const payout=sample();assert.ok(Number.isSafeInteger(payout)&&payout>=0,id+' integer-cent payout');
  const value=payout/stake*100;sum+=value;squares+=value*value;hits+=payout>0?1:0;
 }
 const measuredRtp=sum/n,rtpStandardError=Math.sqrt(Math.max(0,squares/n-measuredRtp*measuredRtp)/n),measuredHit=hits/n*100;
 assert.ok(Math.abs(measuredRtp-target)<=6*rtpStandardError+1,id+' sampled return disagrees with its disclosed model');
 if(hitTarget!=null){
  const hitStandardError=Math.sqrt(hitTarget/100*(1-hitTarget/100)/n)*100;
  assert.ok(Math.abs(measuredHit-hitTarget)<=6*hitStandardError+.05,id+' sampled hit frequency disagrees with target');
 }
 const row={game:id,mode,paidRounds:n,targetRtp:target,measuredRtp,rtpStandardError,targetHitFrequency:hitTarget,measuredHitFrequency:measuredHit};
 observations.push(row);console.log(JSON.stringify(row));
}

process.env.BOOKOFRA_FREE_SPINS='0';
const originalN=100000;
for(const id of ['lucky-clover-x3','vikings-fun','fruit-queen','seven-hot','sizzling','bookofra','firejoker','fortune-teller']){
 const profile=getGameProfile(id),random=seeded(0x3ae834b),options={mathProfile:profile};
 const sample=id==='lucky-clover-x3'?()=>clover(stake,5,random,options).winCents
  :id==='vikings-fun'?()=>spinRound(stake,25,(bet,lines,free,selected)=>vikings(bet,lines,free,random,selected),options).winCents
  :id==='fruit-queen'?()=>agt('fruitqueen',stake,18,random,options).winCents
  :id==='seven-hot'?()=>agt('sevenhot20',stake,20,random,options).winCents
  :id==='sizzling'?()=>Math.round(sizzlingGrade(sizzlingGrid(random,profile.reels),stake/100/5).total*100)
  :id==='bookofra'?()=>Math.round(bookGrade(bookGrid(random,profile.reels),stake/100/10,10).total*100)
  :id==='firejoker'?()=>spinFireJokerRound({stakeCents:stake,mathProfile:profile,random}).winCents
  :()=>spinFortuneRound({stakeCents:stake,lines:20,mathProfile:profile,random}).winCents;
 measure(id,'original',profile.theoreticalRtp,originalN,sample);
}
// The currently supported Book bonus model must include all ten awarded rounds.
process.env.BOOKOFRA_FREE_SPINS='1';
{
 const profile=getGameProfile('bookofra'),random=seeded(0x7a924b);
 measure('bookofra','original-with-free-spins',profile.theoreticalRtp,originalN,()=>{
  const grid=bookGrid(random,profile.reels);let payout=bookGrade(grid,stake/100/10,10).total;
  if(grid.flat().filter(symbol=>symbol===0).length>=3){const mud=random(9)+1;for(let free=0;free<10;free++)payout+=bookGrade(bookGrid(random,profile.reels),stake/100/10,10,mud).total;}
  return Math.round(payout*100);
 });
}
process.env.BOOKOFRA_FREE_SPINS='0';
const unsupported=[];
for(const [id,game]of Object.entries(CUSTOM_GAMES)){
 for(const [rtp,hitFrequency]of [[10,1],[50,5],[100,20],[200,50],[1000,100]]){
  let controls;
  try{controls=validateControls(id,{mode:'custom',rtp,hitFrequency});}
  catch(error){assert.equal(error.code,'INVALID_CUSTOM_MATH');unsupported.push({game:id,rtp,hitFrequency,reason:'Outside native paytable conditional-mean bounds'});continue;}
  const random=seeded(0x93748ce);
  measure(id,'custom',rtp,5000,()=>selectCustomRound(id,{stakeCents:stake,lines:game.lines.at(-1),controls},random).payoutCents,hitFrequency);
 }
 assert.throws(()=>validateControls(id,{mode:'custom',rtp:1000,hitFrequency:1000}),/Hit frequency/);
 assert.ok(customGameSummary(id).customLimits.maxWinMultiplier>0);
}
await mkdir('test-artifacts',{recursive:true});
await writeFile('test-artifacts/protected-casino-simulation.json',JSON.stringify({diagnosticOnly:true,notCertification:true,observations,unsupported},null,2)+'\n');
console.log('PASS protected casino simulations: all eight original engines, Book bonus, supported custom examples, exact monetary outcomes and honest unreachable-pair rejection');
