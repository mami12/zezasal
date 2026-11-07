import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import puppeteer from 'puppeteer';
import tailwind from '../web/tailwind.config.js';
import {buildMatchExposure} from '../server/ledger/financial-monitoring.mjs';
import {pool} from '../server/db.mjs';

const ticketA='00000000-0000-4000-8000-000000000011',ticketB='00000000-0000-4000-8000-000000000012';
const row=(ticket,user,username,stake,quote,match,market,line,outcome,name,odds)=>({ticket_id:ticket,user_id:user,username,stake,original_potential_payout:quote,potential_payout:quote,ticket_status:'PENDING',match_id:match,match_name:match===701?'Arsenal vs Chelsea':'Lyon vs Monaco',market_key:market,market_name:market==='result'?'Full Time Result':'Corners. Total',line,outcome_key:outcome,outcome_name:name,odds_at_placement:odds,status:'PENDING'});
const exposure=buildMatchExposure([
 row(ticketA,'alpha','player.alpha',100,190,701,'result','','1','Arsenal',1.9),
 row(ticketB,'beta','player.beta',200,900,701,'corners','2.5','over','Over',1.5),
 row(ticketB,'beta','player.beta',200,900,702,'result','','1','Lyon',3),
 row('00000000-0000-4000-8000-000000000013','alpha','player.alpha',50,250,701,'result','','X','Draw',5),
]);
const review={status:'MANUAL_REVIEW',checkedAt:'2026-11-05T00:00:00Z',sources:[
 {provider:'provider-a',values:{corners:{home:4,away:3}}},
 {provider:'provider-b',values:{corners:{home:5,away:3}}},
],conflicts:{corners:{values:[{provider:'provider-a',home:4,away:3},{provider:'provider-b',home:5,away:3}]}},unavailable:{'provider-c':'quota'}};
const requests=[],errors=[],remote=[];let vite,http,browser;
const root=fileURLToPath(new URL('../web/',import.meta.url));
try{
 vite=await createServer({root,configFile:false,cacheDir:resolve('tmp/vite-match-exposure'),plugins:[react()],
  css:{postcss:{plugins:[tailwindcss({...tailwind,content:[resolve('web/src/**/*.{ts,tsx}')]}),autoprefixer()]}},
  optimizeDeps:{include:['react','react-dom/client','axios','lucide-react']},server:{middlewareMode:true,hmr:false,fs:{allow:[resolve('.'),resolve('node_modules')]}},appType:'custom'});
 const app=express();app.use(express.json());
 app.get('/app/api/admin/match-exposure',(_q,r)=>r.json(exposure));
 app.get('/app/api/admin/statistics-review',(_q,r)=>r.json({reviews:[{match_id:701,payload:review}]}));
 app.post('/app/api/admin/manual-settlement',async(q,r)=>{requests.push(q.body);await new Promise(resolve=>setTimeout(resolve,100));r.json({changed:[{ticketId:ticketA}]});});
 app.get('/',async(_q,r)=>r.type('html').send(await vite.transformIndexHtml('/',`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React from 'react';import{createRoot}from'react-dom/client';import{LanguageProvider}from'/src/context/LanguageContext.tsx';import MatchExposure from'/src/components/Admin/MatchExposure.tsx';import'/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(LanguageProvider,null,React.createElement(MatchExposure)));</script></body></html>`)));
 app.use(vite.middlewares);http=app.listen(0,'127.0.0.1');await new Promise(r=>http.once('listening',r));
 const origin='http://127.0.0.1:'+http.address().port;
 browser=await puppeteer.launch({headless:true});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 page.setDefaultTimeout(30000);await page.evaluateOnNewDocument(()=>{localStorage.setItem('token','isolated-admin-fixture');localStorage.setItem('lang','al');});
 await page.setRequestInterception(true);page.on('request',request=>{if(request.url().startsWith(origin)||request.url().startsWith('data:'))void request.continue();else{remote.push(request.url());void request.abort();}});
 const label=name=>'[aria-label="'+name+'"]';
 const fill=async(selector,value)=>{await page.$eval(selector,element=>{element.value='';element.dispatchEvent(new Event('input',{bubbles:true}));});await page.type(selector,value);};
 const submit=async()=>{await page.click('form button');await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes('1 bileta'));};
 await mkdir('test-artifacts/match-exposure',{recursive:true});
 for(const width of [1366,390]){
  await page.setViewport({width,height:1000,isMobile:width<768,hasTouch:width<768});await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('[aria-label="Ndeshja e monitoruar"]').options.length===3);
  await page.select(label('Ndeshja e monitoruar'),'701');
  const content=await page.$eval('body',body=>body.innerText);
  assert.match(content,/2 përdorues · 3 bileta/);assert.match(content,/player\.alpha/);assert.match(content,/player\.beta/);
  assert.match(content,/350,00/);assert.match(content,/250,00/);assert.match(content,/190,00/);assert.match(content,/900,00/);assert.match(content,/1\.9/);
  assert.match(content,/Në pritje të verifikimit manual/);assert.match(content,/provider-a/);assert.match(content,/provider-b/);
  assert.match(content,/Kornera: 4–3/);assert.match(content,/Kornera: 5–3/);assert.match(content,/Mospërputhje: Kornera/);assert.match(content,/provider-c/);
  await page.click('table details summary');assert.match(await page.$eval('table details',node=>node.innerText),/player\.alpha/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page fits '+width+'px; tables may scroll within their wrappers');
  await page.screenshot({path:`test-artifacts/match-exposure/${width}.png`,fullPage:true});
  const before=requests.length;
  // The authenticated admin selects status directly; server records audit metadata.
  await page.select(label('Përzgjedhja për verifikim'),JSON.stringify(['corners','2.5','over']));
  await page.select(label('Gjendja e vendimit'),'WON');
  await submit();assert.equal(requests.length,before+1,'one click posts one market decision');
  assert.deepEqual(requests.at(-1),{matchId:'701',marketKey:'corners',line:'2.5',outcomeKey:'over',status:'WON'});
  await page.select(label('Niveli i vendimit'),'ticket');await fill(label('Identifikuesi i biletës'),ticketB);
  await page.select(label('Gjendja e vendimit'),'PENDING');
  await submit();assert.equal(requests.length,before+2,'one click posts one individual-ticket decision');
  assert.deepEqual(requests.at(-1),{ticketId:ticketB,status:'PENDING'});
  console.log('PASS match exposure '+width+'px: real members/stakes/odds/conditional payouts, conflicting providers, status-only admin decisions');
 }
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);assert.equal(requests.length,4);
}finally{await browser?.close();await vite?.close();if(http){http.closeAllConnections();await new Promise(r=>http.close(r));}await pool.end();}
