import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import puppeteer from 'puppeteer';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import tailwind from '../web/tailwind.config.js';
const app=express();app.use(express.json());let mode='admin';const writes=[],errors=[],removals=[],deleted=new Set();
const finance={turnover:24500,settledStake:20000,pendingStake:4500,pendingExposure:9800,payout:15200,tickets:47,pendingTickets:6,casinoStake:8200,casinoPayout:7000,commission:1200,sportCommission:950,casinoCommission:250,playerBalance:4300,managerBalance:2300,players:18,managers:2,sportGross:4800,casinoGross:1200,houseGross:6000,houseWithCommission:4800,managerNet:4800};
const actor={id:'00000000-0000-4000-8000-000000000001',username:'administrator',role:'ADMIN',status:'ACTIVE',balance:12000,currency:'LEK'};
const accounts=Array.from({length:27},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+100).padStart(12,'0')}`,username:i===0?'manager.albania':i===1?'agent.network':`player.${String(i).padStart(2,'0')}`,role:i===0?'MANAGER':i===1?'AGENT':'PLAYER',status:i%6===0?'FROZEN':'ACTIVE',balance:2123.45+i,managerId:i>1?'00000000-0000-4000-8000-000000000100':null,agentId:i===0?'00000000-0000-4000-8000-000000000101':null,createdAt:'2026-10-20T12:30:00Z',manager:i>1?{username:'manager.albania'}:null,agent:i===0?{username:'agent.network'}:null,financial:finance,canManage:true}));
app.get('/app/api/auth/me',(_req,res)=>res.json({...actor,role:mode==='agent'?'AGENT':'ADMIN'}));
app.get('/app/api/:mode/directory',(_req,res)=>res.json({users:accounts.filter(a=>!deleted.has(a.id)&&(mode!=='agent'||a.role!=='AGENT')).map(a=>({...a,canManage:mode==='admin'||a.role==='MANAGER'})),summary:finance,wallet:{balance:12000},commissionRates:{single:3,double:5,multi:7,casino:2},asOf:'2026-10-26T12:30:00Z'}));
app.delete('/app/api/admin/users/:id',(req,res)=>{removals.push(req.params.id);deleted.add(req.params.id);res.json({id:req.params.id});});
app.get('/app/api/:mode/directory/:id',(req,res)=>{const account=accounts.find(a=>a.id===req.params.id);res.json({user:{...account,canManage:mode==='admin'||account?.role==='MANAGER'},children:accounts.filter(a=>a.managerId===account?.id),transactions:[{id:'tx1',type:'AGENT_MANAGER_FUNDING',amount:-100,balanceAfter:900,description:'Transferim agjent / menaxher',createdAt:'2026-10-26T10:00:00Z'}],tickets:[{id:'ticket-id',bookingCode:'ABC123',username:'player.02',stake:100,potentialPayout:250,status:'PENDING',placedAt:'2026-10-26T10:00:00Z'}]});});
app.post('/app/api/:mode/directory',(req,res)=>{writes.push(req.body);res.json({id:'new-account',...req.body});});
const vite=await createServer({root:resolve('web'),configFile:false,cacheDir:resolve('tmp/vite-directory'),plugins:[react()],css:{postcss:{plugins:[tailwindcss({...tailwind,content:[resolve('web/src/**/*.{ts,tsx}')]}),autoprefixer()]}},optimizeDeps:{include:['react','react-dom/client','axios','lucide-react']},server:{middlewareMode:true,hmr:false,fs:{allow:[resolve('.'),resolve('node_modules')]}},appType:'custom'});
app.get('/directory-test',async(_req,res)=>res.type('html').send(await vite.transformIndexHtml('/directory-test?mode='+mode,`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;background:#0c1524"><div id="root"></div><script type="module">import React from 'react';import{createRoot}from 'react-dom/client';import{AuthProvider}from '/src/context/AuthContext.tsx';import{LanguageProvider}from '/src/context/LanguageContext.tsx';import UserDirectory from '/src/components/Admin/UserDirectory.tsx';import '/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(LanguageProvider,null,React.createElement(AuthProvider,null,React.createElement('main',{style:{padding:'16px',maxWidth:'1400px',margin:'auto'}},React.createElement(UserDirectory,{mode:'${mode}'})))));</script></body></html>`)));
app.get(['/','/admin','/agent','/casino'],async(_req,res)=>res.type('html').send(await vite.transformIndexHtml('/',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module">import React from 'react';import{createRoot}from 'react-dom/client';import App from '/src/App.tsx';import '/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(App));</script></body></html>`)));
app.use(vite.middlewares);const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
const click=async(page,selector,text)=>{const found=await page.evaluate(({selector,text})=>{const button=Array.from(document.querySelectorAll(selector)).find(b=>b.getBoundingClientRect().height>0&&b.textContent.trim()===text);button?.click();return !!button;},{selector,text});assert.ok(found,`button ${text}`);};
try{
 browser=await puppeteer.launch({headless:true});const page=await browser.newPage();page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.type());await dialog.dismiss();});page.setDefaultTimeout(30000);await page.evaluateOnNewDocument(()=>{localStorage.setItem('token','directory-fixture');localStorage.setItem('lang','en');});
 const origin=`http://127.0.0.1:${server.address().port}`;await mkdir('test-artifacts/user-directory',{recursive:true});
 for(mode of ['admin','agent'])for(const width of [1440,1024,768,390,320]){
   await page.setViewport({width,height:900,isMobile:width<768,hasTouch:width<768});await page.goto(origin+'/directory-test?mode='+mode,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForSelector('.ud-user-link');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${mode} ${width}px overview overflow`);
   const username=mode==='admin'?'agent.network':'manager.albania';await click(page,'.ud-user-link',username+(mode==='admin'?'20/10/2026':'20/10/2026')).catch(async()=>{await page.evaluate(name=>{const b=Array.from(document.querySelectorAll('.ud-user-link')).find(b=>b.getBoundingClientRect().height&&b.textContent.includes(name));b.click();},username);});
   await page.waitForSelector('.ud-detail-tabs');await page.screenshot({path:`test-artifacts/user-directory/${mode}-${width}-profile.png`,fullPage:true});
   assert.ok(await page.evaluate(()=>document.querySelector('[role="dialog"]').scrollWidth<=document.querySelector('[role="dialog"]').clientWidth+1),`${mode} ${width}px dialog overflow`);
   for(const text of ['Network','Transactions','Tickets','Overview'])await click(page,'.ud-detail-tabs button',text);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
   await click(page,'.ud-heading button',mode==='admin'?'Create user':'Create manager');await page.waitForSelector('.ud-form');
   // Let the dialog's scheduled accessibility focus finish before synthetic
   // keystrokes; otherwise it can move focus mid-type and fail native minLength.
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const expectedName=mode==='admin'?'new.agent':'new.manager';
   await page.type('.ud-form input[autocomplete="off"]',expectedName);await page.type('.ud-form input[type="password"]','abc123');
   assert.equal(await page.$eval('.ud-form input[autocomplete="off"]',input=>input.value),expectedName,'complete username entered after dialog focus');
   assert.equal(await page.$eval('.ud-form input[type="password"]',input=>input.value),'abc123');
   if(mode==='admin')await page.select('.ud-form select','AGENT');
   assert.deepEqual(await page.$$eval('.ud-form input,.ud-form select',inputs=>inputs.filter(input=>!input.validity.valid).map(input=>({name:input.type,value:input.value,message:input.validationMessage}))),[],'fixture form passes native validation');
   if(width===320){await click(page,'.ud-dialog-footer button','Confirm & save');await page.waitForFunction(()=>!document.querySelector('.ud-form'));assert.equal(writes.at(-1).role,mode==='admin'?'AGENT':'MANAGER');}
   else{await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.ud-form'));}
   await page.screenshot({path:`test-artifacts/user-directory/${mode}-${width}-list.png`,fullPage:true});
   if(mode==='agent'){
     await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('.ud-user-link')).find(b=>b.getBoundingClientRect().height&&b.textContent.includes('player.02'));b.click();});await page.waitForSelector('.ud-read-only');assert.equal(await page.$('.ud-profile-actions .ud-primary'),null);await page.keyboard.press('Escape');
   }
   console.log(`PASS ${mode} ${width}px: list/profile/forms, navigation, no overflow, role-aware actions`);
 }
 mode='admin';await page.goto(origin+'/directory-test?mode=admin',{waitUntil:'domcontentloaded',timeout:60000});await page.waitForSelector('.ud-user-link');
 await page.evaluate(()=>[...document.querySelectorAll('.ud-user-link')].find(button=>button.getBoundingClientRect().height&&button.textContent.includes('player.02')).click());
 await page.waitForSelector('.ud-delete-link');assert.equal(await page.$('.ud-form'),null,'profile opens without a confirmation form');
 await page.click('.ud-delete-link');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
 await page.waitForFunction(()=>!document.querySelector('.ud-table-wrap').innerText.includes('player.02'));
 assert.equal(removals.length,1,'one delete-button click submits exactly one deletion');assert.deepEqual(dialogs,[],'no browser confirm or prompt is shown');
 assert.equal(deleted.size,1);assert.ok(accounts.some(account=>account.username==='player.02'),'fixture keeps the account history after active-list removal');
 console.log('PASS admin one-click removal: no typed confirmation, no extra dialog, one request and immediate active-list removal');
 mode='agent';await page.goto(origin+'/admin',{waitUntil:'domcontentloaded',timeout:60000});await page.waitForSelector('[data-directory-mode="agent"]');assert.equal(new URL(page.url()).pathname,'/agent');
 await page.goto(origin+'/casino',{waitUntil:'domcontentloaded',timeout:60000});await page.waitForSelector('[data-directory-mode="agent"]');assert.equal(new URL(page.url()).pathname,'/agent');
 console.log('PASS actual App: AGENT login routes to own panel; direct admin/casino navigation redirects to agent panel');
 assert.deepEqual(errors,[]);assert.equal(writes.length,2);
}finally{await browser?.close();await vite.close();server.closeAllConnections();await new Promise(r=>server.close(r));}



