import assert from 'node:assert/strict';
import {
 marketInformationNeeds,selectedInformationEndpoints,missingSupplementalNeeds,describeJsonStructure,
 requestFootballInformation,canonicalHttpError,isFootballFixture,
 setFootballInformationMapping,inspectFootballInformation,
 createFootballInformationCollector,FOOTBALL_INFORMATION_SQL
} from '../server/stats-providers/football-information.mjs';

assert.match(FOOTBALL_INFORMATION_SQL,/create table if not exists app_football_information_map/);
assert.match(FOOTBALL_INFORMATION_SQL,/unique\(match_id,source,payload_hash\)/);
assert.equal(isFootballFixture({sport_id:1}),true);
assert.equal(isFootballFixture({sport_id:18}),true);
assert.equal(isFootballFixture({sport_tag:'football'}),true);
assert.equal(isFootballFixture({sport_id:2}),false);
assert.equal(isFootballFixture({}),false);

const goal=marketInformationNeeds([{market_name:'Next Goal (Goal 2)'},{market_name:'Player to Score a Goal'}]);
assert.deepEqual(goal,['player'],'Only missing player identity qualifies; Next Goal belongs to PRIMARY');
const corners=marketInformationNeeds([{market_name:'Race to 7 Corners'},
 {market_name:'Race to 6 Goals'},{market_name:'Goal in minutes 10-20'},
 {market_name:'Total Fouls'},{market_name:'Red Cards'},{market_name:'Shots on Target'}]);
assert.deepEqual(corners,[],'All goal, corner and statistic markets use PRIMARY or dedicated statistic providers; do not route them through the player-only secondary API');
assert.deepEqual(marketInformationNeeds([{market_name:'Full Time Result'}]),[]);
const map={aiscore_id:'j374oi0xz04sgqo',thesports01_id:'4578950',mapping_status:'ADMIN_SUPPLIED_UNVERIFIED'};
assert.deepEqual(selectedInformationEndpoints(map,[]),[]);
const endpoints=selectedInformationEndpoints(map,goal);
assert.ok(endpoints.some(x=>x.url.includes('/match/s?match_id=j374oi0xz04sgqo')));
assert.ok(endpoints.some(x=>x.url.includes('/match/mlive?')));
assert.ok(endpoints.every(x=>!x.url.includes('/match/team_stats')));
assert.ok(endpoints.every(x=>!x.url.includes('/odds_list')));
assert.ok(endpoints.every(x=>!x.url.includes('/user/info')));
assert.ok(endpoints.every(x=>!x.url.includes('/chat/')));
const statEndpoints=selectedInformationEndpoints(map,['shotsOnTarget','statistics']);
assert.deepEqual(statEndpoints.map(x=>x.key),[],
 'The player-identity-only information adapter must not fetch unverified team statistics');
assert.deepEqual(missingSupplementalNeeds(['shotsOnTarget','fouls','statistics'],{
 statistics:{shotsOnTarget:{home:5,away:2},fouls:{home:10,away:12}},providersEnabled:true
}),[],'PRIMARY has all facts, no backup call');
assert.deepEqual(missingSupplementalNeeds(['fouls','statistics'],{
 statistics:{},providersEnabled:true
}),[],'Wait for the five existing providers to attempt their verification');
assert.deepEqual(missingSupplementalNeeds(['fouls','statistics'],{
 statistics:{},review:{complete:true,attempted:['bsd','sportapi'],consensus:{}},providersEnabled:true
}),['fouls','statistics'],'Missing stats after providers attempt: AiScore becomes eligible');
assert.deepEqual(missingSupplementalNeeds(['fouls','statistics'],{
 statistics:{},review:{complete:true,attempted:['bsd'],consensus:{fouls:{home:3,away:0}}},providersEnabled:true
}),[],'Other APIs supplied verified fouls; AiScore is unnecessary');
assert.deepEqual(missingSupplementalNeeds(['player','timeline'],{
 primaryEvents:{events:[{type:'goal',player:'Test scorer'}]}
}),['player','timeline'],'A scorer string without own-goal evidence is still ambiguous');
assert.deepEqual(missingSupplementalNeeds(['player','timeline'],{
 primaryEvents:{events:[{type:'goal',player:'Test scorer',ownGoal:false}]}
}),[],'PRIMARY explicitly confirms a non-own goalscorer; supplemental lookup is unnecessary');
assert.equal(canonicalHttpError(403),'AUTH_REQUIRED');
assert.equal(canonicalHttpError(429),'RATE_LIMITED');

let urls=[];
const response=(value,status=200,contentType='application/json')=>({
 ok:status>=200&&status<300,status,
 headers:{get:name=>name.toLowerCase()==='content-length'?'0':name.toLowerCase()==='content-type'?contentType:null},
 arrayBuffer:async()=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)).buffer
});
const fakeFetch=async url=>{urls.push(url);return response({
 success:true,data:{events:[{type:'goal',time:42,player:'A',assist:'B'}],
 home:{corners:3},away:{corners:2}}
});};
const fetched=await requestFootballInformation(
 'https://api.aiscore.com/v1/web/api/match/s?match_id=j374oi0xz04sgqo',{request:fakeFetch});
assert.equal(fetched.ok,true);
assert.ok(fetched.shape.paths.some(x=>x.includes('events')));
assert.equal(urls.length,1);
await assert.rejects(()=>requestFootballInformation('https://evil.example.org/collect',{request:fakeFetch}),/BLOCKED_SECONDARY_HOST/);
assert.equal((await requestFootballInformation('https://api.aiscore.com/v1/web/api/match/s',{request:async()=>response({},403)})).error,'AUTH_REQUIRED');
assert.equal((await requestFootballInformation('https://api.aiscore.com/v1/web/api/match/s',{request:async()=>response('invalid')})).error,'NON_JSON_RESPONSE');

const ledgerMatch={match_id:101,sport_id:1,home:'BKMA',away:'Alashkert',start_at:new Date('2026-11-06T16:00:00Z')};
const mapSql=[];
const mapped=await setFootballInformationMapping({
 matchId:101,aiscoreId:'j374oi0xz04sgqo',thesports01Id:'4578950',actorId:'fake-admin'
},{loadMatch:async()=>ledgerMatch,runQuery:async(sql,params)=>{
 mapSql.push({sql,params});
 return {rows:[{match_id:101,aiscore_id:params[1],thesports01_id:params[2],mapping_status:'ADMIN_SUPPLIED_UNVERIFIED'}]};
}});
assert.equal(mapped.mapping_status,'ADMIN_SUPPLIED_UNVERIFIED');
assert.ok(mapSql[0].sql.includes('ADMIN_SUPPLIED_UNVERIFIED'));
await assert.rejects(()=>setFootballInformationMapping({
 matchId:101,aiscoreId:'j374oi0xz04sgqo',actorId:'admin'
},{loadMatch:async()=>({...ledgerMatch,sport_id:2})}),{status:400});
await assert.rejects(()=>setFootballInformationMapping({
 matchId:101,aiscoreId:'bad?redirect=https://wrong',actorId:'admin'
},{loadMatch:async()=>ledgerMatch}),{status:400});

const sqlCalls=[],fetchedUrls=[];
const db=async(sql,params)=>{
 sqlCalls.push({sql,params});
 if(sql.includes('from app_football_information_map where match_id'))return {rows:[map]};
 if(sql.includes('select distinct l.market_name'))return {rows:[{market_name:'Player to Score a Goal'}]};
 if(sql.includes('select r.statistics'))return {rows:[{statistics:{},review:null}]};
 if(sql.includes('from app_match_event_evidence')||sql.includes('from app_live_event_frame'))return {rows:[]};
 if(sql.startsWith('insert into app_football_information_snapshot'))return {rowCount:1};
 if(sql.startsWith('update app_football_information_map'))return {rowCount:1};
 throw Error('Unexpected SQL '+sql);
};
const result=await inspectFootballInformation(101,{
 runQuery:db,loadMatch:async()=>ledgerMatch,now:()=>Date.parse('2026-11-06T16:30:00Z'),
 request:async url=>{fetchedUrls.push(url);return response({data:{events:[{type:'goal',minute:14,team:'home'}]}});}
});
assert.equal(result.matchId,101);
assert.equal(result.mappingStatus,'ADMIN_SUPPLIED_UNVERIFIED');
assert.equal(result.status,'SAMPLE_ONLY_NOT_VERIFIED_FOR_SETTLEMENT');
assert.ok(result.sources.every(x=>x.ok&&x.shape.paths.length>0));
assert.equal(sqlCalls.filter(x=>x.sql.startsWith('insert into app_football_information_snapshot')).length,
 fetchedUrls.length);
assert.ok(fetchedUrls.every(url=>!url.includes('team_stats')));
assert.ok(sqlCalls.every(x=>!/(update app_ticket|app_user set balance|insert into app_transaction)/i.test(x.sql)));
const noMarket=await inspectFootballInformation(101,{
 runQuery:async sql=>{
  if(sql.includes('from app_football_information_map where match_id'))return {rows:[map]};
  if(sql.includes('select distinct l.market_name'))return {rows:[]};
  throw Error('No request or DB writes allowed with no primary markets');
 },loadMatch:async()=>ledgerMatch,
 request:async()=>{throw Error('Must not hit the secondary API');}
});
assert.equal(noMarket.status,'NO_PRIMARY_BETTED_MARKETS');
let hit=0;
const disabled=createFootballInformationCollector({env:{},runQuery:async()=>{throw Error('No DB request when disabled');}});
assert.equal((await disabled.tick()).enabled,false);
const enabled=createFootballInformationCollector({
 env:{AISCORE_INFO_ENABLED:'true'},now:()=>Date.parse('2026-11-06T16:30:00Z'),
 runQuery:async(sql,params)=>{
  hit++;
  if(sql.startsWith('select m.match_id'))return {rows:[]};
  throw Error('Unwanted provider request');
 }
});
assert.equal((await enabled.tick()).scanned,0);
assert.equal(hit,1);
console.log('PASS football-only secondary information: primary market gate, safe mapping, JSON diagnostics and zero financial writes');
