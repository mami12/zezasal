/** Real match-detail navigation and error recovery, with isolated localhost APIs. */
import assert from 'node:assert/strict';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import express from 'express';
import puppeteer from 'puppeteer';
import {build} from 'esbuild';
import {Server} from 'socket.io';

const root=fileURLToPath(new URL('../web',import.meta.url)),errors=[],writes=[],held=new Map(),modes=new Map();
const fixture=id=>{
 const at=new Date().toISOString(),marketId=`${id}|result|`;
 return {id,tournamentId:1,homeTeam:'Home '+id,awayTeam:'Away '+id,status:'LIVE',startTime:new Date(Date.now()-600000).toISOString(),
  homeScore:0,awayScore:0,scoreAt:at,clockAt:at,phaseAt:at,snapshotAt:at,updatedAt:at,currentMinute:10,period:'1H',isSuspended:false,
  tournament:{id:1,name:'Test League',category:{id:'england',name:'England',sport:{id:18,name:'Football'}}},
  marketCategories:{Popular:1},markets:[{id:marketId,matchId:id,name:'Full Time Result',marketType:'1X2',status:'ACTIVE',sortOrder:1,
   outcomes:['1','X','2'].map(code=>({id:marketId+'|'+code,marketId,name:code,code,odds:2,status:'ACTIVE',priceValidUntil:Date.now()+60000}))}]};
};
const source=`
import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route,useNavigate}from'react-router-dom';
import{LanguageProvider}from'./src/context/LanguageContext.tsx';import{AuthProvider}from'./src/context/AuthContext.tsx';
import{BetslipProvider}from'./src/context/BetslipContext.tsx';import{FavoritesProvider,useFavorites}from'./src/context/FavoritesContext.tsx';
import{LiveFeedProvider}from'./src/api/liveFeed.tsx';import MatchDetail from'./src/components/Sports/MatchDetail.tsx';
function View(){const navigate=useNavigate();window.navigateTo=id=>navigate('/match/'+id);window.favorites=useFavorites();return <Routes><Route path="/match/:id" element={<MatchDetail/>}/></Routes>}
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/match/101']}><LanguageProvider><AuthProvider><LiveFeedProvider><FavoritesProvider><BetslipProvider><View/></BetslipProvider></FavoritesProvider></LiveFeedProvider></AuthProvider></LanguageProvider></MemoryRouter>);
`;
let server,browser,io;
const waitForHeld=async id=>{
 const end=Date.now()+10000;
 while(!held.has(id)&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(held.has(id),'delayed request for '+id+' reached the fixture');return held.get(id);
};
try{
 const bundle=await build({stdin:{contents:source,loader:'tsx',resolveDir:root},outfile:'match-detail-fixture.js',bundle:true,write:false,format:'esm',platform:'browser',target:'es2020',jsx:'automatic',
  define:{'process.env.NODE_ENV':'"development"','import.meta.env':JSON.stringify({BASE_URL:'/app/',VITE_MARKET_DIAGNOSTIC_ALL:'0'})},logLevel:'silent'});
 const app=express();
 app.use('/app/api',(request,response,next)=>{
  if(request.method!=='GET'){writes.push(request.originalUrl);return response.sendStatus(405);}next();
 });
 app.get('/app/api/auth/me',(_q,r)=>r.json({id:'detail-test',username:'Preview',role:'PLAYER',status:'ACTIVE',balance:1000}));
 app.get('/app/api/market-policy',(_q,r)=>r.json({markets:[],categories:[]}));
 app.get('/app/api/matches/:id',(request,response)=>{
  const id=request.params.id,mode=modes.get(id);
  if(mode==='hold'){held.set(id,response);return;}
  if(mode==='missing')return response.status(404).json({message:'match not found'});
  if(mode==='error')return response.status(503).json({message:'temporarily unavailable'});
  response.json(fixture(mode==='mismatch'?'101':id));
 });
 app.get('/fixture.js',(_q,r)=>r.type('js').send(bundle.outputFiles.find(file=>file.path.endsWith('.js')).text));
 app.get('/fixture.css',(_q,r)=>r.type('css').send(bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text??''));
 app.use((_q,r)=>r.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'));
 server=http.createServer(app);io=new Server(server,{serveClient:false});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await puppeteer.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(15000);
 page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);
 page.on('request',request=>request.url().startsWith(origin)||request.url().startsWith('data:')?request.continue():request.abort());
 await page.evaluateOnNewDocument(()=>{
  localStorage.setItem('lang','en');localStorage.setItem('token','isolated-detail-token');
  localStorage.setItem('app_favorite_matches','{"broken":true}');localStorage.setItem('app_alert_matches','null');
 });
 await page.goto(origin,{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-outcome-id="101|result||1"]');
 assert.deepEqual(await page.evaluate(()=>[window.favorites.favorites,window.favorites.alerts]),[[],[]],'invalid saved preferences cannot crash the page');
 const navigate=async id=>page.evaluate(id=>window.navigateTo(id),id);
 const loaded=async id=>page.waitForSelector(`[data-outcome-id="${id}|result||1"]`);
 const absent=async id=>assert.equal(await page.$(`[data-outcome-id^="${id}|"]`),null,'previous match quotes are hidden');
 const retry=async()=>{await page.waitForSelector('[role="alert"] button');await page.click('[role="alert"] button');};

 modes.set('102','hold');await navigate('102');const pending=await waitForHeld('102');
 await page.waitForSelector('[role="status"]');await absent('101');assert.equal(await page.evaluate(()=>document.body.textContent.includes('Home 101')),false);
 pending.json(fixture('102'));await loaded('102');await absent('101');

 modes.set('103','hold');await navigate('103');const old=await waitForHeld('103');
 await navigate('104');await loaded('104');old.json(fixture('103'));await absent('103');
 assert.equal(await page.evaluate(()=>document.body.textContent.includes('Home 104')),true,'an old response cannot replace the new route');

 modes.set('105','missing');await navigate('105');await page.waitForSelector('[role="alert"]');await absent('104');
 assert.match(await page.$eval('[role="alert"]',element=>element.textContent),/no longer available/);
 modes.delete('105');await retry();await loaded('105');assert.equal(await page.$('[role="alert"]'),null);

 await page.setViewport({width:390,height:800,isMobile:true,hasTouch:true});
 modes.set('106','error');await navigate('106');await page.waitForSelector('[role="alert"]');await absent('105');
 assert.match(await page.$eval('[role="alert"]',element=>element.textContent),/Unable to load/);
 modes.delete('106');await retry();await loaded('106');

 modes.set('107','mismatch');await navigate('107');await page.waitForSelector('[role="alert"]');await absent('101');await absent('106');
 modes.delete('107');await retry();await loaded('107');
 modes.set('108','hold');await navigate('108');await waitForHeld('108');
 await page.waitForSelector('[role="alert"]',{timeout:20000});await absent('107');
 modes.delete('108');await retry();await loaded('108');
 modes.set('108','missing');await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await page.waitForSelector('[role="alert"]');await absent('108');
 held.delete('108');modes.set('108','hold');await retry();const retryResponse=await waitForHeld('108');
 await absent('108');assert.ok(await page.$('[role="alert"]'),'a retry does not temporarily reopen unavailable quotes');
 modes.delete('108');retryResponse.json(fixture('108'));await loaded('108');
 await page.evaluate(()=>window.favorites.toggleFavorite('108'));
 await page.waitForFunction(()=>window.favorites.isFavorite('108')&&window.favorites.isAlertEnabled('108'));
 await page.evaluate(()=>window.favorites.toggleFavorite('108'));
 await page.waitForFunction(()=>!window.favorites.isFavorite('108'));
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 console.log('PASS real match details: previous quotes hidden, late responses ignored, 404/503/timeouts/mismatched fixture recovery, invalid favorites repaired, desktop/mobile retry and no bet writes');
}finally{
 await browser?.close();io?.disconnectSockets(true);io?.engine.close();server?.closeAllConnections();
 if(io)await new Promise(resolve=>io.close(resolve));if(server?.listening)await new Promise(resolve=>server.close(resolve));
}
