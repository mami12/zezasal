/** Read-only, football-only AiScore/TheSports01 information collector.
 * These are candidate website endpoints, NOT a documented settlement API.
 * No CF cookies, browser impersonation, MQTT subscription or wallet changes.
 */
import {createHash} from 'node:crypto';
import {enrichPrimaryScorerNames} from './aiscore-scorer-enrichment.mjs';
import {query} from '../db.mjs';
import {getMatchById} from '../matches.mjs';
import {teamsMatch} from './adapters.mjs';
import {fixtureLive,prematchSoon} from './realtime-policy.mjs';

export const FOOTBALL_INFORMATION_SQL=String.raw`
create table if not exists app_football_information_map (
 match_id bigint primary key,
 aiscore_id text,
 thesports01_id text,
 mapped_by uuid references app_user(id) on delete set null,
 mapping_status text not null default 'ADMIN_SUPPLIED_UNVERIFIED'
   check(mapping_status in ('ADMIN_SUPPLIED_UNVERIFIED','CONFIRMED')),
 next_check_at timestamptz not null default now(),
 last_checked_at timestamptz,
 last_error text,
 updated_at timestamptz not null default now(),
 check(aiscore_id is not null or thesports01_id is not null)
);
create table if not exists app_football_information_snapshot (
 id bigserial primary key,
 match_id bigint not null references app_football_information_map(match_id) on delete cascade,
 source text not null,
 payload_hash text not null,
 payload jsonb not null,
 observed_at timestamptz not null default now(),
 unique(match_id,source,payload_hash)
);
create index if not exists app_football_information_snapshot_idx
 on app_football_information_snapshot(match_id,observed_at desc);
`;

const ai='https://api.aiscore.com/v1/web/api';
const ts='https://api.thesports01.com/api';
const asId=(id,kind)=>{
 const value=String(id??'').trim();
 if(value===''||value==='null')return null;
 if(kind==='aiscore'&&!/^[a-z0-9]{10,24}$/i.test(value))throw Object.assign(new Error('ID AiScore i pavlefshëm.'),{status:400});
 if(kind==='thesports01'&&!/^\d{3,12}$/.test(value))throw Object.assign(new Error('ID TheSports01 i pavlefshëm.'),{status:400});
 return value;
};
export function isFootballFixture(row){
 if(!row)return false;
 if(row.sport_tag!=null)return /^football$/i.test(String(row.sport_tag));
 if(row.sport_key!=null)return /^(soccer|football)$/i.test(String(row.sport_key));
 if(row.sport_id!=null)return [1,18].includes(Number(row.sport_id));
 // Unmarked fixtures cannot be proven football; safe failure.
 return false;
}
/**
 * The PRIMARY feed alone grades goals, corners, race-to-X, event windows,
 * cards and all ordinary totals. Request secondary information ONLY for a
 * missing player identity or football shots-on-target/fouls statistics.
 */
/** AiScore supplies scorer names only. All game facts are Zizobet's. */
export function marketInformationNeeds(markets=[]){
 const needs=new Set();
 for(const market of markets){
  const name=String(market.market_name??market.marketName??market.name??'').toLowerCase();
  if(market.live_contract?.kind==='player-goal'){needs.add('player');continue;}
  if(/\b(?:goalscorer|goal scorer|scorer|player)\b.*\b(?:goal|score|scoring|sh[eë]non)\b|\b(?:first|last|anytime)\s+goalscorer/i.test(name))
   needs.add('player');
  if(/\b(?:shots?|goditje|on target|target|fouls?|faulle?)\b/i.test(name))
   needs.add('stats');
 }
 return [...needs];
}
export const INFORMATION_ENDPOINTS=[
 {key:'aiscore:match',kind:'aiscore',needs:['player','stats'],
  path:id=>ai+'/match/s?match_id='+encodeURIComponent(id)},
 {key:'aiscore:mlive',kind:'aiscore',needs:['player','stats'],
  path:id=>ai+'/match/mlive?lang=2&match_id='+encodeURIComponent(id)+'&country_code=AL'}
];
export function selectedInformationEndpoints(map,needs){
 if(!Array.isArray(needs)||!needs.length)return [];
 const wanted=new Set(needs);
 return INFORMATION_ENDPOINTS.filter(spec=>
  (spec.kind==='aiscore'?map.aiscore_id:map.thesports01_id)&&
  spec.needs.some(k=>wanted.has(k))).map(spec=>({
   key:spec.key,url:spec.path(spec.kind==='aiscore'?map.aiscore_id:map.thesports01_id)
  }));
}
export function describeJsonStructure(payload,{maxPaths=80}={}){
 const paths=[],samples=[];
 function visit(item,path,depth){
  if(paths.length>=maxPaths||depth>6||item==null)return;
  if(Array.isArray(item)){
   paths.push(path+'[]');
   if(item.length)visit(item[0],path+'[0]',depth+1);
   return;
  }
  if(typeof item!=='object')return;
  for(const [key,value] of Object.entries(item).slice(0,45)){
   if(paths.length>=maxPaths)break;
   const next=path?path+'.'+key:key;
   paths.push(next);
   if(Array.isArray(value)||value&&typeof value==='object')visit(value,next,depth+1);
  }
 }
 visit(payload,'',0);
 // Describes candidate paths; DOES NOT certify real event coverage or minutes.
 return {topLevelKeys:payload&&typeof payload==='object'&&!Array.isArray(payload)?Object.keys(payload).slice(0,40):[],
  paths,hasEventLikePath:paths.some(x=>/\b(?:incident|event|timeline|goal|card|penalt|assist|corner|foul)\b/i.test(x)),
  samples};
}
export function canonicalHttpError(status){
 if([401,403].includes(status))return 'AUTH_REQUIRED';
 if(status===429)return 'RATE_LIMITED';
 if(status===404)return 'NOT_FOUND';
 if(status>=500)return 'REMOTE_FAILURE';
 return 'HTTP_'+status;
}
export async function requestFootballInformation(url,{request=fetch,maxBytes=700000}={}){
 const parsed=new URL(url);
 if(parsed.protocol!=='https:'||!['api.aiscore.com','api.thesports01.com'].includes(parsed.hostname))
  throw new Error('BLOCKED_SECONDARY_HOST');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9500);
 try{
  // No copied Cloudflare clearance / session tokens and no auth circumvention.
  const response=await request(url,{method:'GET',headers:{accept:'application/json'},
    signal:controller.signal,redirect:'error'});
  if(!response.ok)return {ok:false,error:canonicalHttpError(response.status),httpStatus:response.status};
  const length=Number(response.headers?.get?.('content-length')??0);
  if(length>maxBytes)return {ok:false,error:'RESPONSE_TOO_LARGE'};
  const buffer=await response.arrayBuffer();
  if(buffer.byteLength>maxBytes)return {ok:false,error:'RESPONSE_TOO_LARGE'};
  const source=new TextDecoder().decode(buffer);
  let data;
  try{data=JSON.parse(source);}catch{return {ok:false,error:'NON_JSON_RESPONSE'};}
  if(!data||typeof data!=='object')return {ok:false,error:'UNKNOWN_RESPONSE_FORMAT'};
  return {ok:true,payload:data,shape:describeJsonStructure(data)};
 }catch(error){
  return {ok:false,error:error?.name==='AbortError'?'TIMEOUT':'FETCH_UNAVAILABLE'};
 }finally{clearTimeout(timer);}
}
const nonnegative=v=>v!=null&&v!==''&&Number.isInteger(Number(v))&&Number(v)>=0;
const json=v=>{try{return typeof v==='string'?JSON.parse(v):v;}catch{return null;}};
export function missingSupplementalNeeds(needs,{statistics,review,primaryEvents,providersEnabled=false}={}){
 const selected=new Set(needs);
 const stats=json(statistics)??{},assessed=json(review);
 for(const field of ['shotsOnTarget','fouls']){
  if(!selected.has(field))continue;
  const candidate=stats[field]??(assessed?.conflicts?.[field]?null:assessed?.consensus?.[field]);
  if(candidate&&nonnegative(candidate.home)&&nonnegative(candidate.away)){
   selected.delete(field);continue;
  }
  // The configured five statistics providers must have their first chance
  // before AiScore or TheSports01. A missing review isn't evidence of failure.
  if(providersEnabled&&(!assessed?.complete||!Array.isArray(assessed.attempted)))selected.delete(field);
 }
 if(!selected.has('shotsOnTarget')&&!selected.has('fouls'))selected.delete('statistics');
 if(selected.has('player')){
  const events=json(primaryEvents)?.events;
  const goals=Array.isArray(events)?events.filter(e=>e.type==='goal'&&!e.disabled):[];
  // A player string alone does not establish that the goal was NOT an own goal.
  // Request verified supplementary identity whenever own-goal status is unknown.
  if(goals.length&&goals.every(e=>typeof e.player==='string'&&e.player.trim()&&e.ownGoal===false))
    {selected.delete('player');selected.delete('timeline');}
 }
 return [...selected];
}
export async function sourceMatchNeeds(matchId,{runQuery=query,env=process.env}={}){
 const {rows}=await runQuery(
  "select distinct l.market_name,l.live_contract from app_ticket_line l join app_ticket t on t.id=l.ticket_id "+
  "where l.match_id=$1 and l.status='PENDING' and t.status='PENDING'",[matchId]);
 const needs=marketInformationNeeds(rows);
 if(!needs.length)return needs;
 const facts=(await runQuery(
  'select r.statistics,v.payload as review from (select $1::bigint as id) i '+
  'left join app_match_result r on r.match_id=i.id '+
  'left join app_stat_review v on v.match_id=i.id',[matchId])).rows[0]??{};
 let primaryEvents=null;
 if(needs.includes('player')){
  primaryEvents=(await runQuery(
   'select payload from app_match_event_evidence where match_id=$1',[matchId])).rows[0]?.payload??null;
  if(!primaryEvents)primaryEvents=(await runQuery(
   'select payload from app_live_event_frame where match_id=$1 order by observed_at desc,id desc limit 1',[matchId])).rows[0]?.payload??null;
 }
 return missingSupplementalNeeds(needs,{
  ...facts,primaryEvents,providersEnabled:env.STATS_PROVIDERS_ENABLED==='true'
 });
}
export async function setFootballInformationMapping({matchId,aiscoreId,thesports01Id,actorId},
 {runQuery=query,loadMatch=getMatchById}={}){
 const id=Number(matchId);
 if(!Number.isSafeInteger(id)||id<=0)throw Object.assign(new Error('ID ndeshjeje i pavlefshëm.'),{status:400});
 const row=await loadMatch(id);
 if(!isFootballFixture(row))throw Object.assign(new Error('Lejohen vetëm ndeshje të identifikuara si futboll.'),{status:400});
 const aiscore_id=asId(aiscoreId,'aiscore'),thesports01_id=asId(thesports01Id,'thesports01');
 if(!aiscore_id&&!thesports01_id)throw Object.assign(new Error('Kërkohet të paktën një ID burimi.'),{status:400});
 // Mapping is unverified and can NEVER be used as financial-grade evidence.
 const {rows}=await runQuery(
  'insert into app_football_information_map(match_id,aiscore_id,thesports01_id,mapped_by,mapping_status,next_check_at) '+
  "values($1,$2,$3,$4,'ADMIN_SUPPLIED_UNVERIFIED',now()) "+
  "on conflict(match_id) do update set aiscore_id=excluded.aiscore_id,"+
  "thesports01_id=excluded.thesports01_id,mapped_by=excluded.mapped_by,"+
  "mapping_status='ADMIN_SUPPLIED_UNVERIFIED',next_check_at=now(),updated_at=now() "+
  'returning match_id,aiscore_id,thesports01_id,mapping_status',
  [id,aiscore_id,thesports01_id,actorId]);
 return rows[0];
}
/** Trust scorer identity only after the same AiScore match ID, home
 * team and away team are explicitly confirmed against the main fixture.
 */
export function aiscoreFixtureMatches(payload,mappedId,match){
 const detail=payload?.data?.match??payload?.data?.fixture??payload?.data?.match_info??null;
 if(!detail||typeof detail!=='object')return false;
 const identifier=detail.id??detail.match_id??detail.matchId;
 const name=side=>{
  const v=detail[side+'_team']??detail[side+'Team']??detail[side];
  return typeof v==='string'?v:v?.name??v?.Name??null;
 };
 const providerKickoff=Date.parse(detail.start_at??detail.startAt??
  detail.start_time??detail.startTime??detail.kickoff??'');
 const primaryKickoff=Date.parse(match?.start_at??match?.startAt??'');
 const timeCompatible=!Number.isFinite(providerKickoff)||!Number.isFinite(primaryKickoff)||
  Math.abs(providerKickoff-primaryKickoff)<=7200000;
 // The mapped external fixture ID must agree, as must BOTH normalized
 // participant names and (when independently present) the kickoff. A name
 // similarity score must never override a conflicting provider ID.
 return identifier!=null&&String(identifier)===String(mappedId)&&timeCompatible&&
  teamsMatch(name('home'),match?.home)&&teamsMatch(name('away'),match?.away);
}
export async function inspectFootballInformation(matchId,{runQuery=query,request=fetch,loadMatch=getMatchById,now=Date.now,needsOverride=null,env=process.env}={}){
 const id=Number(matchId);
 if(!Number.isSafeInteger(id)||id<=0)throw Object.assign(new Error('ID ndeshjeje i pavlefshëm.'),{status:400});
 const row=await loadMatch(id);
 if(!isFootballFixture(row))throw Object.assign(new Error('Ndeshja nuk është e konfirmuar si futboll.'),{status:400});
 const mapped=(await runQuery('select * from app_football_information_map where match_id=$1',[id])).rows[0];
 if(!mapped)return {matchId:id,status:'NO_FIXTURE_MAPPING',needs:[],sources:[]};
 // A user viewing an opened match wants scorer names even without an open
 // player-goal ticket. This affects DISPLAY only, never market settlement.
 const needs=Array.isArray(needsOverride)?needsOverride:await sourceMatchNeeds(id,{runQuery});
 if(!needs.length)return {matchId:id,status:'NO_SUPPLEMENTARY_NEEDS',needs:[],sources:[]};
 const selected=selectedInformationEndpoints(mapped,needs);
 const results=[];
 for(const endpoint of selected){
  const checked=await requestFootballInformation(endpoint.url,{request});
  const descriptor={source:endpoint.key,ok:checked.ok,
   ...(checked.ok?{shape:checked.shape}:{error:checked.error,httpStatus:checked.httpStatus})};
  results.push(descriptor);
  if(!checked.ok)continue;
  const hash=createHash('sha256').update(JSON.stringify(checked.payload)).digest('hex');
  await runQuery('insert into app_football_information_snapshot(match_id,source,payload_hash,payload) '+
   'values($1,$2,$3,$4::jsonb) on conflict(match_id,source,payload_hash) do nothing',
   [id,endpoint.key,hash,JSON.stringify(checked.payload)]);
  if(endpoint.key==='aiscore:match'&&aiscoreFixtureMatches(checked.payload,mapped.aiscore_id,row)){
   await runQuery("update app_football_information_map set mapping_status='CONFIRMED',updated_at=now() where match_id=$1 and aiscore_id=$2 and mapping_status='ADMIN_SUPPLIED_UNVERIFIED'",
     [id,mapped.aiscore_id]);
   mapped.mapping_status='CONFIRMED';
  }
  if(endpoint.key.startsWith('aiscore:')&&mapped.mapping_status==='CONFIRMED')
   await enrichPrimaryScorerNames(id,checked.payload,{execute:runQuery});

 }
 const errors=results.filter(s=>!s.ok);
 const seconds=errors.some(e=>['RATE_LIMITED','AUTH_REQUIRED'].includes(e.error))?300:
  errors.length?120:env.STATS_REALTIME_ENABLED==='false'?60:
  fixtureLive(row)?30:prematchSoon(row,now(),env)?300:600;
 await runQuery('update app_football_information_map set last_checked_at=now(),'+
  "next_check_at=now()+($3::int * interval '1 second'),last_error=$2 where match_id=$1",
  [id,errors.map(s=>s.source+':'+s.error).join(', ').slice(0,600)||null,seconds]);
 return {matchId:id,status:'SAMPLE_ONLY_NOT_VERIFIED_FOR_SETTLEMENT',
  mappingStatus:mapped.mapping_status,needs,sources:results,checkedAt:new Date(now()).toISOString()};
}
export function createFootballInformationCollector({runQuery=query,request=fetch,loadMatch=getMatchById,
 env=process.env,now=Date.now}={}){
 let busy=false,lastTick=0,sourcePauseUntil=0;
 const rememberProviderFailure=result=>{
  if(result?.sources?.some(source=>['RATE_LIMITED','AUTH_REQUIRED'].includes(source.error)))
   sourcePauseUntil=Math.max(sourcePauseUntil,now()+5*60*1000);
  return result;
 };
 const observed=new Map();
 const observeMatch=row=>{
  if(!enabled()||env.STATS_REALTIME_ENABLED==='false'||!isFootballFixture(row))return;
  const id=Number(row.match_id??row.id);
  if(!Number.isSafeInteger(id)||id<=0)return;
  if(!fixtureLive(row)&&!prematchSoon(row,now(),env))return;
  observed.delete(id);observed.set(id,{row,at:now()});
  if(observed.size>800)observed.delete(observed.keys().next().value);
 };
 const observedIds=()=>{
  for(const [id,entry] of observed)if(now()-entry.at>900000||(!fixtureLive(entry.row)&&!prematchSoon(entry.row,now(),env)))observed.delete(id);
  return [...observed.keys()];
 };
 // Only explicitly mapped fixtures are queried. Disable globally with
 // AISCORE_INFO_ENABLED=false; no browser session or proxy bypass is used.
 const enabled=()=>env.AISCORE_INFO_ENABLED!=='false';
 const warming=new Map(),lastWarm=new Map(),viewedUntil=new Map();
 const warm=matchId=>{
  const id=Number(matchId);
  if(!enabled()||!Number.isSafeInteger(id)||id<=0)return Promise.resolve({status:'DISABLED_OR_INVALID'});
  // Only an explicitly opened match or a pending ticket may schedule AiScore.
  viewedUntil.delete(id);viewedUntil.set(id,now()+12*60000);
  if(viewedUntil.size>512)viewedUntil.delete(viewedUntil.keys().next().value);
  if(now()<sourcePauseUntil)return Promise.resolve({status:'UPSTREAM_PAUSED'});
  if(warming.has(id))return warming.get(id);
  const at=now();
  if(at-(lastWarm.get(id)??0)<(env.STATS_REALTIME_ENABLED==='false'?60000:20000))return Promise.resolve({status:'CACHED'});
  lastWarm.set(id,at);
  if(lastWarm.size>512)lastWarm.delete(lastWarm.keys().next().value);
  const promise=(async()=>{
   // Shared database cooldown prevents repeated upstream calls when several
   // app instances serve the same selected match.
   const {rows}=await runQuery('select next_check_at from app_football_information_map where match_id=$1 and aiscore_id is not null',[id]);
   if(!rows.length)return {status:'NO_FIXTURE_MAPPING'};
   const due=new Date(rows[0].next_check_at).getTime();
   if(Number.isFinite(due)&&due>now())return {status:'MAPPING_NOT_DUE'};
   return rememberProviderFailure(await inspectFootballInformation(id,{runQuery,request,loadMatch,now,needsOverride:['player'],env}));
  })().finally(()=>warming.delete(id));
  warming.set(id,promise);
  return promise;
 };
 return {
  enabled,warm,observeMatch,
  async tick(){
   if(!enabled()||busy||now()-lastTick<15000||now()<sourcePauseUntil)return {enabled:enabled(),scanned:0,paused:now()<sourcePauseUntil};
   busy=true;lastTick=now();
   let scanned=0,failures=0;
   try{
    // Merely appearing in a LIVE/PREMATCH header never authorizes
    // secondary API polling. A detail viewer or PENDING bet does.
    const ids=observedIds().filter(id=>{
      const until=viewedUntil.get(id);
      if(until>now())return true;
      viewedUntil.delete(id);
      return false;
    });
    const {rows}=await runQuery(
     'select m.match_id,exists(select 1 from app_ticket_line l join app_ticket t on t.id=l.ticket_id '+
     "where l.match_id=m.match_id and l.status='PENDING' and t.status='PENDING') as pending "+
     'from app_football_information_map m where m.next_check_at<=now() and ('+
     'm.match_id=any($1::bigint[]) or exists(select 1 from app_ticket_line l '+
     "join app_ticket t on t.id=l.ticket_id where l.match_id=m.match_id and l.status='PENDING' and t.status='PENDING')) "+
     'order by m.next_check_at limit 4',[ids]);
    for(const row of rows){
     try{
      const result=await inspectFootballInformation(row.match_id,{runQuery,request,loadMatch,now,
       needsOverride:row.pending===true?null:['player'],env});
      rememberProviderFailure(result);
      if(result.status==='NO_SUPPLEMENTARY_NEEDS')
       await runQuery("update app_football_information_map set next_check_at=now()+interval '5 minutes' where match_id=$1",[row.match_id]);
      scanned++;
     }
     catch(error){
      failures++;
      await runQuery('update app_football_information_map set last_error=$2,next_check_at=now()+interval \'2 minutes\' where match_id=$1',
       [row.match_id,String(error?.message??'ERROR').slice(0,400)]);
     }
    }
   }finally{busy=false;}
   return {enabled:true,scanned,failures};
  }
 };
}
export const footballInformation=createFootballInformationCollector();
