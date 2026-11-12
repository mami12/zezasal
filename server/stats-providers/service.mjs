import {displayTeamStatistics,displayGoalIntervals} from './display-stats.mjs';
import {primaryGoalDisplay,matchedSupplementalScorers} from './primary-goal-display.mjs';
import {enrichFotMobScorerNames} from './fotmob-scorer-enrichment.mjs';
import {enrichPrimaryActors} from './primary-actor-enrichment.mjs';
import {SUPPLEMENTAL_INCIDENT_SQL,fotMobIncidents,backupIncidents,rawProviderIncidents,storeSupplementalIncidents} from './supplemental-incidents.mjs';
import {teamStatisticsFromRow} from '../match-statistics.mjs';
import {compareFinalStatistics} from '../ledger/settlement-review.mjs';
import {eventContract,eventSelectionSupported} from '../ledger/event-contract.mjs';
import {supportedContract} from '../ledger/event-evidence.mjs';
import {canonical,uniqueFixture,teamsMatch,goalCapabilities,normalizeBsd,normalizeApiFootball,normalizeSportApi,normalizeWorld,normalizeGoalApi} from './adapters.mjs';
import {findFotMobFixture,fetchFotMobDetails,parseFotMobPayload,candidateDateStrings} from './match-recovery.mjs';
import {apiFootballTimedIncidents,bsdTimedIncidents,sportApiTimedIncidents,goalApiTimedIncidents} from './historical-incidents.mjs';
import {supplementalRefreshMs,fixtureLive,prematchSoon,sportingFingerprint} from './realtime-policy.mjs';
const query=async(...a)=>(await import('../db.mjs')).query(...a);
const specs={bsd:{base:'https://sports.bzzoiro.com/api/v2',env:'BSD_API_KEY',header:'Authorization',prefix:'Token ',day:1000,month:14000},worldcup26:{base:'https://worldcup26.ir',day:500,month:10000},sportapi:{base:'https://sportapi.ai/api',env:'SPORTAPI_API_KEY',header:'X-Api-Key',day:2000,month:14000},goalapi:{base:'https://api.goal-api.com/v1',env:'GOALAPI_API_KEY',header:'Authorization',prefix:'Bearer ',day:1000,month:31000},apifootball:{base:'https://v3.football.api-sports.io',env:'APIFOOTBALL_API_KEY',header:'x-apisports-key',day:100,month:3100}};
const refreshMs=10*60*1000;
// Zizobet alone owns score, corners, cards and the event chronology.
// Secondary APIs may enrich verified actors and missing team statistics.
const supplementalStats=['shotsOnTarget','fouls','shots','possession'];
const requiredStats=['shotsOnTarget','fouls','shots'];
const supplementalSnapshot=values=>Object.fromEntries(supplementalStats
 .filter(field=>values?.[field]!=null).map(field=>[field,values[field]]));
const finished=row=>row.final===true||[row.status,row.service,row.feed_status].some(value=>/^(?:ft|full.?time|finished|ended|cancelled|canceled|after (?:match|penalt(?:y|ies)))(?:\b|$)/i.test(String(value??'')));
const live=row=>!finished(row)&&String(row.service??row.status).toUpperCase()==='LIVE';
export const providerUrls=Object.fromEntries(Object.entries(specs).map(([k,v])=>[k,v.base]));
export function createStatsService({runQuery=query,env=process.env,request=fetch,now=Date.now,saveEvidence,persistGoalFacts,persistTimedFacts,loadMatch,loadSnapshots,getWatchIds,getEventWatchIds}={}){
 let initFlight,busy=false,active=0;const offers=new Map(),inflight=new Map();
 const viewed=new Map(),observed=new Map(),urgent=new Set();
 const realtime=()=>env.STATS_REALTIME_ENABLED!=='false';
 const refreshFor=row=>supplementalRefreshMs(row,env,now());
 const fastPollBatch=()=>Math.min(8,Math.max(1,Number(env.STATS_REALTIME_BATCH)||4));
 const observeMatch=row=>{
  if(!enabled()||!realtime()||!row)return false;
  const id=String(row.match_id??row.id??'');
  if(!/^\d+$/.test(id)||(!fixtureLive(row)&&!prematchSoon(row,now(),env)))return false;
  const old=observed.get(id);
  // Lightweight Zizobet board rows may omit score/stats. Preserve the most
  // recent explicit fact; otherwise header/detail alternation looks like a
  // new goal every 15 seconds and pounds the secondary APIs.
  const combined=old?{...old.row,...row,
   raw:{...(old.row.raw??{}),...(row.raw??{})},
   home_score:row.home_score??old.row.home_score,
   away_score:row.away_score??old.row.away_score,
   stats:row.stats??old.row.stats}:row;
  const fingerprint=sportingFingerprint(combined);
  const changed=old!=null&&old.fingerprint!==fingerprint;
  observed.delete(id);observed.set(id,{row:combined,fingerprint,at:now()});
  if(changed){urgent.add(id);displayCache.delete(id);}
  if(observed.size>1000){const first=observed.keys().next().value;observed.delete(first);urgent.delete(first);}
  return changed;
 };
 const activeObserved=()=>{
  for(const[id,entry] of observed)if(now()-entry.at>900000||(!fixtureLive(entry.row)&&!prematchSoon(entry.row,now(),env))){observed.delete(id);urgent.delete(id);}
  return [...observed.keys()];
 };
 const displayCache=new Map(),displayFlights=new Map();let displayActive=0;const displayWaiters=[];
 const displayTtl=refreshMs;
 const health={lastRunAt:null,lastError:null,providers:{}};
 const enabled=()=>env.STATS_PROVIDERS_ENABLED==='true';
 const betWatchIds=async()=>new Set([...(getWatchIds?await getWatchIds():(await runQuery("select distinct l.match_id from app_ticket_line l join app_ticket t on t.id=l.ticket_id where l.status='PENDING' and t.status='PENDING' order by l.match_id")).rows.map(row=>row.match_id))].map(String));
 // Only pending tickets and explicitly opened match details may spend
 // supplementary API requests. Observing a Zizobet live header is not user
 // interest; otherwise hundreds of unbet fixtures trigger remote work.
 const watchIds=async()=>{
  const ids=await betWatchIds();
  for(const[id,until]of viewed){if(until>now())ids.add(id);else viewed.delete(id);}
  if(realtime())activeObserved(); // prune observation cache; never auto-watch it
  return ids;
 };
 const watched=async id=>(await watchIds()).has(String(id));
 const init=()=>initFlight??=(async()=>{
  await runQuery('create table if not exists app_stats_cache(cache_key text primary key,payload jsonb not null,updated_at timestamptz not null default now())');
  await runQuery('create table if not exists app_stats_usage(provider text not null,period text not null,calls int not null,primary key(provider,period))');
  // The embedded local PostgreSQL adapter prepares every query; it rejects
  // multi-command prepared statements. Create the tables one at a time.
  for(const statement of SUPPLEMENTAL_INCIDENT_SQL.split(';').map(s=>s.trim()).filter(Boolean))
   await runQuery(statement);
 })().catch(e=>{initFlight=null;throw e;});
 const read=async key=>(await runQuery('select payload from app_stats_cache where cache_key=$1',[key])).rows[0]?.payload;
 const write=async(key,payload)=>runQuery('insert into app_stats_cache(cache_key,payload) values($1,$2::jsonb) on conflict(cache_key) do update set payload=excluded.payload,updated_at=now()',[key,JSON.stringify(payload)]);
 const providerOrder=async kind=>{
  const providers=Object.keys(specs).filter(key=>!specs[key].env||env[specs[key].env]);
  const r=await runQuery(`insert into app_stats_cache(cache_key,payload) values($1,'{"cursor":1}'::jsonb)
   on conflict(cache_key) do update set payload=jsonb_build_object('cursor',coalesce((app_stats_cache.payload->>'cursor')::bigint,0)+1),updated_at=now() returning payload`,['rotation:'+kind]);
  const start=(Number(r.rows[0].payload.cursor)-1)%providers.length;
  return [...providers.slice(start),...providers.slice(0,start)];
 };
 const reserve=async(provider,period,limit)=>{
  const r=await runQuery('insert into app_stats_usage(provider,period,calls) values($1,$2,1) on conflict(provider,period) do update set calls=app_stats_usage.calls+1 where app_stats_usage.calls<$3 returning calls',[provider,period,limit]);
  if(!r.rows.length)throw Error('STATS_QUOTA');
 };
 const httpFlights=new Map();
 function api(provider,path,ttl=0){
  const key=provider+'|'+ttl+'|'+path;
  if(httpFlights.has(key))return httpFlights.get(key);
  const flight=performApi(provider,path,ttl).finally(()=>httpFlights.delete(key));httpFlights.set(key,flight);return flight;
 }
 async function performApi(provider,path,ttl=0){
  const s=specs[provider];if(s.env&&!env[s.env])throw Error('STATS_NOT_CONFIGURED');
  const key='http:'+provider+':'+path,cached=ttl?await read(key):null;
  if(cached&&now()-cached.at<ttl)return cached.data;
  const blocked=await read('blocked:'+provider);if(blocked?.until>now())throw Error('STATS_PAUSED');
  const date=new Date(now()).toISOString(),cap=(suffix,fallback)=>{
   const value=env[provider.toUpperCase()+'_'+suffix],number=Number(value);
   return value!=null&&String(value).trim()!==''&&Number.isFinite(number)?Math.min(fallback,Math.max(0,Math.floor(number))):fallback;
  };
  const dayEnd=Date.parse(date.slice(0,10)+'T00:00:00Z')+86400000,monthEnd=Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7)),1);
  const limits=[{period:date.slice(0,10),limit:cap('DAY_LIMIT',s.day),until:dayEnd},{period:date.slice(0,7),limit:cap('MONTH_LIMIT',s.month),until:monthEnd}];
  const usage=(await runQuery('select period,calls from app_stats_usage where provider=$1 and period=any($2::text[])',[provider,limits.map(x=>x.period)])).rows;
  const exhausted=limits.filter(x=>x.limit===0||Number(usage.find(u=>u.period===x.period)?.calls??0)>=x.limit);
  if(exhausted.length){await write('blocked:'+provider,{until:Math.max(...exhausted.map(x=>x.until))});throw Error('STATS_QUOTA');}
  // Reserve before sending: errors/timeouts count too, including after restarts.
  for(const limit of limits){try{await reserve(provider,limit.period,limit.limit);}catch(e){if(e.message==='STATS_QUOTA')await write('blocked:'+provider,{until:limit.until});throw e;}}
  const headers=s.header?{[s.header]:(s.prefix??'')+env[s.env]}:{};
  health.providers[provider]={...(health.providers[provider]??{}),lastRequestAt:new Date(now()).toISOString()};
  const r=await request(s.base+path,{headers,signal:AbortSignal.timeout(12000)});
  const headersOf=name=>r.headers?.get(name),resetAt=value=>{const n=Number(value);return value!=null&&Number.isFinite(n)&&n>0?n*1000:0;};
  let until=0;
  for(const [remaining,reset,fallback] of [['X-RateLimit-Remaining','X-RateLimit-Reset',dayEnd],['X-RateLimit-Month-Remaining','X-RateLimit-Month-Reset',monthEnd],['x-ratelimit-requests-remaining','x-ratelimit-requests-reset',dayEnd]]){
   const value=headersOf(remaining);if(value!=null&&value.trim()!==''&&Number(value)===0)until=Math.max(until,resetAt(headersOf(reset))||fallback);
  }
  if(!r.ok&&[401,402,403,429].includes(r.status)){
   const retry=headersOf('Retry-After'),seconds=Number(retry);
   const retryAt=retry!=null&&(Number.isFinite(seconds)&&seconds>=0)?now()+seconds*1000:Date.parse(retry);
   until=Math.max(until,Number.isFinite(retryAt)&&retryAt>now()?retryAt:now()+(r.status===429?3600000:86400000));
  }
  if(until>now())await write('blocked:'+provider,{until});
  if(!r.ok)throw Error('STATS_HTTP_'+r.status);
  const data=await r.json();if(data.success===false||(data.errors&&Object.keys(data.errors).length))throw Error('STATS_PROVIDER_ERROR');
  health.providers[provider]={...(health.providers[provider]??{}),lastSuccessAt:new Date(now()).toISOString(),lastError:null};
  if(ttl)await write(key,{at:now(),data});return data;
 }
 async function discover(provider,row){
  const day=new Date(row.start_at??row.startAt).toISOString().slice(0,10);let list=[];
  if(provider==='bsd'){
   for(let offset=0;offset<2000;offset+=200){
    const d=await api(provider,`/events/?date_from=${day}&date_to=${day}&limit=200&offset=${offset}`,3600000);
    if(!Array.isArray(d.results))throw Error('STATS_INVALID_RESPONSE');
    list.push(...d.results.map(x=>({id:x.id,home:x.home_team?.name??x.home_team,away:x.away_team?.name??x.away_team,start:x.event_date??x.kickoff??x.kickoff_time??x.date,raw:x})));
    if(!d.next)return uniqueFixture(row,list);
   }throw Error('STATS_INCOMPLETE_PAGES');
  }else if(provider==='sportapi'){
   const d=await api(provider,'/fixtures/date/'+day,3600000);list=(d.data??[]).map(x=>({id:x.id,home:x.home_team,away:x.away_team,start:x.kickoff_utc,raw:x}));
  }else if(provider==='goalapi'){
   for(let offset=0;offset<1000;offset+=100){
    const d=await api(provider,'/fixtures/date/'+day+'?limit=100&offset='+offset,3600000);
    if(d.success!==true||!Array.isArray(d.data))throw Error('STATS_INVALID_RESPONSE');
    list.push(...d.data.map(x=>({id:x.id,home:x.homeTeam?.name??x.homeTeamName,away:x.awayTeam?.name??x.awayTeamName,start:x.kickoffUtc})));
    if(!d.pagination?.hasMore)return uniqueFixture(row,list);
   }
   throw Error('STATS_INCOMPLETE_PAGES');
  }else if(provider==='apifootball'){
    // Finished fixtures may retain service=LIVE in the bookmaker catalog.
    // Use the dated archive after FT; the provider's live list drops them.
    const isLive = live(row);
    const path = isLive ? '/fixtures?live=all' : '/fixtures?date='+day;
    const d=await api(provider,path,isLive ? 60000 : 3600000);
    list=(d.response??[]).map(x=>({id:x.fixture.id,home:x.teams.home.name,away:x.teams.away.name,start:x.fixture.date,raw:x}));
   }else{
   for(const league of String(env.WORLDCUP26_LEAGUES??'eng.1,esp.1,ita.1,ger.1,fra.1,por.1').split(',').filter(x=>/^[a-z0-9.]+$/.test(x))){
    const d=await api(provider,`/get/soccer/${league}/scoreboard?dates=${day.replaceAll('-','')}`,displayTtl);
    for(const x of d.events??[]){const c=x.competitions?.[0],t=c?.competitors??[];list.push({id:x.id,home:t.find(t=>t.homeAway==='home')?.team?.displayName,away:t.find(t=>t.homeAway==='away')?.team?.displayName,start:x.date,league,raw:x});}
   }
  }
  return uniqueFixture(row,list);
 }
 async function collect(provider,m,ttl=0){
  const get=path=>api(provider,path,ttl);
  if(provider==='bsd'){
   const f=await get(`/events/${m.id}/`),availability=await get(`/events/${m.id}/availability/`);
   const inc=await get(`/events/${m.id}/incidents/`),stats=await get(`/events/${m.id}/stats/`),lineups=await get(`/events/${m.id}/lineups/`);
   return {...normalizeBsd(f,inc,stats,lineups,availability),...bsdTimedIncidents(inc.incidents),
     otherIncidents:rawProviderIncidents(provider,inc.incidents),sourcePayload:{incidents:inc,statistics:stats}};
  }
  if(provider==='goalapi'){
   const detail=await get('/fixtures/'+m.id),e=await get('/fixtures/'+m.id+'/events'),l=await get('/fixtures/'+m.id+'/lineups');
   if(!detail.success||String(detail.data?.id)!==String(m.id)||!e.success||!Array.isArray(e.data)||!l.success)throw Error('STATS_INVALID_RESPONSE');
   if((e.count!=null&&e.count!==e.data.length)||e.pagination?.hasMore)throw Error('STATS_INCOMPLETE_PAGES');
   return {...normalizeGoalApi(detail.data,e.data,l.data??{}),...goalApiTimedIncidents(e.data),
     otherIncidents:rawProviderIncidents(provider,e.data),sourcePayload:{incidents:e.data}};
  }
  if(provider==='apifootball'){
   const f=(await get('/fixtures?id='+m.id)).response?.[0];if(!f)throw Error('STATS_NO_FIXTURE');
   const e=await get('/fixtures/events?fixture='+m.id),l=await get('/fixtures/lineups?fixture='+m.id);
   return {...normalizeApiFootball(f,e.response??[],l.response??[]),...apiFootballTimedIncidents(e.response??[],f),
     otherIncidents:rawProviderIncidents(provider,e.response),sourcePayload:{incidents:e.response}};
  }
  if(provider==='sportapi'){
   const f=(await get('/fixtures/'+m.id)).fixture,e=await get(`/fixtures/${m.id}/events`),l=await get(`/fixtures/${m.id}/lineups`);
   if(!f)throw Error('STATS_NO_FIXTURE');return {...normalizeSportApi(f,e.data??[],l),...sportApiTimedIncidents(e.data??[]),
     otherIncidents:rawProviderIncidents(provider,e.data),sourcePayload:{incidents:e.data}};
  }
  const d=await get(`/get/soccer/${m.league}/scoreboard?dates=${String(m.start).slice(0,10).replaceAll('-','')}`),f=d.events?.find(x=>String(x.id)===String(m.id));if(!f)throw Error('STATS_NO_FIXTURE');
  const plays=[];for(let pageIndex=1;pageIndex<=25;pageIndex++){
   const p=await get(`/get/soccer/${m.league}/events/${m.id}/plays?pageIndex=${pageIndex}&pageSize=100`);plays.push(...(p.items??[]));
   if(pageIndex>=p.pageCount)return {...normalizeWorld(f,plays),
     otherIncidents:rawProviderIncidents(provider,plays),sourcePayload:{plays}};
  }throw Error('STATS_INCOMPLETE_PAGES');
 }
 // Backup incidents are kept in their own provenance namespace. Only
 // recorded FT results and independently fetched same-provider counters can
 // certify a complete supplementary chronology.
 async function update(row,pending=false){
  if(!enabled()||!row)return;const id=String(row.match_id??row.id);
  if(inflight.has(id))return inflight.get(id);
  if(active>=2)return;active++;
  const flight=(async()=>{
   if(!(await watched(id)))return;
   await init();let state=await read('match:'+id)??{mapping:{},attempts:0};
   const result=(await runQuery('select home_score,away_score from app_match_result where match_id=$1',[Number(id)])).rows[0];
   const final=!!result||finished(row);if(!final&&!live(row)&&!(realtime()&&prematchSoon(row,now(),env)))return;
   const contracts=pending?(await runQuery("select market_name from app_ticket_line where match_id=$1 and status='PENDING'",[Number(id)])).rows:[];
   const requiredMethods=[...new Set(contracts.map(eventContract).map(c=>c.method).filter(Boolean))],needsAssists=contracts.some(c=>/assist/i.test(c.market_name));
   const fingerprint=[canonical(row.home),canonical(row.away),Date.parse(row.start_at??row.startAt)].join('|');
   if(state.identity&&state.identity!==fingerprint){state={mapping:{},attempts:0};offers.delete(id);}
   const schedule=pending?'next':'preflightNext';
   if(!final&&state[schedule]>now()+refreshFor(row))state[schedule]=now();
   if(state[schedule]>now()&&!(pending&&final&&state.final!==true)){if(state.offer&&state.expires>now())offers.set(id,state);return;}
   state.final=final;state.identity=fingerprint;state[schedule]=now()+(pending?(final?[180000,900000,3600000,21600000][Math.min(state.attempts++,3)]:refreshFor(row)):refreshFor(row));state.expires=now()+2400000;state.offer=null;
   for(const provider of pending?await providerOrder('evidence'):['bsd']){
    if(!pending&&provider!=='bsd')continue;
    if(specs[provider].env&&!env[specs[provider].env])continue;
    try{
     let m=state.mapping[provider];if(!m){m=await discover(provider,row);if(!m)continue;state.mapping[provider]=m;}
     if(!pending&&provider!=='bsd')continue;
     if(!pending){
      // Legacy explicit coverage checks are restricted to matches with active bets.
      if(provider!=='bsd')continue;
      const a=await api(provider,`/events/${m.id}/availability/`,refreshFor(row)),l=await api(provider,`/events/${m.id}/lineups/`,refreshFor(row));
      const players=Object.values(l.lineups??{}).flatMap(t=>t.players??[]).flatMap(p=>[p.name,p.short_name]).filter(Boolean);
      if(a.available?.incidents===true&&l.lineup_status==='confirmed'&&players.length>=22){state.offer={goals:true,methods:a.available?.shotmap===true,methodFields:{header:a.available?.shotmap===true,leftFoot:a.available?.shotmap===true,rightFoot:a.available?.shotmap===true,own:true,penalty:true},assists:true,players};break;}
      continue;
     }
     const evidence=await collect(provider,m,final?0:refreshFor(row)),cap=goalCapabilities(evidence);
     evidence.providerFixtureId=m.id;evidence.observedAt=new Date(now()).toISOString();
     state.offer={...cap,players:(evidence.participants??[]).filter(x=>x.played).flatMap(x=>[x.name,...(x.aliases??[])])};
     if(!final&&cap.goals&&requiredMethods.every(k=>cap.methodFields?.[k]===true)&&(!needsAssists||cap.assists))break;
    }catch(e){health.providers[provider]={...(health.providers[provider]??{}),lastError:/^STATS_[A-Z_0-9]+$/.test(e.message)?e.message:'STATS_UNAVAILABLE'};/* Provider failures are never zero goals. No credentials or raw responses in logs. */}
   }
   await write('match:'+id,state);offers.set(id,state);if(offers.size>3000)offers.delete(offers.keys().next().value);
  })().finally(()=>{inflight.delete(id);active--;});inflight.set(id,flight);return flight;
 }
 const identityOf=row=>[canonical(row.home),canonical(row.away),Date.parse(row.start_at??row.startAt)].join('|');
 async function finalFixture(provider,m,statisticsPayload){
  if(provider==='bsd')return (await api(provider,`/events/${m.id}/`)).status==='finished';
  if(provider==='goalapi'){const f=await api(provider,'/fixtures/'+m.id);return f.success===true&&String(f.data?.id)===String(m.id)&&f.data.matchStatus==='FINISHED';}
  if(provider==='apifootball')return (await api(provider,'/fixtures?id='+m.id)).response?.[0]?.fixture?.status?.short==='FT';
  if(provider==='sportapi')return (await api(provider,'/fixtures/'+m.id)).fixture?.status==='FT';
  const d=statisticsPayload??await api(provider,`/get/soccer/${m.league}/scoreboard?dates=${String(m.start).slice(0,10).replaceAll('-','')}`);
  return d.events?.find(x=>String(x.id)===String(m.id))?.competitions?.[0]?.status?.type?.completed===true;
 }
 async function warmStatistics(row){
  if(!enabled()||!row||(!live(row)&&!finished(row)&&!viewed.has(String(row.match_id??row.id))&&!(realtime()&&prematchSoon(row,now(),env))))return;
  let final=finished(row);
  const primary=teamStatisticsFromRow(row),id=String(row.match_id??row.id),identity=identityOf(row),localTtl=refreshFor(row);
  const dataTtl=urgent.has(id)?0:localTtl;
  const cached=displayCache.get(id);
  const statsReady=entry=>requiredStats.every(field=>['home','away'].every(side=>primary[side]?.[field]!=null||entry.values[field]?.[side]!=null));
  // Check the durable FT archive before reusing a live timer: the catalogue
  // can still say LIVE after the final result has already been verified.
  if(displayFlights.has(id))return displayFlights.get(id);
  const slot=displayActive<2?(displayActive++,null):new Promise(resolve=>displayWaiters.push(resolve));
  const flight=(async()=>{
   if(slot)await slot;
   if(!(await watched(id)))return;
   const result=(await runQuery('select * from app_match_result where match_id=$1',[Number(id)])).rows[0];
   if(result)final=true;
   await init();const old=cached??await read('display:'+id);
   if(old?.version===3&&old.identity===identity&&old.next>now()&&Number.isFinite(Number(old.at))&&now()-Number(old.at)<localTtl&&!urgent.has(id)&&(!final||old.finalReview)){displayCache.set(id,old);return;}
   // Start each refresh with new facts. Keeping non-null values froze live totals forever.
   const entry={version:3,identity,values:{},goalIntervals:null,sources:{},at:now()};
   // Reuse Zizobet's persisted full-time team stats before any extra request.
   for(const field of supplementalStats){
    const value=result?.statistics?.[field];
    if(value&&['home','away'].every(side=>value[side]!=null&&Number.isFinite(Number(value[side])))){
     entry.values[field]={home:Number(value.home),away:Number(value.away)};
     entry.sources[field]='primary-archive';
    }
   }
   // Zizobet's independently reconfirmed event history is the authority for
   // goals, clock windows and minute buckets. Other services supply only
   // missing scorer labels/statistics and never replace these incidents.
   let primaryFacts=[],primaryGoal=null,primaryActors=[],goalCoverage=null;
   const actorSQL="select provider_event_id,kind,minute,team,card_color,player_name,aiscore_player_name,aiscore_verified,own_goal,fotmob_player_name,fotmob_verified,supplemental_player_name,supplemental_verified from app_match_event_fact where match_id=$1 and provider='zizobet' and kind in ('goal','card','foul','corner') and active=true";
   const refreshActors=async()=>{primaryActors=(await runQuery(actorSQL,[Number(id)])).rows;return primaryActors;};
   const needsActors=()=>primaryActors.some(f=>['goal','card','foul'].includes(f.kind)&&
     !f.player_name&&!(f.aiscore_verified&&f.aiscore_player_name)&&
     !(f.fotmob_verified&&f.fotmob_player_name)&&
     !(f.supplemental_verified&&f.supplemental_player_name));
   try{
    const coverage=(await runQuery(
      "select through_minute,count_home,count_away,confirmed_at "+
      "from app_match_event_coverage where match_id=$1 and provider='zizobet' and kind='goal'",
      [Number(id)])).rows[0];
    await refreshActors();
    if(coverage){
     goalCoverage=coverage;
     primaryFacts=(await runQuery(
       "select provider_event_id,minute,team,phase,player_name,aiscore_player_name,aiscore_verified, "+
       "own_goal,fotmob_player_name,fotmob_verified,supplemental_player_name,supplemental_verified "+  
       "from app_match_event_fact where match_id=$1 and provider='zizobet' and kind='goal' and active=true",
       [Number(id)])).rows;
     primaryGoal=primaryGoalDisplay(coverage,primaryFacts,row);
     if(primaryGoal){
      entry.goalIntervals=primaryGoal.goalIntervals;
      entry.scorers=primaryGoal.scorers;
      entry.sources.goals='zizobet';
     }
    }
   }catch{
    // On new installations the fact table may not exist yet. Never invent
    // Zizobet coverage or block ordinary scoreboard/statistics rendering.
   }
   // Even when Zizobet reports goals but its incident timeline is missing,
   // an opened match still needs a source-labelled scorer history.
   // Enrichment attaches only to a Zizobet incident, never an inferred goal.
   const needsAnyActors=()=>needsActors();
   const observations=[],attempted=[],unavailable={};
   if(final&&result)observations.push({provider:'primary',final:true,observedAt:new Date(now()).toISOString(),values:{...(result.statistics??{}),corners:{home:result.corners_home,away:result.corners_away},cards:{home:result.cards_home,away:result.cards_away}}});
   const state=await read('match:'+id),mapping={...(state?.identity===identity?state.mapping??{}:{}),...(old?.identity===identity?old.mapping??{}:{})};
   // Avoid using daily-limited APIs for goal minutes already supplied by
   // Zizobet. For LIVE matches, rotate only if the primary lacks other
   // required statistics. FT independent audit remains unchanged.
   // At FT request only MISSING shots/fouls; the primary archive is authoritative.
   // their goals, corners or cards into the PRIMARY settlement ledger.
   for(const provider of (!statsReady(entry)?await providerOrder('statistics'):[])){
    if(statsReady(entry))break;
    if(specs[provider].env&&!env[specs[provider].env])continue;
    if(final)attempted.push(provider);
    try{
     const m=mapping[provider]??await discover(provider,row);if(!m){if(final)unavailable[provider]='STATS_NO_FIXTURE';continue;}mapping[provider]=m;
     if(!statsReady(entry)){
      try{
       const path=provider==='bsd'?'/events/'+m.id+'/stats/':provider==='goalapi'?'/fixtures/'+m.id+'/statistics':provider==='sportapi'?'/fixtures/'+m.id+'/stats':provider==='apifootball'?'/fixtures/statistics?fixture='+m.id:'/get/soccer/'+m.league+'/scoreboard?dates='+String(m.start).slice(0,10).replaceAll('-','');
       const payload=await api(provider,path,final?0:dataTtl),values=displayTeamStatistics(provider,payload,m);
       if(final){if(await finalFixture(provider,m,payload)){
        observations.push({provider,final:true,values:supplementalSnapshot(values),fixtureId:m.id,observedAt:new Date(now()).toISOString()});
       }else unavailable[provider]='STATS_NOT_FINAL';}
       for(const field of supplementalStats){
        const pair=values[field];if(!pair)continue;
        const current=entry.values[field]??{};
        if(['home','away'].some(side=>{const known=primary[side]?.[field]??current[side];return known!=null&&pair[side]!=null&&known!==pair[side];}))continue;
        if(current.home==null&&pair.home!=null)current.home=pair.home;
        if(current.away==null&&pair.away!=null)current.away=pair.away;
        entry.values[field]=current;
        if(current.home!=null&&current.away!=null)entry.sources[field]=provider;
       }
      }catch(e){unavailable[provider]=/^STATS_[A-Z_0-9]+$/.test(e.message)?e.message:'STATS_UNAVAILABLE';health.providers[provider]={...(health.providers[provider]??{}),lastError:unavailable[provider]};}
     }
     if(statsReady(entry))break;
    }catch(e){unavailable[provider]=/^STATS_[A-Z_0-9]+$/.test(e.message)?e.message:'STATS_UNAVAILABLE';health.providers[provider]={...(health.providers[provider]??{}),lastError:unavailable[provider]};}
   }
   if ((primaryGoal?.hasGoals&&primaryGoal.missingScorers) || needsAnyActors() || !statsReady(entry)) {
    try {
     const targetDate = row.start_at || row.startAt || new Date().toISOString();
     const dates = candidateDateStrings(targetDate);
     const fm = await findFotMobFixture(row.home, row.away, dates,
       row.start_at??row.startAt);
     if (fm && fm.match) {
      const details = await fetchFotMobDetails(fm.match.id,{force:urgent.has(id)});
      const parsed = parseFotMobPayload(fm.match, details);
      if(details){
       try{
        const incidents=fotMobIncidents(details);
        const eventList=details?.content?.matchFacts?.events?.events;
        const shotList=details?.content?.shotmap?.shots;
        const completeKinds=[...(Array.isArray(eventList)?['goal','card']:[]),
          ...(Array.isArray(shotList)?['shot']:[])];
        await storeSupplementalIncidents(Number(id),'fotmob',fm.match.id,incidents,
          {execute:runQuery,payload:details,completeKinds});
        await enrichPrimaryActors(Number(id),'fotmob',primaryActors,incidents,{execute:runQuery});
        await refreshActors();
       }catch(error){console.warn('[supplemental incident archive]',String(error?.message??error));}
      }
      if (primaryGoal?.hasGoals && parsed.goalEvents.length) {
       // FotMob names can fill only one-to-one Zizobet scorer slots.
       // Missing or conflicting goals are never imported as primary events.
       // Match identity into persistent primary slots, never an unverified UI-only guess.
       // Persist an actor label only when it matches ONE confirmed primary
       // goal and primary facts explicitly rule out an own goal.
       try{await enrichFotMobScorerNames(Number(id),primaryFacts,parsed.goalEvents,{execute:runQuery});}
       catch(error){console.warn('[fotmob scorer enrichment]',Number(id),String(error?.message??error));}
       await refreshActors();
      }
      const fmValues = {
       possession: parsed.statistics.possession,
       shots: parsed.statistics.shots,
       shotsOnTarget: parsed.statistics.shotsOnTarget,
       fouls: parsed.statistics.fouls,
       corners: (parsed.cornersHome != null && parsed.cornersAway != null) ? { home: parsed.cornersHome, away: parsed.cornersAway } : null,
       // FotMob card totals do not distinguish yellow and red cards.
       yellow: null,
       red: null
      };
      for (const field of supplementalStats) {
       const pair = fmValues[field];
       if (!pair || pair.home == null || pair.away == null) continue;
       const current = entry.values[field] ?? {};
       if (current.home == null) current.home = pair.home;
       if (current.away == null) current.away = pair.away;
       entry.values[field] = current;
       if (!entry.sources[field]) entry.sources[field] = 'fotmob';
      }
      if (final && parsed.finished) {
       observations.push({
         provider: 'fotmob',
         final: true,
         values: supplementalSnapshot(fmValues),
         fixtureId: fm.match.id,
         observedAt: new Date(now()).toISOString()
       });
      }
     }
    } catch {}
   }
   // Identity rotation: FotMob first (above), then a confirmed AiScore mapping,
   // then the configured daily-quota providers. Stop once known primary actors
   // are identified. All offers, goals, clocks and prices remain Zizobet.
   if(needsAnyActors()){
    try{
     const {footballInformation}=await import('./football-information.mjs');
     await footballInformation.warm(Number(id));
     await refreshActors();
    }catch(error){health.lastError='AISCORE_ACTOR_LOOKUP_UNAVAILABLE';}
   }
   if(needsAnyActors()){
    const fallback=await providerOrder('missing-player-events');
    for(const provider of fallback){
     try{
      const fixture=mapping[provider]??await discover(provider,row);
      if(!fixture)continue;
      mapping[provider]=fixture;
      const evidence=await collect(provider,fixture,final?0:localTtl);
      const incidents=backupIncidents(evidence);
      if(incidents.length){
       await storeSupplementalIncidents(Number(id),provider,fixture.id,incidents,
         {execute:runQuery,payload:evidence});
       await enrichPrimaryActors(Number(id),provider,primaryActors,incidents,
         {execute:runQuery});
       await refreshActors();
      }
      if(!needsAnyActors())break;
     }catch(error){
      health.providers[provider]={...(health.providers[provider]??{}),
       lastActorError:/^STATS_[A-Z_0-9]+$/.test(String(error?.message))?
       error.message:'STATS_UNAVAILABLE'};
     }
    }
   }
   if(goalCoverage&&primaryGoal?.hasGoals){
    try{
     const {rows:fresh}=await runQuery(
      "select provider_event_id,minute,team,phase,player_name,own_goal,"+
      "aiscore_player_name,aiscore_verified,fotmob_player_name,fotmob_verified,"+
      "supplemental_player_name,supplemental_verified "+
      "from app_match_event_fact where match_id=$1 and provider='zizobet' "+
      "and kind='goal' and active=true",[Number(id)]);
     const verified=primaryGoalDisplay(goalCoverage,fresh,row);
     if(verified){entry.scorers=verified.scorers;entry.goalIntervals=verified.goalIntervals;}
    }catch(error){health.lastError='GOAL_ACTOR_DISPLAY_UNAVAILABLE';}
   }
   if(final){const review=compareFinalStatistics(observations,{attempted,unavailable});
    await runQuery('insert into app_stat_review(match_id,payload)values($1,$2::jsonb)on conflict(match_id)do update set payload=excluded.payload,updated_at=now()',[Number(id),JSON.stringify(review)]);
    entry.finalReview=review;
   }
   entry.next=now()+localTtl;entry.at=now();entry.mapping=mapping;
   await write('display:'+id,entry);displayCache.set(id,entry);if(displayCache.size>3000)displayCache.delete(displayCache.keys().next().value);
  })().finally(()=>{displayFlights.delete(id);const next=displayWaiters.shift();if(next)next();else displayActive--;});displayFlights.set(id,flight);return flight;
 }
 function displayStatistics(row){
  const entry=displayCache.get(String(row.match_id??row.id));
  if(!entry?.values||entry.identity!==identityOf(row)||now()-entry.at>refreshFor(row)*2)return row.stats;
  const primary=teamStatisticsFromRow(row),stats={...(row.stats??{})};
  for(const field of supplementalStats){
   const pair=entry.values[field];if(!pair)continue;
   if(['home','away'].some(side=>primary[side]?.[field]!=null&&pair[side]!=null&&primary[side][field]!==pair[side]))continue;
   for(const side of ['home','away']){
    if(primary[side]?.[field]!=null||pair[side]==null)continue;
    const key=String(row.raw?.[side+'Team']?.id??row.raw?.competitors?.[side==='home'?0:1]?.id??side);
    stats[key]={...(primary[side]??{}),...(stats[key]??{}),[field]:pair[side]};
   }
  }
  return stats;
 }
 /** Historical lookup is opt-in and never infers FT from a live clock.
  * Reuse the configured provider identities, verified kickoff matching, quota
  * accounting and HTTP timeouts. No other match's data may grade this fixture.
  */
 async function recoverHistoricalMatch(row,{neededKinds=[],expectedScore=null}={}){
  if(!enabled()||!row?.home||!row?.away||!Number.isFinite(Date.parse(row.start_at??row.startAt)))return null;
  await init();
  let best=null,bestCoverage=-1;
  for(const provider of await providerOrder('historical-result')){
   try{
    const fixture=await discover(provider,row);
    if(!fixture||!(await finalFixture(provider,fixture)))continue;
    const evidence=await collect(provider,fixture);
    const validScore=value=>value!=null&&value!==''&&Number.isSafeInteger(Number(value))&&Number(value)>=0&&Number(value)<=99;
    if(evidence.final!==true||evidence.complete!==true||
       !validScore(evidence.homeScore)||!validScore(evidence.awayScore))continue;
    // Historical totals require explicit final team statistics, not
    // inferred zeroes from a missing provider response.
    let values={};
    try{
      const path=provider==='bsd'?'/events/'+fixture.id+'/stats/':
       provider==='goalapi'?'/fixtures/'+fixture.id+'/statistics':
       provider==='sportapi'?'/fixtures/'+fixture.id+'/stats':
       provider==='apifootball'?'/fixtures/statistics?fixture='+fixture.id:
       '/get/soccer/'+fixture.league+'/scoreboard?dates='+String(fixture.start).slice(0,10).replaceAll('-','');
      values=displayTeamStatistics(provider,await api(provider,path,0),fixture);
    }catch{}
    const validPair=field=>{
      const pair=values[field],valid=v=>v!=null&&v!==''&&Number.isSafeInteger(Number(v))&&Number(v)>=0;
      return pair&&valid(pair.home)&&valid(pair.away)?{home:Number(pair.home),away:Number(pair.away)}:null;
    };
    const corners=validPair('corners'),yellow=validPair('yellow'),red=validPair('red');
    const cards=yellow&&red?{home:yellow.home+red.home,away:yellow.away+red.away}:null;
    const statistics=Object.fromEntries(['shots','shotsOnTarget','fouls','possession']
      .map(field=>[field,validPair(field)]).filter(([,pair])=>pair));
    const candidate={source:provider,homeScore:Number(evidence.homeScore),awayScore:Number(evidence.awayScore),
      cornersHome:corners?.home??null,cornersAway:corners?.away??null,
      cardsHome:cards?.home??null,cardsAway:cards?.away??null,statistics,evidence,
      cornerEvents:evidence.cornerEvents??[],cardEvents:evidence.cardEvents??[],
      cornerTimelineAvailable:evidence.cornerTimelineAvailable===true,
      cardTimelineAvailable:evidence.cardTimelineAvailable===true};
    const covers=kind=>{
      if(kind==='goal')return evidence.goalsAvailable===true&&
        evidence.events.filter(e=>e.type==='goal'&&!e.shootout).length===
        candidate.homeScore+candidate.awayScore;
      const prefix=kind==='corner'?'corner':'card',
       h=candidate[prefix==='corner'?'cornersHome':'cardsHome'],
       a=candidate[prefix==='corner'?'cornersAway':'cardsAway'],
       list=candidate[prefix+'Events'];
      return candidate[prefix+'TimelineAvailable']===true&&h!=null&&a!=null&&
        list.length===h+a;
    };
    // Independent supplementary results must agree with an already known
    // FT score before their incident list can authorize any ticket status.
    if(expectedScore&&(
      candidate.homeScore!==Number(expectedScore.home)||
      candidate.awayScore!==Number(expectedScore.away)))continue;
    const coverage=neededKinds.filter(covers).length;
    if(coverage>bestCoverage){best=candidate;bestCoverage=coverage;}
    if(coverage===neededKinds.length)break;
   }catch(error){
    health.providers[provider]={...(health.providers[provider]??{}),
      lastError:/^STATS_[A-Z_0-9]+$/.test(error.message)?error.message:'STATS_UNAVAILABLE'};
   }
  }
  return best;
 }
 function displayScorers(row){
   const entry=displayCache.get(String(row.match_id??row.id));
   return entry?.scorers ?? [];
  }
  function displayGoalIntervalStats(row){
  const entry=displayCache.get(String(row.match_id??row.id));
  return entry?.identity===identityOf(row)&&now()-entry.at<=refreshFor(row)*2?entry.goalIntervals??null:null;
 }
 function warm(row){
  if(row)viewed.set(String(row.match_id??row.id),now()+12*60000);
  // Detail viewers share the same durable ten-minute cache and quota schedule.
  return warmStatistics(row).catch(error=>{
   health.lastError=/^STATS_[A-Z_0-9]+$/.test(String(error?.message))?
    error.message:'STATS_UNAVAILABLE';
  });
 }
 let cursor=0,priorityCursor=0;
 async function tick(){
  if(!enabled()||busy)return;busy=true;health.lastRunAt=new Date(now()).toISOString();
  try{
   const ids=await watchIds(),events=new Set([...(getEventWatchIds?await getEventWatchIds():[])].map(String));
   health.watchedMatches=ids.size;health.lastError=null;
   const all=[...ids],prioritized=all.filter(id=>urgent.has(id)||events.has(id));
   const rest=all.filter(id=>!urgent.has(id)&&!events.has(id));
   // Reserve at least one slot for unbet matches, but rotate urgent/pending
   // bets as well so a constant first subset cannot starve other tickets.
   const size=fastPollBatch(),priorityCap=rest.length?Math.max(1,size-1):size;
   const number=Math.min(priorityCap,prioritized.length);
   const important=Array.from({length:number},
    (_,i)=>prioritized[(priorityCursor+i)%prioritized.length]);
   if(prioritized.length)priorityCursor=(priorityCursor+number)%prioritized.length;
   const normalSlots=Math.max(0,size-number);
   const ordinary=Array.from({length:Math.min(normalSlots,rest.length)},
    (_,i)=>rest[(cursor+i)%rest.length]);
   if(rest.length)cursor=(cursor+ordinary.length)%rest.length;
   const selected=realtime()?[...important,...ordinary]:all;
   for(const id of selected){
    try{
     const row=observed.get(id)?.row??await loadMatch?.(Number(id))??(await loadSnapshots?.([Number(id)]))?.[0];
     if(!row)continue;
     if(realtime()&&prematchSoon(row,now(),env)&&!viewed.has(id)&&!events.has(id)){
      // Before kickoff, goal/corner/foul counters do not exist. Only check
      // fixture, player/lineup availability instead of burning five stat APIs.
      await update(row,false);
     }else{
      await warmStatistics(row);
      if(events.has(id)||realtime()&&prematchSoon(row,now(),env))await update(row,events.has(id));
     }
     urgent.delete(id);
    }catch{health.lastError='STATS_UNAVAILABLE';}
   }
  }catch{health.lastError='STATS_UNAVAILABLE';}finally{busy=false;}
 }
 return {warm,observeMatch,warmStatistics,displayStatistics,displayGoalIntervalStats,displayScorers,recoverHistoricalMatch,update,tick,enabled,health:()=>({...health,enabled:enabled(),observedMatches:observed.size,urgentMatches:urgent.size,cachedMatches:offers.size,cachedStatistics:displayCache.size,refreshIntervalMs:realtime()?Number(env.STATS_LIVE_REFRESH_MS)||30000:refreshMs}),allows(id,market){
  if(!enabled())return false;const s=offers.get(String(id));if(!s?.offer||s.expires<=now())return false;
  const name=String(market.market_name??market.name??'');
  if(!supportedContract(market)||!eventSelectionSupported(market))return false;
  const contract=eventContract(market);
  if(/assist/i.test(contract.name)&&!s.offer.assists)return false;
  if(contract.method&&!(s.offer.methodFields?.[contract.method]??s.offer.methods))return false;
  if(!/^player|goalscorer|goal scorer/.test(contract.name))return s.offer.goals&&!!(contract.timing||/^(?:total goals|who scores|first goal|last goal|own goals?|headed goals?|header goals?|penalty goals?)/.test(contract.name));
  const target=contract.player;
  return !!target&&s.offer.goals&&s.offer.players.some(p=>canonical(p)===canonical(target));
 }};
}
