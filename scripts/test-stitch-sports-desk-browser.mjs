import assert from 'node:assert/strict';
import express from 'express';
import puppeteer from 'puppeteer';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';

const overview={
 database:'ready',accounts:{player:12,manager:2,agent:1,admin:1},
 tickets:{total:15,pending:3,won:4,lost:7,void:1,openStake:30,settledStake:110,paidOut:90,netBeforeCommission:20},
 matches:{live:4,prematch:8},transactions:{sport:19,total:23},
};
const items=[{
 lineId:'line-a',ticketId:'ticket-a',matchId:'100',matchName:'Arsenal – Chelsea',marketName:'Next Corner',
 marketKey:'next-corner',marketLine:'',outcomeName:'Arsenal',lineStatus:'PENDING',ticketStatus:'PENDING',
 notificationActive:true,noticeExpiresAt:'2026-11-06T20:00:00Z',reason:'MISSING_EVENT_TIMELINE',
},{lineId:'line-b',matchName:'Ndeshje tjetër',notificationActive:false}];
const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><div id="root"></div><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import Desk from '/src/components/Admin/StitchSportsDesk.tsx';
import '/src/index.css';
const sections=[{id:'users',title:'Përdoruesit',panel:()=>React.createElement('h2',null,'Paneli i përdoruesve')}];
createRoot(document.getElementById('root')).render(React.createElement(Desk,{sections}));
</script></body></html>`;

let vite,server,browser;
try{
 vite=await createServer({root:resolve('web'),configFile:false,plugins:[react()],server:{middlewareMode:true,hmr:false},appType:'custom'});
 const app=express(), decisions=[], pauses=[];
 let marketStatus='ACTIVE';
 app.use(express.json());
 app.post('/app/api/admin/manual-settlement',(req,res)=>{decisions.push(req.body);res.json({changed:[req.body.lineId]});});
 app.get('/app/api/admin/matches/100',(_req,res)=>res.json({item:{id:'100',markets:[{id:'100|next-corner|',status:marketStatus}]}}));
 app.patch('/app/api/admin/markets/:id/suspend',(req,res)=>{pauses.push([req.params.id,req.body]);marketStatus='SUSPENDED';res.json({suspended:true});});
 app.get('/app/api/admin/live-event-test',(_req,res)=>res.json({previews:[{
  line_id:'line-a',match_name:'Arsenal – Chelsea',market_name:'Gol në interval',outcome_name:'Po',
  proposed_status:'WON',timelineCheck:'AGREES',
  payload:{contract:{kind:'window',event:'goal',from:35,to:40},frame:{source:'fixture',events:[{id:'goal',type:'goal',minute:36,team:'home'}]}},
 }]}));
 app.get('/app/api/admin/stitch-overview',(_req,res)=>res.json(overview));
 app.get('/app/api/admin/settlement-review-queue',(_req,res)=>res.json({items}));
 app.get('/',async(_req,res)=>res.type('html').send(await vite.transformIndexHtml('/',html)));
 app.use(vite.middlewares);
 server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
 await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.textContent.includes('12 lojtarë')&&document.body.textContent.includes('Next Corner'));
 assert.equal(await page.$eval('.stitch-mascot',node=>getComputedStyle(node).animationName),'stitch-tilt');
 assert.equal(await page.$eval('.stitch-eyes',node=>getComputedStyle(node).animationName),'stitch-blink');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.stitch-mascot')).animationName==='none');
 await page.waitForFunction(()=>document.body.textContent.includes('35 deri në 40')&&document.body.textContent.includes('Gol, minuta 36')&&document.body.textContent.includes('Më doli i njëjti rezultat.'));
 const clickText=text=>page.evaluate(label=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===label).click(),text);
 await clickText('Pezullo këtë treg');
 await clickText('Jo, lëre tregun');
 assert.deepEqual(pauses,[]);
 await clickText('Pezullo këtë treg');
 await clickText('Po, pezullo tregun');
 await page.waitForFunction(()=>document.body.textContent.includes('Tregu u pezullua për baste të reja'));
 assert.deepEqual(pauses,[['100|next-corner|',{status:'SUSPENDED'}]]);
 await clickText('Pezullo këtë treg');
 await clickText('Po, pezullo tregun');
 await page.waitForFunction(()=>document.body.textContent.includes('Gjendja ka ndryshuar'));
 assert.equal(pauses.length,1,'already suspended market must not write again');
 await page.waitForFunction(()=>document.querySelector('select')&&document.body.textContent.includes('ticket-a'));
 assert.equal(await page.evaluate(()=>document.body.textContent.includes('Ndeshje tjetër')),false);
 await page.select('select','WON');
 await page.type('input[placeholder="Arsyeja e kontrolluar"]','Korneri u konfirmua');
 await page.type('input[placeholder="API / raport zyrtar / verifikim"]','Feed testimi');
 await clickText('Ruaj vendimin');
 await page.waitForSelector('[aria-label="Miratimi i vendimit"]');
 await clickText('Jo, kthehu');
 assert.deepEqual(decisions,[]);
 await clickText('Ruaj vendimin');
 await clickText('Po, mirato');
 await page.waitForFunction(()=>document.body.textContent.includes('Vendimi u regjistrua'));
 assert.deepEqual(decisions,[{lineId:'line-a',status:'WON',reason:'Korneri u konfirmua',source:'Feed testimi'}]);
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(node=>node.textContent==='Përdoruesit').click());
 await page.waitForFunction(()=>document.body.textContent.includes('Paneli i përdoruesve')&&!document.querySelector('select'));
 assert.deepEqual(errors,[]);
 console.log('PASS Stitch mobile: sports summary, animated and reduced-motion states, exact review and section actions');
}finally{
 await browser?.close();
 await vite?.close();
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
