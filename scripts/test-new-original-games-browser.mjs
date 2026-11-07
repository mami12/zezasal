/** Actual React host + original clients + isolated SQL wallet. */
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
import {createOriginalWalletStore} from '../server/casino/original-wallet-store.mjs';
import {createOriginalWalletRouter} from '../server/casino/original-wallet.mjs';
import {createCasinoWalletRouter} from '../server/casino/wallet.mjs';
const sql=new PGlite();await sql.exec(LEDGER_SQL);
const manager=randomUUID(),user={id:randomUUID(),username:'isolated-new-games',role:'PLAYER',status:'ACTIVE',balance:100000,currency:'ALL',managerId:manager,financialEpoch:0};
await sql.query("insert into app_user(id,username,password_hash,role,balance,currency)values($1,'isolated-games-manager','test','MANAGER',100000,'ALL')",[manager]);
await sql.query("insert into app_user(id,username,password_hash,role,balance,currency,manager_id)values($1,$2,'test','PLAYER',100000,'ALL',$3)",[user.id,user.username,manager]);
await sql.query('update app_casino_settings set enabled=true where id=1');
let queue=Promise.resolve();const database={async connect(){let release;const previous=queue;queue=new Promise(resolve=>release=resolve);await previous;return{query:(...args)=>sql.query(...args),release};}};
const runQuery=async(...args)=>{const db=await database.connect();try{return await db.query(...args);}finally{db.release();}};
const auth=async(req,_res,next)=>{req.user={...user,balance:Number((await runQuery('select balance from app_user where id=$1',[user.id])).rows[0].balance)};next();};
const root=resolve('web'),fixture=`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route}from'react-router-dom';import{LanguageProvider}from'/src/context/LanguageContext.tsx';import{AuthProvider}from'/src/context/AuthContext.tsx';import CasinoPage from'/src/pages/CasinoPage.tsx';import'/src/index.css';
createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,{initialEntries:['/casino/'+new URLSearchParams(location.search).get('game')]},React.createElement(LanguageProvider,null,React.createElement(AuthProvider,null,React.createElement(Routes,null,React.createElement(Route,{path:'/casino/:gameId',element:React.createElement(CasinoPage)}))))));
</script></body></html>`;
async function clickNative(page,frame,selector,fx=.5,fy=.5){
 const rect=await frame.$eval(selector,(node,{fx,fy})=>{const r=node.getBoundingClientRect();return{x:r.x+r.width*fx,y:r.y+r.height*fy};},{fx,fy});
 const bounds=await(await frame.frameElement()).boundingBox(),size=await frame.evaluate(()=>({w:innerWidth,h:innerHeight}));
 const rotated=bounds.height>bounds.width&&size.w>size.h;
 const x=rotated?bounds.x+bounds.width-rect.y*bounds.width/size.h:bounds.x+rect.x*bounds.width/size.w;
 const y=rotated?bounds.y+rect.x*bounds.height/size.w:bounds.y+rect.y*bounds.height/size.h;
 await page.mouse.click(x,y);
}
async function until(check,message,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,50));}throw Error(message);}
let vite,server,browser;const errors=[],missing=[],external=[],actions=[];
try{
 vite=await createServer({root,configFile:false,cacheDir:resolve('web/node_modules/.vite-new-games-test'),plugins:[react()],css:{postcss:{plugins:[tailwindcss({...tailwind,content:[root+'/src/**/*.{ts,tsx}']}),autoprefixer()]}},server:{middlewareMode:true,hmr:false,fs:{allow:[resolve('.')]}},appType:'custom'});
 const app=express();app.use(express.json());app.get('/app/api/auth/me',auth,(req,res)=>res.json(req.user));
 app.use('/app/api/casino/original',(req,_res,next)=>{if(req.path.endsWith('/rgsm'))try{actions.push(...JSON.parse(req.query.request??'[]').map(c=>c.command));}catch{}if(req.path.endsWith('/dinit.php'))actions.push(req.query.action);next();},createOriginalWalletRouter({store:createOriginalWalletStore({database,checkBet:async()=>{}}),auth,ready:()=>true}));
 app.use('/app/api',createCasinoWalletRouter({database,runQuery,auth,ready:()=>true}));
 app.use('/app/casino-original',express.static(resolve('web/dist/casino-original')));app.use('/app/casino-assets',express.static(resolve('web/dist/casino-assets')));
 app.get('/',async(_req,res)=>res.type('html').send(await vite.transformIndexHtml('/',fixture)));app.use(vite.middlewares);
 server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 await mkdir('test-artifacts/new-original-games',{recursive:true});
 for(const width of [1366,390]){
  browser=await puppeteer.launch({headless:true,protocolTimeout:30000,args:[`--window-size=${width},985`]});const page=await browser.newPage();await page.setViewport({width,height:900});page.setDefaultTimeout(30000);
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{errors.push('Native dialog: '+d.message());await d.dismiss();});
  page.on('response',r=>{if(r.status()>=400)missing.push(new URL(r.url()).pathname);});
  await page.setRequestInterception(true);page.on('request',r=>{if(r.url().startsWith(origin)||r.url().startsWith('data:')||r.url().startsWith('blob:'))r.continue();else{external.push(new URL(r.url()).host);r.abort();}});
  await page.evaluateOnNewDocument(()=>{localStorage.setItem('token','isolated-player');localStorage.setItem('lang','al');});
  for(const id of ['ice-fruits-6x3','fortune-pyramid']){
   const roundsBefore=Number((await runQuery('select count(*) as n from app_casino_round where game_id=$1',[id])).rows[0].n);
   const count=actions.length;await page.goto(origin+'/?game='+id,{waitUntil:'domcontentloaded'});
   await page.waitForSelector('iframe',{timeout:60000});const handle=await page.$('iframe');const frame=await handle.contentFrame();
   if(id==='ice-fruits-6x3'){
    await frame.waitForFunction(()=>window.game?.state?.current==='StateMain',{timeout:60000});
    const help=await frame.evaluate(async()=>{const response=await fetch(location.pathname+'/info');return{status:response.status,images:(await response.text()).match(/page[0-2]\.webp/g)?.length};});
    assert.deepEqual(help,{status:200,images:3},'native information control serves original rule pages');
   }
   else{const sound=width===1366?'#withSound':'#withoutSound';await frame.waitForSelector(sound,{visible:true,timeout:30000});await clickNative(page,frame,sound);await frame.waitForFunction(()=>!document.getElementById('preloader'),{timeout:60000});}
   await new Promise(resolve=>setTimeout(resolve,1000));
   if(id==='fortune-pyramid'){
    await clickNative(page,frame,'#buttonGameMenu');await frame.waitForSelector('#menuAutoExt',{visible:true});await clickNative(page,frame,'#menuAutoExt');
    await frame.waitForSelector('#ar_AutoMenuWindow',{visible:true});
    const full=await page.evaluate(()=>Boolean(document.fullscreenElement));
    await page.click('button[aria-label="Ekran i plotë horizontal"],button[aria-label="Dil nga ekrani i plotë"]');await page.waitForFunction(old=>Boolean(document.fullscreenElement)!==old,{timeout:12000},full);
    await frame.waitForSelector('#ar_AutoMenuWindow',{visible:true});
    const popup=await frame.$eval('#ar_AutoMenuWindow',n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,iw:innerWidth,ih:innerHeight};});
    assert.ok(popup.x>=-2&&popup.y>=-2&&popup.x+popup.w<=popup.iw+2&&popup.y+popup.h<=popup.ih+2,'native autoplay stays inside the game frame');
    await page.screenshot({path:'test-artifacts/new-original-games/pyramid-autoplay-'+width+'.png'});
    await clickNative(page,frame,'#helpButtonsExit');await frame.waitForSelector('#ar_AutoMenuWindow',{hidden:true});
   }else{
    await frame.waitForFunction(()=>model.flags.can_start_spin&&model.flags.can_change_denom,{timeout:30000});
    await clickNative(page,frame,'canvas',700/1920,1000/1080);
    await frame.waitForFunction(()=>model.betLinesMenuOpen===true,{timeout:10000});
    await page.screenshot({path:'test-artifacts/new-original-games/ice-bet-menu-'+width+'.png'});
    await clickNative(page,frame,'canvas',700/1920,1000/1080);
    await frame.waitForFunction(()=>!model.betLinesMenuOpen,{timeout:10000});
   }
   if(id==='ice-fruits-6x3')await clickNative(page,frame,'canvas',.5,.93);else await clickNative(page,frame,'#buttonStart');
   await until(async()=>Number((await runQuery('select count(*) as n from app_casino_round where game_id=$1',[id])).rows[0].n)===roundsBefore+1,'Native spin did not settle one paid round: '+id);
   await new Promise(resolve=>setTimeout(resolve,2500));
   assert.equal(actions.slice(count).filter(action=>action===(id==='ice-fruits-6x3'?'spin':'play')).length,1);
   await page.screenshot({path:`test-artifacts/new-original-games/${id}-${width}.png`});
   console.log('PASS '+id+' at '+width+'px: original controls, popup closure and exactly one wallet spin');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  }
  await browser.close();browser=null;
 }
 assert.deepEqual(errors,[]);assert.deepEqual(missing.filter(p=>p!=='/favicon.ico'),[]);assert.deepEqual(external,[]);
 console.log('PASS both original clients in actual React host, native loading and scoped SQL wallet at desktop/mobile widths');
}finally{await browser?.close();await vite?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await sql.close();}
