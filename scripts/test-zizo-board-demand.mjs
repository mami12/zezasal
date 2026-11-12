import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {startZizoFeed} from '../server/zizobet-feed.mjs';
import {OFFSET} from '../server/zizobet/normalize.mjs';
const calls=[],odds=[],archivedDefinitions=[],defs=Object.fromEntries(Array.from({length:10},(_,i)=>[i+1,{Name:'Unused',pos:[]}]));
defs[448]={Name:'Match result',pos:[{id:1,nm:'1'},{id:2,nm:'X'},{id:3,nm:'2'}]};defs[800]={Name:'Total Corners',pos:[{id:4,nm:'Over'}]};
const game=id=>({id,s:0,ev:{448:{a:{pos:1,coef:2},b:{pos:2,coef:3},c:{pos:3,coef:4}},800:{d:{pos:4,coef:2,h:4.5}}}});
const request=async url=>{
 calls.push(url);
 if(url.includes('getheader/teams'))return [{ID:1,Name:'Home',Sport:1},{ID:2,Name:'Away',Sport:1}];
 if(url.includes('getlivemarkets'))return {};
 if(url.includes('getprematchmarketsbysport'))return [defs];
 if(url.includes('headerformobilenew'))return {Games:[]};
 if(url.includes('sport/getheader/en'))return {EN:{Sports:{1:{Regions:{1:{ID:1,Name:'Japan',Champs:{2:{ID:2,Name:'Regional league',GameSmallItems:Object.fromEntries([11,12].map(ID=>[ID,{ID,t1:1,t2:2,st:'2026-12-01T12:00:00Z'}]))}}}}}}}};
 if(url.includes('getprematchgameall/'))return {game:JSON.stringify([game(11),game(12)])};
 if(url.includes('getprematchgamefull/'))return {game:JSON.stringify(game(Number(url.split('/').at(-1))))};
 throw Error('Unexpected request');
};
const feed=startZizoFeed({autoStart:false,request,now:()=>200000,connectMqtt:()=>({stop(){},pause(){},resume(){},setLiveIds(){}}),onMatch(){},onInfo(){},onOdds:rows=>odds.push(...rows),onMarketDefinitions:defs=>archivedDefinitions.push(...defs)});
try{
 await feed.tick();assert.ok(archivedDefinitions.some(d=>d.scope==='PREMATCH'&&d.id===448&&d.name==='Match result'),'Provider already-fetched market dictionary is sent for archiving');assert.equal(calls.filter(c=>c.includes('getprematchgameall')).length,1);assert.equal(calls.filter(c=>c.includes('getprematchgamefull')).length,0);assert.ok(odds.length>0);assert.ok(odds.every(o=>o.marketName==='Match result'),'Board must preserve the original provider market title, not rewrite it as Full Time Result');
 assert.equal(feed.fullMarketsReady(OFFSET+11),false,'Prematch header is not a complete market snapshot');
 await feed.focus(OFFSET+11);assert.equal(feed.fullMarketsReady(OFFSET+11),true,'Selected prematch becomes full-ready only after native full response');assert.equal(calls.filter(c=>c.includes('getprematchgamefull')).length,1);assert.ok(calls.find(c=>c.endsWith('/11')));assert.ok(!calls.some(c=>c.endsWith('/12')));assert.ok(odds.some(o=>o.matchId===OFFSET+11&&o.marketName==='Total Corners'));assert.ok(!odds.some(o=>o.matchId===OFFSET+12&&o.marketName==='Total Corners'));
 await feed.focus(OFFSET+11);assert.equal(calls.filter(c=>c.includes('getprematchgamefull')).length,1,'fresh detail response shared across viewers');
 console.log('PASS provider batch board quotes only; unopened fixtures never fetch full markets; selected detail loads all its markets, with shared freshness cache and no unrelated fixture requests');
}finally{feed.stop();await feed.drain();}

// Returning to the board must not freeze a previously opened live fixture.
{
 let at=200000,price=2,fullReads=0;const changes=[],infos=[];
 const liveGame=()=>({ID:21,Sport:1,Team1:1,Team2:2,Region:1,Champ:1,MatchStatusID:10,Score:'1:0',MatchTime:25,StartTime:'2026-11-05T12:00:00Z',hprs:[{id:1,mid:602,pid:1,pn:'1',v:price}]});
 const request=async url=>{
  if(url.includes('getheader/teams'))return [{ID:1,Name:'Home',Sport:1},{ID:2,Name:'Away',Sport:1}];
  if(url.includes('getlivemarkets'))return {MarketNames:[{it:602,nm:'Match result'},{it:800,nm:'Total Corners'}]};
  if(url.includes('getprematchmarketsbysport'))return [defs];
  if(url.includes('headerformobilenew'))return {Games:[liveGame()],Regions:[{ID:1,Name:'England'}],Championats:[{ID:1,Name:'Premier League'}]};
  if(url.includes('sport/getheader/en'))return {EN:{Sports:{1:{Regions:{}}}}};
  if(url.includes('live/gamenew/21')){fullReads++;return {Match:{...liveGame(),GameID:21,EventStatus:10,LiveBetStatus:true},gmk:[...liveGame().hprs,{id:4,mid:800,pid:4,pn:'Over',v:2,h:4.5}]};}
  throw Error('Unexpected live test request');
 };
 const liveFeed=startZizoFeed({autoStart:false,request,now:()=>at,connectMqtt:()=>({stop(){},pause(){},resume(){},setLiveIds(){}}),onMatch(){},onInfo:r=>infos.push(r),onOdds:r=>changes.push(...r)});
 try{
  await liveFeed.tick();assert.equal(fullReads,0);assert.equal(liveFeed.fullMarketsReady(OFFSET+21),false,'Live header is only a board offer');await liveFeed.focus(OFFSET+21);assert.equal(liveFeed.fullMarketsReady(OFFSET+21),true,'Selected live match records full-market completion');assert.equal(fullReads,1);assert.ok(changes.some(r=>r.marketName==='Total Corners'));
  at+=301000;price=3;const count=changes.length;await liveFeed.tick();
  assert.equal(fullReads,1,'closed detail does not keep fetching all live markets');
  assert.equal(changes.at(-1).price,3,'lightweight main prices keep updating after focus expires');
  assert.ok(changes.slice(count).every(r=>r.marketName==='Match result'),'Header must retain native Match result quotes without tombstoning full-market detail');
  assert.equal(infos.at(-1).homeScore,1);
  console.log('PASS live main prices continue after detail interest expires; no blanket full fetch or stored extra-market deletion');
 }finally{liveFeed.stop();await liveFeed.drain();}
}
