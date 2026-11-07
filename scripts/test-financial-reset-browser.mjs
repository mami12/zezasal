/** Browser clicks are routed to loopback mock endpoints, never a real database. */
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
const app=express();app.use(express.json());let zeroed=false;const posts=[],errors=[];
app.get('/app/api/auth/me',(_req,res)=>res.json({id:'00000000-0000-4000-8000-000000000001',username:'test-admin',role:'ADMIN',status:'ACTIVE',balance:zeroed?0:500,currency:'LEK'}));
app.get('/app/api/admin/financial-reset/preview',(_req,res)=>res.json({counts:{app_ticket:zeroed?0:12,app_transaction:zeroed?0:30},accounts:4,accountsWithBalance:zeroed?0:4,totalBalance:zeroed?0:1250}));
app.post('/app/api/admin/financial-reset',(req,res)=>{posts.push(req.body);if(req.body.code!=='1122')return res.status(403).json({message:'Wrong test PIN'});zeroed=true;res.json({resetId:'test-only-reset',backupFile:'test-only-backups/example.tgz',token:'new-test-token',requiresLogin:true});});
const root=resolve('web');const vite=await createServer({root,configFile:false,cacheDir:resolve('tmp/vite-reset-browser'),plugins:[react()],css:{postcss:{plugins:[tailwindcss({...tailwind,content:[root+'/src/**/*.{ts,tsx}']}),autoprefixer()]}},optimizeDeps:{include:['react','react-dom/client','react-router-dom','axios','lucide-react']},server:{middlewareMode:true,hmr:false,fs:{allow:[resolve('.'),resolve('node_modules')]}},appType:'custom'});
app.get('/',async(_req,res)=>res.type('html').send(await vite.transformIndexHtml('/',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;background:#0b1424"><div id="root"></div><script type="module">import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{AuthProvider}from'/src/context/AuthContext.tsx';import{LanguageProvider}from'/src/context/LanguageContext.tsx';import FinancialReset from'/src/components/Admin/FinancialReset.tsx';import'/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,React.createElement(LanguageProvider,null,React.createElement(AuthProvider,null,React.createElement(FinancialReset)))));</script></body></html>`)));
app.use(vite.middlewares);const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.evaluateOnNewDocument(()=>{localStorage.setItem('token','test-only-token');localStorage.setItem('lang','en');});const origin=`http://127.0.0.1:${server.address().port}`;
 await mkdir('test-artifacts/reset',{recursive:true});
 for(const width of [1366,390,320]){
   await page.setViewport({width,height:900,isMobile:width<768,hasTouch:width<768});await page.goto(origin,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>document.querySelector('[data-financial-reset] button:not(:disabled)'));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.click('[data-financial-reset] button');await page.waitForSelector('[role="dialog"]');
   assert.equal(posts.length,0);assert.equal(await page.$eval('button[type="submit"]',b=>b.disabled),true);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
   await page.click('[data-financial-reset] button');await page.type('input[type="password"]','9999');await page.type('[role="dialog"] input:not([type="password"])','RESET');
   await page.screenshot({path:`test-artifacts/reset/confirm-${width}.png`});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   if(width!==320){await page.keyboard.press('Escape');continue;}
   await page.click('button[type="submit"]');await page.waitForSelector('[role="alert"]');assert.equal(posts.length,1);assert.equal(zeroed,false);
   await page.click('input[type="password"]');await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.type('input[type="password"]','1122');await page.click('button[type="submit"]');await page.waitForSelector('[role="status"]');
   assert.equal(posts.length,2);assert.equal(posts[0].requestId,posts[1].requestId);assert.equal(await page.evaluate(()=>localStorage.getItem('token')),'new-test-token');assert.ok(!await page.$('[role="dialog"]'));assert.ok(await page.$eval('[data-financial-reset]',node=>node.innerText.includes('Reset completed successfully.')));
   console.log('PASS reset UI 320px: explicit PIN/RESET, wrong PIN retained, same request retry, success/backup shown, renewed administrator session');
 }
 assert.deepEqual(errors,[]);console.log('PASS reset UI desktop/390/320px: modal focus/Escape, responsive preview and confirmation; mock endpoints only');
}finally{await browser?.close();await vite.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
