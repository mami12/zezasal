/**
 * Individual goalscorer totals and goal-in-half markets.
 *
 * Confirmed individual scorer events can prove positive propositions.
 * A negative individual proposition needs BOTH a complete scorer chronology
 * and evidence that the nominated player was eligible/participated.
 *
 * Own goals do not count toward an individual scorer's goals.
 */
const fold=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const canonical=v=>{
 const raw=String(v??'').trim();
 return fold(raw.includes(',')?raw.split(',').reverse().join(' '):raw);
};
const int=v=>v!==null&&v!==undefined&&v!==''&&Number.isSafeInteger(Number(v))&&
 Number(v)>=0?Number(v):null;
const yes=v=>['yes','po'].includes(fold(v))?true:['no','jo'].includes(fold(v))?false:null;
function quotedActor(line,title,choice,kind){
 const key=String(line.market_key??line.marketKey??'');
 let id=null,param=null;
 try{
  const encoded=key.split('@')[1];
  if(encoded){
   const payload=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));
   if(typeof payload?.pl==='string'&&payload.pl.trim())param=payload.pl.trim();
   if(payload?.pid!=null&&String(payload.pid).trim())id=String(payload.pid);
  }
 }catch{return null;}
 const sections=title.split(/\s+·\s+/);
 const embedded=sections.slice(1).join(' · ').trim();
 const market=sections[0];
 const player=param??embedded??'';
 const label=String(choice??'').trim();
 const isSelectionName=kind==='named'&&!player&&
  label&&!/^(?:yes|no|po|jo|over|under|none|exact|1|2|x)$/i.test(label);
 const actor=isSelectionName?label:player;
 if(!actor||!canonical(actor)||actor.length>200)return null;
 return {playerName:actor, ...(id?{playerId:id}:{})};
}
export function isPlayerGoalSpecial(line){
 const title=fold(line?.market_name??line?.marketName??line?.name).split(' · ')[0];
 return /^(?:anytime\s+)?player\s+(?:(?:total\s+)?goals?|to score(?:\s+\d+\s*(?:or more|\+)\s+goals?)?|to score in (?:1st|first|2nd|second|both)\s+hal(?:f|ves)|to score a hat trick)|^player to score\s+(?:2|3)\s+or more goals?$|^player hat trick$/.test(title);
}
export function parsePlayerGoalSpecial(line){
 const title=String(line?.market_name??line?.marketName??line?.name??'').trim();
 const left=title.split(/\s+·\s+/)[0],name=String(left).normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 const period=Number(line?.period??0);
 if(![0,1,2].includes(period))return null;
 const rawLabel=String(line?.outcome_name??line?.outcomeName??line?.outcome_key??line?.outcomeKey??'').trim();
 const label=String(rawLabel).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/\s+/g,' ').trim();
 let mode=null,choice=null,threshold=null,half=null;
 const halfMarket=name.match(/^player to score in (1st|first|2nd|second|both) (?:half|halves)$/);
 const atLeast=name.match(/^player to score (\d{1,2})\s*(?:\+|or more)(?:\s+goals?)?$/);
 const hat=/^player (?:to score a )?hat(?:\s|-)?trick$/.test(name);
 if(halfMarket){
  mode='period';half=/^(?:1st|first)$/.test(halfMarket[1])?1:
    /^(?:2nd|second)$/.test(halfMarket[1])?2:'both';
  if((half==='both'&&period!==0)||
     (half!=='both'&&period&&period!==half))return null;
  choice=yes(rawLabel);
  if(choice===null)choice=true;
 }else if(atLeast||hat){
  mode='count';threshold=hat?3:Number(atLeast[1]);
  choice=yes(rawLabel);
  if(choice===null)choice=true;
 }else if(/^(?:player (?:total )?goals?|player goals? total)$/.test(name)){
  mode='count';
  const over=label.match(/^over\s+(\d+(?:[.,]\d+)?)$/);
  const under=label.match(/^under\s+(\d+(?:[.,]\d+)?)$/);
  const exact=label.match(/^(?:exactly?\s+)?(\d{1,2})$/);
  if(over||under){
   const named=Number((over??under)[1].replace(',','.'));
   const quoted=line.line==null||line.line===''?null:Number(String(line.line).replace(',','.'));
   if(quoted!==null&&quoted!==named)return null;
   if(!Number.isFinite(named)||named<0||named>30||!Number.isSafeInteger(named*2))return null;
   threshold=named;choice=over?'over':'under';
  }else if(/^over$|^under$/.test(label)){
   // Number('') is zero in JavaScript; an omitted goal line is NOT an
   // explicitly priced "Over 0" market and must never be accepted.
   const supplied=line.line??line.specifier;
   if(supplied==null||String(supplied).trim()==='')return null;
   const quoted=Number(String(supplied).replace(',','.'));
   if(!Number.isFinite(quoted)||quoted<0||quoted>30||!Number.isSafeInteger(quoted*2))return null;
   threshold=quoted;choice=label;
  }else if(exact){threshold=Number(exact[1]);choice='exact';}
  else return null;
 }else return null;
 // Native period=1/2 on a player's goal-total is the respective half,
 // never silently expanded to full-time scoring.
 if(mode==='count'&&period)half=period;
 const actor=quotedActor(line,title,rawLabel,mode==='count'?'count':'named');
 if(!actor)return null;
 if(mode==='period'&&!['boolean'].includes(typeof choice))return null;
 if(mode==='count'&&typeof choice==='boolean'&&(!Number.isSafeInteger(threshold)||threshold<1||threshold>30))return null;
 return {version:1,kind:'player-goal-special',event:'goal',...actor,
  mode,choice,...(half?{half}:{}),...(threshold!==null?{threshold}:{})};
}
const first=new Set(['1','h1','1h','1sthalf','firsthalf','half1','firstperiod','1stperiod','period1']);
const second=new Set(['2','h2','2h','2ndhalf','secondhalf','half2','secondperiod','2ndperiod','period2']);
const phaseOf=e=>{
 const minute=int(e?.minute);
 if(minute===null||minute>130)return null;
 const phase=fold(e.phase).replace(/[^a-z0-9]/g,'');
 if(first.has(phase))return minute<=75?1:null;
 if(second.has(phase))return minute>=45?2:null;
 if(phase)return null;
 return minute<45?1:null;
};
export function gradePlayerGoalSpecial(contract,facts,{complete=false,participationVerified=false}={}){
 if(contract?.kind!=='player-goal-special'||contract.event!=='goal'||
    !Array.isArray(facts)||!contract.playerName||
    !['period','count'].includes(contract.mode))return null;
 const requiredName=canonical(contract.playerName);
 let count=0,firstHalf=0,secondHalf=0,ambiguous=false;
 for(const fact of facts){
  if(!['home','away'].includes(fact.team))return null;
  // An unknown scorer might be the selected player; a negative cannot be
  // decided from a partial identity list.
  const own=fact.own_goal??fact.ownGoal;
  if(own===true)continue;
  const scorer=canonical(fact.player_name??fact.playerName??
   (fact.aiscore_verified===true?fact.aiscore_player_name:null)??
   (own===false&&fact.fotmob_verified===true?fact.fotmob_player_name:null));
  const validated=own===false||fact.aiscore_verified===true;
  if(!validated||!scorer){ambiguous=true;continue;}
  const scorerId=fact.player_id??fact.playerId??fact.aiscore_player_id;
  const same=contract.playerId!=null&&scorerId!=null?
    String(contract.playerId)===String(scorerId):scorer===requiredName;
  if(!same)continue;
  const inHalf=phaseOf(fact);
  if(contract.mode==='count'&&!contract.half){
    // Full-match player goals do not require a phase, only a verified scorer
    // and a complete 90-minute goal list.
    count++;
    if(inHalf===1)firstHalf++;else if(inHalf===2)secondHalf++;
    continue;
  }
  if(inHalf===null){ambiguous=true;continue;}
  if(contract.mode==='count'&&contract.half&&inHalf!==contract.half)continue;
  count++;
  if(inHalf===1)firstHalf++;
  else if(inHalf===2)secondHalf++;
 }
 const positive=contract.mode==='period'?
  contract.half==='both'?firstHalf>0&&secondHalf>0:
    contract.half===1?firstHalf>0:contract.half===2?secondHalf>0:null
  :typeof contract.choice==='boolean'?count>=contract.threshold:
    contract.choice==='over'?count>contract.threshold:
    contract.choice==='under'?count<contract.threshold:
    contract.choice==='exact'?count===contract.threshold:null;
 if(positive===null)return null;
 // A proven scorer or required count already met provides irreversible
 // positive evidence for YES/OVER. Negative propositions require coverage
 // and proof that a nominated player was an eligible participant.
 if(contract.mode==='period'){
  if(contract.choice===true&&positive)return 'WON';
  if(contract.choice===false&&positive)return 'LOST';
 }else if(contract.choice===true&&positive)return 'WON';
 else if(contract.choice===false&&positive)return 'LOST';
 else if(contract.choice==='over'&&positive)return 'WON';
 else if(contract.choice==='under'&&!positive&&count>contract.threshold)return 'LOST';
 else if(contract.choice==='exact'&&count>contract.threshold)return 'LOST';
 // A verified scored goal itself proves the player's participation; a
 // zero-goal tally does NOT prove they stepped on the pitch.
 if(!complete||ambiguous||!(participationVerified||count>0))return null;
 if(contract.mode==='period'||typeof contract.choice==='boolean')
  return positive===contract.choice?'WON':'LOST';
 if(Number.isInteger(contract.threshold)&&contract.threshold===count)return contract.choice==='exact'?'WON':
    contract.choice==='over'||contract.choice==='under'?'VOID':null;
 return positive?'WON':'LOST';
}
