// No production environment file, database, upstream feed or customer wallet.
process.env.DOTENV_CONFIG_PATH='NUL';
process.env.DATABASE_URL='postgresql://unused:unused@127.0.0.1:1/casino_test';
process.env.JWT_SECRET='isolated-custom-casino-math-tests';
const assert=(await import('node:assert/strict')).default;
const {createHash}=await import('node:crypto');
const {getGameProfile}=await import('../server/casino/game-rtp-profiles.mjs');
const {CUSTOM_GAMES,originalCatalogReels}=await import('../server/casino/custom-native.mjs');
const {validateControls,customGameSummary,getCustomCatalog,gradeCustomTrajectory,customRoundDistribution,selectCustomRound,randomBelow}=await import('../server/casino/custom-math.mjs');
const {evaluate:cloverEvaluate}=await import('../server/casino/lucky-clover-engine.mjs');
const {evaluate:vikingsEvaluate}=await import('../server/casino/vikings-engine.mjs');
const {evaluate:agtEvaluate}=await import('../server/casino/agt-engine.mjs');
const {gradeGrid:gradeSizzling}=await import('../server/casino/sizzling-demo.mjs');
const {gradeGrid:gradeBook}=await import('../server/casino/bookofra.mjs');

function seeded(seed){let state=seed>>>0;return bound=>{const limit=Math.floor(4294967296/bound)*bound;let value;do{state^=state<<13;state^=state>>>17;state^=state<<5;value=state>>>0;}while(value>=limit);return value%bound;};}
const gcd=(a,b)=>b?gcd(b,a%b):a,lcm=(a,b)=>a/gcd(a,b)*b;
const variants=[...Object.keys(CUSTOM_GAMES).filter(id=>id!=='bookofra').map(id=>[id,false]),['bookofra',false],['bookofra',true]];
const stakes=[2000,2001,2029,2037,2049,2099,2100,2101,9999,10001,499999,500000];
let exactDistributions=0,nativeSpins=0,selectedRounds=0,versionOff;
for(const [gameId,freeEnabled] of variants){
 process.env.BOOKOFRA_FREE_SPINS=freeEnabled?'1':'0';
 const summary=customGameSummary(gameId),entry=getCustomCatalog(gameId),game=CUSTOM_GAMES[gameId];
 assert(summary.version.includes(gameId==='bookofra'?`bookofra-${freeEnabled?'on':'off'}`:gameId));
 assert.equal(createHash('sha256').update(JSON.stringify(entry.reels)).digest('hex'),entry.reelsSha256);
 // Custom is a versioned accepted contract, pinned to its authored native
 // profile. Changing the default original profile must never reindex its stops.
 const authoredProfile=getGameProfile(gameId,{[gameId]:entry.mathProfile.id});
 assert.deepEqual(entry.reels,originalCatalogReels(gameId,authoredProfile),'catalog stops must use their recorded native profile strips');
 assert(Object.isFrozen(entry)&&Object.isFrozen(entry.trajectories)&&Object.isFrozen(entry.reels[0]));
 assert.deepEqual(validateControls(gameId,{mode:'original'}),{mode:'original',rtp:95,hitFrequency:20});
 assert.deepEqual(validateControls(gameId,{mode:'original',rtp:1,hitFrequency:99}),{mode:'original',rtp:1,hitFrequency:99},'inactive drafts do not alter original math');
 for(const invalid of [null,{}, {mode:'custom',rtp:0,hitFrequency:1},{mode:'custom',rtp:1,hitFrequency:0},{mode:'custom',rtp:-1,hitFrequency:1},{mode:'custom',rtp:Number.MAX_SAFE_INTEGER,hitFrequency:100},{mode:'custom',rtp:600,hitFrequency:100.01},{mode:'custom',rtp:'95',hitFrequency:20},{mode:'custom',rtp:NaN,hitFrequency:20},{mode:'custom',rtp:90.001,hitFrequency:20},{mode:'custom',rtp:90,hitFrequency:20,playerId:'forbidden'}])assert.throws(()=>validateControls(gameId,invalid),error=>error.status===400);
 assert.deepEqual(summary.controlLimits,{rtp:{min:0,max:Math.floor(Math.min(...entry.bounds.map(b=>b.maxWinMultiplier))*10000)/100},hitFrequency:{min:0,max:100}});
 const limit=summary.customLimits;
 assert.throws(()=>validateControls(gameId,{mode:'custom',rtp:100,hitFrequency:.01}),/Incompatible/,'unreachable upper means must be rejected');
 assert.throws(()=>validateControls(gameId,{mode:'custom',rtp:.01,hitFrequency:100}),/Incompatible/,'unreachable lower means must be rejected');
 const hit=Math.min(50,Math.floor(95/(limit.minWinMultiplier*1.2)*100)/100),controls=validateControls(gameId,{mode:'custom',rtp:95,hitFrequency:hit});
 const small=validateControls(gameId,{mode:'custom',rtp:Math.ceil(limit.minWinMultiplier*1.2)/100,hitFrequency:.01});
 const zero=validateControls(gameId,{mode:'custom',rtp:0,hitFrequency:0});
 const boundary=[];
 boundary.push(validateControls(gameId,{mode:'custom',rtp:600,hitFrequency:100}),validateControls(gameId,{mode:'custom',rtp:1000,hitFrequency:100}));
 if(limit.minWinMultiplier<=1&&limit.maxWinMultiplier>=1)boundary.push(validateControls(gameId,{mode:'custom',rtp:100,hitFrequency:100}));
 if(Number.isInteger(limit.minWinMultiplier)&&Number.isInteger(100/limit.minWinMultiplier))boundary.push(validateControls(gameId,{mode:'custom',rtp:100,hitFrequency:100/limit.minWinMultiplier}));
 if(gameId==='sizzling')boundary.push(validateControls(gameId,{mode:'custom',rtp:100,hitFrequency:1}));
 for(const lines of game.lines){
  for(const stakeCents of stakes){
   for(const control of [zero,controls,small,...boundary]){
    const plan=customRoundDistribution(gameId,{stakeCents,lines,controls:control}),den=BigInt(plan.denominator),units=plan.groups.reduce((value,group)=>lcm(value,BigInt(group.count)),1n);
    const sum=plan.groups.reduce((value,group)=>value+BigInt(group.weight),0n);
    const hits=plan.groups.reduce((value,group)=>value+(group.hit?BigInt(group.weight):0n),0n);
    const expected=plan.groups.reduce((value,group)=>value+BigInt(group.weight)*BigInt(group.payoutSumCents)*(units/BigInt(group.count)),0n);
    assert.equal(sum,den,'probabilities sum exactly to1');
    assert.equal(hits*10000n,den*BigInt(Math.round(control.hitFrequency*100)),'hit probability equals target exactly');
    assert.equal(expected*10000n,den*units*BigInt(stakeCents)*BigInt(Math.round(control.rtp*100)),'expected rounded payout equals RTP exactly');
    exactDistributions++;
   }
  }
 }
 // Independently call production scanners on all stored trajectories. This
 // also verifies full feature lengths, retriggers and a frozen Book symbol.
 for(const trajectory of entry.trajectories){
  for(const lines of [...new Set([game.lines[0],game.lines.at(-1)])]){
   for(const stakeCents of [2000,2037,10000,500000]){
    const raw={...trajectory,catalogVariant:gameId==='bookofra'?`bookofra-${freeEnabled?'on':'off'}`:gameId};
    const round=gradeCustomTrajectory(gameId,raw,{stakeCents,lines});
    let remaining=0,total=0;
    for(let index=0;index<round.spins.length;index++){
     const spin=round.spins[index],isFree=index>0;
     assert.equal(spin.free,isFree);if(isFree){assert(remaining>0);remaining--;}
     for(let reel=0;reel<5;reel++)assert.deepEqual(spin.grid[reel],Array.from({length:entry.rows},(_,row)=>entry.reels[reel][(trajectory.stops[index][reel]+row)%entry.reels[reel].length]));
     let expected;
     if(game.kind==='clover')expected=cloverEvaluate(spin.grid,stakeCents,lines);
     else if(game.kind==='vikings')expected=vikingsEvaluate(spin.grid,stakeCents,lines,isFree);
     else if(game.kind==='agt')expected=agtEvaluate(game.internal,spin.grid,stakeCents,lines);
     else if(game.kind==='sizzling'){
      const graded=gradeSizzling(spin.grid,stakeCents/(100*lines),1);assert.deepEqual(spin.graded,graded);expected={winCents:Math.round(graded.total*100)};
     }else{
      const graded=gradeBook(spin.grid,stakeCents/(100*lines),lines,isFree?trajectory.mud:null);assert.deepEqual(spin.graded,graded);expected={winCents:Math.round(graded.total*100)};
      assert.equal(spin.mud,trajectory.mud??null);
      if(isFree)assert(trajectory.mud>=1&&trajectory.mud<=9);
     }
     assert.equal(spin.winCents,expected.winCents);assert(Number.isSafeInteger(spin.winCents));total+=spin.winCents;remaining+=spin.freeSpins||0;nativeSpins++;
     if(spin.graded){
      let awardCents=0n;
      for(const win of spin.graded.line_wins){assert.match(win.amount,/^\d+\.\d{2}$/,'Pixi awards serialize exact monetary cents');const [whole,fraction]=win.amount.split('.');awardCents+=BigInt(whole)*100n+BigInt(fraction);}
      assert.equal(awardCents,BigInt(spin.winCents));
     }
    }
    assert.equal(remaining,0,'every awarded free game must be present');assert.equal(total,round.payoutCents);
   }
  }
 }
 const random=seeded(0xf3a5521);
 for(let index=0;index<1000;index++){
  const round=selectCustomRound(gameId,{stakeCents:2000,lines:game.lines.at(-1),controls},random);
  assert.equal(round.payoutCents,round.spins.reduce((sum,spin)=>sum+spin.winCents,0));
  assert(round.payoutCents<=round.maxPayoutCents);assert.equal(round.mathProfile.rtp,entry.mathProfile.rtp);
  assert(Object.isFrozen(round.spins[0].grid[0]));assert.throws(()=>{round.spins[0].grid[0][0]=-1;},TypeError);
  selectedRounds++;
 }
 for(let index=0;index<25;index++){
  const round=selectCustomRound(gameId,{stakeCents:2000,lines:game.lines.at(-1),controls:zero},random);assert.equal(round.payoutCents,0);assert.equal(round.maxPayoutCents,0);
 }
 if(limit.minWinMultiplier<.5){
  const allHits=validateControls(gameId,{mode:'custom',rtp:50,hitFrequency:100});
  for(let index=0;index<25;index++)assert(selectCustomRound(gameId,{stakeCents:2000,lines:game.lines.at(-1),controls:allHits},random).payoutCents>0);
 }
 if(['vikings-fun','sizzling','bookofra'].includes(gameId)){
  const options={stakeCents:10000,lines:game.lines.at(-1),controls:validateControls(gameId,{mode:'custom',rtp:100,hitFrequency:100})};
  const plan=customRoundDistribution(gameId,options),den=BigInt(plan.denominator);
  const payouts=new Map(entry.trajectories.map((trajectory,index)=>[index,gradeCustomTrajectory(gameId,trajectory,options).payoutCents]));
  const units=plan.groups.reduce((n,g)=>lcm(n,BigInt(g.count)),1n);
  const above=plan.groups.reduce((n,g)=>n+BigInt(g.weight)*BigInt(g.trajectoryIds.filter(id=>payouts.get(id)>10000).length)*(units/BigInt(g.count)),0n);
  assert(above*10n>=den*units,'100/100 keeps a meaningful above-stake band, not almost exclusively tiny returns');
  assert(plan.groups.every(g=>g.trajectoryIds.every(id=>payouts.get(id)>0)),'100% hit never selects a losing round');
  assert(plan.groups.some(g=>g.trajectoryIds.some(id=>payouts.get(id)>60000)),'large original-paytable awards remain reachable');
  const draws=seeded(0x823a91),seen=new Set();
  for(let i=0;i<200;i++){const round=selectCustomRound(gameId,options,draws);if(round.payoutCents>10000)seen.add(round.payoutCents);}
  assert(seen.size>=2,'bounded repeatable sample includes varied above-stake native combinations');
 }
 const extended={stakeCents:10000,lines:game.lines.at(-1),controls:validateControls(gameId,{mode:'custom',rtp:600,hitFrequency:100})};
 const extendedDraws=seeded(0x923a1),extendedPayouts=new Set(),extendedTrajectories=new Set();
 for(let i=0;i<300;i++){
  const round=selectCustomRound(gameId,extended,extendedDraws);
  assert(round.payoutCents>0,'all games support 100% hit with sufficient RTP');
  assert.equal(round.rtp,600);assert.equal(round.hitFrequency,100);
  extendedPayouts.add(round.payoutCents);extendedTrajectories.add(round.meta.trajectoryId);
 }
 assert(extendedPayouts.size>=3&&extendedTrajectories.size>=3,'above-100% RTP retains varied genuine combinations on every game');
 assert.throws(()=>selectCustomRound(gameId,{stakeCents:19,lines:game.lines.at(-1),controls}),/stake/);
 assert.throws(()=>selectCustomRound(gameId,{stakeCents:500001,lines:game.lines.at(-1),controls}),/stake/);
 assert.throws(()=>selectCustomRound(gameId,{stakeCents:2000,lines:999,controls}),/line/);
 if(gameId==='vikings-fun')assert(entry.trajectories.some(trajectory=>trajectory.stops.length>16),'catalog covers an original retrigger chain');
 if(gameId==='bookofra'){
  if(!freeEnabled){versionOff=summary.version;assert(entry.trajectories.every(trajectory=>trajectory.stops.length===1));}
  else {
   assert.notEqual(summary.version,versionOff);assert(entry.trajectories.some(trajectory=>trajectory.stops.length===11));
   const held=JSON.parse(JSON.stringify({...entry.trajectories.find(trajectory=>trajectory.stops.length===11),catalogVariant:'bookofra-on'}));
   const before=gradeCustomTrajectory(gameId,held,{stakeCents:2000,lines:10});
   process.env.BOOKOFRA_FREE_SPINS='0';
   assert.deepEqual(gradeCustomTrajectory(gameId,held,{stakeCents:2000,lines:10}),before,'accepted feature contracts survive a global feature change');
   process.env.BOOKOFRA_FREE_SPINS='1';
  }
 }
}
assert.throws(()=>validateControls('unknown',{mode:'original'}),error=>error.status===400);
assert.equal(randomBelow(1n,()=>{throw new Error('No random bits needed');}),0n);
let requests=[];assert.equal(randomBelow(3n,bound=>{requests.push(bound);return requests.length===1?3:2;}),2n);assert.deepEqual(requests,[4,4],'out-of-range integer is retried with unbiased bits');
assert.throws(()=>randomBelow(7n,()=>7.5),/invalid bounded integer/);
for(const bound of [2n,3n,255n,256n,257n,9007199254740997n,2n**100n+17n])for(let index=0;index<100;index++){const value=randomBelow(bound);assert(value>=0n&&value<bound);}
console.log(`PASS ${exactDistributions} exact rational RTP/hit distributions, ${nativeSpins} independently graded native spins, ${selectedRounds} immutable custom draws, zero/hundred-percent boundaries, complete bonus/retrigger contracts and original paytables`);

