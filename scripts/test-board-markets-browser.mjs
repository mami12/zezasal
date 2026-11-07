import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import express from 'express';
import http from 'node:http';
import {Server} from 'socket.io';
import puppeteer from 'puppeteer';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const repository=fileURLToPath(new URL('../',import.meta.url));
const root=process.env.FAQJA_FRONTEND_ROOT || path.join(repository,'web');
const tailwind=(await import(pathToFileURL(path.join(root,'tailwind.config.js')).href)).default;
const market=(id,type,name,line,names,status='ACTIVE')=>({id,marketType:type,name,line,status,outcomes:names.map((name,i)=>({id:`${id}|${i}`,marketId:id,name,code:name,odds:2+i/10,status}))});
const result=id=>market(`${id}|result|`,'1X2','Full Time Result','',['1','X','2']);
const total=(id,line,status='ACTIVE')=>market(`${id}|total|${line}`,'OVER_UNDER','Total Goals',String(line),['Over','Under'],status);
const dc=id=>market(`${id}|dc|`,'DOUBLE_CHANCE','Double Chance','',['1X','12','X2']);
const btts=id=>market(`${id}|btts|`,'BTTS','Both Teams to Score','',['Yes','No']);
const cases=[
 {id:'108',markets:[],type:'NONE',line:null,future:true},
 {id:'101',markets:[result('101'),total('101',3.5),total('101',4.5)],type:'1X2',line:'3.5'},
 {id:'102',markets:[dc('102'),total('102',4.5)],type:'DC',line:'4.5'},
 {id:'103',markets:[btts('103')],type:'BTTS',line:null},
 {id:'104',markets:[{...result('104'),status:'SUSPENDED',outcomes:result('104').outcomes.map(o=>({...o,status:'SUSPENDED'}))},dc('104'),total('104',2.5,'SUSPENDED'),total('104',3.5)],type:'1X2',line:'2.5',locked:true},
 {id:'105',markets:[result('105'),total('105',2.5,'SUSPENDED'),total('105',5.5)],type:'1X2',line:'5.5',live:true},
 {id:'106',markets:[{...result('106'),name:'Total Corners 1X2'},dc('106')],type:'DC',line:null},
 {id:'107',markets:[{...dc('107'),status:'CLOSED'},btts('107')],type:'BTTS',line:null},
];
const matches=cases.map((c,i)=>({...c,tournamentId:1,homeTeam:`Home ${c.id}`,awayTeam:`Away ${c.id}`,status:c.live?'LIVE':'PREMATCH',homeScore:c.live?4:0,awayScore:0,currentMinute:c.live?64:undefined,period:c.live?'2H':undefined,startTime:new Date(Date.now()+(c.future?7*86400000:3600000)).toISOString(),snapshotAt:new Date().toISOString(),scoreAt:new Date().toISOString(),displayOrder:i,competitionOrder:1,marketCount:c.markets.length,tournament:{id:1,name:'Premier League',category:{id:1,name:'England',sport:{id:18,name:'Football'}}}}));
const extraTheme=fs.existsSync(path.join(root,'src/vave-theme.css'))?"import '/src/vave-theme.css';":'';
const fixture=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module">
import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';
import{LanguageProvider}from'/src/context/LanguageContext.tsx';import{AuthProvider}from'/src/context/AuthContext.tsx';import{BetslipProvider,useBetslip}from'/src/context/BetslipContext.tsx';import{FavoritesProvider}from'/src/context/FavoritesContext.tsx';import{LiveFeedProvider}from'/src/api/liveFeed.tsx';import MatchList from'/src/components/Sports/MatchList.tsx';import Header from'/src/components/Layout/Header.tsx';import'/src/index.css';import'/src/styles/zshop.css';import'/src/styles/ecco-sports.css';${extraTheme}
const e=React.createElement;function Probe(){window.slip=useBetslip();return null}function Board(){return e('div',{className:'zshop-shell'},e(Header),e(Probe),e(MatchList,{viewMode:'all',searchTerm:'',onSearchChange:()=>{},onViewModeChange:()=>{}}))}
createRoot(document.getElementById('root')).render(e(MemoryRouter,null,e(LanguageProvider,null,e(AuthProvider,null,e(FavoritesProvider,null,e(BetslipProvider,null,e(LiveFeedProvider,null,e(Board))))))));
</script></body></html>`;
let vite,server,socket,browser;const errors=[],writes=[];
try{
 vite=await createServer({root,configFile:false,cacheDir:path.join(root,'node_modules/.vite-board-fallback'),plugins:[react()],css:{postcss:{plugins:[tailwindcss({...tailwind,content:[`${root}/src/**/*.{js,ts,jsx,tsx}`]}),autoprefixer()]}},optimizeDeps:{include:['react','react-dom/client','react-router-dom','axios','lucide-react','socket.io-client']},server:{middlewareMode:true,hmr:false,fs:{allow:[repository,path.resolve(root,'..')]}},appType:'custom'});
 const app=express();app.use('/app/api',(req,res)=>{if(req.method!=='GET'){writes.push(req.originalUrl);return res.status(400).json({error:'Fixture does not place bets'})}if(req.path==='/auth/me')return res.json({id:'board-fixture',username:'Preview',role:'PLAYER',balance:10000});if(req.path==='/matches')return res.json(matches);return res.json([])});
 app.get('/',async(_req,res)=>res.type('html').send(await vite.transformIndexHtml('/',fixture)));app.use(vite.middlewares);server=http.createServer(app);socket=new Server(server,{serveClient:false});socket.on('connection',client=>client.emit('hello',{mode:'live'}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await puppeteer.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',req=>req.url().startsWith(origin)||req.url().startsWith('data:')?req.continue():req.abort());await page.evaluateOnNewDocument(()=>{localStorage.setItem('token','board-fixture');localStorage.setItem('lang','en')});
 for(const width of [1366,390,320]){
  await page.setViewport({width,height:900,isMobile:width<768,hasTouch:width<768});await page.goto(origin,{waitUntil:'networkidle0'});await page.waitForSelector('[data-zshop-match="101"]');
  assert.ok(await page.$$eval('.zshop-market-heading',nodes=>nodes.length>0&&nodes.every(node=>node.children.length===4)),'each competition has only match, primary, totals and expand columns');
  for(const c of cases){await page.evaluate(bottom=>window.scrollTo(0,bottom?document.body.scrollHeight:0),c.type==='NONE');await new Promise(resolve=>setTimeout(resolve,150));const row=await page.$(`[data-zshop-match="${c.id}"]`);assert.ok(row,`visible fixture ${c.id}`);
   assert.equal(await row.$$eval('.zshop-board-odds',nodes=>nodes.filter(n=>n.getBoundingClientRect().width>0&&getComputedStyle(n).display!=='none').length),width<768?1:2,`protected visible market count ${c.id}`);
   assert.equal(await row.$('.zshop-nextgoal'),null,`next-goal market is not shown on the board ${c.id}`);
   if(c.type==='NONE')continue;
   const family=c.type==='DC'?'dc':c.type==='BTTS'?'btts':'result';
   assert.ok(await row.$(`.zshop-main-odds [data-market-id="${c.id}|${family}|"]`),`correct primary market ${c.id}`);
   const ids=await row.$$eval('[data-market-id]',nodes=>[...new Set(nodes.map(n=>n.dataset.marketId))]);if(c.line!==null)assert.ok(ids.includes(`${c.id}|total|${c.line}`),`nearest available total ${c.id}: ${ids}`);
   const columns=await row.evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length);assert.equal(columns,width<768?3:4,`aligned columns ${width}px fixture ${c.id}`);
   if(c.locked){assert.equal(await row.$$eval('[data-market-id="104|result|"]',nodes=>nodes.every(n=>n.disabled)),true,'suspended primary stays locked');assert.equal(await row.$('[data-market-id="104|dc|"]'),null,'suspension never substitutes DC')}
   if(!c.locked){await page.evaluate(()=>window.slip.clearAll());const button=await row.$(`[data-outcome-id="${c.id}|${family}||0"]`);assert.ok(button,`native outcome ${c.id}`);await button.click();await page.waitForFunction(id=>window.slip.selections[0]?.outcomeId===id,{},`${c.id}|${family}||0`);const selected=await page.evaluate(()=>window.slip.selections[0]);assert.equal(selected.marketId,`${c.id}|${family}|`);assert.equal(selected.odds,2)}
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`no horizontal overflow ${width}`);console.log(`PASS board ${width}px: ${width<768?'one mobile market':'two original desktop markets'}, aligned columns, no horizontal overflow`);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
}finally{await browser?.close();if(socket)await new Promise(resolve=>socket.close(resolve));await vite?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}}
