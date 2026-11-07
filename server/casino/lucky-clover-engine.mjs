// Port of Slotopol luckycloverx3_rule.go; upstream MIT license in slotopol-source/.
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const DATA = JSON.parse(readFileSync(new URL('./lucky-clover-data.json', import.meta.url),'utf8'));
export const PAY = [[],[],[],[0,10,50,200,3000],[0,0,40,100,500],[0,0,40,100,500],[0,0,20,50,200],[0,0,10,30,100],[0,0,10,30,100],[0,0,10,30,100],[0,0,10,30,100]];
export const SYMBOLS = ['Wild','Star scatter','Banana scatter','Seven','Horseshoe','Coin','Bell','Apple','Peach','Plum','Cherry'];
// Actual CDN sprite numbers differ from the Slotopol symbol identifiers.
export const SPRITES = [11,1,10,9,8,7,6,5,4,3,2];
export const BETS = [10,20,50,100,200,500]; // total bet in integer cents
export function evaluate(grid, betCents, selected=5) {
  if (!Number.isSafeInteger(betCents) || betCents<=0 || !Number.isInteger(selected) || selected<1 || selected>30) throw new Error('Invalid bet or lines');
  if (grid.length!==5 || grid.some(r=>r.length!==3 || r.some(s=>!Number.isInteger(s)||s<1||s>11))) throw new Error('Invalid grid');
  const wildReels=grid.map((r,x)=>x>0&&x<4&&r.includes(1));
  let wn=0;
  // Upstream counts consecutive wild reels starting at reel two.
  for(let x=1;x<4&&wildReels[x];x++) wn++;
  const multiplier=[1,1,2,3][wn];
  const wins=[];
  for(let li=0;li<selected;li++) {
    const line=DATA.lines[li], symbol=grid[0][line[0]];
    let count=5;
    for(let x=1;x<5;x++) if(!wildReels[x]&&grid[x][line[x]]!==symbol) {count=x;break;}
    const pay=PAY[symbol-1][count-1]||0;
    if(pay) wins.push({line:li+1,symbol,count,amount:betCents/selected*pay*multiplier,cells:line.slice(0,count).map((y,x)=>[x,y])});
  }
  const positions=symbol=>grid.flatMap((r,x)=>r.flatMap((s,y)=>s===symbol?[[x,y]]:[]));
  const stars=positions(2), bananas=positions(3);
  // Upstream deliberately uses else-if: stars take precedence over bananas.
  const scat=stars.length>=3?{symbol:2,cells:stars,pay:[0,0,3,20,100][stars.length-1]}:bananas.length>=3?{symbol:3,cells:bananas,pay:20}:null;
  if(scat) wins.push({line:0,symbol:scat.symbol,count:scat.cells.length,amount:betCents*scat.pay*multiplier,cells:scat.cells});
  return {wins,winCents:Math.round(wins.reduce((n,w)=>n+w.amount,0)),multiplier,wildReels};
}
export function spin(betCents,selected=5,random=randomInt,options={}) {
  if(typeof random==='object'&&random!==null){options=random;random=randomInt;}
  const requested=options.mathProfile?options.mathProfile.rtp:DATA.defaultRtp;
  const key=Object.keys(DATA.reels).find(value=>Number(value)===Number(requested));
  if(!key)throw new Error('Unknown Lucky Clover reel profile');
  const reels=DATA.reels[key];
  const stops=reels.map(r=>random(r.length));
  const grid=reels.map((r,x)=>Array.from({length:3},(_,y)=>r[(stops[x]+y)%r.length]));
  return {grid,stops,...evaluate(grid,betCents,selected),...(options.mathProfile?{mathProfile:{...options.mathProfile}}:{})};
}
