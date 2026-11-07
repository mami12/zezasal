import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import puppeteer from 'puppeteer';

let mode='admin',loseResponse=false;const writes=[],receipts=new Map(),errors=[];
const finance={tickets:0,pendingTickets:0,playerBalance:150,houseGross:0,pendingStake:0};
const admin={id:'00000000-0000-4000-8000-000000000001',username:'admin.wallet',role:'ADMIN',status:'ACTIVE',balance:200,currency:'LEK'};
const player={...admin,id:'00000000-0000-4000-8000-000000000002',username:'player.wallet',role:'PLAYER',balance:150};
const account=u=>({...u,managerId:null,agentId:null,createdAt:'2026-10-20T12:00:00Z',manager:null,agent:null,financial:finance,canManage:mode==='admin'});
const app=express();app.use(express.json());
app.get('/app/api/auth/me',(_req,res)=>res.json({...admin,role:mode==='admin'?'ADMIN':'AGENT'}));
app.get('/app/api/:mode/directory',(_req,res)=>res.json({users:(mode==='admin'?[admin,player]:[player]).map(account),summary:finance,wallet:{balance:admin.balance},commissionRates:{single:3,double:5,multi:7,casino:0},asOf:new Date().toISOString()}));
app.post('/app/api/admin/directory/:id/funds',(req,res)=>{
 const {amount,direction,requestId}=req.body;writes.push({id:req.params.id,...req.body});
 if(receipts.has(requestId))return res.json(receipts.get(requestId));
 const user=[admin,player].find(u=>u.id===req.params.id);if(!user||direction!=='withdraw'||amount>user.balance)return res.status(400).json({message:'Balance does not suffice.'});
 user.balance=Number((user.balance-amount).toFixed(2));const response={success:true,balance:user.balance,referenceId:requestId};receipts.set(requestId,response);
 if(loseResponse){loseResponse=false;return res.status(503).json({message:'The response was interrupted. Retry the same request.'});}res.json(response);
});
const vite=await createServer({root:resolve('web'),configFile:false,cacheDir:resolve('tmp/vite-admin-withdraw'),plugins:[react()],optimizeDeps:{include:['react','react-dom/client','axios','lucide-react']},server:{middlewareMode:true,hmr:false,fs:{allow:[resolve('.'),resolve('node_modules')]}},appType:'custom'});
app.get('/withdraw-test',async(_req,res)=>res.type('html').send(await vite.transformIndexHtml('/withdraw-test',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;background:#0c1524"><div id="root"></div><script type="module">import React from 'react';import{createRoot}from 'react-dom/client';import{AuthProvider}from '/src/context/AuthContext.tsx';import{LanguageProvider}from '/src/context/LanguageContext.tsx';import UserDirectory from '/src/components/Admin/UserDirectory.tsx';createRoot(document.getElementById('root')).render(React.createElement(LanguageProvider,null,React.createElement(AuthProvider,null,React.createElement('main',{style:{padding:16}},React.createElement(UserDirectory,{mode:'${mode}'})))));</script></body></html>`)));
app.use(vite.middlewares);const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
const clickVisible=async(page,selector)=>{assert.ok(await page.evaluate(selector=>{const el=Array.from(document.querySelectorAll(selector)).find(e=>e.getClientRects().length>0);el?.click();return !!el;},selector),selector);};
try{
 browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 await page.evaluateOnNewDocument(()=>{localStorage.setItem('token','withdraw-fixture');localStorage.setItem('lang','en');});const origin=`http://127.0.0.1:${server.address().port}`;
 for(const width of [1366,390,320]){
  mode='admin';admin.balance=200;player.balance=150;receipts.clear();writes.length=0;
  await page.setViewport({width,height:800,isMobile:width<700,hasTouch:width<700});await page.goto(origin+'/withdraw-test',{waitUntil:'domcontentloaded'});await page.waitForSelector('.ud-own-wallet');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`no overflow at ${width}`);
  await clickVisible(page,'button[aria-label="Withdraw funds player.wallet"]');await page.waitForSelector('.ud-form');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.ok((await page.$eval('[role="dialog"]',e=>e.textContent)).includes('player.wallet'));
  await page.type('.ud-form input[type="number"]','25');loseResponse=true;await clickVisible(page,'.ud-dialog-footer button[type="submit"]');await page.waitForSelector('.ud-form [role="alert"]');
  assert.equal(player.balance,125,'request committed before lost response');await clickVisible(page,'.ud-dialog-footer button[type="submit"]');await page.waitForFunction(()=>!document.querySelector('.ud-form'));
  assert.equal(player.balance,125,'safe retry does not withdraw twice');assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);
  await clickVisible(page,'button[aria-label="Withdraw from my wallet"]');await page.waitForSelector('.ud-form');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.type('.ud-form input[type="number"]','20');
  assert.ok((await page.$eval('.ud-transfer-preview',e=>e.textContent)).includes('180.00'));
  const dialogBounds=await page.$eval('[role="dialog"]',e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,scroll:e.scrollWidth,client:e.clientWidth}));assert.ok(dialogBounds.width<=width&&dialogBounds.height<=800&&dialogBounds.scroll<=dialogBounds.client+1);
  await clickVisible(page,'.ud-dialog-footer button[type="submit"]');await page.waitForFunction(()=>!document.querySelector('.ud-form'));assert.equal(admin.balance,180);
  await page.waitForFunction(()=>document.querySelector('.ud-own-wallet').textContent.includes('180.00'));
  mode='agent';await page.goto(origin+'/withdraw-test',{waitUntil:'domcontentloaded'});await page.waitForSelector('.ud-user-link');assert.equal(await page.$('.ud-own-wallet'),null);assert.equal(await page.$('button[aria-label="Withdraw funds player.wallet"]'),null,'agent cannot withdraw a read-only player');
  console.log(`PASS ${width}px: user/own withdrawals, lost-response retry, live wallet refresh and agent visibility`);
 }
 assert.deepEqual(errors,[]);
}finally{await browser?.close();await vite.close();server.closeAllConnections?.();await new Promise(r=>server.close(r));}
