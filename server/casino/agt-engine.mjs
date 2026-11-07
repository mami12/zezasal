// Ports of the supplied Slotopol AGT scanners, with original client symbol maps.
import {randomInt} from 'node:crypto';
import {readFileSync} from 'node:fs';
const baseData=JSON.parse(readFileSync(new URL('./agt-data.json',import.meta.url),'utf8'));
export const DATA={...baseData,games:{...baseData.games,'6megaice':JSON.parse(readFileSync(new URL('./ice-fruits-data.json',import.meta.url),'utf8'))}};
export function evaluate(id,grid,betCents,selected){
 const d=DATA.games[id];
 if(!d||!Number.isSafeInteger(betCents)||betCents<=0||!Number.isInteger(selected)||selected<1||selected>d.lines.length||grid.length!==d.sx||grid.some(col=>col.length!==d.sy||col.some(s=>!Number.isInteger(s)||s<1||s>d.symbols.length)))throw Error('Invalid AGT game, grid or bet');
 const wins=[];
 for(let li=0;li<selected;li++){
  const line=d.lines[li];let numw=0,numl=d.sx,syml=0;
  for(let x=0;x<d.sx;x++){
   const sx=grid[x][line[x]];
   if(sx===d.wild){if(!syml)numw=x+1;}
   else if(!syml)syml=sx;
   else if(sx!==syml){numl=x;break;}
  }
  const payw=numw?(d.pay[d.wild-1]?.[numw-1]||0):0,payl=syml?(d.pay[syml-1]?.[numl-1]||0):0;
  const factor=Math.max(payw,payl),count=payl>payw?numl:numw,symbol=payl>payw?syml:d.wild;
  if(factor)wins.push({line:li+1,symbol,count,amount:betCents/selected*factor,cells:line.slice(0,count).map((y,x)=>[x,y])});
 }
 const scat=grid.flatMap((col,x)=>col.flatMap((s,y)=>s===d.scatter?[[x,y]]:[]));
 const hit=d.scatterExact?scat.length===d.scatterExact:scat.length>=3;
 if(hit)wins.push({line:0,symbol:d.scatter,count:id==='zeus'?1:scat.length,amount:betCents*(d.scatterPay[scat.length-1]||0),cells:scat,freeSpins:d.freeSpins});
 return {wins,winCents:Math.round(wins.reduce((sum,w)=>sum+w.amount,0)),freeSpins:hit?d.freeSpins:0};
}
export function spin(id,betCents,selected,random=randomInt,options={}){
 if(typeof random==='object'&&random!==null){options=random;random=randomInt;}
 const d=DATA.games[id];if(!d)throw Error('Invalid AGT game');
 const requested=options.mathProfile?options.mathProfile.rtp:d.rtp;
 const key=Object.keys(d.reels).find(value=>Number(value)===Number(requested));
 if(!key)throw Error('Unknown AGT reel profile');
 const reels=d.reels[key],stops=reels.map(r=>random(r.length));
 const grid=reels.map((r,x)=>Array.from({length:d.sy},(_,y)=>r[(stops[x]+y)%r.length]));
 return {grid,stops,...evaluate(id,grid,betCents,selected),...(options.mathProfile?{mathProfile:{...options.mathProfile}}:{})};
}
