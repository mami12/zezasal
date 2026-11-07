/** Real immutable reel choices. Payouts always use the displayed paytable. */
import {randomInt} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {REELS,paytable,paylines,randomGrid} from './sizzling-demo.mjs';
import {reelReturn} from './reel-return.mjs';
const data=JSON.parse(readFileSync(new URL('./legacy-slotopol-reels.json',import.meta.url),'utf8'));
const make=(id,reels,source)=>Object.freeze({id,reels,label:source,source,theoreticalRtp:Number(reelReturn(reels,paytable,paylines,{scatterPay:paytable[0]}).rtp.toFixed(6)),certified:false});
export const RTP_PROFILES=Object.freeze([
 make('SIZZLING_ORIGINAL_REELS_V2',REELS,'Original client reels'),
 ...Object.entries(data.sizzling).map(([key,reels])=>make(`SIZZLING_SLOTOPOL_${key.replace('.','_')}_V2`,reels,`Slotopol reels ${key}; adapter paytable`)),
].sort((a,b)=>a.theoreticalRtp-b.theoreticalRtp));
export const profileById=id=>RTP_PROFILES.find(profile=>profile.id===id)||null;
export const baseRtp=()=>reelReturn(REELS,paytable,paylines,{scatterPay:paytable[0]}).rtp;
export function theoreticalRtp(id='SIZZLING_ORIGINAL_REELS_V2'){
 const profile=profileById(id);if(!profile)throw new Error('Unsupported casino reel profile');return profile.theoreticalRtp;
}
export function randomProfileGrid(id='SIZZLING_ORIGINAL_REELS_V2',random=bound=>randomInt(bound)){
 const profile=profileById(id);if(!profile)throw new Error('Unsupported casino reel profile');return randomGrid(random,profile.reels);
}
export const publicRtpProfiles=()=>RTP_PROFILES.map(({reels,...profile})=>profile);
