/** Actual list/detail/sidebar React; all HTTP uses loopback fixtures only. */
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import puppeteer from 'puppeteer';
import tailwind from '../web/tailwind.config.js';
const countries=[['England','england.svg'],['United States','united-states-of-america.svg'],['Brazil','brazil.svg'],['International Clubs','fallback'],['Unknown country','fallback'],['Sweden','sweden.svg']];
const matches=countries.map(([country],i)=>{
 const marketId=`${i+1}|result|`;
 return {id:String(i+1),homeTeam:`Home ${i+1}`,awayTeam:`Away ${i+1}`,status:'PREMATCH',startTime:'2099-01-01T12:00:00Z',isSuspended:false,marketCount:1,
  tournament:{id:i+1,name:'Premier League',category:{id:i+1,name:country,sport:{id:18,name:'Football'}}},
  markets:[{id:marketId,name:'Full Time Result',marketType:'1X2',status:'ACTIVE',outcomes:['1','X','2'].map(name=>({id:marketId+'|'+name,marketId,name,code:name,status:'ACTIVE',odds:2}))}]};
});
// A protected top division with no quotes must remain listed without invented prices.
Object.assign(matches[5],{protectedPrematch:true,listingPriority:20,marketCount:0,markets:[]});matches[5].tournament.name='Allsvenskan';
const tree=[{id:18,name:'Football',categories:matches.map(match=>({...match.tournament.category,tournaments:[{id:match.tournament.id,name:match.tournament.name,protectedPrematch:match.protectedPrematch}]}))}];
const app=express(),errors=[],writes=[];
app.use('/app/country-flags',express.static(resolve('web/public/country-flags')));
app.get('/app/api/sports',(_req,res)=>res.json(tree));app.get('/app/api/matches',(_req,res)=>res.json(matches));
app.get('/app/api/matches/:id',(req,res)=>res.json(matches.find(match=>match.id===req.params.id)));
app.use('/app/api',(req,res)=>{if(req.method!=='GET')writes.push(req.method+' '+req.path);res.status(404).json({});});
const root=resolve('web');
const vite=await createServer({root,configFile:false,define:{'import.meta.env.BASE_URL':JSON.stringify('/app/')},cacheDir:resolve('tmp/vite-country-flags'),plugins:[react()],css:{postcss:{plugins:[tailwindcss({...tailwind,content:[root+'/src/**/*.{ts,tsx}']}),autoprefixer()]}},optimizeDeps:{include:['react','react-dom/client','react-router-dom','axios','lucide-react','socket.io-client']},server:{middlewareMode:true,hmr:false,fs:{allow:[resolve('.'),resolve('node_modules')]}},appType:'custom'});
app.get('/',async(req,res)=>res.type('html').send(await vite.transformIndexHtml('/',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;background:#0b1424"><div id="root"></div><script type="module">
import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route}from'react-router-dom';import{LanguageProvider}from'/src/context/LanguageContext.tsx';import{BetslipProvider}from'/src/context/BetslipContext.tsx';import{FavoritesProvider}from'/src/context/FavoritesContext.tsx';import MatchList from'/src/components/Sports/MatchList.tsx';import MatchDetail from'/src/components/Sports/MatchDetail.tsx';import SportsSidebar from'/src/components/Layout/SportsSidebar.tsx';import'/src/index.css';
const e=React.createElement,noop=()=>{},view=${JSON.stringify(String(req.query.view||'board'))};
const body=view==='detail'?e(Routes,null,e(Route,{path:'/match/:id',element:e(MatchDetail)})):view==='sidebar'?e('div',{style:{width:230}},e(SportsSidebar,{searchTerm:'',onSearchChange:noop,onSelectTournament:noop,onSelectSport:noop,onSelectCategory:noop,onSelectAll:noop,onSelectLive:noop,onSelectFavorites:noop})):e(MatchList,{viewMode:'all',searchTerm:'',onSearchChange:noop,onViewModeChange:noop});
createRoot(document.getElementById('root')).render(e(MemoryRouter,{initialEntries:['/match/1']},e(LanguageProvider,null,e(BetslipProvider,null,e(FavoritesProvider,null,body)))));
</script></body></html>`)));
app.use(vite.middlewares);const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);
 const origin=`http://127.0.0.1:${server.address().port}`;await page.evaluateOnNewDocument(()=>localStorage.setItem('lang','al'));
 await mkdir('test-artifacts/country-flags',{recursive:true});
 for(const view of ['board','detail','sidebar'])for(const width of [1366,390,320]){
  await page.setViewport({width,height:1200,isMobile:width<768,hasTouch:width<768});await page.goto(`${origin}/?view=${view}`,{waitUntil:'networkidle0',timeout:60000});await page.waitForSelector('[data-country-flag]',{timeout:60000});
  const expected=view==='detail'?countries.slice(0,1):countries;
  for(const [country,file] of expected){
   const flag=await page.$(`[data-country-flag="${file}"][${file==='fallback'?'aria-label':'alt'}="${country}"]`);assert.ok(flag,`${view}/${width}: ${country}`);
   if(file!=='fallback'){
    await flag.evaluate(el=>el.scrollIntoView({block:'center'}));await page.waitForFunction(el=>el.complete&&el.naturalWidth>0,{},flag);
    assert.equal(await flag.evaluate(el=>el.src.startsWith(location.origin+'/app/country-flags/')),true,'local captured asset');
   }
   assert.equal(await flag.evaluate(el=>el.getBoundingClientRect().width),16,'stable compact width');
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${view}/${width}: no overflow`);
  if(view==='board'){assert.ok((await page.$eval('body',e=>e.textContent)).includes('Home 6'),'protected unpriced match remains visible');assert.equal(await page.$('[data-outcome-id^="6|"]'),null,'no invented odds for an unpriced protected fixture');}
  if(width===320)await page.screenshot({path:`test-artifacts/country-flags/${view}-${width}.png`,fullPage:true});
  console.log(`PASS ${view}/${width}: country flags, local assets and fallback`);
 }
 // A deployment/cache missing an asset becomes a neutral icon, never a broken
 // image or a different country's flag.
 await page.setCacheEnabled(false);await page.setRequestInterception(true);page.on('request',req=>req.url().endsWith('/england.svg')?req.abort():req.continue());
 await page.goto(origin+'/?view=detail',{waitUntil:'networkidle0'});await page.waitForSelector('[data-country-flag="fallback"][aria-label="England"]');
 assert.equal(await page.$('img[alt="England"]'),null);
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 console.log('PASS local country flags in list/detail/sidebar at1366/390/320px; names, compact size, international/unknown/missing-asset fallback, no overflow or API mutation');
}finally{await browser?.close();await vite.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
