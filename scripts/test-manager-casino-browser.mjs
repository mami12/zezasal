/** Real scoped settings HTTP/SQL with an isolated browser; no live accounts. */
import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import express from 'express';
import http from 'node:http';
import puppeteer from 'puppeteer';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import tailwind from '../web/tailwind.config.js';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {createCasinoWalletRouter} from '../server/casino/wallet.mjs';
import {saveManagerCasinoSettings} from '../server/casino/manager-settings.mjs';
const root=resolve('web'),sql=new PGlite();await sql.exec(LEDGER_SQL);
const actor={id:randomUUID(),username:'isolated-admin',role:'ADMIN'},agent=randomUUID(),manager=randomUUID();
await sql.query("insert into app_user(id,username,password_hash,role)values($1,'isolated-admin','test','ADMIN'),($2,'isolated-agent','test','AGENT'),($3,'isolated-manager','test','MANAGER')",[actor.id,agent,manager]);
await sql.query('update app_user set agent_id=$1 where id=$2',[agent,manager]);
let queue=Promise.resolve();const database={async connect(){let release;const previous=queue;queue=new Promise(resolve=>release=resolve);await previous;return{query:(...args)=>sql.query(...args),release};}};
const runQuery=async(...args)=>{const db=await database.connect();try{return await db.query(...args);}finally{db.release();}};
await saveManagerCasinoSettings({managerId:agent,gameId:'lucky-clover-x3',mode:'custom',rtp:40,hitFrequency:10},actor,database);
const fixture=`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from'react';import{createRoot}from'react-dom/client';import{LanguageProvider}from'/src/context/LanguageContext.tsx';import CasinoSettings from'/src/components/Admin/CasinoSettings.tsx';import'/src/index.css';
createRoot(document.getElementById('root')).render(React.createElement(LanguageProvider,null,React.createElement(CasinoSettings)));
</script></body></html>`;
let vite,server,browser;const errors=[],writes=[];
try{
 vite=await createServer({root,configFile:false,cacheDir:resolve('web/node_modules/.vite-manager-casino-test'),plugins:[react()],css:{postcss:{plugins:[tailwindcss({...tailwind,content:[root+'/src/**/*.{ts,tsx}']}),autoprefixer()]}},server:{middlewareMode:true,hmr:false,fs:{allow:[resolve('.')]}},appType:'custom'});
 const app=express();app.use(express.json());
 app.get('/app/api/admin/casino/finance',(_req,res)=>res.json({totals:{casinoStake:0,casinoPayout:0,casinoSpins:0}}));
 app.use('/app/api',(req,_res,next)=>{if(req.method==='PATCH')writes.push({...req.body});next();},createCasinoWalletRouter({database,runQuery,ready:()=>true,auth:(req,_res,next)=>{req.user={...actor,role:req.headers['x-test-role']||'ADMIN'};next();}}));
 app.get('/',async(_req,res)=>res.type('html').send(await vite.transformIndexHtml('/',fixture)));app.use(vite.middlewares);
 server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 browser=await puppeteer.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin)||r.url().startsWith('data:')?r.continue():r.abort());
 await page.evaluateOnNewDocument(()=>{localStorage.setItem('token','isolated-admin');localStorage.setItem('lang','al');});
 const scope='select[aria-label="Menaxheri ose agjenti i kazinosë"]',rtp='input[aria-label="Lucky Clover X3: RTP"]',hit='input[aria-label="Lucky Clover X3: Shpeshtësia e fitimit"]';
 const value=async(selector,text)=>page.$eval(selector,(el,v)=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));},text);
 const wait=async(selector,text)=>page.waitForFunction((s,v)=>document.querySelector(s)?.value===v,{},selector,text);
 await mkdir('test-artifacts/manager-casino',{recursive:true});
 for(const width of [1366,390]){
  await page.setViewport({width,height:900});await page.goto(origin,{waitUntil:'networkidle0',timeout:60000});
  await page.waitForFunction(s=>document.querySelector(s)?.options.length===3,{},scope);
  await page.select(scope,manager);await wait(rtp,'40');await wait(hit,'10');
  await page.select(scope,agent);await wait(rtp,'40');await value(rtp,'50');
  await page.click('article:has(input[aria-label="Lucky Clover X3: RTP"]) button');
  await page.waitForFunction(s=>!document.querySelector(s)?.disabled,{},scope);
  assert.equal(writes.at(-1).managerId,agent);assert.equal(writes.at(-1).rtp,50);
  await value('input[aria-label="Komisioni i kazinosë"]','12.5');
  const saveCommission=(await page.$$('button'))[1];assert.equal(await saveCommission.evaluate(b=>b.textContent),'Ruaj komisionin');await saveCommission.click();
  await page.waitForFunction(s=>!document.querySelector(s)?.disabled,{},scope);
  await page.select(scope,manager);await wait(rtp,'50');await wait('input[aria-label="Komisioni i kazinosë"]','12.5');
  await value(rtp,'96');await page.click('article:has(input[aria-label="Lucky Clover X3: RTP"]) button');
  await wait(rtp,'50');assert.equal((await runQuery('select game_controls from app_manager_casino_settings where manager_id=$1',[manager])).rows[0].game_controls['lucky-clover-x3'].rtp,96);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal page overflow');
  assert.equal(await page.$('[role="alert"]'),null);
  await page.screenshot({path:`test-artifacts/manager-casino/${width}.png`,fullPage:true});
  // Restore the agent for the next viewport; manager96 remains subordinate.
  await saveManagerCasinoSettings({managerId:agent,gameId:'lucky-clover-x3',mode:'custom',rtp:40,hitFrequency:10},actor,database);
  console.log(`PASS ${width}px: real SQL/API agent40 cascade, scoped save, agent priority over manager96, casino commission and layout`);
 }
 assert.deepEqual(errors,[]);
 const unauthorized=await fetch(origin+'/app/api/admin/casino/commission',{method:'PATCH',headers:{'content-type':'application/json','x-test-role':'PLAYER'},body:JSON.stringify({managerId:agent,commission:99})});assert.equal(unauthorized.status,403);
}finally{await browser?.close();await vite?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await sql.close();}
