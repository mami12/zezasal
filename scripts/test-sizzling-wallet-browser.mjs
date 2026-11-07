/**
 * Browser-smoke the exact money-wallet Pixi entrypoint, not the demo.
 * Requires a disposable casino_test PostgreSQL DB and a built web/dist.
 * A 29% preloader hang must fail CI and print browser/network diagnostics.
 */
import assert from 'node:assert/strict';
import express from 'express';
import puppeteer from 'puppeteer';
import jwt from 'jsonwebtoken';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {config} from '../server/config.mjs';
import {casinoSessionRouter} from '../server/casino/sizzling-real.mjs';
import {casinoWalletRouter} from '../server/casino/wallet.mjs';
import {query,closePool} from '../server/db.mjs';
import {initLedgerSchema,createUser} from '../server/ledger/store.mjs';
import {createSizzlingRealRouter} from '../server/casino/sizzling-real.mjs';

assert.ok(process.env.DATABASE_URL?.includes('/casino_test'),
  'This test can only operate on disposable casino_test PostgreSQL');

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const app=express();
app.use(express.json());

app.get('/app/wallet-test',(_req,res)=>res.type('html').send('<!doctype html><html><body>preflight</body></html>'));
app.use('/app/api/casino/sizzlinghotdeluxe/real',createSizzlingRealRouter());
app.use('/app/api',casinoSessionRouter);
app.use('/app/api',casinoWalletRouter);
app.use('/app',express.static(join(root,'web/dist')));
let browser,server;
try{
  await initLedgerSchema();
  await query('update app_casino_settings set enabled=true where id=1');
  const player=await createUser({
    username:'pixi'+randomUUID(),passwordHash:'unused',role:'PLAYER',balance:10000,
  });
  server=await new Promise(done=>{
    const s=app.listen(0,'127.0.0.1',()=>done(s));
  });
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await puppeteer.launch({
    headless:true,
    args:['--no-sandbox','--disable-setuid-sandbox','--enable-unsafe-swiftshader',
      '--use-gl=angle','--use-angle=swiftshader'],
  });
  const page=await browser.newPage();
  await page.setViewport({width:1024,height:768,deviceScaleFactor:1});
  const token=jwt.sign({
    sub:player.id,jti:randomUUID(),kind:'casino-pixi-wallet',
  },config.jwtSecret,{expiresIn:'1h'});
  // Exercise the same HTTP session+cookie handoff as the React component.
  await page.goto(origin+'/app/wallet-test');
  const preflight=await page.evaluate(async bearer=>{
    const session=await fetch('/app/api/casino/session',{
      method:'POST',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},
      credentials:'same-origin',body:'{}',
    });
    const payload=await session.json();
    if(!session.ok||!payload.ready)throw new Error('Session '+session.status+': '+JSON.stringify(payload));
    const form=new FormData();
    form.append('data',JSON.stringify({action:'init',request_id:'0'}));
    const init=await fetch('/app/api/casino/sizzlinghotdeluxe/real/play',{
      method:'POST',body:form,credentials:'same-origin',
    });
    const response=await init.json();
    return {session:session.status,init:init.status,
      balance:response.balance?.after,gameUrl:payload.gameUrl};
  },token);
  assert.equal(preflight.session,200);
  assert.equal(preflight.init,200,'session cookie did not cross to Pixi wallet API');
  assert.equal(preflight.balance,10000,'wallet must use sportsbook balance');
  console.log('WALLET SESSION PREFLIGHT:',JSON.stringify(preflight));
  const jsErrors=[],consoleErrors=[],badHttp=[],failedRequests=[],api=[];
  page.on('pageerror',e=>jsErrors.push(e.stack||e.message));
  page.on('console',msg=>{
    if(['error','warn','warning'].includes(msg.type()))
      consoleErrors.push(msg.type()+': '+msg.text());
  });
  page.on('requestfailed',r=>failedRequests.push(r.url()+' '+r.failure()?.errorText));
  page.on('response',async response=>{
    const url=response.url();
    if(url.includes('/app/api/casino/sizzlinghotdeluxe/real/play')){
      let payload='';
      try{payload=(await response.text()).slice(0,1300)}catch{}
      api.push({status:response.status(),method:response.request().method(),
        request:response.request().postData()?.slice(0,280),payload});
    }
    if(response.status()>=400&&url.startsWith(origin)){
      badHttp.push(response.status()+' '+url);
    }
  });
  const response=await page.goto(
    origin+'/app/casino-original/sizzling/index-real.html',
    {waitUntil:'domcontentloaded',timeout:30000});
  assert.equal(response.status(),200);
  let loaded=false;
  try{
    await page.waitForFunction(
      ()=>!!document.querySelector('#slotCanvas') &&
      document.querySelector('#preloaderContainer')===null,
      {timeout:42000});
    loaded=true;
  }catch{}
  const state=await page.evaluate(()=>{
    const p=document.querySelector('#preloaderProgress');
    const loader=document.querySelector('#preloaderContainer');
    const canvas=document.querySelector('#slotCanvas');
    return {
      loader:!!loader,progress:document.querySelector('#preloaderText')?.textContent,
      track:p?.style.width,canvas:canvas?{width:canvas.width,height:canvas.height}:null,
      title:document.title,pixi:typeof window.PIXI,
      text:document.body.innerText.slice(0,240),
    };
  });
  const out=join(root,'tmp/sizzling-wallet-browser');
  await mkdir(out,{recursive:true});
  await page.screenshot({path:join(out,'wallet-loading.png')});
  // The previous smoke test stopped at the loader and never clicked Start.
  // Press the original PIXI canvas button and capture the actual POST payload.
  // Use the game's own scale/padding conversion, as proven by
  // test-sizzling-controls.mjs on both desktop and mobile.
  const pressPoint=await page.evaluate(()=>{
    const p=c2d.env.screenParams;
    const r=document.querySelector('#slotCanvas').getBoundingClientRect();
    return {x:r.x+(1570+p.paddingLeft)*p.canvasScaleCoef/p.pixelRatio,
      y:r.y+(1025+p.paddingTop)*p.canvasScaleCoef/p.pixelRatio};
  });
  // The original cabinet uses the same Start area as Stop Spin. A second
  // press should fast-stop the reels, not send a second wager.
  await page.evaluate(()=>{
    window.__sizzlingStops=[];
    window.__sizzlingTimeChanges=[];
    if(window.c2d?.documentEvents){
      document.addEventListener(c2d.documentEvents.SPIN_REELS_WAS_STOPPED,
        ()=>window.__sizzlingStops.push(performance.now()));
      document.addEventListener(c2d.documentEvents.TIMESCALE_WAS_CHANGED,
        e=>window.__sizzlingTimeChanges.push({at:performance.now(),scale:e.detail?.timescale}));
    }
  });
  const pressStarted=Date.now();
  await page.mouse.click(pressPoint.x,pressPoint.y);
  await new Promise(resolve=>setTimeout(resolve,700));
  await page.mouse.click(pressPoint.x,pressPoint.y);
  await new Promise(resolve=>setTimeout(resolve,4500));
  const quickStopState=await page.evaluate(()=>({
    stopped:window.__sizzlingStops,
    timeChanges:window.__sizzlingTimeChanges,
    timescale:window.c2d?.timescale,
    screen:window.c2d?.env?.screenParams?.orientation,
  }));
  console.log('WALLET PIXI QUICK STOP:',JSON.stringify({pressStarted,quickStopState}));
  assert.ok(quickStopState.timeChanges.some(change=>change.scale===4),
    'Second Start press must activate 4x speed on original Pixi reels');
  assert.ok(quickStopState.stopped.length>0,
    'Second Start press must finish the original reel animation');
  assert.equal(quickStopState.timescale,1,
    'Original reel speed must reset after stopping');

  const clicks=[pressPoint,pressPoint];
  await page.screenshot({path:join(out,'wallet-after-start.png')});
  console.log('WALLET PIXI START CLICKS:',JSON.stringify(clicks));
  console.log('WALLET PIXI START API:',JSON.stringify(api));

  console.log('WALLET PIXI STATE:',JSON.stringify(state));
  console.log('WALLET PIXI API:',JSON.stringify(api));
  console.log('WALLET PIXI ERRORS:',JSON.stringify(jsErrors.slice(0,15)));
  console.log('WALLET PIXI CONSOLE:',JSON.stringify(consoleErrors.slice(0,20)));
  console.log('WALLET PIXI FAILED NETWORK:',JSON.stringify(failedRequests.slice(0,20)));
  console.log('WALLET PIXI BAD HTTP:',JSON.stringify(badHttp.slice(0,20)));
  assert.ok(api.some(x=>x.status===200),
    'The real-wallet Pixi client must initialize using a 200 API response');
  assert.deepEqual(badHttp,[],'Wallet Pixi assets or requests returned HTTP errors');
  assert.deepEqual(jsErrors,[],'Wallet Pixi game threw an error');
  assert.ok(loaded,
    'Real-wallet Pixi preloader never finished. State: '+JSON.stringify(state));
  const attemptedSpin=api.find(entry=>(entry.request||'').includes('"action": "spin"'));
  assert.ok(attemptedSpin,'Original Start button did not submit a spin. Clicks: '+JSON.stringify(clicks));
  assert.equal(attemptedSpin.status,200,
    'Original Start spin failed: '+JSON.stringify(attemptedSpin));
  console.log('Wallet Pixi fully loaded past 29%');
}finally{
  await browser?.close();
  if(server)await new Promise(done=>server.close(done));
  // Leave the test setting enabled so the following casino-ledger regression
  // can verify its first-deploy state in the same disposable CI database.
  await closePool();
}
