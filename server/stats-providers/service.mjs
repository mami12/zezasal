import {displayTeamStatistics,displayGoalIntervals} from './display-stats.mjs';
import {primaryGoalDisplay,matchedSupplementalScorers} from './primary-goal-display.mjs';
import {TEAM_STAT_FIELDS,teamStatisticsFromRow} from '../match-statistics.mjs';
import {compareFinalStatistics} from '../ledger/settlement-review.mjs';
import {eventContract,eventSelectionSupported} from '../ledger/event-contract.mjs';
import {supportedContract} from '../ledger/event-evidence.mjs';
import {canonical,uniqueFixture,teamsMatch,goalCapabilities,normalizeBsd,normalizeApiFootball,normalizeSportApi,normalizeWorld,normalizeGoalApi} from './adapters.mjs';
import {findFotMobFixture,fetchFotMobDetails,parseFotMobPayload,candidateDateStrings} from './match-recovery.mjs';
import {apiFootballTimedIncidents,bsdTimedIncidents,sportApiTimedIncidents,goalApiTimedIncidents} from './historical-incidents.mjs';
const query=async(...a)=>(await import('../db.mjs')).query(...a);
const specs={bsd:{base:'https://sports.bzzoiro.com/api/v2',env:'BSD_API_KEY',header:'Authorization',prefix:'Token ',day:1000,month:14000},worldcup26:{base:'https://worldcup26.ir',day:500,month:10000},sportapi:{base:'https://sportapi.ai/api',env:'SPORTAPI_API_KEY',header:'X-Api-Key',day:2000,month:14000},goalapi:{base:'https://api.goal-api.com/v1',env:'GOALAPI_API_KEY',header:'Authorization',prefix:'Bearer ',day:1000,month:31000},apifootball:{base:'https://v3.football.api-sports.io',env:'APIFOOTBALL_API_KEY',header:'x-apisports-key',day:100,month:3100}};
const refreshMs=10*60*1000,requiredStats=['shotsOnTarget','fouls','shots','corners'];
const finished=row=>row.final===true||[row.status,row.service,row.feed_status].some(value=>/^(?:ft|full.?time|finished|ended|cancelled|canceled|after (?:match|penalt(?:y|ies)))(?:\b|$)/i.test(String(value??'')));
const live=row=>!finished(row)&&String(row.service??row.status).toUpperCase()==='LIVE';
export const providerUrls=Object.fromEntries(Object.entries(specs).map(([k,v])=>[k,v.base]));
export function createStatsService({runQuery=query,env=process.env,request=fetch,now=Date.now,saveEvidence,persistGoalFacts,persistTimedFacts,loadMatch,loadSnapshots,getWatchIds,getEventWatchIds}={}){
 let initFlight,busy=false,active=0;const offers=new Map(),inflight=new Map();
 const viewed=new Map();
 const displayCache=new Map(),displayFlights=new Map();let displayActive=0;const displayWaiters=[];
 const displayTtl=refreshMs;
 const health={lastRunAt:null,lastError:null,providers:{}};
 const enabled=()=>env.STATS_PROVIDERS_ENABLED==='true';
 const betWatchIds=async()=>new Set([...(getWatchIds?await getWatchIds():(await runQuery("select distinct l.match_id from app_ticket_line l join app_ticket t on t.id=l.ticket_id where l.status='PENDING' and t.status='PENDING' order by l.match_id")).rows.map(row=>row.match_id))].map(String));
 const watchIds=async()=>{const ids=await betWatchIds();for(const[id,until]of viewed){if(until>now())ids.add(id);else viewed.delete(id);}return ids;};
 const watched=async id=>(await watchIds()).has(String(id));
 const init=()=>initFlight??=(async()=>{
  await runQuery('create table if not exists app_stats_cache(cache_key text primary key,payload jsonb not null,updated_at timestamptz not null default now())');
  await runQuery('create table if not exists app_stats_usage(provider text not null,period text not null,calls int not null,primary key(provider,period))');
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
    const isLive = String(row.service??row.status).toUpperCase()==='LIVE';
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
   return {...normalizeBsd(f,inc,stats,lineups,availability),...bsdTimedIncidents(inc.incidents)};
  }
  if(provider==='goalapi'){
   const detail=await get('/fixtures/'+m.id),e=await get('/fixtures/'+m.id+'/events'),l=await get('/fixtures/'+m.id+'/lineups');
   if(!detail.success||String(detail.data?.id)!==String(m.id)||!e.success||!Array.isArray(e.data)||!l.success)throw Error('STATS_INVALID_RESPONSE');
   if((e.count!=null&&e.count!==e.data.length)||e.pagination?.hasMore)throw Error('STATS_INCOMPLETE_PAGES');
   return {...normalizeGoalApi(detail.data,e.data,l.data??{}),...goalApiTimedIncidents(e.data)};
  }
  if(provider==='apifootball'){
   const f=(await get('/fixtures?id='+m.id)).response?.[0];if(!f)throw Error('STATS_NO_FIXTURE');
   const e=await get('/fixtures/events?fixture='+m.id),l=await get('/fixtures/lineups?fixture='+m.id);
   return {...normalizeApiFootball(f,e.response??[],l.response??[]),...apiFootballTimedIncidents(e.response??[],f)};
  }
  if(provider==='sportapi'){
   const f=(await get('/fixtures/'+m.id)).fixture,e=await get(`/fixtures/${m.id}/events`),l=await get(`/fixtures/${m.id}/lineups`);
   if(!f)throw Error('STATS_NO_FIXTURE');return {...normalizeSportApi(f,e.data??[],l),...sportApiTimedIncidents(e.data??[])};
  }
  const d=await get(`/get/soccer/${m.league}/scoreboard?dates=${String(m.start).slice(0,10).replaceAll('-','')}`),f=d.events?.find(x=>String(x.id)===String(m.id));if(!f)throw Error('STATS_NO_FIXTURE');
  const plays=[];for(let pageIndex=1;pageIndex<=25;pageIndex++){
   const p=await get(`/get/soccer/${m.league}/events/${m.id}/plays?pageIndex=${pageIndex}&pageSize=100`);plays.push(...(p.items??[]));
   if(pageIndex>=p.pageCount)return normalizeWorld(f,plays);
  }throw Error('STATS_INCOMPLETE_PAGES');
 }
 // Backup incidents are kept in their own provenance namespace. Only
 // recorded FT results and independently fetched same-provider counters can
 // certify a complete supplementary chronology.
 async function saveVerifiedBackupFacts(id,provider,match,evidence,result){
  if(!result||evidence?.final!==true||evidence?.complete!==true||
     ![evidence.homeScore,evidence.awayScore].every(x=>x!=null&&Number.isSafeInteger(Number(x))&&Number(x)>=0)||
     Number(evidence.homeScore)!==Number(result.home_score)||
     Number(evidence.awayScore)!==Number(result.away_score))return;
  if(typeof persistGoalFacts==='function'&&evidence.goalsAvailable===true)
   try{await persistGoalFacts(id,evidence);}catch(error){
    health.lastError='SUPPLEMENTAL_GOAL_FACTS_UNAVAILABLE';
   }
  if(typeof persistTimedFacts!=='function'||
     (!evidence.cornerTimelineAvailable&&!evidence.cardTimelineAvailable))return;
  const statsPath=provider==='bsd'?'/events/'+match.id+'/stats/':
    provider==='goalapi'?'/fixtures/'+match.id+'/statistics':
    provider==='sportapi'?'/fixtures/'+match.id+'/stats':
    provider==='apifootball'?'/fixtures/statistics?fixture='+match.id:
    '/get/soccer/'+match.league+'/scoreboard?dates='+String(match.start).slice(0,10).replaceAll('-','');
  const sourceStats=displayTeamStatistics(provider,await api(provider,statsPath,0),match);
  const pair=field=>{
   const p=sourceStats?.[field];
   return p&&['home','away'].every(side=>p[side]!=null&&
      Number.isSafeInteger(Number(p[side]))&&Number(p[side])>=0)?
     {home:Number(p.home),away:Number(p.away)}:null;
  };
  const corners=pair('corners'),yellow=pair('yellow'),red=pair('red');
  const cards=yellow&&red?
    {home:yellow.home+red.home,away:yellow.away+red.away}:null;
  for(const [kind,events,available,counts] of [
    ['corner',evidence.cornerEvents,evidence.cornerTimelineAvailable,corners],
    ['card',evidence.cardEvents,evidence.cardTimelineAvailable,cards]]){
   if(!available||!counts||!Array.isArray(events))continue;
   try{await persistTimedFacts(id,{source:evidence.source,kind,final:true,
     complete:true,timelineAvailable:true,homeCount:counts.home,
     awayCount:counts.away,events});}catch(error){
    health.lastError='SUPPLEMENTAL_'+kind.toUpperCase()+'_FACTS_UNAVAILABLE';
   }
  }
 }
 async function update(row,pending=false){
  if(!enabled()||!row)return;const id=String(row.match_id??row.id);
  if(inflight.has(id))return inflight.get(id);
  if(active>=2)return;active++;
  const flight=(async()=>{
   if(!(await watched(id)))return;
   await init();let state=await read('match:'+id)??{mapping:{},attempts:0};
   const result=(await runQuery('select home_score,away_score from app_match_result where match_id=$1',[Number(id)])).rows[0];
   const final=!!result||finished(row);if(!final&&!live(row))return;
   const contracts=pending?(await runQuery("select market_name from app_ticket_line where match_id=$1 and status='PENDING'",[Number(id)])).rows:[];
   const requiredMethods=[...new Set(contracts.map(eventContract).map(c=>c.method).filter(Boolean))],needsAssists=contracts.some(c=>/assist/i.test(c.market_name));
   const fingerprint=[canonical(row.home),canonical(row.away),Date.parse(row.start_at??row.startAt)].join('|');
   if(state.identity&&state.identity!==fingerprint){state={mapping:{},attempts:0};offers.delete(id);}
   const schedule=pending?'next':'preflightNext';
   if(!final&&state[schedule]>now()+refreshMs)state[schedule]=now();
   if(state[schedule]>now()&&!(pending&&final&&state.final!==true)){if(state.offer&&state.expires>now())offers.set(id,state);return;}
   state.final=final;state.identity=fingerprint;state[schedule]=now()+(pending?(final?[180000,900000,3600000,21600000][Math.min(state.attempts++,3)]:refreshMs):refreshMs);state.expires=now()+2400000;state.offer=null;
   for(const provider of pending?await providerOrder('evidence'):['bsd']){
    if(!pending&&provider!=='bsd')continue;
    if(specs[provider].env&&!env[specs[provider].env])continue;
    try{
     let m=state.mapping[provider];if(!m){m=await discover(provider,row);if(!m)continue;state.mapping[provider]=m;}
     if(!pending&&provider!=='bsd')continue;
     if(!pending){
      // Legacy explicit coverage checks are restricted to matches with active bets.
      if(provider!=='bsd')continue;
      const a=await api(provider,`/events/${m.id}/availability/`,600000),l=await api(provider,`/events/${m.id}/lineups/`,600000);
      const players=Object.values(l.lineups??{}).flatMap(t=>t.players??[]).flatMap(p=>[p.name,p.short_name]).filter(Boolean);
      if(a.available?.incidents===true&&l.lineup_status==='confirmed'&&players.length>=22){state.offer={goals:true,methods:a.available?.shotmap===true,methodFields:{header:a.available?.shotmap===true,leftFoot:a.available?.shotmap===true,rightFoot:a.available?.shotmap===true,own:true,penalty:true},assists:true,players};break;}
      continue;
     }
     const evidence=await collect(provider,m,final?0:refreshMs),cap=goalCapabilities(evidence);
     evidence.providerFixtureId=m.id;evidence.observedAt=new Date(now()).toISOString();
     state.offer={...cap,players:(evidence.participants??[]).filter(x=>x.played).flatMap(x=>[x.name,...(x.aliases??[])])};
     const goals=evidence.events.filter(e=>e.type==='goal'&&!e.shootout&&!/extra|shoot/i.test(e.phase??'')&&Number.isFinite(e.minute)&&e.minute>=0&&e.minute<=90);
     const eventIds=goals.filter(e=>e.id!=null&&String(e.id)!=='').map(e=>String(e.id));
     const reconciled=new Set(eventIds).size===eventIds.length&&evidence.final===true&&evidence.complete===true&&[evidence.homeScore,evidence.awayScore].every(x=>Number.isInteger(x)&&x>=0)&&goals.every(e=>['home','away'].includes(e.team))&&goals.filter(e=>e.team==='home').length===evidence.homeScore&&goals.filter(e=>e.team==='away').length===evidence.awayScore&&(!result||(evidence.homeScore===Number(result.home_score)&&evidence.awayScore===Number(result.away_score)));
     if(final&&reconciled)await saveEvidence?.(id,evidence);
     if(final&&result&&(persistGoalFacts||persistTimedFacts))
      await saveVerifiedBackupFacts(Number(id),provider,m,evidence,result);
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
  if(!enabled()||!row||(!live(row)&&!finished(row)&&!viewed.has(String(row.match_id??row.id))))return;
  let final=finished(row);
  const primary=teamStatisticsFromRow(row),id=String(row.match_id??row.id),identity=identityOf(row);
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
   if(old?.version===2&&old.identity===identity&&old.next>now()&&(!final||old.finalReview)){displayCache.set(id,old);return;}
   // Start each refresh with new facts. Keeping non-null values froze live totals forever.
   const entry={version:2,identity,values:{},goalIntervals:null,sources:{},at:now()};
   // Zizobet's independently reconfirmed event history is the authority for
   // goals, clock windows and minute buckets. Other services supply only
   // missing scorer labels/statistics and never replace these incidents.
   let primaryFacts=[],primaryGoal=null;
   try{
    const coverage=(await runQuery(
      "select through_minute,count_home,count_away,confirmed_at "+
      "from app_match_event_coverage where match_id=$1 and provider='zizobet' and kind='goal'",
      [Number(id)])).rows[0];
    if(coverage){
     primaryFacts=(await runQuery(
       "select provider_event_id,minute,team,phase,player_name,aiscore_player_name,aiscore_verified "+
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
   const observations=[],attempted=[],unavailable={};
   if(final&&result)observations.push({provider:'primary',final:true,observedAt:new Date(now()).toISOString(),values:{...(result.statistics??{}),corners:{home:result.corners_home,away:result.corners_away},cards:{home:result.cards_home,away:result.cards_away}}});
   const state=await read('match:'+id),mapping={...(state?.identity===identity?state.mapping??{}:{}),...(old?.identity===identity?old.mapping??{}:{})};
   // Avoid using daily-limited APIs for goal minutes already supplied by
   // Zizobet. For LIVE matches, rotate only if the primary lacks other
   // required statistics. FT independent audit remains unchanged.
   for(const provider of (final||!statsReady(entry))?
     await providerOrder('statistics'):[]){
    if(specs[provider].env&&!env[specs[provider].env])continue;
    if(final)attempted.push(provider);
    try{
     const m=mapping[provider]??await discover(provider,row);if(!m){if(final)unavailable[provider]='STATS_NO_FIXTURE';continue;}mapping[provider]=m;
     if(final||!statsReady(entry)){
      try{
       const path=provider==='bsd'?'/events/'+m.id+'/stats/':provider==='goalapi'?'/fixtures/'+m.id+'/statistics':provider==='sportapi'?'/fixtures/'+m.id+'/stats':provider==='apifootball'?'/fixtures/statistics?fixture='+m.id:'/get/soccer/'+m.league+'/scoreboard?dates='+String(m.start).slice(0,10).replaceAll('-','');
       const payload=await api(provider,path,final?0:displayTtl),values=displayTeamStatistics(provider,payload,m);
       if(final){if(await finalFixture(provider,m,payload)){
        if(values.yellow&&values.red)values.cards={home:values.yellow.home+values.red.home,away:values.yellow.away+values.red.away};
        observations.push({provider,final:true,values,fixtureId:m.id,observedAt:new Date(now()).toISOString()});
       }else unavailable[provider]='STATS_NOT_FINAL';}
       for(const field of TEAM_STAT_FIELDS){
        const pair=values[field];if(!pair)continue;
        const current=entry.values[field]??{};
        if(['home','away'].some(side=>{const known=primary[side]?.[field]??current[side];return known!=null&&pair[side]!=null&&known!==pair[side];}))continue;
        if(current.home==null&&pair.home!=null)current.home=pair.home;
        if(current.away==null&&pair.away!=null)current.away=pair.away;
        entry.values[field]=current;
        if(current.home!=null&&current.away!=null)entry.sources[field]=provider;
       }
      }catch(e){unavailable[provider]=/^STATS_[A-Z_0-9]+$/.test(e.message)?e.message:'STATS_UNAVAILABLE';health.providers[provider]={...(health.providers[provider]??{}),lastError:unavailable[provider]};}
      if(provider==='apifootball'){
       try{
        const evData=await api(provider,`/fixtures/events?fixture=${m.id}`,displayTtl);
        if(Array.isArray(evData?.response)){
         entry.scorers=evData.response
          .filter(e=>e.type==='Goal'&&e.comments!=='Disallowed'&&e.detail!=='Missed Penalty')
          .map(e=>({
            minute:Number(e.time?.elapsed),
            team:teamsMatch(e.team?.name,row.home)?'home':'away',
            player:e.player?.name??null
          }))
          .filter(e=>e.minute!=null&&e.player);
        }
       }catch{}
      }
     }
     if(final&&!entry.goalIntervals){
      try{
       let payload;
       if(provider==='bsd')payload=await api(provider,'/events/'+m.id+'/incidents/',displayTtl);
       else if(provider==='goalapi')payload=await api(provider,'/fixtures/'+m.id+'/events',displayTtl);
       else if(provider==='sportapi')payload=await api(provider,`/fixtures/${m.id}/events`,displayTtl);
       else if(provider==='apifootball'){
        const first=await api(provider,`/fixtures/events?fixture=${m.id}`,displayTtl),response=[...(first.response??[])];
        const pages=Math.max(1,Number(first.paging?.pages)||1);
        for(let page=2;page<=pages&&page<=20;page++){
         const next=await api(provider,`/fixtures/events?fixture=${m.id}&page=${page}`,displayTtl);
         response.push(...(next.response??[]));
        }
        if(pages>20)throw Error('STATS_INCOMPLETE_PAGES');
        payload={...first,response};
       }else{
        const day=String(m.start).slice(0,10).replaceAll('-','');
        const scoreboard=await api(provider,`/get/soccer/${m.league}/scoreboard?dates=${day}`,displayTtl);
        if(!scoreboard.events?.some(event=>String(event.id)===String(m.id)))throw Error('STATS_NO_FIXTURE');
        const items=[];let pageCount=null;
        for(let pageIndex=1;pageIndex<=20;pageIndex++){
         const next=await api(provider,`/get/soccer/${m.league}/events/${m.id}/plays?pageIndex=${pageIndex}&pageSize=100`,displayTtl);
         if(!Array.isArray(next.items))throw Error('STATS_INVALID_RESPONSE');
         items.push(...next.items);pageCount=Number(next.pageCount);
         if(Number.isFinite(pageCount)&&pageIndex>=pageCount)break;
        }
        if(!Number.isFinite(pageCount)||pageCount<1||pageCount>20)throw Error('STATS_INCOMPLETE_PAGES');
        payload={...scoreboard,items};
       }
       if(provider==='bsd'&&!Array.isArray(payload.incidents))throw Error('STATS_INVALID_RESPONSE');
       if(provider==='goalapi'&&(!payload.success||!Array.isArray(payload.data)||(payload.count!=null&&payload.count!==payload.data.length)||payload.pagination?.hasMore))throw Error('STATS_INCOMPLETE_PAGES');
       if(provider==='sportapi'&&!Array.isArray(payload.data))throw Error('STATS_INVALID_RESPONSE');
       if(provider==='apifootball'&&!Array.isArray(payload.response))throw Error('STATS_INVALID_RESPONSE');
       if(provider==='apifootball'&&Array.isArray(payload.response)){
         entry.scorers = payload.response
          .filter(e => e.type === 'Goal' && e.comments !== 'Disallowed')
          .map(e => ({
            minute: Number(e.time?.elapsed),
            team: String(e.team?.id) === String(m.raw?.teams?.home?.id) ? 'home' : 'away',
            player: e.player?.name ?? null
          }))
          .filter(e => e.minute != null && e.player);
        }
        const intervals=displayGoalIntervals(provider,payload,m);
       const matchesScore=intervals&&['home','away'].every(side=>{
        const score=row[side+'_score'];
        return score==null||!Number.isInteger(Number(score))||Number(score)<0||intervals.reduce((sum,bin)=>sum+bin[side],0)===Number(score);
       });
       if(matchesScore){entry.goalIntervals=intervals;entry.sources.goals=provider;}
      }catch(e){health.providers[provider]={...(health.providers[provider]??{}),lastError:/^STATS_[A-Z_0-9]+$/.test(e.message)?e.message:'STATS_UNAVAILABLE'};}
     }
     if(!final&&statsReady(entry))break;
    }catch(e){unavailable[provider]=/^STATS_[A-Z_0-9]+$/.test(e.message)?e.message:'STATS_UNAVAILABLE';health.providers[provider]={...(health.providers[provider]??{}),lastError:unavailable[provider]};}
   }
   if ((primaryGoal?.hasGoals&&primaryGoal.missingScorers) || !statsReady(entry)) {
    try {
     const targetDate = row.start_at || row.startAt || new Date().toISOString();
     const dates = candidateDateStrings(targetDate);
     const fm = await findFotMobFixture(row.home, row.away, dates,
       row.start_at??row.startAt);
     if (fm && fm.match) {
      const details = await fetchFotMobDetails(fm.match.id);
      const parsed = parseFotMobPayload(fm.match, details);
      if (primaryGoal?.hasGoals && parsed.goalEvents.length) {
       // FotMob names can fill only one-to-one Zizobet scorer slots.
       // Missing or conflicting goals are never imported as primary events.
       const matched=matchedSupplementalScorers(primaryFacts,
        parsed.goalEvents.map(e=>({minute:e.minute,team:e.team,player:e.player})));
       const used=new Set((entry.scorers??[]).map(e=>e.team+'|'+e.minute));
       entry.scorers=[...(entry.scorers??[]),
        ...matched.filter(e=>!used.has(e.team+'|'+e.minute))];
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
      for (const field of TEAM_STAT_FIELDS) {
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
         values: fmValues,
         fixtureId: fm.match.id,
         observedAt: new Date(now()).toISOString()
       });
      }
     }
    } catch {}
   }
   if(final){const review=compareFinalStatistics(observations,{attempted,unavailable});
    await runQuery('insert into app_stat_review(match_id,payload)values($1,$2::jsonb)on conflict(match_id)do update set payload=excluded.payload,updated_at=now()',[Number(id),JSON.stringify(review)]);
    entry.finalReview=review;
   }
   entry.next=now()+displayTtl;entry.at=now();entry.mapping=mapping;
   await write('display:'+id,entry);displayCache.set(id,entry);if(displayCache.size>3000)displayCache.delete(displayCache.keys().next().value);
  })().finally(()=>{displayFlights.delete(id);const next=displayWaiters.shift();if(next)next();else displayActive--;});displayFlights.set(id,flight);return flight;
 }
 function displayStatistics(row){
  const entry=displayCache.get(String(row.match_id??row.id));
  if(!entry?.values||entry.identity!==identityOf(row)||now()-entry.at>displayTtl*2)return row.stats;
  const primary=teamStatisticsFromRow(row),stats={...(row.stats??{})};
  for(const field of TEAM_STAT_FIELDS){
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
  return entry?.identity===identityOf(row)&&now()-entry.at<=displayTtl*2?entry.goalIntervals??null:null;
 }
 function warm(row){
  if(row)viewed.set(String(row.match_id??row.id),now()+12*60000);
  // Detail viewers share the same durable ten-minute cache and quota schedule.
  void warmStatistics(row).catch(()=>{});
 }
 async function tick(){
  if(!enabled()||busy)return;busy=true;health.lastRunAt=new Date(now()).toISOString();
  try{
   const ids=await watchIds(),events=new Set([...(getEventWatchIds?await getEventWatchIds():[])].map(String));
   health.watchedMatches=ids.size;health.lastError=null;
   for(const id of ids){
    try{
     const row=await loadMatch?.(Number(id))??(await loadSnapshots?.([Number(id)]))?.[0];if(!row)continue;
     await warmStatistics(row);
     if(events.has(id))await update(row,true);
    }catch{health.lastError='STATS_UNAVAILABLE';}
   }
  }catch{health.lastError='STATS_UNAVAILABLE';}finally{busy=false;}
 }
 return {warm,warmStatistics,displayStatistics,displayGoalIntervalStats,displayScorers,recoverHistoricalMatch,update,tick,enabled,health:()=>({...health,enabled:enabled(),cachedMatches:offers.size,cachedStatistics:displayCache.size,refreshIntervalMs:refreshMs}),allows(id,market){
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
