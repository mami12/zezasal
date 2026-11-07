import {readFileSync} from 'node:fs';
import {REELS,PAYTABLE,LINES,SCATTER_PAY,FREE_SPINS} from './bookofra.mjs';
import {reelReturn} from './reel-return.mjs';
const data=JSON.parse(readFileSync(new URL('./legacy-slotopol-reels.json',import.meta.url),'utf8'));
export const bookFreeSpinsEnabled=()=>process.env.BOOKOFRA_FREE_SPINS==='1';
function make(id,reels,source){
 const base=reelReturn(reels,PAYTABLE,LINES,{wild:0,scatterPay:SCATTER_PAY});
 const bonusRtp=Array.from({length:9},(_,i)=>reelReturn(reels,PAYTABLE,LINES,{wild:0,scatterPay:SCATTER_PAY,expanding:i+1}).rtp).reduce((a,b)=>a+b,0)/9;
 return Object.freeze({id,reels,label:source,source,certified:false,baseRtp:base.rtp,bonusRtp:base.rtp+base.triggerProbability*FREE_SPINS*bonusRtp});
}
export const BOOK_PROFILES=Object.freeze([
 make('BOOKOFRA_ORIGINAL_REELS_V2',REELS,'Original client reels'),
 ...Object.entries(data.bookofra).map(([key,reels])=>make(`BOOKOFRA_SLOTOPOL_${key.replace('.','_')}_V2`,reels,`Slotopol reels ${key}; adapter paytable`)),
]);
export function bookProfiles(){return BOOK_PROFILES.map(profile=>({...profile,theoreticalRtp:Number((bookFreeSpinsEnabled()?profile.bonusRtp:profile.baseRtp).toFixed(6)),freeSpinsEnabled:bookFreeSpinsEnabled()})).sort((a,b)=>a.theoreticalRtp-b.theoreticalRtp);}
