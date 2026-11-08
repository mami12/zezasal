/**
 * First/Last Goalscorer selections (90 minutes + stoppage).
 * The winning scorer must be a verified non-own-goal actor from a complete
 * official incident history. Negative named-player decisions need validated
 * match participation and are NOT inferred from absence in a goals list.
 */
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
export function normalizeScorerName(v){
 const raw=String(v??'').trim();
 const reordered=raw.includes(',')?raw.split(',').map(x=>x.trim()).reverse().join(' '):raw;
 return norm(reordered);
}
export function parsePlayerOrdinalScorer(line){
 const title=String(line?.market_name??line?.marketName??line?.name??'').trim();
 const [market,...actorParts]=title.split(/\s+·\s+/);
 const name=norm(market);
 const matched=name.match(/^(first|1st|last)\s+(?:(?:goal\s*scorers?|goalscorers?)|(?:player\s+to\s+score))$/);
 if(!matched||Number(line?.period??0)!==0)return null;
 const mode=matched[1]==='last'?'last':'first';
 const quoted=String(line?.outcome_name??line?.outcomeName??line?.outcome_key??line?.outcomeKey??'').trim();
 let parameter=null;
 try{
  const key=String(line?.market_key??line?.marketKey??'');
  const encoded=key.split('@')[1];
  if(encoded){
   const p=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));
   if(typeof p?.pl==='string'&&p.pl.trim())parameter=p.pl.trim();
  }
 }catch{return null;}
 const none=/^(?:no\s+goalscorer|no\s+goal\s+scorer|no\s+scorer|none|neither|no\s+goals?)$/i.test(quoted);
 if(none)return {version:1,kind:'player-ordinal-goal',event:'goal',
  position:mode,choice:'none'};
 let nameOfPlayer=parameter??actorParts.join(' · ').trim();
 if(nameOfPlayer){
  if(!['yes','po'].includes(norm(quoted)))return null;
 }else{
  if(!quoted||['yes','no','po','jo','over','under','home','away','draw','x','1','2'].includes(norm(quoted)))return null;
  nameOfPlayer=quoted;
 }
 if(!normalizeScorerName(nameOfPlayer))return null;
 return {version:1,kind:'player-ordinal-goal',event:'goal',
  position:mode,choice:'player',playerName:nameOfPlayer.slice(0,200)};
}
export function gradePlayerOrdinalScorerFacts(contract,facts,{complete=false}={}){
 if(!complete||contract?.kind!=='player-ordinal-goal'||contract.event!=='goal'||
    !['first','last'].includes(contract.position)||
    !['none','player'].includes(contract.choice)||!Array.isArray(facts))return null;
 const eligible=[];
 for(const fact of facts){
  const minute=Number(fact?.minute),seconds=fact?.seconds==null?null:Number(fact.seconds);
  if(!Number.isSafeInteger(minute)||minute<0||minute>130||
     seconds!==null&&(!Number.isFinite(seconds)||seconds<0)||
     !['home','away'].includes(fact.team))return null;
  if(fact.own_goal===true)continue; // own goals never count as goalscorers
  // 'aiscore_verified' comes from a matched scorer incident and its own-goal
  // exclusion. An unknown own-goal flag with no proof is not a player goal.
  if(fact.own_goal!==false&&fact.aiscore_verified!==true)return null;
  const name=normalizeScorerName(fact.player_name??fact.aiscore_player_name);
  const alt=normalizeScorerName(fact.aiscore_player_name);
  if(!name&&!alt)return null; // unknown actor could have been the winner
  eligible.push({...fact,minute,seconds,name,alt});
 }
 eligible.sort((a,b)=>a.minute-b.minute||
   (a.seconds!==null&&b.seconds!==null?a.seconds-b.seconds:0));
 const selected=contract.position==='first'?eligible[0]:eligible.at(-1);
 if(selected){
  const second=contract.position==='first'?eligible[1]:eligible.at(-2);
  if(second&&second.minute===selected.minute&&
     (second.seconds===null||selected.seconds===null||
      second.seconds===selected.seconds))return null;
 }
 if(contract.choice==='none')return selected?'LOST':'WON';
 const picked=normalizeScorerName(contract.playerName);
 if(!picked)return null;
 if(!selected)return null; // no goal is not proof that the player started
 const match=picked===selected.name||picked===selected.alt;
 if(match)return 'WON';
 // A losing named scorer is only enforceable when the player's required
 // participation/start conditions are independently verified.
 if(contract.participationVerified===true)return 'LOST';
 return null;
}
