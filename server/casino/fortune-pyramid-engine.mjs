import {readFileSync} from 'node:fs';
import {randomInt} from 'node:crypto';
export const DATA=JSON.parse(readFileSync(new URL('./fortune-pyramid-data.json',import.meta.url),'utf8'));
export const symbol=s=>DATA.symbols[s-1];
export const rows=grid=>Array.from({length:3},(_,y)=>grid.map(col=>symbol(col[y])));
export function evaluate(grid,stakeCents,selected=20){
 if(!Number.isSafeInteger(stakeCents)||stakeCents<=0||!Number.isInteger(selected)||selected<1||selected>20||grid.length!==5||grid.some(col=>col.length!==3||col.some(s=>!Number.isInteger(s)||s<1||s>8)))throw Error('Invalid Fortune Pyramid wager/grid');
 const wins=[];
 for(let index=0;index<selected;index++){
  const line=DATA.lines[index];let leadingWilds=0,count=5,target=0;
  for(let x=0;x<5;x++){const s=grid[x][line[x]];if(s===1){if(!target)leadingWilds=x+1;}else if(!target)target=s;else if(s!==target){count=x;break;}}
  const wildPay=DATA.pay[0][leadingWilds-1]??0,targetPay=target?(DATA.pay[target-1][count-1]??0):0,factor=Math.max(wildPay,targetPay);
  if(factor){const length=targetPay>wildPay?count:leadingWilds;wins.push({line:index+1,symbol:targetPay>wildPay?target:1,count:length,factor,amount:stakeCents/selected*factor,cells:line.slice(0,length).map((y,x)=>[x,y])});}
 }
 const cells=grid.flatMap((col,x)=>col.flatMap((s,y)=>s===2?[[x,y]]:[]));
 if(cells.length>=3){const factor=DATA.scatterPay[cells.length-1]??0;if(factor)wins.push({line:0,symbol:2,count:cells.length,factor,amount:stakeCents*factor,cells});}
 return {wins,winCents:Math.round(wins.reduce((sum,w)=>sum+w.amount,0)),freeSpins:0};
}
export function spin(stakeCents,selected=20,options={}){
 const rtp=options.mathProfile?.rtp??DATA.defaultRtp,reels=DATA.reels[String(rtp)];if(!reels)throw Error('Unknown Fortune Pyramid reel profile');
 const random=options.random??randomInt,stops=reels.map(reel=>random(reel.length));
 const grid=reels.map((reel,x)=>Array.from({length:3},(_,y)=>reel[(stops[x]+y)%reel.length]));
 const result={grid,stops,...evaluate(grid,stakeCents,selected)};
 return {...result,games:[{...result,totalWin:result.winCents}]};
}
