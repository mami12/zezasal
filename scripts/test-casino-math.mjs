import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {publicRtpProfiles,randomProfileGrid,profileById} from '../server/casino/rtp-profiles.mjs';
import {gradeGrid,randomGrid,paytable,paylines} from '../server/casino/sizzling-demo.mjs';
import {gradeGrid as gradeBook,randomGrid as bookGrid,PAYTABLE,LINES,SCATTER_PAY} from '../server/casino/bookofra.mjs';
import {reelReturn} from '../server/casino/reel-return.mjs';
import {bookProfiles} from '../server/casino/bookofra-profiles.mjs';
const toy=[[0,1,7,7],[1,0,7,1],[7,7,0,1],[0,7,1,7],[7,1,0,1]];
const grids=[];
for(let a=0;a<4;a++)for(let b=0;b<4;b++)for(let c=0;c<4;c++)for(let d=0;d<4;d++)for(let e=0;e<4;e++){
 const stops=[a,b,c,d,e];grids.push(toy.map((reel,i)=>Array.from({length:3},(_,r)=>reel[(stops[i]+r)%4])));
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
// Exhaustive stop enumeration independently verifies the analytic model against
// the actual production graders, including dependent visible scatter positions.
close(reelReturn(toy,paytable,paylines,{scatterPay:paytable[0]}).rtp,grids.reduce((sum,grid)=>sum+gradeGrid(grid,1).total,0)/grids.length/5*100);
const base=reelReturn(toy,PAYTABLE,LINES,{wild:0,scatterPay:SCATTER_PAY});
close(base.rtp,grids.reduce((sum,grid)=>sum+gradeBook(grid,1).total,0)/grids.length/10*100);
close(base.triggerProbability,grids.filter(grid=>grid.flat().filter(s=>s===0).length>=3).length/grids.length);
for(let mud=1;mud<=9;mud++)close(reelReturn(toy,PAYTABLE,LINES,{wild:0,scatterPay:SCATTER_PAY,expanding:mud}).rtp,
 grids.reduce((sum,grid)=>sum+gradeBook(grid,1,10,mud).total,0)/grids.length/10*100);
assert.equal(profileById('SCHOOL_RTP_1'),null);assert.throws(()=>randomProfileGrid('SCHOOL_RTP_1'));
assert.equal(gradeGrid(Array.from({length:5},()=>[1,1,1]),1).total,25000);
assert.equal(gradeBook(Array.from({length:5},()=>[1,1,1]),1).total,90000);
assert.equal(publicRtpProfiles().length,4);
for(const profile of publicRtpProfiles()){
 const internal=profileById(profile.id);
 close(profile.theoreticalRtp,Number(reelReturn(internal.reels,paytable,paylines,{scatterPay:paytable[0]}).rtp.toFixed(6)));
 let state=0x23456789;const random=bound=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)%bound;};
 let hits=0,total=0,sumSquares=0;const samples=100000;
 for(let i=0;i<samples;i++){
  const payout=gradeGrid(randomProfileGrid(profile.id,random),1).total,rtp=payout/5*100;
  hits+=payout>0?1:0;total+=rtp;sumSquares+=rtp*rtp;
 }
 const estimate=total/samples,se=Math.sqrt(Math.max(0,sumSquares/samples-estimate*estimate)/samples);
 assert.ok(Math.abs(estimate-profile.theoreticalRtp)<=6*se+0.5,'Seeded diagnostic disagrees with exact reel expectation');
 assert.ok(hits<samples*.8,'Not every spin is a winning spin');
 console.log(`Sizzling ${profile.id}: analytic ${profile.theoreticalRtp}%, seeded estimate ${estimate.toFixed(2)}% ±${(6*se).toFixed(2)}%, winning spins ${(hits/samples*100).toFixed(2)}%`);
}
for(const profile of bookProfiles()){
 const measured=reelReturn(profile.reels,PAYTABLE,LINES,{wild:0,scatterPay:SCATTER_PAY});close(measured.rtp,profile.baseRtp);
 const free=Array.from({length:9},(_,i)=>reelReturn(profile.reels,PAYTABLE,LINES,{wild:0,scatterPay:SCATTER_PAY,expanding:i+1}).rtp).reduce((a,b)=>a+b,0)/9;
 close(profile.bonusRtp,profile.baseRtp+measured.triggerProbability*10*free);
}
console.log('PASS casino math: exhaustive legacy scanner expectation, all9expanding symbols, real reel profiles, immutable paytables, rejected fake1%, seeded sampling and hitfrequency');
