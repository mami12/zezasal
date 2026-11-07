import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import puppeteer from 'puppeteer';
import { sizzlingDemoRouter } from '../server/sizzling-demo.mjs';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const app=express();
app.use('/app/api/casino/sizzling',sizzlingDemoRouter);
app.use('/app',express.static(join(root,'web/dist')));
const server=await new Promise(done=>{
  const s=app.listen(0,'127.0.0.1',()=>done(s));
});
let browser;
try{
  const base='http://127.0.0.1:'+server.address().port;
  const session=await fetch(base+'/app/api/casino/sizzling/play',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({action:'init',request_id:0}),
  });
  assert.equal(session.status,200);
  const cookie=session.headers.get('set-cookie').split(';')[0];
  const init=await session.json();
  assert.ok(init.init.extra.symbol_types,'original client symbol_types');
  assert.deepEqual(init.available_actions,['spin']);
  assert.equal(Object.keys(init.init.start_symbols).length,5);
  const spin=await fetch(base+'/app/api/casino/sizzling/play',{
    method:'POST',headers:{'content-type':'application/json',cookie},
    body:JSON.stringify({action:'spin',bet:1,denomination:1,lines:5,request_id:1}),
  });
  assert.equal(spin.status,200);
  const outcome=await spin.json();
  assert.equal(Object.keys(outcome.spin.symbols).length,5);
  assert.ok(Number.isFinite(Number(outcome.spin.wins.total)));

  browser=await puppeteer.launch({headless:true,args:[
    '--no-sandbox','--disable-setuid-sandbox',
    '--use-gl=angle','--use-angle=swiftshader','--enable-webgl',
  ]});
  const page=await browser.newPage();
  await page.setViewport({width:1000,height:650});
  const errors=[],failed=[],gameRequests=[];
  page.on('request',request=>{
    if(request.url().includes('/app/api/casino/sizzling/play'))
      gameRequests.push({method:request.method(),body:request.postData()?.slice(0,260)});
  });
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{
    if(response.status()>=400&&!response.url().includes('favicon'))failed.push(
      response.status()+' '+response.url());
  });
  const response=await page.goto(base+'/app/casino-original/sizzling/index.html',
    {waitUntil:'domcontentloaded',timeout:30000});
  assert.equal(response.status(),200);
  await page.waitForFunction(()=>
    document.getElementById('slotCanvas')&&
    document.querySelector('script[src*="bundle-"]'),
    {timeout:30000});
  await new Promise(done=>setTimeout(done,9000));
  const state=await page.evaluate(()=>({
    canvas:!!document.getElementById('slotCanvas'),
    width:document.getElementById('slotCanvas')?.width??0,
    height:document.getElementById('slotCanvas')?.height??0,
    loader:!!document.querySelector('.preloader'),
    scripts:[...document.scripts].filter(s=>/pixi|spine|bundle-/.test(s.src)).map(s=>s.src),
    title:document.title,
  }));
  console.log('Original Sizzling browser state:',JSON.stringify(state));
  console.log('Original Sizzling browser failures:',JSON.stringify(failed.slice(0,20)));
  console.log('Original Sizzling browser errors:',JSON.stringify(errors.slice(0,20)));
  console.log('Original Sizzling browser game requests:',JSON.stringify(gameRequests.slice(0,6)));
  assert.ok(gameRequests.length>=1,'The Pixi game must call the same-origin demo protocol');
  assert.ok(state.canvas,'original Pixi canvas missing');
  assert.ok(state.scripts.some(s=>s.includes('bundle-')),'original game bundle not loaded');
  assert.ok(state.width>0&&state.height>0,'original engine did not initialize canvas');
  assert.ok(!failed.some(f=>/\/(?:data|images|audio|animations|libs|scripts)\//.test(f)),
    'Original game asset requests returned HTTP errors');
  assert.deepEqual(errors,[],'original client unhandled JavaScript errors');
  console.log('Original Sizzling: real client Pixi/Spine plus demo protocol validated');
}finally{
  if(browser)await browser.close();
  await new Promise(done=>server.close(done));
}
