/** Actual React buttons, betslip and sockets; no real bets or upstream access. */
import assert from 'node:assert/strict';
import express from 'express';import http from 'node:http';import{resolve}from'node:path';
import{createServer}from'vite';import react from'@vitejs/plugin-react';import tailwindcss from'tailwindcss';
import tailwind from'../web/tailwind.config.js';import puppeteer from'puppeteer';import{Server}from'socket.io';
const app=express(),errors=[],writes=[];let vite,server,io,browser;
app.get('/app/api/auth/me',(_q,r)=>r.json({id:'p',username:'test-player',role:'PLAYER',status:'ACTIVE',balance:10000,currency:'LEK'}));
app.use('/app/api',(q,r)=>{if(q.method!=='GET')writes.push(q.path);r.status(404).json({});});
const html=`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;background:#142136"><div id="root"></div><script type="module">
import React from'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';
import{AuthProvider}from'/src/context/AuthContext.tsx';import{LanguageProvider}from'/src/context/LanguageContext.tsx';import{BetslipProvider,useBetslip}from'/src/context/BetslipContext.tsx';import{LiveFeedProvider,useLiveFeed}from'/src/api/liveFeed.tsx';
import OddsButton from'/src/components/Sports/OddsButton.tsx';import Betslip from'/src/components/Betslip/Betslip.tsx';import'/src/index.css';
const at=new Date().toISOString(),until=Date.now()+60000;
const match={id:'881',homeTeam:'Home',awayTeam:'Away',status:'LIVE',homeScore:0,awayScore:0,scoreAt:at,period:'2H',currentMinute:90,isSuspended:false};
const market={id:'881|result|',matchId:'881',name:'Full Time Result',marketType:'1X2',status:'ACTIVE',sortOrder:0};
const one={id:'881|result||1',marketId:market.id,name:'1',code:'1',odds:2,status:'ACTIVE',feedSuspended:false,quotedAt:at,priceValidUntil:until};
const two={...one,id:'881|result||2',name:'2',code:'2',priceValidUntil:undefined};
const unknown={...one,id:'881|result||X',name:'X',code:'X',priceValidUntil:null};
const combo={id:'BB|881|fixture|market',matchId:'881',name:'Bet Builder: 1X2 + Total Goals',marketType:'OTHER',status:'ACTIVE',sortOrder:0,builderQuotedAt:at,builderLegs:[{marketId:market.id,outcomeId:one.id,odds:2,priceValidUntil:until},{marketId:'881|total|5.5',outcomeId:'881|total|5.5|Over',odds:2,priceValidUntil:until}]};
const combined={id:'BB|881|fixture',marketId:combo.id,name:'1X2 1 + TOTAL Over 5.5',odds:4,status:'ACTIVE'};
function View(){const feed=useLiveFeed(),slip=useBetslip();window.fixtureFeed=feed;window.fixtureSlip=slip;
return React.createElement('main',{style:{width:'100%',maxWidth:1000,padding:8,boxSizing:'border-box'}},React.createElement('div',{style:{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8}},React.createElement(OddsButton,{match,market,outcome:one}),React.createElement(OddsButton,{match,market,outcome:two}),React.createElement(OddsButton,{match,market,outcome:unknown}),React.createElement(OddsButton,{match,market:combo,outcome:combined})),React.createElement('div',{style:{height:650,marginTop:10}},React.createElement(Betslip)));}
createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,React.createElement(LanguageProvider,null,React.createElement(AuthProvider,null,React.createElement(BetslipProvider,null,React.createElement(LiveFeedProvider,null,React.createElement(View)))))));
</script></body></html>`;
try{
 const root=resolve('web');vite=await createServer({root,configFile:false,cacheDir:resolve('tmp/vite-quote-validity'),plugins:[react()],css:{postcss:{plugins:[tailwindcss({...tailwind,content:[root+'/src/**/*.{ts,tsx}']})]}},optimizeDeps:{include:['react','react-dom/client','react-router-dom','axios','lucide-react','socket.io-client']},server:{middlewareMode:true,hmr:false,fs:{allow:[resolve('.'),resolve('node_modules')]}},appType:'custom'});
 app.get('/',async(_q,r)=>r.type('html').send(await vite.transformIndexHtml('/',html)));app.use(vite.middlewares);
 server=http.createServer(app);io=new Server(server,{serveClient:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.evaluateOnNewDocument(()=>{localStorage.setItem('lang','al');localStorage.setItem('token','fixture');window.alerts=[];window.alert=value=>window.alerts.push(value);});
 const native='[data-outcome-id="881|result||1"]',other='[data-outcome-id="881|result||2"]',bb='[data-outcome-id="BB|881|fixture"]';
 const quote=(key,ms=20000)=>io.emit('odds:update',{matchId:'881',at:new Date().toISOString(),markets:[{key:key==='1'?'result':'total',line:key==='1'?'':'5.5',outcomes:[{key:key==='1'?'1':'Over',price:2,suspended:false,priceValidUntil:Date.now()+ms}]}]});
 const placeState=()=>page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(el=>el.textContent.includes('Vendos Bastin'));return b?b.disabled:null;});
 for(const width of [1366,390,320]){
  await page.setViewport({width,height:950});await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.fixtureFeed?.connected===true);await page.waitForSelector(native);
  const version=await page.evaluate(()=>window.fixtureFeed.refreshVersion);io.emit('board:settings',{at:new Date().toISOString()});await page.waitForFunction(before=>window.fixtureFeed.refreshVersion>before,{},version);
  assert.equal(await page.$eval('[data-outcome-id="881|result||X"]',el=>el.disabled),true,'missing timestamp cannot be clicked');
  quote('1',1600);await page.waitForFunction(()=>window.fixtureFeed.oddsDeltas['881|result||1']?.priceValidUntil>0);
  await page.click(native);await page.waitForFunction(()=>window.fixtureSlip.selections.length===1);
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(el=>el.textContent.includes('Vendos Bastin')&&!el.disabled));
  io.emit('match:info',{match_id:'881',home_score:0,away_score:0,match_time_ms:90*60000,at:new Date().toISOString()});
  await page.waitForFunction(()=>document.querySelector('[data-outcome-id="881|result||1"]').disabled,{timeout:8000});
  assert.equal(await placeState(),true,'slip stops before submission when the same quote expires');
  assert.equal(await page.$eval(other,el=>el.disabled),false,'other active quote is not globally suspended');
  quote('1');await page.waitForFunction(()=>!document.querySelector('[data-outcome-id="881|result||1"]').disabled);
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(el=>el.textContent.includes('Vendos Bastin')&&!el.disabled));
  await page.click(native);quote('1',1500);quote('Over');
  await page.waitForFunction(()=>window.fixtureSlip.selections.length===0);await page.click(bb);await page.waitForFunction(()=>window.fixtureSlip.selections[0]?.outcomeId.startsWith('BB|'));
  await page.waitForFunction(()=>document.querySelector('[data-outcome-id="BB|881|fixture"]').disabled,{timeout:8000});
  assert.equal(await placeState(),true,'combo and slip expire with their earliest leg');
  quote('Over');assert.equal(await page.$eval(bb,el=>el.disabled),true,'refreshing another leg cannot reopen an old leg');
  quote('1');await page.waitForFunction(()=>!document.querySelector('[data-outcome-id="BB|881|fixture"]').disabled);
  io.emit('feed:state',{mode:'waking'});await page.waitForFunction(()=>document.querySelector('[data-outcome-id="881|result||2"]').disabled);
  assert.equal(await placeState(),true,'all markets and slip blocked while feed rebuilds');
  io.emit('feed:state',{mode:'live'});await page.waitForFunction(()=>!document.querySelector('[data-outcome-id="881|result||2"]').disabled);
  assert.deepEqual(await page.evaluate(()=>window.alerts),[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  console.log('PASS quote expiry/browser '+width+': lock before click, slip, same-price reopen, score-only nonrenewal, independent siblings, combo legs, feed rebuild');
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
}finally{await browser?.close();io?.close();await vite?.close();if(server){server.closeAllConnections?.();await new Promise(r=>server.close(r));}}
