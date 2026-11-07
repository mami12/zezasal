/** Real page rendering with fake accounts and read-only ticket fixtures. */
import assert from 'node:assert/strict';
import express from 'express';
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const web=fileURLToPath(new URL('../web/',import.meta.url));
const artifacts=fileURLToPath(new URL('../test-artifacts/ticket-payout-presentation/',import.meta.url));
const placedAt='2026-11-05T10:00:00Z';
const base={userId:'fixture-user',user:{username:'Fixture'},bookingCode:null,ticketType:'SINGLE',stake:1000,totalOdds:5,
 potentialPayout:5000,actualPayout:0,status:'LOST',placedAt,settledAt:placedAt,lines:[]};
const tickets=[{...base,id:'00000001-0000-4000-8000-000000000001'},
 {...base,id:'00000002-0000-4000-8000-000000000002',potentialPayoutIsEstimated:true}];
const columns=[{...base,id:'column-won',stake:500,totalOdds:4,potentialPayout:2000,actualPayout:2000,status:'WON'},
 {...base,id:'column-lost',stake:500,totalOdds:6,potentialPayout:3000,actualPayout:0}];
tickets.push({...base,id:'SYS-00000003-0000-4000-8000-000000000003',ticketType:'SYSTEM',status:'WON',actualPayout:2000,totalOdds:0,
 system:{batchId:'fixture-batch',columns,columnCount:2,minColumnPayout:2000,maxColumnPayout:3000,paidOut:2000,refunded:0,pendingColumns:0}});
let mode='bets',browser,http;const errors=[],writes=[];
const source=`import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';
import{AuthProvider,useAuth}from'./src/context/AuthContext';import{LanguageProvider}from'./src/context/LanguageContext';
import MyBets from'./src/pages/MyBetsPage';import History from'./src/pages/TransactionHistoryPage';import Manager from'./src/pages/ManagerPage';
const mode=new URLSearchParams(location.search).get('mode');const Page=mode==='manager'?Manager:mode==='history'?History:MyBets;
function Probe(){window.fixtureAuth=useAuth();return null;}
createRoot(document.getElementById('root')).render(<BrowserRouter><LanguageProvider><AuthProvider><Probe/><Page/></AuthProvider></LanguageProvider></BrowserRouter>);`;
const bundle=await build({stdin:{contents:source,loader:'tsx',resolveDir:web},write:false,bundle:true,format:'esm',platform:'browser',jsx:'automatic',
 define:{'process.env.NODE_ENV':'"production"','import.meta.env':JSON.stringify({BASE_URL:'/app/'})},logLevel:'silent'});
const cssName=(await readdir(web+'dist/assets')).find(name=>/^index-.*\.css$/.test(name));
const css=await readFile(web+'dist/assets/'+cssName,'utf8');
const app=express();
app.get('/fixture.js',(_q,r)=>r.type('js').send(bundle.outputFiles[0].text));
app.get('/fixture.css',(_q,r)=>r.type('css').send(css));
app.get('/fixture',(_q,r)=>r.type('html').send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script>'));
app.get('/app/api/auth/me',(_q,r)=>r.json({id:'fixture-user',username:'Fixture',role:mode==='manager'?'MANAGER':'PLAYER',balance:1000,status:'ACTIVE'}));
app.get(['/app/api/bets/history','/app/api/manager/tickets'],(_q,r)=>r.json(tickets));
app.get('/app/api/me/bets',(_q,r)=>r.json(tickets.map(ticket=>({...ticket,kind:'TICKET'}))));
app.get('/app/api/manager/stats',(_q,r)=>r.json({financials:null}));
app.get('/app/api/me/transactions/summary',(_q,r)=>r.json({winnings:0,losses:0,net:0}));
app.get('/app/api/{*rest}',(_q,r)=>r.json([]));
app.use('/app/api',(q,r)=>{writes.push(q.method+' '+q.path);r.sendStatus(405);});
try{
 await mkdir(artifacts,{recursive:true});http=app.listen(0,'127.0.0.1');await new Promise(r=>http.once('listening',r));
 browser=await puppeteer.launch({headless:true});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.evaluateOnNewDocument(()=>{localStorage.setItem('token','isolated-fixture');localStorage.setItem('lang','al');});
 for(mode of ['bets','history','manager'])for(const width of [1366,390,320]){
  await page.setViewport({width,height:900});await page.goto('http://127.0.0.1:'+http.address().port+'/fixture?mode='+mode);
  await page.waitForFunction(()=>window.fixtureAuth?.user?.id==='fixture-user');
  if(mode==='bets')await page.click('.flex.gap-px.mb-4 > button:nth-child(2)');
  if(mode==='manager')await page.click('.mx-auto.max-w-7xl.flex.gap-2 > button:nth-child(2)');
  if(mode==='history'){
   await page.waitForSelector('details');await page.$$eval('details',items=>items.forEach(item=>item.open=true));
  }
  await page.waitForFunction(()=>document.body.innerText.includes('Vlerë e rindërtuar nga shuma dhe koeficienti i ruajtur.'));
  const text=await page.$eval('body',e=>e.innerText);
  assert.match(text,/Fitimi i mundshëm/);assert.match(text,/i rindërtuar/);assert.match(text,/5000\.00/);
  assert.match(text,/Fitimi real: 0\.00/,'a losing ticket retains5000potential and separately showszeroactual');
  assert.match(text,/Fitimi real: 2000\.00/,'a settled system ticket shows its2000actual separately from its5000original quote');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),mode+' has no horizontal overflow at'+width);
  await page.screenshot({path:artifacts+mode+'-'+width+'.png',fullPage:true});
  console.log('PASS '+mode+' '+width+': original potential, estimated legacy label, zero actual payout, no overflow');
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[],'rendering never writes to a wallet or changes tickets');
}finally{if(browser)await browser.close();if(http){http.closeAllConnections();await new Promise(r=>http.close(r));}}
