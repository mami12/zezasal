/** Real React/OddsButton clicks; all HTTP is a loopback fixture, with no bets placed. */
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

const outcome=(marketId,id,name,extra={})=>({id,marketId,name,odds:3.55,status:'ACTIVE',...extra});
const market=(id,name,outcomes,extra={})=>({id,name,matchId:'fixture',marketType:'other',sortOrder:0,status:'ACTIVE',outcomes,...extra});
const builders=Array.from({length:8},(_,i)=>{
 const id=`BB|fixture|template-${i}|market`;
 return market(id,`Bet Builder: ${i%3===0?'1':i%3===1?'X':'2'} + Over ${3.5+Math.floor(i/3)}`,
  [outcome(id,`BB|fixture|template-${i}`,`1X2 ${i%3===0?'1':i%3===1?'X':'2'} + TOTAL Over ${3.5+Math.floor(i/3)}`)],
  {builderLegs:[{marketId:'result',outcomeId:'result-1',odds:2},{marketId:'total',outcomeId:'total-over',odds:1.775}]});
});
// Same translated names remain separate contracts; only duplicate IDs deduplicate.
builders.push(market('BB|fixture|same-label|market','Bet Builder: same display name',[
 outcome('BB|fixture|same-label|market','BB|fixture|same-label','1X2 1 + TOTAL Over 3.5')]));
const native=[3.5,4.5].map(line=>market(`native-${line}`,'Result and Total Goals',[
 outcome(`native-${line}`,`native-${line}-1`,`Home And Over ${line}`),
 outcome(`native-${line}`,`native-${line}-x`,`Draw And Under ${line}`),
 outcome(`native-${line}`,`native-${line}-2`,`Away And Over ${line}`,line===4.5?{status:'SUSPENDED'}:{}),
],{extId:'provider-result-total',line:String(line)}));
native[0].outcomes.push({...native[0].outcomes[0]});
const btts=market('native-btts','Both Teams to Score and Total Goals',[
 outcome('native-btts','native-btts-yes','Yes And Over 2.5'),
 outcome('native-btts','native-btts-no','No And Over 2.5'),
]);
const unrelated=['a','b'].map(suffix=>market(`provider-${suffix}`,'Result and BTTS',[
 outcome(`provider-${suffix}`,`provider-${suffix}-home`,'Home And Yes'),
],{extId:`different-family-${suffix}`}));
const main=market('result','1X2',[outcome('result','result-1','1'),outcome('result','result-x','X'),outcome('result','result-2','2')],{marketType:'1x2'});
const fixture={id:'fixture',tournamentId:1,homeTeam:'Home Club',awayTeam:'Away Club',status:'PREMATCH',startTime:'2099-01-01T12:00:00Z',isSuspended:false,markets:[main,...builders,...native,btts,...unrelated]};
const expectedIds=[...builders,...native,btts,...unrelated].flatMap(m=>m.outcomes.map(o=>o.id)).filter((id,i,a)=>a.indexOf(id)===i);
const app=express(),errors=[],unexpected=[];
app.get('/app/api/matches/fixture',(_req,res)=>res.json(fixture));
app.use('/app/api',(req,res)=>{unexpected.push(req.method+' '+req.path);res.status(404).json({});});
const root=resolve('web');
const vite=await createServer({root,configFile:false,cacheDir:resolve('tmp/vite-combo-layout'),plugins:[react()],css:{postcss:{plugins:[tailwindcss({...tailwind,content:[root+'/src/**/*.{ts,tsx}']}),autoprefixer()]}},optimizeDeps:{include:['react','react-dom/client','react-router-dom','axios','lucide-react']},server:{middlewareMode:true,hmr:false,fs:{allow:[resolve('.'),resolve('node_modules')]}},appType:'custom'});
app.get('/',async(req,res)=>res.type('html').send(await vite.transformIndexHtml('/',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;background:#0b1424"><div id="root"></div><script type="module">
import React,{useEffect} from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route}from'react-router-dom';import{LanguageProvider}from'/src/context/LanguageContext.tsx';import{BetslipProvider,useBetslip}from'/src/context/BetslipContext.tsx';import{FavoritesProvider}from'/src/context/FavoritesContext.tsx';import MarketPanel from'/src/components/Sports/MarketPanel.tsx';import MatchDetail from'/src/components/Sports/MatchDetail.tsx';import'/src/index.css';
const fixture=await(await fetch('/app/api/matches/fixture')).json();function Probe(){const value=useBetslip();window.comboSelections=value.selections;return null;}const detail=${req.query.view==='detail'};
createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,{initialEntries:['/match/fixture']},React.createElement(LanguageProvider,null,React.createElement(BetslipProvider,null,React.createElement(FavoritesProvider,null,React.createElement(React.Fragment,null,React.createElement(Probe),detail?React.createElement(Routes,null,React.createElement(Route,{path:'/match/:id',element:React.createElement(MatchDetail)})):React.createElement(MarketPanel,{match:fixture})))))));
</script></body></html>`)));
app.use(vite.middlewares);
const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 await page.evaluateOnNewDocument(()=>localStorage.setItem('lang','al'));
 await mkdir('test-artifacts/combo-layout',{recursive:true});const origin=`http://127.0.0.1:${server.address().port}`;
 for(const view of ['panel','detail'])for(const width of [1366,768,390,320]){
  await page.setViewport({width,height:900,isMobile:width<768,hasTouch:width<768});await page.goto(`${origin}/?view=${view}`,{waitUntil:'networkidle0',timeout:60000});await page.waitForSelector('[data-combo-odds-grid]');
  const metrics=await page.evaluate(()=>({
   ids:[...document.querySelectorAll('[data-combo-odds-grid] button')].map(b=>b.dataset.outcomeId),
   overflow:document.documentElement.scrollWidth>innerWidth+1,
   grids:[...document.querySelectorAll('[data-combo-odds-grid]')].map(grid=>({columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,nonButtons:[...grid.children].some(cell=>cell.children.length!==1||cell.firstElementChild.tagName!=='BUTTON')})),
   small:[...document.querySelectorAll('[data-combo-odds-grid] button')].some(b=>b.getBoundingClientRect().height<44),
  }));
  assert.deepEqual([...metrics.ids].sort(),[...expectedIds].sort(),`${view}/${width}: all original combo contracts exactly once`);
  assert.equal(metrics.overflow,false,`${view}/${width}: no page overflow`);assert.equal(metrics.small,false,`${view}/${width}: touch target`);
  assert.ok(metrics.grids.every(g=>g.columns>=2&&!g.nonButtons),`${view}/${width}: buttons only, horizontal grid`);
  const target='BB|fixture|template-0';await page.click(`[data-outcome-id="${target}"]`);await page.waitForFunction(id=>window.comboSelections?.some(s=>s.outcomeId===id),{},target);
  const picked=await page.evaluate(()=>window.comboSelections[0]);assert.equal(picked.marketId,builders[0].id);assert.equal(picked.odds,3.55);assert.deepEqual(picked.builderLegs,builders[0].builderLegs);
  assert.equal(await page.$eval(`[data-outcome-id="${target}"]`,b=>b.getAttribute('aria-pressed')),'true');
  await page.click(`[data-outcome-id="${target}"]`);await page.waitForFunction(()=>window.comboSelections.length===0);
  assert.equal(await page.$eval('[data-outcome-id="native-4.5-2"]',b=>b.disabled),true);
  // Provider families without a numeric line must never be visually merged.
  assert.equal(await page.$eval('[data-outcome-id="provider-a-home"]',b=>b.closest('[data-combo-odds-grid]').querySelectorAll('button').length),1);
  assert.equal(await page.$eval('[data-outcome-id="provider-b-home"]',b=>b.closest('[data-combo-odds-grid]').querySelectorAll('button').length),1);
  if(width===1366||width===320)await page.screenshot({path:`test-artifacts/combo-layout/${view}-${width}.png`,fullPage:true});
 }
 Object.assign(fixture,{status:'LIVE',homeScore:3,awayScore:1,scoreAt:new Date().toISOString(),phaseAt:new Date().toISOString(),currentMinute:60,period:'2nd Half'});
 for(const view of ['panel','detail']){
  await page.goto(`${origin}/?view=${view}`,{waitUntil:'networkidle0',timeout:60000});await page.waitForSelector('[data-combo-odds-grid]');
  assert.equal(await page.$('[data-outcome-id="BB|fixture|template-0"]'),null,`${view}: completed total combo stays hidden`);
  assert.ok(await page.$('[data-outcome-id="BB|fixture|template-6"]'),`${view}: uncompleted, feasible combo remains`);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 console.log('PASS combo layouts: MatchDetail + MarketPanel at 1366/768/390/320px; original contract IDs, same-name choices, native families, 2+ columns, 44px touch targets, selection toggle/price/legs, provider suspension, live completed-combo filtering, no API mutations.');
}finally{await browser?.close();await vite.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
