import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {fixtureLive,prematchSoon,supplementalRefreshMs,sportingFingerprint}
 from '../server/stats-providers/realtime-policy.mjs';
import {createFootballInformationCollector}
 from '../server/stats-providers/football-information.mjs';
import {startZizoFeed} from '../server/zizobet-feed.mjs';

const now=Date.parse('2026-11-12T12:15:00Z');
const live={match_id:7000000000001,home:'A',away:'B',sport_id:18,
 start_at:new Date(now-15*60000).toISOString(),service:'LIVE',status:'live',home_score:0,away_score:0};
const pre={...live,match_id:7000000000002,service:'PREMATCH',status:'scheduled',
 start_at:new Date(now+45*60000).toISOString()};
assert.equal(fixtureLive(live),true);
assert.equal(prematchSoon(pre,now),true);
assert.equal(supplementalRefreshMs(live,{},now),30000);
assert.equal(supplementalRefreshMs(pre,{},now),300000);
assert.equal(supplementalRefreshMs(live,{STATS_REALTIME_ENABLED:'false'},now),600000);
assert.equal(sportingFingerprint({...live,match_time_ms:550000}),
 sportingFingerprint({...live,match_time_ms:560000}),
 'Clock-only updates must not cause secondary provider refresh');
assert.notEqual(sportingFingerprint(live),sportingFingerprint({...live,home_score:1}),
 'A real goal must prioritize a new supplemental observation');

let time=now,checked=0,requests=0,nextCheck=0,seenIDs=null;
const mapped={aiscore_id:'j374oi0xz04sgqo',mapping_status:'ADMIN_SUPPLIED_UNVERIFIED'};
const sql=async (statement,params=[])=>{
 if(statement.startsWith('select m.match_id')){
  seenIDs=params[0];
  return {rows:time>=nextCheck&&seenIDs.includes(live.match_id)?
   [{match_id:live.match_id,pending:false}]:[]};
 }
 if(statement.startsWith('select * from app_football_information_map'))return {rows:[mapped]};
 if(statement.startsWith('insert into app_football_information_snapshot'))return {rowCount:1};
 if(statement.startsWith('update app_football_information_map set last_checked_at')){
  checked++;nextCheck=time+params[2]*1000;return {rowCount:1};
 }
 throw Error('Unexpected SQL '+statement);
};
const response=()=>({
 ok:true,status:200,headers:{get:()=>null},
 arrayBuffer:async()=>new TextEncoder().encode(JSON.stringify({data:{events:[]}})).buffer
});
const collector=createFootballInformationCollector({
 runQuery:sql,request:async()=>{requests++;return response();},
 loadMatch:async()=>live,env:{AISCORE_INFO_ENABLED:'true',STATS_REALTIME_ENABLED:'true'},
 now:()=>time
});
collector.observeMatch(live);
assert.equal((await collector.tick()).scanned,1,'AiScore must refresh a mapped live match without pending bets');
assert.ok(seenIDs.includes(live.match_id));
assert.equal(requests,2);
assert.equal(checked,1);
time+=20000;
assert.equal((await collector.tick()).scanned,0,'Respect shared source cooldown');
assert.equal(requests,2);
time+=16000;
assert.equal((await collector.tick()).scanned,1,'Refresh mapped LIVE scorer info after 30 seconds');
assert.equal(requests,4);

// Even board-filtered PREMATCH fixtures are registered for information
// preflight when they are close to kickoff. Odds remain untouched.
const teams=[{ID:1,Name:'Home',Sport:1},{ID:2,Name:'Away',Sport:1}];
const regions=[{ID:1,Name:'England'}],champs=[{ID:1,Name:'Premier League'}];
const next={ID:77,t1:1,t2:2,Region:1,Champ:1,
 StartTime:'2026-11-12T13:00:00Z'};
const request=async url=>{
 if(url.includes('getheader/teams'))return teams;
 if(url.includes('getlivemarkets'))return {StatusNames:[],PositionNames:[],MarketNames:[]};
 if(url.includes('getprematchmarketsbysport'))return [
  Object.fromEntries(Array.from({length:11},(_,i)=>[i+1,{ID:i+1,Name:'Result'}]))];
 if(url.includes('headerformobilenew'))return {Games:[],Teams:teams,Regions:regions,Championats:champs};
 if(url.includes('sport/getheader/en')){
  const champ={ID:1,Name:'Premier League',GameSmallItems:{77:next}};
  const region={ID:1,Name:'England',Champs:{1:champ}};
  return {EN:{Sports:{1:{Regions:{1:region}}}}};
 }
 throw Error('Unexpected prematch provider URL '+url);
};
const prematch=[],visible=[];
const feed=startZizoFeed({autoStart:false,now:()=>now,request,selectRows:()=>[],
 onFixtureDiscovered:row=>prematch.push(row),onMatch:row=>visible.push(row),
 onOdds:()=>{},onInfo:()=>{},connectMqtt:()=>({stop(){},setLiveIds(){},pause(){},resume(){}})});
try{
 await feed.tick();
 assert.equal(visible.length,0,'Filtered fixtures stay off the betting board');
 assert.equal(prematch.length,1,'Prematch catalog fixture reaches background information watcher');
 assert.equal(prematchSoon(prematch[0],now),true);
}finally{feed.stop();await feed.drain();}
console.log('PASS near-live information cadence, unselected prematch preflight and mapped AiScore without bet');
