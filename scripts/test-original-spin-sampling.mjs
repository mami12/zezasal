import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {spin as cloverSpin} from '../server/casino/lucky-clover-engine.mjs';
import {spin as vikingsSpin,spinRound} from '../server/casino/vikings-engine.mjs';
import {spin as agtSpin,DATA as AGT} from '../server/casino/agt-engine.mjs';
import {createCtProtocol} from '../server/casino/ct-protocol.mjs';
import {formatAgtSpin} from '../server/casino/agt-protocol.mjs';
import {vikingsConfig,mapVikingsRound} from '../server/casino/vikings-ct-router.mjs';
import {getGameProfile,getGameProfiles} from '../server/casino/game-rtp-profiles.mjs';

// Reproducible diagnostic sampling, not an RTP certification or an assertion
// that a small sample must equal a long-run theoretical return.
const count=5000,observations=[];
function generator(seed){let state=seed>>>0;return bound=>{state^=state<<13;state^=state>>>17;state^=state<<5;return Math.floor((state>>>0)/4294967296*bound);};}
for(const id of ['lucky-clover-x3','vikings-fun','fruit-queen','seven-hot']){
 const all=getGameProfiles(id),profiles=[...new Map([all[0],getGameProfile(id),all.at(-1)].map(profile=>[profile.id,profile])).values()];
 for(const mathProfile of profiles){
  const random=generator(0x93ab128c),options={mathProfile};let positive=0,zero=0,profitable=0,stakeReturned=0,partialReturn=0,individualSpins=0,current;
  const protocol=id==='lucky-clover-x3'?createCtProtocol({spinFn:()=>current}):id==='vikings-fun'?createCtProtocol({spinFn:()=>current,selectedLines:25,configFn:vikingsConfig,mapRound:mapVikingsRound}):null;
  for(let index=0;index<count;index++){
   if(id==='lucky-clover-x3')current=cloverSpin(100,5,random,options);
   else if(id==='vikings-fun')current=spinRound(100,25,(bet,lines,free,spinOptions)=>vikingsSpin(bet,lines,free,random,spinOptions),options);
   else current=agtSpin(id==='fruit-queen'?'fruitqueen':'sevenhot20',100,id==='fruit-queen'?18:20,random,options);
   assert(Number.isSafeInteger(current.winCents)&&current.winCents>=0);
   const spins=current.games??[current];individualSpins+=spins.length;
   for(const result of spins){
    assert.equal(Math.round(result.wins.reduce((sum,win)=>sum+win.amount,0)),result.winCents,'positive payouts must exactly match graded wins');
    assert.equal(result.winCents>0,result.wins.some(win=>win.amount>0));
   }
   if(current.winCents>0)positive++;else zero++;
   if(current.winCents>100)profitable++;else if(current.winCents===100)stakeReturned++;else if(current.winCents>0)partialReturn++;
   if(protocol){
    const lines=id==='lucky-clover-x3'?5:25,state={credit:10000000,grid:current.grid,results:new Map(),round:0,pending:0,history:[],mathProfile};
    const response=protocol.run(state,[{command:'play',sequence_number:1,game_denom:1,lines,line_bet:100/lines,total_bet:100}],options)[0];
    assert.equal(response.status.status,'ok');assert.equal(state.pending,current.winCents);
    const slots=response.result.filter(result=>result.type==='slot_subgame');
    assert.equal(slots.reduce((sum,result)=>sum+result.win,0),current.winCents);
    assert.equal(Math.round(slots.reduce((sum,result)=>sum+[...result.lines_win,...result.scatters_win].reduce((value,win)=>value+win.win,0),0)),current.winCents);
    if(current.winCents===0)assert(slots.every(result=>result.lines_win.length===0&&result.scatters_win.length===0),'losing CT rounds must never send winning-line animations');
   }else{
    const internal=id==='fruit-queen'?'fruitqueen':'sevenhot20',formatted=formatAgtSpin(internal,current,options),lines=AGT.games[internal].lines.length;
    assert.equal(formatted.linesMask.length,lines+1);
    assert.equal(Math.round(formatted.linesValue.reduce((sum,value)=>sum+value,0)*100),current.winCents);
    for(let line=0;line<=lines;line++)assert.equal(formatted.linesMask[line]!==0,formatted.linesValue[line]>0,'AGT winning masks must only mark actual paid wins');
    if(current.winCents===0){assert(formatted.linesMask.every(value=>value===0));assert(formatted.linesValue.every(value=>value===0));}
   }
  }
  assert(positive>0&&zero>0,`${id} must produce both winning and losing rounds`);
  assert.equal(positive,profitable+stakeReturned+partialReturn);
  observations.push({game:id,rtp:mathProfile.theoreticalRtp,paidRounds:count,positivePayoutRounds:positive,profitableRounds:profitable,stakeReturnedRounds:stakeReturned,partialReturnRounds:partialReturn,zeroPayoutRounds:zero,individualSpins});
 }
}
console.log(JSON.stringify(observations));
console.log(`PASS ${observations.length*count} deterministic paid-round samples: both wins and losses, exact response payouts, no false CT/AGT winning masks, and full Vikings free-game totals`);
