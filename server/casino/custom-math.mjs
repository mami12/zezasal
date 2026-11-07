/** Transparent custom paid-round distribution.
 * Original paytable graders price a finite, offline-authored catalog. A wager
 * draws once from exact rational global weights; there is no runtime search
 * for winning/losing grids, payout scalar, or player-dependent probability.
 */
import {readFileSync} from 'node:fs';
import {createHash,randomInt} from 'node:crypto';
import {CUSTOM_GAMES,customVariant,gradeNativeTrajectory} from './custom-native.mjs';

function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
const source=readFileSync(new URL('./custom-catalog-v1.json',import.meta.url),'utf8'),catalog=freeze(JSON.parse(source));
const fingerprints=new Map(Object.entries(catalog.variants).map(([name,entry])=>[name,createHash('sha256').update(JSON.stringify(entry)).digest('hex')]));
// A deployment that changes a grader/sampler changes the disclosed contract,
// even if the authored catalog and its outer payout bounds stayed identical.
const revisionHash=createHash('sha256');
for(const name of ['lucky-clover-engine.mjs','vikings-engine.mjs','agt-engine.mjs','sizzling-demo.mjs','bookofra.mjs','custom-native.mjs','custom-math.mjs'])revisionHash.update(name+'\0').update(readFileSync(new URL(name,import.meta.url),'utf8').replace(/\r\n/g,'\n'));
const nativeRevision=revisionHash.digest('hex');
const fail=message=>Object.assign(new Error(message),{status:400,code:'INVALID_CUSTOM_MATH'});
const MIN_STAKE=2000,MAX_STAKE=500000,DENOMINATOR=10000n;
// RTP is an expected return, so it may exceed 100%. Hit frequency is a
// probability and must never exceed 100%. Native paytable bounds still apply.
export const CUSTOM_CONTROL_LIMITS=freeze({rtp:{min:0,max:1000},hitFrequency:{min:0,max:100}});
function entryFor(gameId,variant=customVariant(gameId)){
 const entry=catalog.variants[variant];
 if(!CUSTOM_GAMES[gameId]||!entry||entry.gameId!==gameId)throw fail('Unsupported casino game');
 return entry;
}
const versionOf=(gameId,variant=customVariant(gameId))=>`${catalog.format}:${variant}:${fingerprints.get(variant)}:${nativeRevision}`;
function limitsOf(entry){return {
 minWinMultiplier:Math.max(...entry.bounds.map(bound=>bound.minWinMultiplier)),
 maxWinMultiplier:Math.min(...entry.bounds.map(bound=>bound.maxWinMultiplier)),
};}
function percentage(value,name,fallback,maximum=100){
 if(value===undefined)return fallback;
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>maximum||Math.abs(value*100-Math.round(value*100))>1e-7)throw fail(`${name} must be a number from 0 to ${maximum} with at most two decimal places`);
 return Math.round(value*100)/100;
}
export function validateControls(gameId,controls){
 const entry=entryFor(gameId);
 if(!controls||typeof controls!=='object'||Array.isArray(controls)||Object.keys(controls).some(key=>!['mode','rtp','hitFrequency'].includes(key))||!['original','custom'].includes(controls.mode))throw fail('Select original or custom casino math');
 const normalized={mode:controls.mode,rtp:percentage(controls.rtp,'RTP',controls.mode==='original'?95:undefined,Math.floor(limitsOf(entry).maxWinMultiplier*10000)/100),hitFrequency:percentage(controls.hitFrequency,'Hit frequency',controls.mode==='original'?20:undefined,CUSTOM_CONTROL_LIMITS.hitFrequency.max)};
 if(normalized.rtp===undefined||normalized.hitFrequency===undefined)throw fail('RTP and hit frequency are required');
 if(normalized.mode==='custom'){
  const {rtp,hitFrequency}=normalized;
  if((rtp===0)!==(hitFrequency===0))throw fail('RTP and hit frequency must both be zero, or both be greater than zero');
  const bounds=limitsOf(entry),mean=rtp/hitFrequency;
  if(rtp>0&&(mean<bounds.minWinMultiplier-1e-10||mean>bounds.maxWinMultiplier+1e-10))
   throw fail('Incompatible RTP / hit frequency: the requested average winning payout is outside this game\'s paytable bounds');
 }
 return freeze(normalized);
}
function validateWager(gameId,stakeCents,lines){
 if(!Number.isSafeInteger(stakeCents)||stakeCents<MIN_STAKE||stakeCents>MAX_STAKE)throw fail('Casino stake must be between 20 and 5000.00');
 if(!Number.isInteger(lines)||!CUSTOM_GAMES[gameId]?.lines.includes(lines))throw fail('Unsupported casino line count');
}

// Only integer payout vectors are cached; accepted native results and bonus
// trajectories are freshly built, immutable and never shared between users.
const payoutCache=new Map(),CACHE_LIMIT=128;
function payoutVector(gameId,entry,stakeCents,lines){
 const key=`${customVariant(gameId)}:${stakeCents}:${lines}`;
 let payouts=payoutCache.get(key);
 if(payouts){payoutCache.delete(key);payoutCache.set(key,payouts);return payouts;}
 payouts=freeze(entry.trajectories.map(trajectory=>gradeNativeTrajectory(gameId,entry,trajectory,{stakeCents,lines}).payoutCents));
 payoutCache.set(key,payouts);if(payoutCache.size>CACHE_LIMIT)payoutCache.delete(payoutCache.keys().next().value);
 return payouts;
}
/** Uniform bounded integers of arbitrary size, using unbiased bounded integer
 * limbs. The rejection is integer-range sampling, never a rejected spin. The
 * injectable random(bound) follows the engines' integer RNG convention. */
export function randomBelow(bound,random=randomInt){
 bound=BigInt(bound);if(bound<=0n)throw new RangeError('Positive integer bound required');if(bound===1n)return 0n;
 const bits=(bound-1n).toString(2).length;
 for(;;){
  let result=0n,remaining=bits;
  while(remaining>0){
   const width=Math.min(26,remaining),limit=2**width,part=random(limit);
   if(!Number.isSafeInteger(part)||part<0||part>=limit)throw new Error('Casino RNG returned an invalid bounded integer');
   result=(result<<BigInt(width))+BigInt(part);remaining-=width;
  }
  if(result<bound)return result;
 }
}
function distribution(gameId,{stakeCents,lines,controls}){
 const entry=entryFor(gameId),normalized=validateControls(gameId,controls);validateWager(gameId,stakeCents,lines);
 if(normalized.mode!=='custom')throw fail('Custom round selection requires custom mode');
 const payouts=payoutVector(gameId,entry,stakeCents,lines),zero=[],winning=[];
 for(let index=0;index<payouts.length;index++)(payouts[index]===0?zero:winning).push(index);
 if(!zero.length)throw new Error('Catalog is missing a losing trajectory');
 const r=BigInt(Math.round(normalized.rtp*100)),h=BigInt(Math.round(normalized.hitFrequency*100)),stake=BigInt(stakeCents);
 if(r===0n)return {entry,controls:normalized,payouts,denominator:1n,groups:[{weight:1n,ids:zero}],maxPayoutCents:0};
 let low=winning.filter(index=>BigInt(payouts[index])*h<=stake*r),high=winning.filter(index=>BigInt(payouts[index])*h>stake*r);
 if(!low.length)throw fail('Requested custom profile is unavailable at this stake');
 if(!high.length){
  // At the largest achievable mean, every winning draw must pay that maximum.
  const maximum=Math.max(...winning.map(index=>payouts[index]));
  if(BigInt(maximum)*h!==stake*r)throw fail('Requested custom profile is unavailable at this stake');
  low=winning.filter(index=>payouts[index]===maximum);
  return {entry,controls:normalized,payouts,denominator:DENOMINATOR,groups:[{weight:DENOMINATOR-h,ids:zero},{weight:h,ids:low}].filter(group=>group.weight>0n),maxPayoutCents:maximum};
 }
 const bracket=upper=>{
  const lowCount=BigInt(low.length),highCount=BigInt(upper.length);
  const lowSum=low.reduce((sum,index)=>sum+BigInt(payouts[index]),0n),highSum=upper.reduce((sum,index)=>sum+BigInt(payouts[index]),0n);
  const difference=highSum*lowCount-lowSum*highCount;
  return {denominator:DENOMINATOR*difference,groups:[
   {weight:(DENOMINATOR-h)*difference,ids:zero},
   {weight:(h*highSum-stake*r*highCount)*lowCount,ids:low},
   {weight:(stake*r*lowCount-h*lowSum)*highCount,ids:upper},
  ]};
 };
 // A single upper pool dominated by rare very large catalog awards makes
 // ordinary above-stake returns needlessly scarce. Most probability now uses
 // a nearby upper band; a smaller broad component retains every large award.
 // Both components independently have the exact same RTP and hit target.
 let nearby=high.filter(index=>BigInt(payouts[index])*h<=stake*r*6n);
 if(!nearby.length){const nearest=Math.min(...high.map(index=>payouts[index]));nearby=high.filter(index=>payouts[index]===nearest);}
 const broad=bracket(high),core=bracket(nearby);
 const gcd=(a,b)=>b?gcd(b,a%b):a;
 const common=broad.denominator/gcd(broad.denominator,core.denominator)*core.denominator;
 const denominator=common*8n,combined=new Map();
 for(const [plan,share] of [[core,7n],[broad,1n]])for(const group of plan.groups){
  const key=group.ids.join(','),weight=group.weight*(common/plan.denominator)*share;
  const existing=combined.get(key);
  if(existing)existing.weight+=weight;else combined.set(key,{ids:group.ids,weight});
 }
 const groups=[...combined.values()];
 if(groups.some(group=>group.weight<0n)||groups.reduce((sum,group)=>sum+group.weight,0n)!==denominator)throw new Error('Invalid custom probability distribution');
 const active=groups.filter(group=>group.weight>0n),maxPayoutCents=Math.max(...active.flatMap(group=>group.ids.map(index=>payouts[index])));
 return {entry,controls:normalized,payouts,denominator,groups:active,maxPayoutCents};
}
export function getCustomCatalog(gameId,{variant=customVariant(gameId)}={}){return entryFor(gameId,variant);}
export function gradeCustomTrajectory(gameId,trajectory,{stakeCents,lines}){
 const entry=entryFor(gameId,trajectory.catalogVariant??customVariant(gameId));
 return freeze(gradeNativeTrajectory(gameId,entry,trajectory,{stakeCents,lines}));
}
/** Test/review interface: exact integer weights and pool sums permit independent
 * rational expectation checks without a statistical RTP tolerance. */
export function customRoundDistribution(gameId,options){
 const plan=distribution(gameId,options);
 return freeze({denominator:String(plan.denominator),maxPayoutCents:plan.maxPayoutCents,
  groups:plan.groups.map(group=>({weight:String(group.weight),trajectoryIds:[...group.ids],payoutSumCents:group.ids.reduce((sum,index)=>sum+plan.payouts[index],0),count:group.ids.length,hit:plan.payouts[group.ids[0]]>0}))});
}
export function customGameSummary(gameId,{controls,stakeCents,lines}={}){
 const entry=entryFor(gameId),variant=customVariant(gameId),normalized=controls?validateControls(gameId,controls):null;
 let maxPayoutMultiplier=Math.max(...entry.bounds.map(bound=>bound.maxPayoutMultiplier)),maxPayoutCents;
 if(normalized?.mode==='custom'&&normalized.rtp===0)maxPayoutMultiplier=0;
 if(stakeCents!==undefined||lines!==undefined){
  const selectedLines=lines??CUSTOM_GAMES[gameId].lines.at(-1);validateWager(gameId,stakeCents,selectedLines);
  maxPayoutCents=normalized?.mode==='custom'?distribution(gameId,{stakeCents,lines:selectedLines,controls:normalized}).maxPayoutCents:Math.max(...payoutVector(gameId,entry,stakeCents,selectedLines));
  maxPayoutMultiplier=maxPayoutCents/stakeCents;
 }
 return freeze({gameId,version:versionOf(gameId,variant),mode:normalized?.mode??'original',controls:normalized,
  customLimits:limitsOf(entry),controlLimits:{rtp:{min:0,max:Math.floor(limitsOf(entry).maxWinMultiplier*10000)/100},hitFrequency:CUSTOM_CONTROL_LIMITS.hitFrequency},maxPayoutMultiplier,...(maxPayoutCents!==undefined?{maxPayoutCents}:{}),
  mathProfile:{...entry.mathProfile},freeSpinsEnabled:entry.freeSpinsEnabled,catalogTrajectories:entry.trajectories.length,
  hitDefinition:'Paid rounds with total payout greater than zero, including all awarded free games',
  scope:'All players; future paid rounds only',customModel:'Finite original-paytable trajectory catalog; custom outcome probabilities'});
}
export {supportsCustomCasinoMath} from './custom-native.mjs';
export function selectCustomRound(gameId,{stakeCents,lines,controls},random=randomInt){
 const plan=distribution(gameId,{stakeCents,lines,controls}),variant=customVariant(gameId);
 let draw=randomBelow(plan.denominator,random),selected;
 for(const group of plan.groups){if(draw<group.weight){selected=group;break;}draw-=group.weight;}
 if(!selected)throw new Error('Invalid custom probability draw');
 const index=selected.ids[Number(randomBelow(BigInt(selected.ids.length),random))],raw=plan.entry.trajectories[index];
 const graded=gradeNativeTrajectory(gameId,plan.entry,raw,{stakeCents,lines}),mathProfile={...plan.entry.mathProfile},version=versionOf(gameId,variant);
 return freeze({version,controls:{...plan.controls},mathProfile,
  spins:graded.spins.map(spin=>({...spin,mathProfile:{...mathProfile}})),payoutCents:graded.payoutCents,
  rtp:plan.controls.rtp,hitFrequency:plan.controls.hitFrequency,maxPayoutCents:plan.maxPayoutCents,
  trajectory:{...raw,stops:raw.stops.map(stop=>[...stop]),catalogVariant:variant},
  meta:{mode:'custom',version,catalogVariant:variant,trajectoryId:raw.id,rtp:plan.controls.rtp,hitFrequency:plan.controls.hitFrequency,hitDefinition:'Paid rounds with total payout greater than zero'}});
}
