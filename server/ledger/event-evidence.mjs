import {createHash} from 'node:crypto';
import {eventContract,eventInWindow} from './event-contract.mjs';
const query=async(...args)=>(await import('../db.mjs')).query(...args);
import {eventMarketRequirement} from './event-market-policy.mjs';
import {parseTeamGoalMarket} from './live-contract-rules.mjs';
export const needsEvents=m=>!!eventMarketRequirement(m)||/header|headed|own goal|scoring method|method of.*goal/i.test(m.market_name??m.name??'');
/** One bounded snapshot per fixture, only while a matching ticket needs it.
 * An empty/error fallback cannot replace already complete event evidence. */
export function createEventEvidenceStore({runQuery=query,now=Date.now,cacheMs=10000}={}){
 let ready,pendingAt=-Infinity,pending=new Set(),watchFlight;
 let acceptedAt=-Infinity,accepted=new Set(),acceptedFlight;
 const acceptedBetWatchIds=async()=>{
  if(now()-acceptedAt<cacheMs)return accepted;
  if(!acceptedFlight)acceptedFlight=(async()=>{
   const r=await runQuery("select distinct l.match_id from app_ticket_line l join app_ticket t on t.id=l.ticket_id where l.status='PENDING' and t.status='PENDING'");
   accepted=new Set(r.rows.map(r=>String(r.match_id)));acceptedAt=now();return accepted;
  })().finally(()=>{acceptedFlight=null;});
  return acceptedFlight;
 };
 const init=()=>ready??=runQuery(`create table if not exists app_match_event_evidence(match_id bigint primary key,payload jsonb not null,observed_at timestamptz not null default now())`).catch(e=>{ready=null;throw e;});
 const eventWatchIds=async()=>{
  if(now()-pendingAt<cacheMs)return pending;
  if(!watchFlight)watchFlight=(async()=>{const r=await runQuery("select l.match_id,l.market_name,l.line,l.outcome_name,l.outcome_key,l.live_contract from app_ticket_line l join app_ticket t on t.id=l.ticket_id where l.status='PENDING' and t.status='PENDING'");pending=new Set(r.rows.filter(r=>r.live_contract!=null||needsEvents(r)||parseTeamGoalMarket(r)!=null).map(r=>String(r.match_id)));pendingAt=now();return pending;})().finally(()=>{watchFlight=null;});
  return watchFlight;
 };
 return {eventWatchIds,acceptedBetWatchIds,async pruneUnbetMatchEvidence(){
  await init();
  // The latest raw evidence is temporary for unbet fixtures. Keep the
  // snapshot used by Finished Favorites until its separate 48-hour window.
  return runQuery(`with expired_evidence as (
   delete from app_match_event_evidence e using app_match_result r
   where r.match_id=e.match_id and r.finished_at<now()-interval '24 hours'
     and not exists(select 1 from app_ticket_line l where l.match_id=e.match_id)
   returning e.match_id
  ), expired_snapshots as (
   delete from app_match_snapshot s using app_match_result r
   where r.match_id=s.match_id and r.finished_at<now()-interval '48 hours'
     and not exists(select 1 from app_ticket_line l where l.match_id=s.match_id)
   returning s.match_id
  )
  select (select count(*)::int from expired_evidence) as evidence,
         (select count(*)::int from expired_snapshots) as snapshots`);
 },async saveEventEvidence(id,payload){
  if(!payload||!Array.isArray(payload.events)||payload.events.length>20000)throw new Error('Invalid event evidence');
  if(!(await acceptedBetWatchIds()).has(String(id)))return false;
  await init();
  const saved=await runQuery(`insert into app_match_event_evidence(match_id,payload)
   select $1,$2::jsonb where exists(select 1 from app_ticket_line where match_id=$1 and status='PENDING')
   on conflict(match_id) do update set payload=excluded.payload,observed_at=now()
   where app_match_event_evidence.payload is distinct from excluded.payload
    and not (coalesce(excluded.payload->>'source','') in ('zizobet','betgenius') and coalesce(app_match_event_evidence.payload->>'source','') in ('bsd','worldcup26','sportapi','goalapi','apifootball') and coalesce(app_match_event_evidence.payload->>'complete','false')='true')
    and not (coalesce(excluded.payload->>'source','')='zizobet' and coalesce(app_match_event_evidence.payload->>'source','') in ('betgenius','sportradar'))
    and not (coalesce(app_match_event_evidence.payload->>'complete','false')='true' and coalesce(excluded.payload->>'complete','false')<>'true')
    and not (coalesce(app_match_event_evidence.payload->'coverage'->>'cornersThrough','-1')::numeric > coalesce(excluded.payload->'coverage'->>'cornersThrough','-1')::numeric and coalesce(excluded.payload->>'complete','false')<>'true')`,[id,JSON.stringify(payload)]);
  return saved.rowCount>0;
 },async loadEventEvidence(id){await init();return (await runQuery('select payload from app_match_event_evidence where match_id=$1',[id])).rows[0]?.payload??null;}};
}
const store=createEventEvidenceStore();
export const eventWatchIds=()=>store.eventWatchIds();
export const acceptedBetWatchIds=()=>store.acceptedBetWatchIds();
export const pruneUnbetMatchEvidence=()=>store.pruneUnbetMatchEvidence();
export const saveEventEvidence=(id,payload)=>store.saveEventEvidence(id,payload);
export const loadEventEvidence=id=>store.loadEventEvidence(id);
function zizobetMinute(value){
 const raw=String(value??'').trim(),match=raw.match(/^(\d{1,3})(?:\s*\+\s*(\d{1,2}))?$/);
 if(!match)return null;
 const minute=Number(match[1])+Number(match[2]??0);
 return Number.isSafeInteger(minute)&&minute>=0&&minute<=130?minute:null;
}
function zizobetEventSeconds(clock,minute){
 const time=String(clock??'').match(/^(\d{1,3}):([0-5]\d)$/);
 if(!time||minute===null)return null;
 const seconds=Number(time[1])*60+Number(time[2]);
 return Math.abs(seconds/60-minute)<=1?seconds:null;
}

export function normalizeEvents(data,source){
 let events=[];
 const active=e=>!e.disabled&&!e.cancelled&&!e.canceled&&e.isConfirmed!==false&&!/cancelled|canceled|voided/i.test(String(e.status??''));
 if(source==='sportradar')events=(data.doc?.[0]?.data?.events??[]).map(e=>({disabled:!active(e),id:e._id,type:e.type==='goal'?'goal':e.type==='corner'?'corner':e.type==='card'?'card':e.type,team:e.team,minute:e.time,seconds:e.seconds,injury:e.injurytime,player:e.scorer?.name??e.player?.name,playerId:e.scorer?._id??e.player?._id,own:e.owngoal,header:e.header,penalty:e.penalty,card:e.card,shootout:e.time===-1,phase:e.period??null,updatedAt:e.updated_uts??e.uts}));
 if(source==='betgenius')events=Object.values(data.data?.details?.playByPlayInfo??{}).flat().map(e=>({disabled:!active(e),id:e.id??`${e.type}|${e.teamId}|${e.timestamp}`,type:e.type==='Goal'?'goal':e.type==='Corner'?'corner':e.type==='Card'?'card':e.type,team:e.teamId,minute:parseInt(e.clock),player:e.actionDetails?.playerName,own:e.actionDetails?.isOwn,header:e.actionDetails?.isHeader,penalty:e.actionDetails?.penalty,phase:e.phase,qualifier:e.phaseQualifier,shootout:/shoot/i.test(e.phase??''),updatedAt:Date.parse(e.updatedTimestamp??e.timestamp??'')}));
 // A corner counts only after it is TAKEN, not merely awarded. Zizobet
 // schemas are not assumed to expose this flag universally: when an explicit
 // unexecuted/awarded marker exists, never turn it into a financial incident.
 // A contradictory official corner counter then prevents timeline coverage.
 const cornerNotTaken=e=>e.type==='corner_kick'&&
  (e.isTaken===false||e.taken===false||
   /^(?:awarded|not[_ -]?taken|unexecuted|not[_ -]?executed)$/i.test(String(e.status??'').trim()));
 const explicitCardColor=e=>{
  const type=String(e.type??'').toLowerCase().replace(/[\s-]+/g,'_');
  // Second-yellow dismissal semantics vary between providers. Do not silently
  // assign it to either counter without a documented primary event type.
  if(/second_yellow|yellow_red|yellowred/.test(type))return null;
  const fromType=/^(?:yellow_card|yellowcard|card_yellow|booking_yellow)$/.test(type)?'yellow':
   /^(?:red_card|redcard|card_red|booking_red)$/.test(type)?'red':null;
  const raw=String(e.cardColor??e.card_color??e.color??'').toLowerCase().trim();
  const fromField=/^yellow$/.test(raw)?'yellow':/^red$/.test(raw)?'red':null;
  if(fromType&&fromField&&fromType!==fromField)return null;
  return fromType??fromField;
 };
 const explicitOwnGoal=e=>{
  for(const raw of [e.isOwnGoal,e.ownGoal,e.own_goal,e.own]){
   if(typeof raw==='boolean')return raw;
   if(raw===1||raw==='1'||raw==='true')return true;
   if(raw===0||raw==='0'||raw==='false')return false;
  }
  if(/(?:\(\s*og\s*\)|\bown goal\b|\bautogol\b)/i.test(String(e.pl??'')))return true;
  return null;
 };
 const stableZizoId=e=>{
  if(e.id!=null&&String(e.id).trim())return String(e.id);
  // Timeline indices change when the provider reorders/corrects old events.
  // A content-derived identity is stable across polls; indistinguishable
  // duplicate events fail reconciliation rather than fabricating order.
  return 'anonymous:'+createHash('sha256').update(JSON.stringify([
   e.type??null,e.team??null,e.gt??null,e.clk??null,
   e.pl??null,e.playerId??e.player_id??null,e.cardColor??e.card_color??e.color??null
  ])).digest('hex').slice(0,32);
 };
 if(source==='zizobet')events=(data.TimeLines??[]).map(e=>{
  const type=String(e.type??'').toLowerCase();
  const minute=zizobetMinute(e.gt),color=explicitCardColor(e);
  return {disabled:!active(e)||cornerNotTaken(e),id:stableZizoId(e),
   type:type==='score_change'?'goal':type==='corner_kick'?'corner':/card|booking/.test(type)?'card':e.type,
   cardColor:/card|booking/.test(type)?color:null,
   ownGoal:type==='score_change'?explicitOwnGoal(e):null,
   team:/^(?:1|home|h)$/i.test(String(e.team))?'home':/^(?:2|away|a)$/i.test(String(e.team))?'away':null,
   minute:minute??NaN,seconds:zizobetEventSeconds(e.clk,minute),
   minuteLabel:e.gt==null?null:String(e.gt),
   player:[e.pl,e.player,e.player_name,e.playerName,e.actor]
     .map(v=>typeof v==='string'?v.trim():v&&typeof v==='object'?
       String(v.name??v.fullName??v.full_name??'').trim():'').find(Boolean)??null,
   playerId:e.playerId??e.player_id??e.player?.id??null,
   // The provider's 45+N notation unambiguously belongs to first-half
   // stoppage. Keep it as phase evidence: 45+2 must not be treated as 2H.
   phase:e.phase??(/^45\s*\+\s*[1-9]\d?$/.test(String(e.gt??'').trim())?'1st half':
     /^90\s*\+\s*[1-9]\d?$/.test(String(e.gt??'').trim())?'2nd half':null),
   updatedAt:e.updated_uts??null};
 });
 const unique=new Map();for(const event of events){const key=String(event.id),old=unique.get(key);if(!old||Number(event.updatedAt??0)>=Number(old.updatedAt??0)||!Number.isFinite(Number(old.updatedAt)))unique.set(key,event);}
 const retained=[...unique.values()].filter(e=>!e.disabled);
 // For closed corner windows, prove the timeline covers every corner observed
 // by this same provider at its own clock. Missing counters, invalid teams
 // or inconsistent totals mean NO coverage and must leave the bet pending.
 let coverage;
 if(source==='zizobet'&&Array.isArray(data.TimeLines)){
  const game=data.Match??{},rawClock=String(game.MatchTimeExtended??'').trim();
  const full=rawClock.match(/^(\d{1,3}):(\d{2})$/);
  const minute=full?Number(full[1])+Number(full[2])/60:
   game.MatchTime!=null&&String(game.MatchTime).trim()!==''?Number(game.MatchTime):NaN;
  const h=game.CornersTeam1,a=game.CornersTeam2;
  const count=[h,a].map(v=>v!=null&&String(v).trim()!==''&&/^\d+$/.test(String(v))?Number(v):null);
  const corners=retained.filter(e=>e.type==='corner');
  const actual=[corners.filter(e=>e.team==='home').length,corners.filter(e=>e.team==='away').length];
  const verified=Number.isFinite(minute)&&minute>=0&&minute<=130&&
   count.every(v=>v!==null)&&count.every((v,i)=>v===actual[i])&&
   corners.every(e=>Number.isFinite(e.minute)&&e.minute>=0&&(Number.isFinite(e.seconds)?e.seconds/60:e.minute)<=minute&&e.team!=null);
  if(verified)coverage={cornersThrough:Math.floor(minute)};
 }
 const zizoComplete=source==='zizobet'&&(Number(data?.Match?.MatchStatusID)===40||Number(data?.Match?.EventStatus)===40||data?.status==='ended'); const srComplete=source==='sportradar'&&retained.some(e=>e.type==='match_started')&&retained.some(e=>e.type==='match_ended'); return {source,complete:srComplete||zizoComplete,methodsVerified:source==='sportradar'&&data.doc?.[0]?.data?.match?.coverage?.deepercoverage===true,events:retained,...(coverage?{coverage}:{})};
}
const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const person=s=>norm(String(s??'').includes(',')?String(s).split(',').reverse().join(' '):s);
export const supportedContract=line=>eventContract(line).valid===true;
const confirmedPair=(home,away)=>[home,away].every(v=>v!=null&&Number.isInteger(Number(v))&&Number(v)>=0);
const completeByTeam=(events,home,away)=>confirmedPair(home,away)&&events.every(e=>e.team==='home'||e.team==='away')&&events.filter(e=>e.team==='home').length===Number(home)&&events.filter(e=>e.team==='away').length===Number(away);
// undefined = unsupported contract; null = incomplete evidence. Neither means loss.
export function gradeEventLine(line,result){
 if(!needsEvents(line))return undefined;
 const evidence=result?.event_evidence;
 const candidates=[evidence,...(evidence?.alternatives??[])].filter(Boolean);
 const statuses=new Set(candidates.map(event_evidence=>gradeSingleEventLine(line,{...result,event_evidence})).filter(x=>['WON','LOST','VOID'].includes(x)));
 return statuses.size===1?[...statuses][0]:null;
}
function gradeSingleEventLine(line,result){
 if(!needsEvents(line))return undefined;
 const ev=result?.event_evidence;if(!ev?.events||ev.complete!==true)return null;
 const contract=eventContract(line),name=contract.name??'',label=String(line.outcome_name??''),key=String(line.outcome_key??'').toLowerCase();
 if(!supportedContract(line))return null;
 if(/extra time|overtime|shootout|early payout|scoring type|scoring method|shots?|fouls?/i.test(name))return null;
 const regular=ev.events.filter(e=>!e.shootout&&Number.isFinite(e.minute)&&e.minute>=0&&e.minute<=90&&!/extra|shoot/i.test(e.phase??'')).sort((a,b)=>a.minute-b.minute||(a.injury??0)-(b.injury??0)||(a.seconds??0)-(b.seconds??0));
 let all=regular.filter(e=>e.type==='goal');
 // Stable provider IDs identify one physical event, even if a source repeats it.
 const eventIds=all.filter(e=>e.id!=null&&String(e.id)!=='').map(e=>String(e.id));
 if(new Set(eventIds).size!==eventIds.length)return null;
 if(!completeByTeam(all,result.home_score,result.away_score))return null;
 if(/corners?/i.test(name)){all=regular.filter(e=>e.type==='corner');if(!completeByTeam(all,result.corners_home,result.corners_away))return null;}
 if(/cards?/i.test(name)){if(/yellow|red/i.test(name))return null;all=regular.filter(e=>e.type==='card');if(!completeByTeam(all,result.cards_home,result.cards_away))return null;}
 if(/first.*scorer|last.*scorer|^(?:first goal|last goal|who scores goal)/i.test(name)&&all.some((e,i)=>i&&e.minute===all[i-1].minute&&(e.injury??0)===(all[i-1].injury??0)&&(!Number.isFinite(e.seconds)||!Number.isFinite(all[i-1].seconds)||e.seconds===all[i-1].seconds)))return null;
 let selected=all;
 if(contract.timing){
  const timed=all.filter(e=>eventInWindow(e,contract)),goal=timed[contract.timing-1];
  if(timed.some((e,i)=>i&&e.minute===timed[i-1].minute&&(e.injury??0)===(timed[i-1].injury??0)&&(!Number.isFinite(e.seconds)||!Number.isFinite(timed[i-1].seconds)||e.seconds===timed[i-1].seconds)))return null;
  if(/^(?:no goal|none|no more goals)$/i.test(label)||key==='none')return goal?'LOST':'WON';
  const interval=label.match(/^(\d+)\s*[-–]\s*(\d+)(?:\s*(?:minutes?|min))?$/i)??key.match(/^(\d+)-(\d+)$/);
  if(!interval)return null;const from=Number(interval[1]),to=Number(interval[2]);if(from<0||to>90||to<from)return null;
  return goal&&goal.minute>=from&&goal.minute<=to?'WON':'LOST';
 }
 selected=selected.filter(e=>eventInWindow(e,contract));
 let count,target;
 const method=contract.method;
 if(method){if(selected.length&&(selected.some(e=>typeof e[method]!=='boolean')||(!ev.methodsVerified&&!['bsd','goalapi','apifootball','sportapi'].includes(ev.source))))return null;selected=selected.filter(e=>e[method]);}
 const assistMarket=/assist/i.test(name);
 const player=/player|scorer|assist|\bto score\b/i.test(name)&&!/both teams|team to score|who scores/i.test(name);
 if(player){
  if(all.some(e=>!e.player||typeof e.own!=='boolean'))return null;
  // Own goals do not identify the first/last eligible goalscorer.
  if(/first.*scorer/i.test(name))selected=selected.filter(e=>e.own!==true).slice(0,1);
  else if(/last.*scorer/i.test(name))selected=selected.filter(e=>e.own!==true).slice(-1);
  target=contract.player;
  if(!target){try{const encoded=String(line.market_key??'').split('@')[1];target=JSON.parse(Buffer.from(encoded,'base64url').toString()).pl;}catch{}}
  target=target??(!/^(yes|no|over|under|1|2)$/i.test(label)?label:null);
  if(!target)return null;
  // Being absent from the scorers list does not prove a player participated.
  // Without participation evidence a non-playing selection may be a refund.
  const participants=(ev.participants??[]).filter(p=>[p.name,...(p.aliases??[])].some(n=>person(n)===person(target))&&p.played===true);
  const identities=new Set(participants.map(p=>String(p.id??person(p.name))));
  if(identities.size>1)return null;
  const identity=participants[0];
  const isPlayer=e=>identity?.id!=null&&e.playerId!=null?String(identity.id)===String(e.playerId):person(e.player)===person(target);
  if(!identity&&!all.some(isPlayer))return null;
  if(assistMarket){
   if(all.some(e=>e.assistKnown!==true))return null;
   selected=selected.filter(e=>e.own!==true&&(identity?.id!=null&&e.assistId!=null?String(identity.id)===String(e.assistId):[target,identity?.name,...(identity?.aliases??[])].filter(Boolean).some(n=>person(n)===person(e.assist))));
  }else selected=selected.filter(e=>isPlayer(e)&&(method==='own'||e.own!==true));count=selected.length;
  if(count===0&&/first.*scorer|last.*scorer/i.test(name)&&!identity)return null;
 }else if(/most goals|most corners|most cards|who scores goal|first goal|last goal|next goal/i.test(name)){
  if(/next goal/i.test(name)){const n=Number(name.match(/who scores (?:the )?goal (\d+)|goal (\d+)/i)?.[1]??name.match(/(\d+)(?:st|nd|rd|th) goal/i)?.[1]??1);selected=selected.slice(n-1,n);}
  if(/first goal/i.test(name))selected=selected.slice(0,1);
  else if(/last goal/i.test(name))selected=selected.slice(-1);
  else if(/who scores goal/i.test(name)){const n=Number(name.match(/who scores goal (\d+)/i)?.[1]);if(!n)return null;selected=selected.slice(n-1,n);}
  if(selected.some(e=>!['home','away'].includes(e.team)))return null;
  const h=selected.filter(e=>e.team==='home').length,a=selected.filter(e=>e.team==='away').length;
  if(/no goal|none|no more goals/i.test(label)||key==='none'||key==='0'){
   return selected.length===0?'WON':'LOST';
  }
  if(!/most /i.test(name)&&!selected.length)return /^(1|2|home|away)$/i.test(label)||key==='1'||key==='2'?'LOST':null;
  const side=/^(1|home)$/i.test(label)||key==='1'?'home':/^(2|away)$/i.test(label)||key==='2'?'away':/^(x|draw)$/i.test(label)||key==='x'?'draw':null;if(!side)return null;
  return (side==='home'?h>a:side==='away'?a>h:h===a)?'WON':'LOST';
 }
 else if(/total|number of goals/i.test(name)||method){if(/home team/i.test(name))selected=selected.filter(e=>e.team==='home');if(/away team/i.test(name))selected=selected.filter(e=>e.team==='away');count=selected.length;}
 else return null;
 const yes=/^(yes|po)$/i.test(label)||key==='yes',no=/^(no|jo)$/i.test(label)||key==='no';
 if(yes&&no)return null;
 if(contract.mode){
  let amount=contract.amount,mode=contract.mode;
  if(mode==='exactSelection'){
   const value=/^\d+$/.test(label.trim())?label.trim():/^\d+$/.test(key)?key:null;
   if(value==null)return null;amount=Number(value);mode='exact';
  }
  if(!Number.isInteger(amount)||amount<0||amount>100)return null;
  const met=mode==='exact'?count===amount:count>=amount;
  if(!yes&&!no&&contract.mode!=='exactSelection'&&person(label)!==person(target??''))return null;
  return (no?!met:met)?'WON':'LOST';
 }
 const plus=(name+' '+label).match(/\b(\d+)\+/);if(plus){const met=count>=Number(plus[1]);return (no?!met:met)?'WON':'LOST';}
 if(/exact/i.test(name))return null;
 if(yes||no)return (no?count===0:count>0)?'WON':'LOST';
 const threshold=Number(line.line),over=/^over/i.test(label)||key==='over',under=/^under/i.test(label)||key==='under';
 if(over&&under)return null;
 if((over||under)&&line.line!==''&&line.line!=null&&Number.isFinite(threshold))return count===threshold?'VOID':(over?count>threshold:count<threshold)?'WON':'LOST';
 if(player&&!/next|exact/i.test(name)&&person(label)===person(target??''))return count>0?'WON':'LOST';
 return null;
}

/** A proved provider corner timeline can close a frozen 5-minute YES/NO
 * contract once the provider clock has advanced beyond the window.
 * Missing or contradictory evidence returns null, never a presumed loss.
 */
export function gradeClosedCornerWindow(line,evidence){
 const contract=eventContract(line);
 if(!contract.valid||!contract.window||contract.half||!/^(?:total corners)$/.test(contract.name))return null;
 const through=Number(evidence?.coverage?.cornersThrough);
 if(!evidence||evidence.source!=='zizobet'||evidence.coverage?.cornersThrough==null||
    !Number.isFinite(through)||through<=contract.window.to||!Array.isArray(evidence.events))return null;
 const label=String(line.outcome_name??line.outcomeName??'').trim().toLowerCase();
 const key=String(line.outcome_key??line.outcomeKey??'').trim().toLowerCase();
 // Provider outcome keys may be opaque IDs. The stored display label proves
 // which selection was sold. Unknown choices must never be auto-graded.
 const yes=label==='yes'||label==='po',no=label==='no'||label==='jo';
 if(yes===no)return null;
 const corners=evidence.events.filter(e=>e.type==='corner');
 if(corners.some(e=>!Number.isFinite(e.minute)||!['home','away'].includes(e.team)))return null;
 const happened=corners.some(e=>eventInWindow(e,contract));
 return (yes?happened:!happened)?'WON':'LOST';
}
