// Faithful port of Slotopol ct/vikingsfun; see slotopol-source/ and its MIT license.
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const DATA=JSON.parse(readFileSync(new URL('./vikings-data.json',import.meta.url),'utf8'));
export const SPRITES=[11,1,9,10,8,7,6,5,4,3,2];
export const PAY=[[0,10,140,800,10000],[],[0,5,15,80,625],[0,5,15,80,625],[0,0,15,100,625],[0,0,15,100,625],[0,0,10,60,200],[0,0,10,60,200],[0,0,5,30,100],[0,0,5,30,100],[0,0,5,30,100]];
export function evaluate(grid,betCents,selected=25,free=false){
 if(!Number.isSafeInteger(betCents)||betCents<=0||!Number.isInteger(selected)||selected<1||selected>30||grid.length!==5||grid.some(r=>r.length!==3||r.some(s=>!Number.isInteger(s)||s<1||s>11)))throw Error('Invalid Vikings grid or bet');
 const wins=[];
 for(let li=0;li<selected;li++){
  const line=DATA.lines[li];let numw=0,numl=5,symw=0,syml=0;
  for(let x=0;x<5;x++){
   const sx=grid[x][line[x]];
   if(sx===1||(free&&(sx===3||sx===4))){
    if(!syml){if(free){if(!symw)symw=sx;else if(sx!==symw)break;}numw=x+1;}
   }else if(!syml)syml=sx;
   else if(sx!==syml){numl=x;break;}
  }
  const payw=numw>=2?(PAY[(free?symw:1)-1]?.[numw-1]||0):0;
  const payl=numl>=(free?3:2)&&syml?(PAY[syml-1]?.[numl-1]||0):0;
  const pay=Math.max(payl,payw),count=payl>payw?numl:numw,symbol=payl>payw?syml:(free?symw:1);
  if(pay)wins.push({line:li+1,symbol,count,factor:pay,amount:betCents/selected*pay,cells:line.slice(0,count).map((y,x)=>[x,y])});
 }
 const scat=grid.flatMap((r,x)=>r.flatMap((s,y)=>s===2?[[x,y]]:[]));
 if(scat.length>=3)wins.push({line:0,symbol:2,count:scat.length,factor:[0,0,7,20,100][scat.length-1],amount:betCents*[0,0,7,20,100][scat.length-1],cells:scat,freeSpins:15});
 return {wins,winCents:Math.round(wins.reduce((sum,w)=>sum+w.amount,0)),freeSpins:scat.length>=3?15:0};
}
export function spin(betCents,selected=25,free=false,random=randomInt,options={}){
 if(typeof random==='object'&&random!==null){options=random;random=randomInt;}
 const requested=options.mathProfile?options.mathProfile.rtp:DATA.defaultRtp;
 const key=Object.keys(DATA.reels).find(value=>Number(value)===Number(requested));
 if(!key)throw Error('Unknown Vikings reel profile');
 const reels=DATA.reels[key];
 const stops=reels.map(r=>random(r.length));
 const grid=reels.map((r,x)=>Array.from({length:3},(_,y)=>r[(stops[x]+y)%r.length]));
 return {grid,stops,...evaluate(grid,betCents,selected,free),...(options.mathProfile?{mathProfile:{...options.mathProfile}}:{})};
}
export function spinRound(betCents,selected=25,spinFn=spin,options={}){
 if(typeof spinFn==='object'&&spinFn!==null){options=spinFn;spinFn=spin;}
 const games=[];let remaining=0,totalFree=0,played=0,totalWin=0;
 do{
  const free=remaining>0,result=spinFn(betCents,selected,free,options);
  if(free){remaining--;played++;}
  remaining+=result.freeSpins;totalFree+=result.freeSpins;totalWin+=result.winCents;
  games.push({...result,free,freeGameNumber:played,freeGameTotal:totalFree,totalWin});
 }while(remaining>0);
 return {grid:games.at(-1).grid,winCents:totalWin,games,...(options.mathProfile?{mathProfile:{...options.mathProfile}}:{})};
}
