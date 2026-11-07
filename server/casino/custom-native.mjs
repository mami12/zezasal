/** Native paytable grading shared by the offline catalog builder and selector.
 * This module never draws randomness. Every stop is part of an accepted,
 * versioned paid-round trajectory; free games remain part of that contract.
 */
import {DATA as CLOVER,evaluate as cloverEvaluate} from './lucky-clover-engine.mjs';
import {DATA as VIKINGS,evaluate as vikingsEvaluate} from './vikings-engine.mjs';
import {DATA as AGT,evaluate as agtEvaluate} from './agt-engine.mjs';
import {gradeGrid as gradeSizzling} from './sizzling-demo.mjs';
import {gradeGrid as gradeBook,FREE_SPINS} from './bookofra.mjs';

export const CUSTOM_GAMES=Object.freeze({
 'lucky-clover-x3':Object.freeze({lines:Object.freeze([5]),kind:'clover'}),
 'vikings-fun':Object.freeze({lines:Object.freeze([25]),kind:'vikings'}),
 'fruit-queen':Object.freeze({lines:Object.freeze(Array.from({length:18},(_,i)=>i+1)),kind:'agt',internal:'fruitqueen'}),
 'seven-hot':Object.freeze({lines:Object.freeze(Array.from({length:20},(_,i)=>i+1)),kind:'agt',internal:'sevenhot20'}),
 sizzling:Object.freeze({lines:Object.freeze([5]),kind:'sizzling'}),
 bookofra:Object.freeze({lines:Object.freeze([10]),kind:'book'}),
});
export const supportsCustomCasinoMath=gameId=>Object.hasOwn(CUSTOM_GAMES,gameId);
export const customVariant=gameId=>gameId==='bookofra'?`bookofra-${process.env.BOOKOFRA_FREE_SPINS==='1'?'on':'off'}`:gameId;
export function customGrid(reels,stops,rows=3){
 if(!Array.isArray(stops)||stops.length!==5)throw new Error('Invalid catalog stops');
 return reels.map((reel,x)=>{
  const stop=stops[x];
  if(!Number.isInteger(stop)||stop<0||stop>=reel.length)throw new Error('Invalid catalog reel stop');
  return Array.from({length:rows},(_,y)=>reel[(stop+y)%reel.length]);
 });
}
export function gradeNativeTrajectory(gameId,entry,trajectory,{stakeCents,lines}){
 const game=CUSTOM_GAMES[gameId];
 if(!game||!game.lines.includes(lines))throw new Error('Unsupported catalog line count');
 if(!Number.isSafeInteger(stakeCents)||stakeCents<=0)throw new Error('Invalid catalog stake');
 if(!trajectory||!Array.isArray(trajectory.stops)||trajectory.stops.length<1||trajectory.stops.length>256)throw new Error('Invalid complete catalog trajectory');
 const spins=[];let remaining=0,totalFree=0,played=0,cumulative=0;
 for(let index=0;index<trajectory.stops.length;index++){
  const stops=trajectory.stops[index],grid=customGrid(entry.reels,stops,entry.rows??3),free=index>0;
  if(free&&remaining<=0)throw new Error('Catalog contains an unawarded free game');
  if(free){remaining--;played++;}
  let result;
  if(game.kind==='clover')result=cloverEvaluate(grid,stakeCents,lines);
  else if(game.kind==='vikings')result=vikingsEvaluate(grid,stakeCents,lines,free);
  else if(game.kind==='agt')result=agtEvaluate(game.internal,grid,stakeCents,lines);
  else if(game.kind==='sizzling'){
   const graded=gradeSizzling(grid,stakeCents/(100*lines),1);
   result={graded,winCents:Math.round(graded.total*100),freeSpins:0};
  }else{
   const graded=gradeBook(grid,stakeCents/(100*lines),lines,free?trajectory.mud:null);
   const freeSpins=!free&&entry.freeSpinsEnabled&&grid.flat().filter(symbol=>symbol===0).length>=3?FREE_SPINS:0;
   if(freeSpins&&(!Number.isInteger(trajectory.mud)||trajectory.mud<1||trajectory.mud>9))throw new Error('Catalog bonus is missing its frozen expanding symbol');
   result={graded,winCents:Math.round(graded.total*100),freeSpins,mud:trajectory.mud??null};
  }
  const added=Number(result.freeSpins||0);remaining+=added;totalFree+=added;cumulative+=result.winCents;
  spins.push({...result,grid,stops:[...stops],free,freeGameNumber:played,freeGameTotal:totalFree,totalWin:cumulative});
 }
 if(remaining!==0)throw new Error('Catalog truncates an awarded bonus');
 if(!Number.isSafeInteger(cumulative)||cumulative<0)throw new Error('Invalid catalog payout');
 return {spins,payoutCents:cumulative};
}

/** The reference stake makes all line stakes integral. Original scanners round
 * once per spin; Pixi rounds once per award. Bound the absolute cent rounding
 * error by 0.5 per such operation, including every awarded free game. */
export function trajectoryReturnBounds(gameId,entry,trajectory,lines){
 const reference=lines*10000,result=gradeNativeTrajectory(gameId,entry,trajectory,{stakeCents:reference,lines});
 const roundingOperations=result.spins.reduce((sum,spin)=>{
  // An integral multiplier always returns an integral number of cents. At
  // these bounded stakes floating-point error stays far below half a cent.
  if(!spin.graded)return sum+(Number.isInteger(spin.winCents/reference)?0:1);
  return sum+spin.graded.line_wins.filter(win=>!Number.isInteger(Math.round(Number(win.amount)*100)/reference)).length;
 },0);
 return {coefficient:result.payoutCents/reference,errorCents:roundingOperations/2,roundingHalfCents:roundingOperations,referencePayoutCents:result.payoutCents,referenceStakeCents:reference};
}

// Used only by the offline generator to identify the original immutable strips.
export function originalCatalogReels(gameId,profile){
 if(gameId==='lucky-clover-x3')return CLOVER.reels[Object.keys(CLOVER.reels).find(key=>Number(key)===profile.rtp)];
 if(gameId==='vikings-fun')return VIKINGS.reels[Object.keys(VIKINGS.reels).find(key=>Number(key)===profile.rtp)];
 if(gameId==='fruit-queen'||gameId==='seven-hot'){
  const game=AGT.games[CUSTOM_GAMES[gameId].internal];return game.reels[Object.keys(game.reels).find(key=>Number(key)===profile.rtp)];
 }
 return profile.reels;
}
