import {gradeFortuneLine,fortuneCardsWin,FORTUNE_SCATTER,FORTUNE_FREE_SPINS} from './fortune-teller-engine.mjs';
/** Enumerate symbol probabilities and exact visible scatter-count distributions. */
export function fortuneTellerReturn(reels,lines=20){
 const probabilities=reels.map(reel=>Array.from({length:12},(_,index)=>reel.filter(value=>value===index+1).length/reel.length));
 let base=0,free=0;
 const symbols=[];
 function enumerate(reel,probability){
  if(reel===5){base+=(gradeFortuneLine(symbols)?.multiplier??0)*probability;free+=(gradeFortuneLine(symbols,true)?.multiplier??0)*probability;return;}
  for(let symbol=1;symbol<=12;symbol++)if(probabilities[reel][symbol-1]){symbols[reel]=symbol;enumerate(reel+1,probability*probabilities[reel][symbol-1]);}
 }
 enumerate(0,1);
 function counts(symbol){
  let total=[1];
  for(const reel of reels){
   const local=Array(4).fill(0);
   for(let stop=0;stop<reel.length;stop++)local[[0,1,2].filter(row=>reel[(stop+row)%reel.length]===symbol).length]+=1/reel.length;
   const next=Array(total.length+3).fill(0);for(let i=0;i<total.length;i++)for(let j=0;j<local.length;j++)next[i+j]+=total[i]*local[j];total=next;
  }return total;
 }
 const cats=counts(2),tarot=counts(3),bonusHit=tarot.slice(3).reduce((sum,p)=>sum+p,0);
 let expectedCards=0;for(let a=1;a<=4;a++)for(let b=1;b<=4;b++)for(let c=1;c<=4;c++)expectedCards+=fortuneCardsWin([a,b,c])/64;
 const cards=bonusHit*expectedCards/lines;
 const scatter=cats.reduce((sum,p,count)=>sum+p*(FORTUNE_SCATTER[count-1]??0),0);
 const expectedFree=cats.reduce((sum,p,count)=>sum+p*(FORTUNE_FREE_SPINS[count-1]??0),0);
 return {rtp:100*(base+scatter+cards+expectedFree*(free+cards)),baseLines:100*base,scatters:100*scatter,cards:100*cards,expectedFreeSpins:expectedFree,freeGameReturn:100*(free+cards),cardsHitProbability:bonusHit};
}
