import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {projectZizobetHistory,createZizobetHistoryArchive} from '../server/ledger/zizobet-match-history.mjs';
import {startZizoFeed} from '../server/zizobet-feed.mjs';

const game=(score,clock,events,extra={})=>({
 Match:{GameID:7,Score:score,MatchTimeExtended:clock,MatchStatusID:10,EventStatus:10,
  CornersTeam1:0,CornersTeam2:0,YellowCardsTeam1:0,YellowCardsTeam2:0,
  RedCardsTeam1:0,RedCardsTeam2:0,...extra},
 TimeLines:events, gmk:[{v:99.9,mid:602}], hprs:[{v:88.8}]
});
const g1={id:'goal-1',type:'score_change',gt:10,clk:'10:05',team:1,
 player_name:'First Scorer'};
const g2={id:'goal-2',type:'score_change',gt:22,clk:'22:44',team:2,
 pl:'Second Scorer'};
const fixture={home:'Home United',away:'Away United',start_at:'2026-11-12T12:00:00Z'};

const projected=projectZizobetHistory(8000000000007,game('1:0','11:00',[g1]),fixture);
assert.equal(projected.events[0].playerName,'First Scorer',
 'The financial/parser path must recognize the same actor fields as the live UI');
assert.equal(projected.events[0].minute,10);
assert.equal(projected.events[0].minuteLabel,'10');
const withFoul=projectZizobetHistory(8000000000007,game('1:0','11:00',[g1,
 {id:'foul-1',type:'foul_committed',team:2,gt:11,player:'Defender'}]),fixture);
assert.equal(withFoul.events.find(e=>e.kind==='foul')?.playerName,'Defender');
assert.deepEqual(projected.verifiedKinds,['goal','corner','card']);
const withPeriods=projectZizobetHistory(8000000000007,{...game('1:0','11:00',[g1]),
 Match:{...game('1:0','11:00',[g1]).Match,SetScores:['1:0','0:1']}},fixture);
assert.deepEqual(withPeriods.details.periodScores,[{home:1,away:0},{home:0,away:1}]);
assert.doesNotMatch(JSON.stringify(projected),/99\.9|88\.8|gmk|hprs/,
 'Never archive coefficients, only sporting facts');
assert.match(LEDGER_SQL,/app_zizobet_match_incident/);

const pg=new PGlite();
try{
 await pg.exec(LEDGER_SQL);
 const database={connect:async()=>({query:(sql,args=[])=>pg.query(sql,args),release(){}})};
 let clock=Date.parse('2026-11-12T12:11:00Z');
 const save=createZizobetHistoryArchive({database,now:()=>new Date(clock)});
 const id=8000000000007;
 const read=sql=>pg.query(sql,[id]);
 const initial=await save(id,game('1:0','11:00',[g1]),fixture);
 assert.equal(initial.stored,true);
 assert.equal(initial.confirmedKinds.length,0,'One upstream sample cannot confirm financial evidence');
 clock+=6000;
 const repeated=await save(id,game('1:0','11:00',[g1]),fixture);
 assert.equal(repeated.stored,false,'Identical sports summaries are not repeatedly written');
 assert.equal(repeated.reason,'EVIDENCE_REOBSERVED');
 assert.ok(repeated.confirmedKinds.includes('goal'),
  'A second identical provider sample must confirm canonical evidence');
 let rows=(await read('select kind,minute,detail,active from app_zizobet_match_incident where match_id=$1')).rows;
 assert.equal(rows.length,1);
 assert.equal(rows[0].detail.playerName,'First Scorer');
 let summary=(await read('select details from app_zizobet_match_history where match_id=$1')).rows[0].details;
 assert.deepEqual(summary.goals,{home:1,away:0});
 assert.equal(summary.home,'Home United');
 assert.equal(summary.corners.home,0);
 assert.ok(!('odds' in summary) && !('gmk' in summary));

 clock+=60000;
 await save(id,game('1:1','23:00',[g1,g2]),fixture);
 rows=(await read('select kind,minute,detail,active from app_zizobet_match_incident where match_id=$1 order by minute')).rows;
 assert.equal(rows.length,2);
 assert.equal(rows[1].detail.playerName,'Second Scorer');
 // Missing TimeLines does not erase previously archived incidents.
 clock+=60000;
 const noTimeline=game('1:1','24:00',undefined);
 delete noTimeline.TimeLines;
 await save(id,noTimeline,fixture);
 assert.equal((await read('select count(*)::int as n from app_zizobet_match_incident where match_id=$1 and active')).rows[0].n,2);
 summary=(await read('select details from app_zizobet_match_history where match_id=$1')).rows[0].details;
 assert.equal(summary.clockMinute,24);

 // Explicitly corrected complete timeline can deactivate a rescinded goal.
 clock+=60000;
 await save(id,game('1:0','25:00',[g1]),fixture);
 rows=(await read('select provider_event_id,active from app_zizobet_match_incident where match_id=$1 order by provider_event_id')).rows;
 assert.deepEqual(rows.map(r=>[r.provider_event_id,r.active]),
  [['goal-1',true],['goal-2',false]]);
 // Incomplete provider counts cannot retire any previous event.
 clock+=60000;
 await save(id,game('2:0','26:00',[g1]),fixture);
 assert.equal((await read("select active from app_zizobet_match_incident where match_id=$1 and provider_event_id='goal-1'")).rows[0].active,true);
 // Other matches have no ticket at all, yet they are archived independently.
 clock+=60000;
 await save(id+1,game('0:0','12:00',[]),{...fixture,home:'Other'});
 assert.equal((await pg.query('select count(*)::int as n from app_zizobet_match_history')).rows[0].n,2);
}finally{await pg.close();}

// A fixture without a visitor or pending ticket still enters the detail poll.
const teams=[{ID:1,Name:'Home United',Sport:1},{ID:2,Name:'Away United',Sport:1}];
const regions=[{ID:1,Name:'England'}],champs=[{ID:1,Name:'Premier League'}];
const games=Array.from({length:5},(_,i)=>({
 ID:i+1,Sport:1,Team1:1,Team2:2,Region:1,Champ:1,
 MatchStatusID:10,Score:'0:0',MatchTime:15,StartTime:'2026-11-12T12:00:00Z'
}));
const archiveCalls=[],detailReads=[],oddsCalls=[];
let now=Date.parse('2026-11-12T12:15:00Z');
const request=async url=>{
 if(url.includes('getheader/teams'))return teams;
 if(url.includes('getlivemarkets'))return {StatusNames:[{it:'1_10',nm:'1st half'}],PositionNames:[],MarketNames:[]};
 if(url.includes('getprematchmarketsbysport'))return [Object.fromEntries(Array.from({length:11},(_,i)=>[i+1,{ID:i+1,Name:'Result'}]))];
 if(url.includes('headerformobilenew'))return {Games:games,Teams:teams,Regions:regions,Championats:champs};
 if(url.includes('sport/getheader/en'))return {EN:{Sports:{1:{Regions:{}}}}};
 const id=Number(url.match(/live\/gamenew\/(\d+)/)?.[1]);
 if(id){detailReads.push(id);
  const response={...game('0:0','15:00',[]),Match:{...game('0:0','15:00',[]).Match,GameID:id}};
  if(id===5)delete response.gmk; // Suspended match still has real history.
  return response;
 }
 throw Error('Unexpected provider request '+url);
};
const feed=startZizoFeed({
 autoStart:false,historyEnabled:true,now:()=>now,request,
 archiveHistory:async (id,raw)=>{archiveCalls.push({id,raw});},
 connectMqtt:()=>({setLiveIds(){},stop(){},pause(){},resume(){}}),
 getWatchedIds:()=>[],onMatch:()=>{},onInfo:()=>{},onOdds:rows=>oddsCalls.push(rows)
});
try{
 await feed.tick();
 assert.deepEqual(detailReads,[1,2,3,4],
  'Background all-match history is bounded to four details per flush');
 await feed.tick();
 assert.deepEqual(detailReads,[1,2,3,4,5],
  'The fifth unbet fixture must not starve');
 assert.equal(archiveCalls.length,5);
 assert.equal(oddsCalls.length,0,
  'Archive-only refresh must never publish new market odds');
 assert.ok(archiveCalls.every(v=>!('gmk' in v.raw)&&!('hprs' in v.raw)));
 now+=61000;
 await feed.tick();
 await feed.tick();
 assert.equal(archiveCalls.length,10,'Scheduled background history continues after 60 seconds');
}finally{feed.stop();await feed.drain();}
console.log('PASS all-match Zizobet history, actor minute labels, corrections, odds exclusion and bounded background polling');
