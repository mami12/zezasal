/** Real React/socket stat display, isolated loopback fixtures only. */
import assert from 'node:assert/strict';
import http from 'node:http';
import {resolve} from 'node:path';
import express from 'express';
import puppeteer from 'puppeteer';
import {Server} from 'socket.io';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import tailwind from '../web/tailwind.config.js';
const root=resolve('web'),app=express(),errors=[];
const html=`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module">
import React from'react';import{createRoot}from'react-dom/client';import{LanguageProvider}from'/src/context/LanguageContext.tsx';import{LiveFeedProvider,useLiveFeed}from'/src/api/liveFeed.tsx';import PitchTracker from'/src/components/Tracker/PitchTracker.tsx';import ShotsOnTargetComparison from'/src/components/Tracker/ShotsOnTargetComparison.tsx';import'/src/index.css';
function View(){const feed=useLiveFeed();window.fixtureFeed=feed;const intervals=[['1–15',1,0],['16–30',0,0],['31–45+',0,1],['46–60',0,0],['61–75',1,0],['76–90+',0,0]].map(([label,home,away])=>({label,from:1,to:15,home,away}));return React.createElement(React.Fragment,null,React.createElement(PitchTracker,{matchId:'A',homeTeam:'Home',awayTeam:'Away'}),React.createElement(ShotsOnTargetComparison,{values:{home:4,away:2},fouls:{home:7,away:11},intervals,homeTeam:'Home',awayTeam:'Away'}));}
createRoot(document.getElementById('root')).render(React.createElement(LanguageProvider,null,React.createElement(LiveFeedProvider,null,React.createElement(View))));
</script></body></html>`;
let vite,server,browser,io;
try{
 vite=await createServer({root,configFile:false,cacheDir:resolve('tmp/vite-statistics'),plugins:[react()],css:{postcss:{plugins:[tailwindcss({...tailwind,content:[root+'/src/**/*.{ts,tsx}']})]}},optimizeDeps:{include:['react','react-dom/client','axios','lucide-react','socket.io-client']},server:{middlewareMode:true,hmr:false,fs:{allow:[resolve('.'),resolve('node_modules')]}},appType:'custom'});
 app.get('/',async(_q,r)=>r.type('html').send(await vite.transformIndexHtml('/',html)));app.use(vite.middlewares);
 server=http.createServer(app);io=new Server(server,{serveClient:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.evaluateOnNewDocument(()=>localStorage.setItem('lang','al'));
 await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.fixtureFeed?.connected===true);
 assert.equal(await page.$('.zshop-tracker'),null,'unknown live counters do not fabricate values');
 assert.equal(await page.$$eval('[data-stat="goal-intervals"] .zs-interval-cell',els=>els.length),6,'match details render the six 15-minute bins');
 assert.ok((await page.$eval('[data-stat="fouls"]',el=>el.textContent)).includes('7')&&(await page.$eval('[data-stat="fouls"]',el=>el.textContent)).includes('11'));
 assert.ok((await page.$eval('[data-stat="goal-intervals"]',el=>el.textContent)).includes('31–45+'));
 const emit=stats=>io.emit('match:info',{match_id:'A',stats,at:new Date().toISOString()});
 emit({home:{shotsOnTarget:0,fouls:2},away:{shotsOnTarget:1,fouls:3}});
 await page.waitForFunction(()=>document.body.textContent.includes('Goditje në portë')&&document.body.textContent.includes('Faulle'));
 assert.deepEqual(await page.$$eval('.zshop-tracker-stat strong',els=>els.map(el=>el.textContent)),['0 - 1','2 - 3']);
 for(const width of [1366,390,320]){await page.setViewport({width,height:800});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'responsive stat row');}
 emit({home:{yellow:1,red:0},away:{yellow:0,red:0}});
 await page.waitForFunction(()=>window.fixtureFeed.livePatches.A?.cards?.home===1);
 assert.ok((await page.$$eval('.zshop-tracker-stat strong',els=>els.map(el=>el.textContent))).includes('1 - 0'));
 assert.ok((await page.$eval('.zshop-tracker',el=>el.textContent)).includes('Goditjet në portë'),'unrelated card update preserves shot facts');
 emit({home:{shotsOnTarget:3},away:{shotsOnTarget:4}});
 await page.waitForFunction(()=>document.body.textContent.includes('3 - 4'));
 assert.ok((await page.$eval('.zshop-tracker',el=>el.textContent)).includes('2 - 3'),'unrelated shot update preserves foul facts');
 assert.deepEqual(errors,[]);
 console.log('PASS actual socket statistics UI: missing vs real zero, SOT/foul values, partial unrelated updates, responsive1366/390/320 and no runtime errors');
}finally{await browser?.close();io?.close();await vite?.close();if(server){server.closeAllConnections?.();await new Promise(r=>server.close(r));}}
