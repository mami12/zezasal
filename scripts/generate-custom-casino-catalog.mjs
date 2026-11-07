/** Offline authoring only. Runtime never searches/rerolls to find a win.
 * Rebuild intentionally changes the catalog contract and its content hash.
 * All candidates are complete trajectories on the original immutable strips.
 */
process.env.DOTENV_CONFIG_PATH='NUL';
process.env.DATABASE_URL='postgresql://unused:unused@127.0.0.1:1/casino_test';
const {writeFileSync}=await import('node:fs');
const {createHash}=await import('node:crypto');
const {getGameProfile}=await import('../server/casino/game-rtp-profiles.mjs');
const {CUSTOM_GAMES,customGrid,gradeNativeTrajectory,trajectoryReturnBounds,originalCatalogReels}=await import('../server/casino/custom-native.mjs');
const {DATA:AGT}=await import('../server/casino/agt-engine.mjs');

const VERSION='CUSTOM_TRAJECTORY_V1',SEED=0x219ac893,SAMPLES=16000,MAX_SPINS=256;
const compare=(a,b)=>a.n*b.d<b.n*a.d?-1:a.n*b.d>b.n*a.d?1:0;
const roundedUp=fraction=>Number((fraction.n*1000000n+fraction.d-1n)/fraction.d)/1000000;
const roundedDown=fraction=>Number(fraction.n*1000000n/fraction.d)/1000000;
function seededRandom(seed){
 let state=seed>>>0;
 return bound=>{
  const limit=Math.floor(4294967296/bound)*bound;let n;
  do{state^=state<<13;state^=state>>>17;state^=state<<5;n=state>>>0;}while(n>=limit);
  return n%bound;
 };
}
function trajectory(gameId,entry,random){
 const game=CUSTOM_GAMES[gameId],stops=[];let remaining=0,mud=null;
 do{
  const free=stops.length>0;
  if(free)remaining--;
  const draw=entry.reels.map(reel=>random(reel.length)),grid=customGrid(entry.reels,draw,entry.rows);stops.push(draw);
  let added=0;
  if(game.kind==='vikings')added=grid.flat().filter(symbol=>symbol===2).length>=3?15:0;
  else if(game.kind==='agt'){
   const definition=AGT.games[game.internal],count=grid.flat().filter(symbol=>symbol===definition.scatter).length;
   added=(definition.scatterExact?count===definition.scatterExact:count>=3)?definition.freeSpins:0;
  }else if(game.kind==='book'&&!free&&entry.freeSpinsEnabled&&grid.flat().filter(symbol=>symbol===0).length>=3){added=10;mud=1+random(9);}
  remaining+=added;
 }while(remaining>0&&stops.length<MAX_SPINS);
 // Discard a bounded, unfinished authoring sample. It is never offered as a
 // truncated trajectory, and no part of it can become a real wager.
 return remaining?null:{stops,...(mud!==null?{mud}:{})};
}
function ranked(list,candidate,value,ascending){
 if(list.some(item=>item.value===value))return;
 list.push({candidate,value});list.sort((a,b)=>ascending?a.value-b.value:b.value-a.value);if(list.length>4)list.pop();
}
const variants={};
for(const [variant,gameId,freeSpinsEnabled] of [
 ['lucky-clover-x3','lucky-clover-x3',false],['vikings-fun','vikings-fun',false],
 ['fruit-queen','fruit-queen',false],['seven-hot','seven-hot',false],['sizzling','sizzling',false],
 ['bookofra-off','bookofra',false],['bookofra-on','bookofra',true],
]){
 process.env.BOOKOFRA_FREE_SPINS=freeSpinsEnabled?'1':'0';
 const profile=getGameProfile(gameId),reels=originalCatalogReels(gameId,profile);
 const {reels:unused,baseRtp:unusedBase,bonusRtp:unusedBonus,...mathProfile}=profile;
 const game=CUSTOM_GAMES[gameId],rows=game.kind==='agt'?AGT.games[game.internal].sy:3;
 const entry={gameId,freeSpinsEnabled,mathProfile,rows,reels,reelsSha256:createHash('sha256').update(JSON.stringify(reels)).digest('hex')};
 const lines=CUSTOM_GAMES[gameId].lines,random=seededRandom(SEED+Object.keys(variants).length),low=lines.map(()=>[]),high=lines.map(()=>[]),losses=[],features=[],variety=[];
 let discarded=0;
 for(let sample=0;sample<SAMPLES;sample++){
  const candidate=trajectory(gameId,entry,random);
  if(!candidate){discarded++;continue;}
  let maximum=0;
  for(let i=0;i<lines.length;i++){
   const result=trajectoryReturnBounds(gameId,entry,candidate,lines[i]),ratio=result.coefficient;maximum=Math.max(maximum,ratio);
   if(ratio>result.errorCents/20)ranked(low[i],candidate,ratio,true);
   if(ratio>0)ranked(high[i],candidate,ratio,false);
  }
  if(maximum===0&&losses.length<24)losses.push(candidate);
  if(candidate.stops.length>1&&features.length<16)features.push(candidate);
  if(maximum>0&&variety.length<32)variety.push(candidate);
 }
 const retained=[...losses,...features,...variety,...low.flat().map(item=>item.candidate),...high.flat().map(item=>item.candidate)];
 entry.trajectories=[...new Map(retained.map(candidate=>[JSON.stringify(candidate),candidate])).values()].map((candidate,index)=>({id:index,...candidate}));
 entry.bounds=lines.map(lineCount=>{
  const bounds=entry.trajectories.map(candidate=>trajectoryReturnBounds(gameId,entry,candidate,lineCount));
  const fractions=bounds.map(value=>{
   const paid=BigInt(value.referencePayoutCents)*40n,error=BigInt(value.roundingHalfCents)*BigInt(value.referenceStakeCents),d=BigInt(value.referenceStakeCents)*40n;
   return {low:{n:paid-error,d},high:{n:paid+error,d}};
  });
  const min=fractions.filter(value=>value.low.n>0n).map(value=>value.high).sort(compare)[0];
  const max=fractions.map(value=>value.low).sort(compare).at(-1);
  const ceiling=fractions.map(value=>value.high).sort(compare).at(-1);
  if(!min||!max||compare(max,min)<0||!losses.length)throw new Error(`Insufficient catalog coverage: ${variant}/${lineCount}`);
  return {lines:lineCount,minWinMultiplier:roundedUp(min),maxWinMultiplier:roundedDown(max),maxPayoutMultiplier:roundedUp(ceiling)};
 });
 variants[variant]=entry;
 console.log(`${variant}: ${entry.trajectories.length} complete trajectories; ${discarded} capped authoring samples discarded; conditional multiplier ${Math.max(...entry.bounds.map(bound=>bound.minWinMultiplier))}..${Math.min(...entry.bounds.map(bound=>bound.maxWinMultiplier))}`);
}
const catalog={format:VERSION,seed:SEED,samplesPerVariant:SAMPLES,maxAuthoringSpins:MAX_SPINS,variants};
writeFileSync(new URL('../server/casino/custom-catalog-v1.json',import.meta.url),JSON.stringify(catalog)+'\n');
console.log('Saved immutable custom-catalog-v1.json. Commit the artifact; never generate it at server startup.');
