import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import express from 'express';
import http from 'node:http';
import puppeteer from 'puppeteer';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import tailwind from '../web/tailwind.config.js';
import {buildMatchExposure} from '../server/ledger/financial-monitoring.mjs';
const root=resolve('web'),ticketId='11111111-1111-4111-8111-111111111111';
const exposure=buildMatchExposure([{ticket_id:ticketId,user_id:'p1',username:'Lojtari i provës',stake:100,original_potential_payout:500,ticket_status:'PENDING',match_id:101,match_name:'Alpha vs Beta',market_key:'corners',market_name:'Total Corners',line:'4.5',outcome_key:'over',outcome_name:'Over',odds_at_placement:5,status:'PENDING'}]);
const reviews=[{match_id:101,payload:{status:'MANUAL_REVIEW',checkedAt:new Date().toISOString(),conflicts:{corners:{}},sources:[{provider:'primary',values:{corners:{home:3,away:2}}},{provider:'bsd',values:{corners:{home:4,away:2}}}],unavailable:{}}}];
const fixture=`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from'react';import{createRoot}from'react-dom/client';import{LanguageProvider}from'/src/context/LanguageContext.tsx';import MatchExposure from'/src/components/Admin/MatchExposure.tsx';import'/src/index.css';
createRoot(document.getElementById('root')).render(React.createElement(LanguageProvider,null,React.createElement(MatchExposure)));
</script></body></html>`;
let vite,server,browser;const writes=[],errors=[];
try{
 vite=await createServer({root,configFile:false,cacheDir:resolve('web/node_modules/.vite-exposure-test'),plugins:[react()],css:{postcss:{plugins:[tailwindcss({...tailwind,content:[root+'/src/**/*.{ts,tsx}']}),autoprefixer()]}},server:{middlewareMode:true,hmr:false,fs:{allow:[resolve('.')]}},appType:'custom'});
 const app=express();app.use(express.json());app.use('/app/api',(req,res)=>{
  if(req.method==='POST'&&req.path==='/admin/manual-settlement'){writes.push(req.body);return res.json({changed:[{ticketId,status:req.body.status}]});}
  if(req.method!=='GET')return res.status(405).end();
  if(req.path==='/admin/match-exposure')return res.json(exposure);
  if(req.path==='/admin/statistics-review')return res.json({reviews});
  return res.status(404).end();
 });app.get('/',async(_req,res)=>res.type('html').send(await vite.transformIndexHtml('/',fixture)));app.use(vite.middlewares);
 server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 browser=await puppeteer.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin)||r.url().startsWith('data:')?r.continue():r.abort());
 await page.evaluateOnNewDocument(()=>{localStorage.setItem('token','isolated-admin-fixture');localStorage.setItem('lang','al');});
 await mkdir('test-artifacts/match-exposure',{recursive:true});
 for(const width of [1366,390]){
  await page.setViewport({width,height:900});await page.goto(origin,{waitUntil:'networkidle0',timeout:60000});
  await page.select('select[aria-label="Ndeshja e monitoruar"]','101');await page.waitForFunction(()=>document.body.innerText.includes('Lojtari i provës'));
  const text=await page.$eval('body',n=>n.innerText);assert.match(text,/Në pritje të verifikimit manual/);assert.match(text,/primary/);assert.match(text,/bsd/);assert.match(text,/3–2/);assert.match(text,/4–2/);assert.match(text,/500/);
  await page.click('details summary');assert.match(await page.$eval('body',n=>n.innerText),/Lojtari i provës/);
  await page.select('select[aria-label="Përzgjedhja për verifikim"]',JSON.stringify(['corners','4.5','over']));
  await (await page.$('form select')).at(-1).select('WON');
  let count=writes.length;await page.click('form button');await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes('Vendimi u regjistrua'));
  assert.equal(writes.length,count+1);assert.deepEqual(writes.at(-1),{matchId:'101',marketKey:'corners',line:'4.5',outcomeKey:'over',status:'WON'});
  await page.select('select[aria-label="Niveli i vendimit"]','ticket');await page.waitForFunction(()=>document.querySelectorAll('form input').length===1);await (await page.$('form input'))[0].type(ticketId);
  await (await page.$$('form select')).at(-1).select('PENDING');count=writes.length;const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/admin/manual-settlement'));await page.click('form button');await response;
  await page.waitForFunction(()=>document.querySelector('form button')?.textContent==='Ruaj vendimin manual');
  assert.equal(writes.length,count+1);assert.equal(writes.at(-1).ticketId,ticketId);assert.equal(writes.at(-1).status,'PENDING');assert.equal(writes.at(-1).matchId,undefined);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal page overflow');
  await page.screenshot({path:`test-artifacts/match-exposure/${width}.png`,fullPage:true});
  console.log(`PASS admin exposure ${width}px: identities, stakes, odds, conditional payouts, conflicting final sources, exact manual market/ticket submissions`);
 }
 assert.deepEqual(errors,[]);assert.equal(writes.length,4);
}finally{await browser?.close();await vite?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
