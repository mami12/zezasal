import {randomInt} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {casinoStakeCents} from './bet-limits.mjs';
export const FORTUNE_DATA=JSON.parse(readFileSync(new URL('./fortune-teller-data.json',import.meta.url),'utf8'));
export const FORTUNE_LINES=[
 [2,2,2,2,2],[1,1,1,1,1],[3,3,3,3,3],[1,2,3,2,1],[3,2,1,2,3],
 [2,1,1,1,2],[2,3,3,3,2],[1,1,2,3,3],[3,3,2,1,1],[2,3,2,1,2],
 [2,1,2,3,2],[1,2,2,2,1],[3,2,2,2,3],[1,2,1,2,1],[3,2,3,2,3],
 [2,2,1,2,2],[2,2,3,2,2],[1,1,3,1,1],[3,3,1,3,3],[1,3,3,3,1],
].map(line=>line.map(row=>row-1));
export const FORTUNE_PAY=[
 [0,0,50,500,5000],[0,0,0,0,0],[0,0,0,0,0],[0,0,25,250,1000],
 [0,0,15,100,500],[0,0,15,100,500],[0,0,15,75,250],
 [0,0,10,50,150],[0,0,10,50,150],[0,0,5,25,100],[0,0,5,25,100],[0,0,5,25,100],
];
export const FORTUNE_SCATTER=[0,2,3,30,300],FORTUNE_FREE_SPINS=[0,0,15,20,25];
/** Exact port of ScanLinedReg/ScanLinedBon, including leading cat/wild rules. */
export function gradeFortuneLine(symbols,free=false){
 let wilds=0,count=5,symbol=0,continuous=true;
 for(let index=0;index<5;index++){
  const value=symbols[index];
  if(value===1){if((!free||continuous)&&symbol===0)wilds=index+1;}
  else if(free&&value===2)continuous=false;
  else if(symbol===0)symbol=value;
  else if(value!==symbol){count=index;break;}
 }
 const wildPay=wilds>=3?FORTUNE_PAY[0][wilds-1]:0;
 const linePay=count>=3&&symbol>0?FORTUNE_PAY[symbol-1][count-1]:0;
 return linePay>wildPay?{symbol,count,multiplier:linePay}:wildPay>0?{symbol:1,count:wilds,multiplier:wildPay}:null;
}
export function fortuneCardsWin(cards){
 if(!Array.isArray(cards)||cards.length!==3||cards.some(card=>!Number.isInteger(card)||card<1||card>4))throw Error('Invalid Tarot cards');
 const counts=[1,2,3,4].map(type=>cards.filter(card=>card===type).length);
 const triple=counts.indexOf(3);if(triple>=0)return [1000,200,50,20][triple];
 const pair=counts.indexOf(2);return pair>=0?[100,20,10,5][pair]:5;
}
export function gradeFortuneGrid(grid,{stakeCents,lines=20,free=false}){
 if(!Array.isArray(grid)||grid.length!==5||grid.some(reel=>!Array.isArray(reel)||reel.length!==3||reel.some(symbol=>!Number.isInteger(symbol)||symbol<1||symbol>12)))throw Error('Invalid Fortune Teller grid');
 if(!Number.isSafeInteger(stakeCents)||stakeCents<=0||!Number.isInteger(lines)||lines<1||lines>20||stakeCents%lines)throw Error('Invalid Fortune Teller stake');
 const wins=[],lineBet=stakeCents/lines;
 for(let line=0;line<lines;line++){
  const rows=FORTUNE_LINES[line],win=gradeFortuneLine(rows.map((row,reel)=>grid[reel][row]),free);
  if(win){const amountCents=lineBet*win.multiplier;wins.push({...win,line:line+1,amountCents,cells:rows.slice(0,win.count).map((row,reel)=>[reel,row])});}
 }
 const positions=symbol=>grid.flatMap((reel,x)=>reel.flatMap((value,y)=>value===symbol?[[x,y]]:[]));
 const cats=positions(2),tarot=positions(3);let freeSpins=0;
 if(!free&&cats.length>=2){
  if(cats.length>5)throw Error('Invalid Fortune Teller scatter count');
  const multiplier=FORTUNE_SCATTER[cats.length-1];freeSpins=FORTUNE_FREE_SPINS[cats.length-1];
  wins.push({symbol:2,count:cats.length,multiplier,line:0,amountCents:stakeCents*multiplier,cells:cats,freeSpins});
 }
 if(tarot.length>=3)wins.push({symbol:3,count:tarot.length,multiplier:0,line:0,amountCents:0,cells:tarot,bonus:true});
 const winCents=wins.reduce((sum,win)=>sum+win.amountCents,0);
 if(!Number.isSafeInteger(winCents))throw Error('Fortune Teller payout exceeds safe range');
 return {grid,wins,winCents,freeSpins,cardsTriggered:tarot.length>=3};
}
const reelsFor=profile=>{
 const reels=FORTUNE_DATA.reels[String(Number(profile?.rtp??FORTUNE_DATA.defaultRtp))];
 if(!reels)throw Object.assign(Error('Unsupported Fortune Teller reel profile'),{status:503,code:'UNSUPPORTED_MATH_PROFILE'});return reels;
};
const draw=(bound,random)=>{const value=random(bound);if(!Number.isInteger(value)||value<0||value>=bound)throw Error('Invalid Fortune Teller random draw');return value;};
export function initialFortuneGrid({mathProfile,random=randomInt}={}){
 return reelsFor(mathProfile).map(reel=>{const stop=draw(reel.length,random);return [0,1,2].map(row=>reel[(stop+row)%reel.length]);});
}
/** A single accepted draw freezes every awarded free game and Tarot award. */
export function spinFortuneRound({stakeCents,lines=20,mathProfile,random=randomInt}){
 if(casinoStakeCents(stakeCents/100)!==stakeCents||!Number.isInteger(lines)||lines<1||lines>20||stakeCents%lines)throw Error('Invalid Fortune Teller stake');
 const games=[];let total=0,freeTotal=0;
 for(let index=0;index<=freeTotal;index++){
  const game=gradeFortuneGrid(initialFortuneGrid({mathProfile,random}),{stakeCents,lines,free:index>0});
  if(index===0)freeTotal=game.freeSpins;
  if(game.cardsTriggered){
   const cards=Array.from({length:3},()=>draw(4,random)+1),multiplier=fortuneCardsWin(cards);
   game.cardsBonus={cards,multiplier,amountCents:stakeCents/lines*multiplier};game.winCents+=game.cardsBonus.amountCents;
  }
  total+=game.winCents;games.push({...game,free:index>0,freeGameNumber:index,freeGameTotal:freeTotal,totalWin:total});
 }
 if(!Number.isSafeInteger(total))throw Error('Fortune Teller payout exceeds safe range');
 return {grid:games.at(-1).grid,winCents:total,games,awardedFreeSpins:freeTotal};
}
