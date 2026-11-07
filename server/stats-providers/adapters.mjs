// Provider identities remain separate. Never fuzzy-match a player or swap home/away.
export const canonical=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');

export function cleanTeam(s) {
 return String(s ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\b(futbol|kulubu|kulub|club|clube|calcio|deportivo|sporting|athletic|united|city|town|wanderers|rovers)\b/gi, '')
  .replace(/\b(fc|fk|cf|afc|sc|as|ac|sk|bsc|cs|cd|ss|us|sv|vfb|tsv|spvgg|rb)\b/gi, '')
  .replace(/y/g, 'i')
  .replace(/[^a-z0-9]/g, '');
}

export function teamsMatch(a, b) {
 const ca = cleanTeam(a), cb = cleanTeam(b);
 if (!ca || !cb) return false;
 if (ca === cb) return true;
 if (ca.length >= 4 && cb.length >= 4) {
  if (ca.includes(cb) || cb.includes(ca)) return true;
 }
 return false;
}

export function uniqueFixture(row,list){
 const time=Date.parse(row.start_at??row.startAt),h=canonical(row.home),a=canonical(row.away);
 if(!h||!a||h===a||!Number.isFinite(time))return null;
 const exact=list.filter(x=>canonical(x.home)===h&&canonical(x.away)===a&&Math.abs(Date.parse(x.start)-time)<=7200000);
 if(exact.length===1)return exact[0];
 const found=list.filter(x=>teamsMatch(x.home,row.home)&&teamsMatch(x.away,row.away)&&Math.abs(Date.parse(x.start)-time)<=7200000);
 return found.length===1?found[0]:null;
}
export function goalCapabilities(e){
 const goals=e.events.filter(x=>x.type==='goal'&&!x.shootout);
 const methodFields=Object.fromEntries(['header','leftFoot','rightFoot','own','penalty'].map(k=>[k,goals.length>0&&goals.every(x=>typeof x[k]==='boolean')]));
 return {methodFields,goals:e.goalsAvailable===true,methods:goals.length>0&&goals.every(x=>typeof x.header==='boolean'&&typeof x.own==='boolean'&&typeof x.penalty==='boolean'),assists:goals.length>0&&goals.every(x=>typeof x.assistKnown==='boolean'&&x.assistKnown)};
}
const phase=(m,extra)=>Number(m)>90?'extra':Number(m)<=45?'H1':'H2';
export function normalizeGoalApi(f,list,lineups){
 const score=v=>v!=null&&v!==''&&Number.isInteger(Number(v))?Number(v):null;
 const events=list.filter(x=>x.type==='GOAL').map(x=>{
  const side=x.homeScorer&&!x.awayScorer?'home':x.awayScorer&&!x.homeScorer?'away':null;
  const player=side==='home'?x.homeScorer:x.awayScorer,playerId=side==='home'?x.homeScorerId:x.awayScorerId;
  const assist=side==='home'?x.homeAssist:x.awayAssist,info=String(x.info??'');
  const period=/extra|shoot|penalt.*shoot/i.test(x.scoreInfoTime??'')?'extra':/1st|first/i.test(x.scoreInfoTime??'')?'H1':/2nd|second/i.test(x.scoreInfoTime??'')?'H2':phase(parseInt(x.time));
  return {id:x.id,type:'goal',team:side,player,playerId,assist:assist??null,assistId:side==='home'?x.homeAssistId:x.awayAssistId,assistKnown:!!assist||/^penalty$/i.test(info),minute:parseInt(x.time),injury:Number(String(x.time).match(/\+\s*(\d+)/)?.[1]??0),phase:period,own:/own goal/i.test(info),penalty:/^penalty$/i.test(info)};
 });
 const participants=[];
 for(const side of ['home','away'])for(const p of lineups[side]?.startingLineups??[]){
  const aliases=events.flatMap(e=>[...(String(e.playerId)===String(p.playerKey)?[e.player]:[])]);
  participants.push({id:p.playerKey,name:p.lineupPlayer,aliases,team:side,played:true});
 }
 // A scorer participated; do not infer participation from a substitute listing.
 for(const e of events)if(e.player)participants.push({id:e.playerId,name:e.player,team:e.team,played:true});
 return {source:'goalapi',events,participants,final:f.matchStatus==='FINISHED',complete:f.matchStatus==='FINISHED',goalsAvailable:Array.isArray(list)&&events.every(e=>e.team&&e.player),homeScore:score(f.homeTeamFtScore),awayScore:score(f.awayTeamFtScore),methodsVerified:false};
}
export function normalizeBsd(f,inc,stats,lineups,availability){
 const events=(inc.incidents??[]).filter(x=>x.type==='goal'&&!x.cancelled&&!x.disabled).map((x,i)=>{
  const shot=(stats.shotmap??[]).filter(s=>s.type==='goal'&&String(s.player_id)===String(x.player_id)&&Number(s.min)===Number(x.minute)&&s.sit!=='shootout');
  const seq=(x.sequence??[]).filter(s=>s.event==='goal'&&String(s.pid)===String(x.player_id));
  const body=shot.length===1?shot[0].body:seq.length===1?seq[0].body:null;
  const known=['regular','normal','penalty','own_goal','own-goal','own'].includes(x.goal_type);
  return {id:String(i),type:'goal',team:x.is_home===true?'home':x.is_home===false?'away':null,minute:x.minute==null||x.minute===''?NaN:Number(x.minute),injury:Number(x.added_time??0),phase:phase(x.minute),player:x.player,playerId:x.player_id,assist:x.assist??null,assistKnown:Object.hasOwn(x,'assist'),own:known?/own/.test(x.goal_type):undefined,penalty:known?x.goal_type==='penalty':undefined,header:['head','left-foot','right-foot','other'].includes(body)?body==='head':undefined,leftFoot:['head','left-foot','right-foot','other'].includes(body)?body==='left-foot':undefined,rightFoot:['head','left-foot','right-foot','other'].includes(body)?body==='right-foot':undefined};
 });
 const participants=[];
 for(const side of ['home','away'])for(const p of lineups.lineups?.[side]?.players??[])participants.push({id:p.id,name:p.name,aliases:[p.short_name].filter(Boolean),team:side,played:lineups.lineup_status==='confirmed'});
 // A substitute with an observed goal demonstrably participated; a bench listing alone does not.
 for(const e of events)if(e.player)participants.push({id:e.playerId,name:e.player,team:e.team,played:true});
 return {source:'bsd',events,participants,final:f.status==='finished',complete:f.status==='finished',goalsAvailable:availability.available?.incidents===true,homeScore:f.home_score,awayScore:f.away_score,methodsVerified:goalCapabilities({events}).methods};
}
export function normalizeApiFootball(f,list,lineups){
 const events=list.filter(x=>x.type==='Goal').map((x,i)=>({id:String(i),type:'goal',team:x.team?.id===f.teams.home.id?'home':x.team?.id===f.teams.away.id?'away':null,minute:x.time?.elapsed,injury:x.time?.extra??0,phase:phase(x.time?.elapsed),player:x.player?.name,playerId:x.player?.id,assist:x.assist?.name??null,assistId:x.assist?.id,assistKnown:!!x.assist,own:x.detail==='Own Goal',penalty:x.detail==='Penalty'}));
 const participants=[];for(const t of lineups)for(const p of t.startXI??[])participants.push({id:p.player?.id,name:p.player?.name,team:t.team?.id===f.teams.home.id?'home':'away',played:true});
 for(const x of list.filter(x=>x.type==='subst'))participants.push({id:x.assist?.id,name:x.assist?.name,played:true});
 return {source:'apifootball',events,participants,final:f.fixture.status.short==='FT',complete:f.fixture.status.short==='FT',goalsAvailable:list.length>0,homeScore:f.goals.home,awayScore:f.goals.away,methodsVerified:false};
}
export function normalizeSportApi(f,list,lineups){
 const events=list.filter(x=>/^(goal|own_goal|penalty_goal)$/.test(x.event_type)).map(x=>({id:String(x.id),type:'goal',team:x.team_side,minute:parseInt(x.minute),injury:Number(String(x.minute).match(/\+(\d+)/)?.[1]??0),phase:phase(parseInt(x.minute)),player:x.player_name,playerId:x.player_urn,own:x.event_type==='own_goal'||/own goal/i.test(x.extra_info??''),penalty:x.event_type==='penalty_goal'||/penalty/i.test(x.extra_info??'')}));
 const participants=[];for(const side of ['home','away'])for(const p of [...(lineups.data?.[side]?.starters??[]),...(lineups.data?.[side]?.subs??[])])if(p.mins_played>0)participants.push({name:p.name,played:true,team:side});
 return {source:'sportapi',events,participants,final:f.status==='FT',complete:f.status==='FT',goalsAvailable:list.length>0,homeScore:f.home_score,awayScore:f.away_score,methodsVerified:false};
}
export function normalizeWorld(f,plays){
 const c=f.competitions?.[0],teams=c?.competitors??[],events=[];
 for(const x of plays.filter(x=>x.scoringPlay&&x.valid!==false&&!x.shootout)){
  const t=teams.find(t=>String(t.id)===String(x.team?.source_id||x.team?.id)),p=x.athletesInvolved?.[0];
  const display=String(x.clock?.displayValue??'').replace(/['’\s]/g,'').match(/^(\d+)(?:\+(\d+))?$/),clock=x.clock?.value==null||x.clock?.value===''?NaN:Number(x.clock.value);
  const minute=display?Number(display[1]):Math.ceil(clock/60),injury=display?.[2]?Number(display[2]):0;
  events.push({id:x.id,type:'goal',team:t?.homeAway,minute,injury,seconds:Number.isFinite(clock)?clock%60:undefined,phase:Number(x.period?.number)>2?'extra':Number(x.period?.number)===1?'H1':'H2',player:p?.displayName,playerId:p?.id,own:x.ownGoal,penalty:x.penaltyKick});
 }
 return {source:'worldcup26',events,participants:[],final:c?.status?.type?.completed===true,complete:c?.status?.type?.completed===true,goalsAvailable:events.length>0&&events.every(e=>e.team&&e.player),homeScore:Number(teams.find(t=>t.homeAway==='home')?.score),awayScore:Number(teams.find(t=>t.homeAway==='away')?.score),methodsVerified:false};
}
