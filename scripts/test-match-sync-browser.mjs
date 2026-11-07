import assert from 'node:assert/strict';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import express from 'express';
import puppeteer from 'puppeteer';
import {createServer} from 'vite';
import {Server as SocketServer} from 'socket.io';
import {freshFeed,freshSocketHeaders,liveBoardFacts} from '../server/feed-sync.mjs';
import {providerTimeline} from '../server/live-event-timeline.mjs';
import {marketFamily,setCatalogRows,setCategoryPolicies,setScopeBlocks} from '../server/market-catalog.mjs';
import {detailProjection} from '../server/market-delivery.mjs';

// Real React board/provider and Socket.IO, isolated local snapshots only.
const root=fileURLToPath(new URL('../web',import.meta.url));
const html=`<!doctype html><html><body><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {LanguageProvider} from '/src/context/LanguageContext.tsx';
import {BetslipProvider} from '/src/context/BetslipContext.tsx';
import {FavoritesProvider} from '/src/context/FavoritesContext.tsx';
import {LiveFeedProvider,useLiveFeed} from '/src/api/liveFeed.tsx';
import MatchList from '/src/components/Sports/MatchList.tsx';
import PitchTracker from '/src/components/Tracker/PitchTracker.tsx';
function Board(){const [mode,setMode]=React.useState('all');window.feed=useLiveFeed();window.setMode=setMode;
return React.createElement(React.Fragment,null,React.createElement(MatchList,{viewMode:mode,onViewModeChange:setMode,searchTerm:'',onSearchChange:()=>{}}),React.createElement(PitchTracker,{matchId:'A',homeTeam:'Home A',awayTeam:'Away A',eventsOnly:true}));}
createRoot(document.getElementById('root')).render(React.createElement(LanguageProvider,null,
React.createElement(BrowserRouter,null,React.createElement(BetslipProvider,null,
React.createElement(LiveFeedProvider,null,React.createElement(FavoritesProvider,null,React.createElement(Board)))))));
</script></body></html>`;
const base=Date.now()-60000, at=n=>new Date(base+n*100).toISOString();
let version=1;
const match=(id,status='LIVE')=>({id,tournamentId:'1',homeTeam:`Home ${id}`,awayTeam:`Away ${id}`,
  status,startTime:new Date(base+(status==='LIVE'?-1800000:3600000)).toISOString(),
  events:id==='A'?providerTimeline(id,[{id:'g23',type:'score_change',team:'home',gt:23},{id:'y45',type:'yellow_card',team:'away',gt:'45+2'}]):[],
  homeScore:0,awayScore:0,scoreAt:at(1),clockAt:at(1),currentMinute:75,currentSecond:0,period:status==='LIVE'?'2H':'pre',
  updatedAt:at(1),snapshotAt:at(1),isSuspended:false,marketCount:1,
  tournament:{id:1,name:'Premier League',category:{id:'england',name:'England',slug:'england',sport:{id:18,name:'Football'}}},
  markets:[{id:`${id}|result|`,matchId:id,marketType:'1X2',name:'Full Time Result',status:'ACTIVE',sortOrder:1,
    outcomes:['1','X','2'].map(code=>({id:`${id}|result||${code}`,marketId:`${id}|result|`,name:code,code,odds:2,
      quotedAt:at(1),status:'ACTIVE',feedSuspended:false,riskSuspended:false}))}]});
let matches=[match('A'),match('P','PREMATCH'),match('R')];
let policy={markets:[],categories:[],scopes:[]};
const sockets=new Map(), blocked=new Set(), requests=[];
let holdClient=null, held=null;
let vite,server,browser,io;
const errors=[];
const stamp=()=>{
  const time=at(++version);
  matches=matches.map(m=>({...m,snapshotAt:time,updatedAt:time,
    markets:m.markets.map(market=>({...market,outcomes:market.outcomes.map(outcome=>({...outcome,quotedAt:time}))}))}));
  return time;
};
const board=()=>({at:at(version),matches:liveBoardFacts(matches.filter(m=>m.status==='LIVE').map(m=>({
  ...m,status:'live',minute:m.currentMinute,phase:m.period,score:{home:m.homeScore,away:m.awayScore},
  suspended:m.isSuspended,home:m.homeTeam,away:m.awayTeam,
})))});
const updateGoal=(score,closed=false)=>{
  matches=matches.map(m=>m.id==='A'?{...m,homeScore:score,isSuspended:closed}:m);
  const time=stamp();matches=matches.map(m=>m.id==='A'?{...m,scoreAt:time,clockAt:time}:m);
  io.emit('match:info',{match_id:'A',home_score:score,away_score:0,score_at:time,clock_at:time,
    match_time_ms:80*60000,feed_status:'2H',has_open_odds:!closed,at:time,updated_at:time,
    events:matches.find(m=>m.id==='A').events});
};
try {
  vite=await createServer({root,configFile:false,plugins:[(await import('@vitejs/plugin-react')).default()],
    server:{middlewareMode:true,hmr:false,fs:{allow:[fileURLToPath(new URL('..',import.meta.url))]}},
    appType:'custom',optimizeDeps:{include:['react','react-dom/client','react-router-dom','axios','lucide-react','socket.io-client']}});
  const app=express();app.use('/app/api',freshFeed);
  app.get('/app/api/matches',(request,response)=>{
    requests.push(request.get('x-test-client'));
    // An offline client cannot recover through the independent REST poll while
    // its Socket.IO handshake is blocked. Restore both paths together below.
    if(blocked.has(request.get('x-test-client'))){response.status(503).json({error:'Isolated client is offline'});return;}
    const snapshot=structuredClone(matches.map(m=>detailProjection(m)));
    if(holdClient===request.get('x-test-client')){
      holdClient=null;
      const pending={response,snapshot,aborted:false};held=pending;
      response.once('close',()=>{if(!response.writableEnded)pending.aborted=true;});
      return;
    }
    response.json(snapshot);
  });
  app.get('/app/api/market-policy',(_request,response)=>response.json(policy));
  app.get('/',async(_request,response)=>response.type('html').send(await vite.transformIndexHtml('/',html)));
  app.use(vite.middlewares);
  server=http.createServer(app);
  io=new SocketServer(server,{serveClient:false,allowRequest:(request,done)=>done(null,!blocked.has(request.headers['x-test-client']))});
  io.engine.on('headers',freshSocketHeaders);
  io.on('connection',socket=>{
    const name=socket.handshake.headers['x-test-client'];sockets.set(name,socket);
    socket.emit('hello',{mode:'live'});socket.emit('matches:live',board());
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(origin+'/app/api/matches');
  for(const key of ['cache-control','cdn-cache-control','cloudflare-cdn-cache-control'])assert.match(response.headers.get(key),/no-store/);
  const polling=await fetch(origin+'/socket.io/?EIO=4&transport=polling');
  for(const key of ['cache-control','cdn-cache-control','cloudflare-cdn-cache-control'])assert.match(polling.headers.get(key),/no-store/);
  browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
  const open=async(name,mobile=false)=>{
    const page=await browser.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(60000); // Vite may compile this fixture on a cold Windows cache.
    await page.setExtraHTTPHeaders({'x-test-client':name});
    if(mobile)await page.setViewport({width:390,height:700,isMobile:true,hasTouch:true});
    page.on('pageerror',error=>errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request',request=>request.url().startsWith(origin)||request.url().startsWith('data:')?request.continue():request.abort());
    await page.goto(origin);await page.waitForFunction(()=>window.feed?.connected&&document.body.innerText.includes('Home A'));
    return page;
  };
  const left=await open('left'),right=await open('right',true);
  const score=async(page,value)=>page.waitForFunction(value=>window.feed.livePatches.A?.homeScore===value,{polling:100},value);
  const visible=async(page,id,want=true)=>page.waitForFunction((id,want)=>document.body.innerText.includes('Home '+id)===want,{polling:100},id,want);
  const displayedScore=async(page,value)=>page.waitForFunction(value=>{
    const scores=[...document.querySelectorAll('[data-zshop-match="A"] .zshop-team strong')].map(node=>node.textContent.trim());
    return scores.length===2&&scores[0]===String(value)&&scores[1]==='0';
  },{polling:100},value);
  const resync=async page=>{await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('online')));};
  // Hold an old REST response while a newer goal arrives on the shared socket.
  await left.bringToFront();await left.waitForNetworkIdle({idleTime:150});
  holdClient='left';await resync(left);
  const deadline=Date.now()+10000;while(!held&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(held,'old snapshot request captured');
  matches=matches.map(m=>m.id==='A'?{...m,events:[...m.events,...providerTimeline('A',[{id:'c78',type:'corner_kick',team:'home',gt:78}])]}:m);
  const deliveredAt=Date.now();updateGoal(1,true);
  await Promise.all([score(left,1),score(right,1)]);
  const latencyMs=Date.now()-deliveredAt;
  assert.ok(latencyMs<2000,'local score processing/broadcast does not introduce a two-second queue: '+latencyMs+'ms');
  console.log('PASS two-client local score propagation: '+latencyMs+'ms (excluding upstream provider/network delay)');
  for(const page of [left,right]){
    await page.waitForFunction(()=>document.querySelector('.zshop-tracker-events')?.textContent.includes('45+2'));
    assert.deepEqual(await page.evaluate(()=>window.feed.matchEvents.filter(e=>e.matchId==='A').map(e=>e.minuteLabel)),['23','45+2','78'],'a delayed REST response cannot erase the latest pushed incident');
    assert.deepEqual(await page.$$eval('.zshop-tracker-events time',nodes=>nodes.map(node=>node.textContent)),['78′','45+2′','23′'],'the actual tracker renders provider stoppage time rather than the later live clock');
  }
  held.response.json(held.snapshot);held=null;
  await Promise.all([displayedScore(left,1),displayedScore(right,1)]);
  assert.equal(await left.evaluate(()=>window.feed.lockedMatches.A),true,'old REST cannot unlock the pushed closed match');
  io.emit('matches:live',{...board(),at:at(1),matches:board().matches.map(m=>({...m,snapshotAt:at(1),scoreAt:at(1),score:{home:0,away:0},suspended:false}))});
  await Promise.all([score(left,1),score(right,1)]);
  const cold=await open('cold');await score(cold,1);await displayedScore(cold,1);
  assert.equal(await cold.evaluate(()=>window.feed.lockedMatches.A),true,'cold visitor hydrates the same lock as an existing visitor');
  console.log('PASS delayed snapshot, stale socket and independently opened cold client');
  // Collector cycles must queue a refresh, rather than repeatedly aborting a
  // slow REST snapshot. Hold the queued response too so the first snapshot's
  // membership is observable before the newer authoritative membership wins.
  const coalesced=await open('coalesced');
  await coalesced.bringToFront();await coalesced.waitForNetworkIdle({idleTime:150});
  const coalescedRequests=()=>requests.filter(name=>name==='coalesced').length;
  const beforeSlow=coalescedRequests();
  const waitHeld=async label=>{
    const deadline=Date.now()+10000;
    while(!held&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(held,label);
    return held;
  };
  matches=[...matches,match('H')];stamp();
  holdClient='coalesced';await resync(coalesced);
  const firstSlow=await waitHeld('slow board snapshot captured before collector cycles');
  assert.ok(firstSlow.snapshot.some(item=>item.id==='H'));
  const beforeCycles=await coalesced.evaluate(()=>window.feed.refreshVersion);
  matches=[...matches.filter(item=>item.id!=='H'),match('N')];
  for(let cycle=0;cycle<5;cycle++){stamp();io.emit('matches:live',board());}
  await coalesced.waitForFunction(before=>window.feed.refreshVersion>before,{polling:100},beforeCycles);
  await coalesced.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(await coalesced.evaluate(()=>window.feed.refreshVersion),beforeCycles+1,'unchanged membership does not request five redundant snapshots');
  assert.equal(firstSlow.aborted,false,'collector cycles cannot abort an in-flight board request');
  assert.equal(firstSlow.response.destroyed,false,'slow board connection remains usable');
  assert.equal(coalescedRequests(),beforeSlow+1,'several collector cycles cannot restart the held snapshot');
  held=null;holdClient='coalesced';firstSlow.response.json(firstSlow.snapshot);
  const queued=await waitHeld('one queued refresh captures the newer board membership');
  await visible(coalesced,'H');await visible(coalesced,'N',false);
  assert.equal(coalescedRequests(),beforeSlow+2,'collector cycles collapse into one follow-up request');
  assert.ok(queued.snapshot.some(item=>item.id==='N')&&!queued.snapshot.some(item=>item.id==='H'));
  held=null;queued.response.json(queued.snapshot);
  await visible(coalesced,'N');await visible(coalesced,'H',false);
  await coalesced.waitForNetworkIdle({idleTime:150});
  assert.equal(coalescedRequests(),beforeSlow+2,'the coalesced refresh is not followed by extra discarded cycles');
  await coalesced.close();
  matches=matches.filter(item=>item.id!=='N');stamp();io.emit('matches:live',board());
  await Promise.all([left.waitForNetworkIdle({idleTime:200}),right.waitForNetworkIdle({idleTime:200})]);
  console.log('PASS slow board refresh: repeated real collector cycles preserve the pending snapshot and coalesce one newer membership refresh');
  // Miss a complete goal while offline, then let actual Socket.IO reconnect.
  await right.bringToFront();blocked.add('right');sockets.get('right').conn.close();
  await right.waitForFunction(()=>window.feed.connected===false,{polling:100});
  updateGoal(2,false);await score(left,2);
  assert.equal(await right.evaluate(()=>window.feed.livePatches.A.homeScore),1,'disconnected tab really missed the goal');
  blocked.delete('right');
  await right.bringToFront();
  await right.waitForFunction(()=>window.feed.connected,{timeout:15000,polling:100});
  await Promise.all([score(left,2),score(right,2),displayedScore(right,2)]);
  updateGoal(1,false);await Promise.all([score(left,1),score(right,1)]);
  await Promise.all([displayedScore(left,1),displayedScore(right,1)]);
  console.log('PASS disconnected window recovery and provider score correction');
  // Membership is replaced, not appended forever. Upcoming becomes live in all tabs.
  await Promise.all([left.evaluate(()=>window.setMode('live')),right.evaluate(()=>window.setMode('live'))]);
  await Promise.all([visible(left,'P',false),visible(right,'P',false)]);
  matches=matches.filter(m=>m.id!=='R').map(m=>m.id==='P'?{...m,status:'LIVE',period:'1H'}:m);
  stamp();io.emit('matches:live',board());
  await Promise.all([visible(left,'P'),visible(right,'P'),visible(left,'R',false),visible(right,'R',false)]);
  console.log('PASS identical membership removals and upcoming-to-live transition');
  // REST-only quote changes must update the button too; an old socket price cannot stick.
  matches=matches.map(m=>m.id==='A'?{...m,markets:m.markets.map(market=>({...market,outcomes:market.outcomes.map(outcome=>({...outcome,odds:2.5}))}))}:m);
  stamp();io.emit('matches:live',board());
  // Compact collector frames carry facts, not prices. An unchanged ID set
  // waits for the 30s REST poll or browser resume; exercise resume explicitly.
  await resync(left);await resync(right);
  const price=async(page,value)=>page.waitForFunction(value=>window.feed.oddsDeltas['A|result||1']?.newOdds===value,{polling:100},value);
  await Promise.all([price(left,2.5),price(right,2.5)]);
  io.emit('odds:update',{matchId:'A',at:at(1),markets:[{key:'result',line:'',outcomes:[{key:'1',price:1.2,suspended:true}]}]});
  await resync(left);await price(left,2.5);
  const checkButtons=page=>page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent.replace(/\s/g,'')==='12.50'),{polling:100});
  await Promise.all([checkButtons(left),checkButtons(right)]);
  // A missed membership change is also recovered on browser resume without a push.
  matches=matches.filter(m=>m.id!=='P');stamp();
  await resync(left);await visible(left,'P',false);
  await resync(right);await visible(right,'P',false);
  // Actual React views must apply the same policy immediately, including when
  // an older raw price remains in their shared socket cache.
  matches=[...matches,{...match('PRE','PREMATCH'),startTime:new Date().toISOString()},{...match('J','PREMATCH'),startTime:new Date().toISOString(),tournament:{id:3,name:'J1 League',category:{id:'japan',name:'Japan',sport:{id:18,name:'Football'}}}}];
  stamp();await Promise.all([left.evaluate(()=>window.setMode('all')),right.evaluate(()=>window.setMode('all'))]);
  await Promise.all([resync(left),resync(right)]);await Promise.all([visible(left,'PRE'),visible(right,'PRE'),visible(left,'J'),visible(right,'J')]);
  const family=marketFamily({name:'Full Time Result',key:'result'}).key;
  const hasPrices=(page,id,want)=>page.waitForFunction((id,want)=>{
    const card=document.querySelector('[data-zshop-match="'+id+'"]');
    return Boolean(card&&[...card.querySelectorAll('button')].some(button=>/2[.,](?:00|50)/.test(button.textContent)))===want;
  },{polling:100},id,want);
  const publishPolicy=(enabled,scopes=[])=>{
    policy={markets:[{key:family,name:'Full Time Result',enabled}],categories:[],scopes};
    setCatalogRows(policy.markets);setCategoryPolicies([]);setScopeBlocks(scopes);stamp();io.emit('markets:policy',policy);
  };
  publishPolicy(false);
  await Promise.all([hasPrices(left,'A',false),hasPrices(right,'A',false),hasPrices(left,'PRE',false),hasPrices(right,'PRE',false)]);
  io.emit('odds:update',{matchId:'A',at:at(++version),markets:[{key:'result',name:'Full Time Result',line:'',outcomes:[{key:'1',price:2.5,suspended:false}]}]});
  await Promise.all([resync(left),resync(right)]);
  await Promise.all([hasPrices(left,'A',false),hasPrices(right,'A',false)]);
  publishPolicy(true);await Promise.all([hasPrices(left,'A',true),hasPrices(right,'A',true),hasPrices(left,'PRE',true),hasPrices(right,'PRE',true)]);
  publishPolicy(true,[{country:'England',league:'Premier League',families:[family],categories:[]}]);
  await Promise.all([hasPrices(left,'A',false),hasPrices(right,'PRE',false),hasPrices(left,'J',true),hasPrices(right,'J',true)]);
  publishPolicy(true);await Promise.all([hasPrices(left,'A',true),hasPrices(right,'PRE',true)]);
  console.log('PASS real React multi-client global/scoped admin hide/reactivation: LIVE, PREMATCH, unaffected Japan and cached price cannot resurrect a hidden market');
  assert.deepEqual(errors,[]);
  console.log('PASS real multi-window match sync: delayed REST, stale socket, cold client, missed goal/reconnect, score correction, locks, membership, live transition, mobile resume and REST-only odds');
} catch(error) {
  console.error('Match sync browser regression failed:',error.message,errors);
  throw error;
} finally {
  await browser?.close();
  io?.disconnectSockets(true);io?.engine.close();server?.closeAllConnections();
  if(io)await new Promise(resolve=>io.close(resolve));
  await vite?.close();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
