/** Isolated provider scheduling and quota regression; no real credentials or HTTP. */
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createStatsService} from '../server/stats-providers/service.mjs';
import {displayGoalIntervals,displayTeamStatistics} from '../server/stats-providers/display-stats.mjs';
import {teamStatisticsFromRow} from '../server/match-statistics.mjs';

const database=new PGlite(),tenMinutes=600000,start=Date.parse('2026-11-04T18:00:00Z');
const totals={home:{shotsOnTarget:4,fouls:7,shots:10,corners:3,yellow:1,red:0,possession:60},away:{shotsOnTarget:2,fouls:11,shots:8,corners:1,yellow:0,red:0,possession:40}};
const names={shotsOnTarget:'Shots on target',fouls:'Fouls',shots:'Total Shots',corners:'Corner Kicks',yellow:'Yellow Cards',red:'Red Cards',possession:'Ball Possession'};
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers});
const row=(id=101,extra={})=>({match_id:id,home:'Home '+id,away:'Away '+id,start_at:'2026-11-04T17:00:00Z',service:'LIVE',stats:{},raw:{homeTeam:{id:'h'+id},awayTeam:{id:'a'+id}},...extra});
let cases=0;
async function harness({env={},rows=[row()],stats=()=>totals,override=()=>null,events=()=>[],persistFacts=false}={}){
 await database.exec(`truncate app_ticket,app_ticket_line,app_match_result,app_stats_cache,app_stats_usage,app_stat_review`);
 let at=start;const calls=[],unexpected=[],matches=new Map(rows.map(r=>[Number(r.match_id),r])),saved=[],persistedGoals=[],persistedTimed=[];
 const config={STATS_PROVIDERS_ENABLED:'true',STATS_REALTIME_ENABLED:'false',WORLDCUP26_LEAGUES:'eng.1',...env};
 const request=async(value,options)=>{
  const url=new URL(value),path=url.pathname;
  const provider=url.host==='sports.bzzoiro.com'?'bsd':url.host==='worldcup26.ir'?'worldcup26':url.host==='sportapi.ai'?'sportapi':url.host==='api.goal-api.com'?'goalapi':'apifootball';
  const call={provider,path,url,at};calls.push(call);
  assert.ok(options.signal,'every HTTP request has a timeout');
  const custom=await override(call);if(custom)return custom;
  const all=[...matches.values()],id=Number(path.match(/(?:events|fixtures)\/(\d+)/)?.[1]??url.searchParams.get('fixture')??url.searchParams.get('id')),match=matches.get(id);
  const fixture=r=>({id:r.match_id,home_team:r.home,away_team:r.away,event_date:r.start_at,kickoff_utc:r.start_at,homeTeamName:r.home,awayTeamName:r.away,kickoffUtc:r.start_at,
   fixture:{id:r.match_id,date:r.start_at},teams:{home:{id:'h'+r.match_id,name:r.home},away:{id:'a'+r.match_id,name:r.away}}});
  if(provider==='bsd'){
   if(path==='/api/v2/events/')return json({results:all.map(fixture),next:null});
   if(path.endsWith('/stats/')&&match)return json({stats:stats(provider,match)});
   if(path.endsWith('/incidents/')&&match)return json({incidents:events(provider,match)});
   if(path.endsWith('/availability/'))return json({available:{incidents:true}});
   if(path.endsWith('/lineups/'))return json({lineup_status:'confirmed',lineups:{}});
   if(match&&path==='/api/v2/events/'+id+'/')return json({status:match.feed_status==='FT'?'finished':'live',home_score:0,away_score:0});
  }
  if(provider==='worldcup26'){
   if(path.endsWith('/scoreboard'))return json({events:all.map(r=>({id:r.match_id,date:r.start_at,competitions:[{status:{type:{completed:r.feed_status==='FT'}},competitors:['home','away'].map(side=>({id:(side==='home'?'h':'a')+r.match_id,homeAway:side,team:{displayName:r[side]},statistics:Object.entries(stats(provider,r)[side]??{}).map(([key,value])=>({name:names[key],displayValue:value}))}))}]}))});
   if(path.endsWith('/plays'))return json({items:match?events(provider,match):[],pageCount:1});
  }
  if(provider==='sportapi'){
   if(match&&path.endsWith('/fixtures/'+id))return json({fixture:{status:match.feed_status==='FT'?'FT':'LIVE'}});
   if(path.includes('/fixtures/date/'))return json({success:true,data:all.map(fixture)});
   if(path.endsWith('/stats')&&match)return json({success:true,data:stats(provider,match)});
   if(path.endsWith('/events')&&match)return json({success:true,data:events(provider,match)});
  }
  if(provider==='goalapi'){
   if(match&&path.endsWith('/fixtures/'+id))return json({success:true,data:{id,matchStatus:match.feed_status==='FT'?'FINISHED':'LIVE'}});
   if(path.includes('/fixtures/date/'))return json({success:true,data:all.map(fixture),pagination:{hasMore:false}});
   if(path.endsWith('/statistics')&&match){const values=stats(provider,match);return json({success:true,data:{match:{fullTime:Object.keys(names).map(key=>({name:names[key],home:values.home?.[key],away:values.away?.[key]}))}}});}
   if(path.endsWith('/events')&&match)return json({success:true,data:events(provider,match)});
  }
  if(provider==='apifootball'){
   if(match&&url.searchParams.has('id'))return json({response:[{fixture:{id,status:{short:match.feed_status==='FT'?'FT':'LIVE'}}}]});
   if(url.searchParams.has('date')||url.searchParams.get('live')==='all')return json({response:all.map(fixture)});
   if(path.endsWith('/statistics')&&match)return json({response:['home','away'].map(side=>({team:{id:(side==='home'?'h':'a')+id},statistics:Object.entries(stats(provider,match)[side]??{}).map(([key,value])=>({type:names[key],value}))}))});
   if(path.endsWith('/events')&&match)return json({response:events(provider,match),paging:{pages:1}});
  }
  unexpected.push(value);throw Error('UNEXPECTED_TEST_ENDPOINT');
 };
 const create=()=>createStatsService({runQuery:(...args)=>database.query(...args),env:config,request,now:()=>at,loadMatch:async id=>matches.get(id),loadSnapshots:async()=>[],
  getEventWatchIds:async()=>new Set((await database.query("select distinct match_id from app_ticket_line where status='PENDING' and market_name='Total goals in minutes 1-15'")).rows.map(r=>String(r.match_id))),saveEvidence:async(id,evidence)=>saved.push({id,evidence}),
  ...(persistFacts?{persistGoalFacts:async(id,evidence)=>persistedGoals.push({id,evidence}),
   persistTimedFacts:async(id,evidence)=>persistedTimed.push({id,evidence})}:{})});
 const bet=async(id,ticket='ticket-'+id,status='PENDING',lineStatus='PENDING')=>{
  await database.query('insert into app_ticket(id,status) values($1,$2) on conflict(id) do update set status=excluded.status',[ticket,status]);
  await database.query('insert into app_ticket_line(ticket_id,match_id,status,market_name) values($1,$2,$3,$4)',[ticket,id,lineStatus,'1X2']);
 };
 return {service:create(),create,calls,matches,config,saved,persistedGoals,persistedTimed,bet,advance:ms=>{at+=ms;},setTime:value=>{at=Date.parse(value);},stats:(service,r=rows[0])=>teamStatisticsFromRow({...r,stats:service.displayStatistics(r)}),verify:()=>{assert.deepEqual(unexpected,[]);cases++;}};
}

try{
 await database.exec(`create table app_ticket(id text primary key,status text);
  create table app_ticket_line(ticket_id text,match_id bigint,status text,market_name text);
  create table app_match_result(match_id bigint primary key,home_score int,away_score int);
  create table app_stats_cache(cache_key text primary key,payload jsonb not null,updated_at timestamptz not null default now());
  create table app_stats_usage(provider text,period text,calls int,primary key(provider,period));
  create table app_stat_review(match_id bigint primary key,payload jsonb not null,updated_at timestamptz default now());`);

 // Secondary API event information must never be written as primary
 // goal/corner/card facts even when a matching FT result is available.
 {
  const source=[{type:'corner',id:'c1',is_home:true,minute:12,player:{id:'p1',name:'Corner Taker'}},
    {type:'corner',id:'c2',is_home:true,minute:18},
    {type:'corner',id:'c3',is_home:true,minute:28},
    {type:'corner',id:'c4',is_home:false,minute:48}];
  const h=await harness({env:{BSD_API_KEY:'test-key',WORLDCUP26_DAY_LIMIT:'0'},
   rows:[row(101,{feed_status:'FT'})],events:()=>source,persistFacts:true});
  await h.bet(101);
  await database.query("update app_ticket_line set market_name='Total goals in minutes 1-15' where match_id=101");
  await database.query('insert into app_match_result values(101,0,0)');
  await h.service.tick();
  assert.equal(h.persistedTimed.length,0,'External cards/corners cannot become primary facts');
  assert.equal(h.persistedGoals.length,0,'External goal incidents cannot become primary facts');
  assert.equal(h.saved.length,0,'External FT incidents cannot replace Zizobet event evidence');
  assert.equal(h.calls.some(call=>call.url.host.includes('zizobet')),false,
   'Supplementary incident collection must not fetch bookmaker odds');
  h.verify();
 }
 // Opening a single detail opts that match into shared enrichment without a bet.
 {const h=await harness();h.service.warm(row());await h.service.warmStatistics(row());assert.ok(h.calls.length>0);const count=h.calls.length;h.service.warm(row());await h.service.warmStatistics(row());assert.equal(h.calls.length,count,'repeat viewers share the ten-minute cache');h.advance(tenMinutes);h.service.warm(row());await h.service.warmStatistics(row());assert.ok(h.calls.length>count,'viewed fixture refreshes after ten minutes');h.verify();}
 // Three concurrent viewed fixtures are queued, never silently dropped by the two-job limit.
 {const rows=[row(),row(102),row(103)],h=await harness({rows});for(const r of rows)h.service.warm(r);await Promise.all(rows.map(r=>h.service.warmStatistics(r)));for(const r of rows)assert.equal(h.stats(h.service,r).home.fouls,7);assert.equal(h.calls.filter(c=>c.path.endsWith('/plays')).length,0,'No auxiliary goal-minute API calls for viewed LIVE fixtures');h.verify();}
 {const r=row(101,{service:'PREMATCH'}),h=await harness({rows:[r]});h.service.warm(r);await h.service.warmStatistics(r);assert.ok(h.calls.length>0,'opening prematch also starts enrichment');const count=h.calls.length;h.advance(12*60000+1);await h.service.tick();assert.equal(h.calls.length,count,'closed unbet view stops background polling after interest expires');h.verify();}
 // A non-viewed detail, a prematch bet, a closed parent and a settled line spend nothing.
 {
  const h=await harness({env:{BSD_API_KEY:'test-key'},rows:[row(),row(102,{service:'PREMATCH'}),row(103),row(104)]});
  await h.service.warmStatistics(row());await h.service.update(row());
  await h.bet(102);await h.bet(103,'closed','WON');await h.bet(104,'settled-line','PENDING','WON');
  await h.service.tick();assert.equal(h.calls.length,0);h.verify();
 }
 {
  const h=await harness();await h.bet(101);
  await database.query('insert into app_match_result values(101,0,0)');
  await h.service.tick();assert.ok(h.calls.length>0,'an archived FT result starts final verification even when the catalog lags');h.verify();
 }
 // Shared 10-minute schedule works without viewers, through restart and without duplicate tickets.
 {
  let count=4;
  const h=await harness({stats:()=>({...totals,home:{...totals.home,shotsOnTarget:count}})});
  await h.bet(101);await h.bet(101,'another-bet');
  await Promise.all([h.service.tick(),h.service.warmStatistics(row()),h.service.warmStatistics(row())]);
  assert.equal(h.calls.length,1,'A single scoreboard stats request, no auxiliary goal play-by-play');
  assert.equal(h.stats(h.service).home.shotsOnTarget,4);
  h.advance(tenMinutes-1);await h.service.tick();assert.equal(h.calls.length,1);
  const restarted=h.create();await restarted.tick();assert.equal(h.calls.length,1,'restart keeps the next refresh');
  h.advance(1);count=7;await restarted.tick();assert.equal(h.stats(restarted).home.shotsOnTarget,7,'non-null totals actually refresh');
  assert.equal(h.calls.length,2,'mapped fixture skips another discovery');
  await database.query("update app_ticket set status='CASHED_OUT'");h.advance(tenMinutes);await restarted.tick();await restarted.warmStatistics(row());
  assert.equal(h.calls.length,2,'closing all tickets stops provider HTTP');h.verify();
 }
 // Finished rows often retain service=LIVE. Neither that nor reopening details restarts polling.
 {
  const h=await harness({rows:[row(101,{feed_status:'FT'}),row(102,{status:'ended'}),row(103,{service:'FINISHED'})]});
  for(const id of h.matches.keys())await h.bet(id);
  await h.service.tick();assert.ok(h.calls.length>0,'finished watched fixtures receive a final statistics check');h.verify();
 }
 // Round-robin starting providers persist across restart; a success stops the chain.
 {
  const h=await harness({env:{BSD_API_KEY:'test-key',SPORTAPI_API_KEY:'test-key',GOALAPI_API_KEY:'test-key',APIFOOTBALL_API_KEY:'test-key'},rows:[row(101,{feed_status:'FT'})],
   stats:provider=>provider==='worldcup26'?{...totals,home:{...totals.home,corners:4}}:totals});
  await h.bet(101);await database.query('insert into app_match_result values(101,0,0)');await h.service.tick();
  const review=(await database.query('select payload from app_stat_review where match_id=101')).rows[0].payload;
  assert.deepEqual(new Set(review.attempted),new Set(['bsd','worldcup26','sportapi','goalapi','apifootball']),'every configured available provider is checked after FT');
  assert.deepEqual(new Set(review.sources.map(s=>s.provider)),new Set(['primary','bsd','worldcup26','sportapi','goalapi','apifootball']));
  assert.equal(review.status,'VERIFIED');assert.equal(review.conflicts.corners,undefined,
   'Foreign corner counts are ignored for Zizobet settlement');
  assert.equal(review.consensus.fouls.home,7);
  const count=h.calls.length;await h.service.tick();assert.equal(h.calls.length,count,'final review is cached and shared across viewers');h.verify();
 }
 {
  const h=await harness({env:{BSD_API_KEY:'test-key',SPORTAPI_API_KEY:'test-key',GOALAPI_API_KEY:'test-key',APIFOOTBALL_API_KEY:'test-key'}});await h.bet(101);
  for(const provider of ['bsd','worldcup26','sportapi','goalapi','apifootball']){
   const offset=h.calls.length,service=h.create();await service.tick();
   assert.ok(h.calls.length>offset);assert.ok(h.calls.slice(offset).every(call=>call.provider===provider),provider+' completes the cycle without unnecessary fallback');
   assert.equal(h.stats(service).home.shotsOnTarget,4);assert.equal(h.stats(service).away.fouls,11);assert.ok(h.stats(service).home.corners==null,'Secondary corners are not imported');h.advance(tenMinutes);
  }h.verify();
 }
 {
  const h=await harness({env:{BSD_API_KEY:'test-key',SPORTAPI_API_KEY:'test-key'}});await h.bet(101);
  await h.service.tick();assert.deepEqual([...new Set(h.calls.map(c=>c.provider))],['bsd']);
  let offset=h.calls.length;h.advance(tenMinutes);await h.service.tick();assert.ok(h.calls.slice(offset).every(c=>c.provider==='worldcup26'));
  offset=h.calls.length;h.advance(tenMinutes);const restarted=h.create();await restarted.tick();assert.ok(h.calls.slice(offset).every(c=>c.provider==='sportapi'));
  assert.ok(h.stats(restarted).home.corners==null,'Primary corners stay unknown if Zizobet omitted them');assert.equal(h.stats(restarted).away.shots,8);h.verify();
 }
 // Fallback fills only absent facts, and does not fetch already complete stats just for missing events.
 {
  const h=await harness({env:{BSD_API_KEY:'test-key'},stats:provider=>provider==='bsd'?{home:{shotsOnTarget:4,fouls:7,shots:10},away:{shotsOnTarget:2,fouls:11,shots:8}}:totals});await h.bet(101);
  await h.service.tick();assert.ok(h.stats(h.service).home.corners==null,'No secondary corner fallback');
  assert.equal(h.calls.some(c=>c.provider==='worldcup26'),false,
   'Complete primary-scoped extra stats need no second provider for missing corners');h.verify();
 }
 {
  const h=await harness({env:{BSD_API_KEY:'test-key'},stats:provider=>provider==='bsd'?{home:{shotsOnTarget:4},away:{shotsOnTarget:2}}:totals});await h.bet(101);
  await h.service.tick();assert.equal(h.stats(h.service).home.fouls,7);assert.equal(h.stats(h.service).home.shotsOnTarget,4);
  assert.ok(h.calls.some(c=>c.provider==='worldcup26'));h.verify();
 }
 {
  const h=await harness({env:{BSD_API_KEY:'test-key'},override:call=>call.path.endsWith('/incidents/')?json({error:'unavailable'},503):null});await h.bet(101);
  await h.service.tick();assert.equal(h.stats(h.service).home.fouls,7);
  assert.equal(h.calls.filter(c=>c.provider==='worldcup26'&&c.path.endsWith('/scoreboard')).length,0,
   'Do not spend a second provider quota on goal-event fallback when Zizobet owns minutes and BSD has all required stats');h.verify();
 }
 // A provider with a conflicting known side is skipped instead of creating a made-up pair.
 {
  const primary=row(101,{stats:{home:{shotsOnTarget:5},away:{fouls:11}}});
  const h=await harness({rows:[primary],env:{BSD_API_KEY:'test-key'},stats:provider=>provider==='bsd'?totals:{...totals,home:{...totals.home,shotsOnTarget:5}}});await h.bet(101);
  await h.service.tick();assert.equal(h.stats(h.service,primary).away.shotsOnTarget,2);assert.equal(h.stats(h.service,primary).home.shotsOnTarget,5);h.verify();
 }
 // Each HTTP request counts, including a failed one; hitting 100 stops that provider.
 {
  const h=await harness({env:{APIFOOTBALL_API_KEY:'test-key',WORLDCUP26_DAY_LIMIT:'0'}});await h.bet(101);
  await database.query("insert into app_stats_usage(provider,period,calls) values('apifootball','2026-11-04',99),('apifootball','2026-11',99)");
  await h.service.tick();assert.equal(h.calls.filter(c=>c.provider==='apifootball').length,1);
  assert.equal((await database.query("select calls from app_stats_usage where provider='apifootball' and period='2026-11-04'")).rows[0].calls,100);
  h.advance(tenMinutes);await h.create().tick();assert.equal(h.calls.length,1,'quota persists across restart');h.verify();
 }
 {
  const h=await harness({env:{BSD_API_KEY:'test-key'},override:call=>call.provider==='bsd'?json({},500):null});await h.bet(101);
  await h.service.tick();assert.equal(h.stats(h.service).home.fouls,7);
  assert.equal((await database.query("select calls from app_stats_usage where provider='bsd' and period='2026-11-04'")).rows[0].calls,1);h.verify();
 }
 // Retry-After and provider-advertised exhausted quotas pause further HTTP automatically.
 for(const limited of [json({},429,{'Retry-After':'7200'}),json({results:[],next:null},200,{'X-RateLimit-Remaining':'0','X-RateLimit-Reset':String((start+7200000)/1000)})]){
  const h=await harness({env:{BSD_API_KEY:'test-key'},override:call=>call.provider==='bsd'?limited.clone():null});await h.bet(101);
  await h.service.tick();h.advance(tenMinutes);await h.create().tick();h.advance(tenMinutes);await h.service.tick();
  assert.equal(h.calls.filter(c=>c.provider==='bsd').length,1);h.verify();
 }
 // Monthly exhaustion sleeps until next month, without consuming a new day's quota.
 {
  const h=await harness({env:{BSD_API_KEY:'test-key',BSD_MONTH_LIMIT:'1',WORLDCUP26_DAY_LIMIT:'0'}});await h.bet(101);
  await h.service.tick();assert.equal(h.calls.length,1);
  h.setTime('2026-11-05T18:00:00Z');await h.create().tick();assert.equal(h.calls.length,1);
  const block=(await database.query("select payload from app_stats_cache where cache_key='blocked:bsd'")).rows[0].payload;
  assert.equal(block.until,Date.parse('2026-12-01T00:00:00Z'));
  assert.equal((await database.query("select calls from app_stats_usage where provider='bsd' and period='2026-11-05'")).rows.length,0);
  h.setTime('2026-12-01T00:01:00Z');await h.create().tick();assert.equal(h.calls.length,2);h.verify();
 }
 // Both simultaneously active matches share a catalog, but never exceed a request cap.
 {
  const h=await harness({rows:[row(),row(102)],env:{BSD_API_KEY:'test-key',BSD_DAY_LIMIT:'2',WORLDCUP26_DAY_LIMIT:'0'}});await h.bet(101);await h.bet(102);
  await Promise.all([h.service.warmStatistics(row()),h.service.warmStatistics(row(102))]);
  assert.equal(h.calls.filter(c=>c.provider==='bsd').length,2);
  assert.equal((await database.query("select calls from app_stats_usage where provider='bsd' and period='2026-11-04'")).rows[0].calls,2);h.verify();
 }
 // Paginated BSD discovery reaches the target on page 2 instead of treating page 1 as absence.
 {
  const h=await harness({env:{BSD_API_KEY:'test-key'},override:call=>call.provider==='bsd'&&call.path==='/api/v2/events/'&&call.url.searchParams.get('offset')==='0'?json({results:[],next:'page-2'}):null});await h.bet(101);
  await h.service.tick();assert.equal(h.stats(h.service).home.fouls,7);assert.ok(h.calls.some(c=>c.url.searchParams.get('offset')==='200'));h.verify();
 }
 // Independent event evidence is still verified after FT, bypassing the live ten-minute wait.
 {
  const h=await harness({env:{BSD_API_KEY:'test-key'}});await h.bet(101);
  await database.query("update app_ticket_line set market_name='Total goals in minutes 1-15'");
  await h.service.tick();assert.equal(h.saved.length,0);
  h.matches.get(101).feed_status='FT';await database.query('insert into app_match_result values(101,0,0)');
  await h.service.tick();assert.equal(h.saved.length,0,
   'Final third-party events remain supplementary, not settlement evidence');h.verify();
 }
 // A new timeline is collected every cycle; cards and missed penalties are never goals.
 {
  const h=await harness({rows:[row(101,{home_score:1,away_score:0})],env:{BSD_API_KEY:'test-key'},events:provider=>provider==='worldcup26'?[{id:'g',scoringPlay:true,clock:{displayValue:"15'"},period:{number:1},team:{source_id:'h101'}}]:[]});await h.bet(101);
  await h.service.tick();assert.equal(h.service.displayGoalIntervalStats(row()),null,'Auxiliary event timelines cannot replace a missing confirmed Zizobet goal history');h.verify();
 }
 {
  let scored=false;
  const h=await harness({env:{BSD_API_KEY:'test-key'},events:()=>scored?[{id:'goal',type:'goal',is_home:true,minute:15},{id:'card',type:'card',is_home:true,minute:18}]:[]});await h.bet(101);
  await h.service.tick();assert.equal(h.service.displayGoalIntervalStats(row()),null,'Do not infer intervals from foreign event feeds without Zizobet confirmation');
  scored=true;h.advance(tenMinutes);await h.service.tick();h.advance(tenMinutes);await h.service.tick();
  assert.equal(h.service.displayGoalIntervalStats(row()),null,'Changing secondary play-by-play never replaces primary minutes');h.verify();
 }
 assert.equal(displayGoalIntervals('bsd',{incidents:[{id:'card',type:'card',minute:2,is_home:true},{id:'missed',type:'penalty_missed',minute:3,is_home:true}]},{}).reduce((sum,x)=>sum+x.home+x.away,0),0);
 assert.equal(displayGoalIntervals('sportapi',{data:[{id:'g',event_type:'goal',team_side:'home',minute:"55'"}]},{} )[3].home,1);
 assert.equal(displayTeamStatistics('bsd',{stats:{home:{total_shots:12,corner_kicks:0,ball_possession:55,yellow_cards:2},away:{}}},{}).corners.home,0);
 // Live fixtures without bets are observed. Provider HTTP calls stay bounded.
 {
  const rows=[row(101),row(102)];
  const h=await harness({rows,env:{STATS_REALTIME_ENABLED:'true',
   BSD_API_KEY:'test-key',WORLDCUP26_DAY_LIMIT:'0'}});
  h.service.observeMatch(rows[0]);h.service.observeMatch(rows[1]);
  await h.service.tick();
  const initial=h.calls.length;
  assert.ok(initial>=2,'Unbet live matches get supplemental stats');
  h.advance(10000);await h.service.tick();
  assert.equal(h.calls.length,initial,'No new requests on mere 10-second clock advancement');
  h.advance(25000);await h.service.tick();
  assert.ok(h.calls.length>initial,'Refresh after 30 seconds, not ten minutes');
  const beforeEvent=h.calls.length;
  h.service.observeMatch({...rows[0],home_score:0,away_score:0,
   raw:{...rows[0].raw,eventTimeline:[{id:'corner-1',type:'corner',minute:18}]}});
  await h.service.tick();
  assert.ok(h.calls.length>beforeEvent,'Zizobet incident change bypasses cached secondary stats');
  h.verify();
 }
 console.log(`PASS ${cases} provider scenarios: legacy ten-minute fallback and active all-match refresh, rotation/restart, fallback, current totals/timeline, HTTP quotas/pauses, pagination and final evidence`);
}finally{await database.close();}
