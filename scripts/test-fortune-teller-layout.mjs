import assert from 'node:assert/strict';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import {fortuneFixture} from './fixtures/fortune-teller-env.mjs';
import {getCasinoSettings} from '../server/casino/wallet.mjs';

// The real React host and native cabinet use an in-memory test wallet only.
// Every game action below opens/cancels a menu or changes coins; none spins.
const f=await fortuneFixture();
const webRoot=fileURLToPath(new URL('../web/',import.meta.url));
const artifacts=fileURLToPath(new URL('../test-artifacts/fortune-teller-layout/',import.meta.url));
const headful=Boolean(process.env.FORTUNE_HEADFUL);
const dpr=Number(process.env.FORTUNE_DPR||1);
const errors=[],httpErrors=[];
let browser,http,page,frame;

const source=`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {LanguageProvider} from './src/context/LanguageContext';
import {AuthProvider} from './src/context/AuthContext';
import CasinoFullscreen from './src/components/Layout/CasinoFullscreen';
import CasinoOriginalWallet from './src/pages/CasinoOriginalWallet';
import {apiClient} from './src/api/client';
apiClient.defaults.headers.common['x-test-player']='isolated-player';
createRoot(document.getElementById('root')).render(
 <LanguageProvider><AuthProvider>
  <CasinoFullscreen title="Fortune Teller" onExit={()=>{}}>
   <CasinoOriginalWallet game="fortune-teller"/>
  </CasinoFullscreen>
 </AuthProvider></LanguageProvider>
);
`;

// Bounds are native Pixi coordinates, measured without dispatching game events.
function nativeGeometry(){
 const runtime=window.desktop_Entry.walletRuntime();
 const entities=runtime.game._resourceManager.getEntityManager();
 const canvas=document.querySelector('#gameContainer canvas');
 const view=canvas.getBoundingClientRect();
 const menu=entities.getByName('menu');
 const bounds=object=>{
  if(!object)return null;
  const b=object.getBounds();
  return {x:b.x,y:b.y,width:b.width,height:b.height};
 };
 const button=(entity,path)=>bounds(entity?.getButton(path)?._node?.renderObject);
 const modal=entities.getByName('modal');
 const autoplay=modal.getHierarchy('windows').getByName('AutoPlay');
 return {
  canvas:{x:view.x,y:view.y,width:view.width,height:view.height,pixelsWide:canvas.width,pixelsHigh:canvas.height},
  autoplayButton:button(menu,'autoPlayBtn'),
  coinsButton:button(menu,'coinsPlusBtn'),
  coinsMinusButton:button(menu,'coinsMinusBtn'),
  panel:bounds(autoplay?.node?.renderObject),
  cancel:button(autoplay,'cancelBtn'),
  open:Boolean(autoplay?.getDisplay('.').isVisible()),
  coins:runtime.bet.coins,balance:runtime.round.balance,running:runtime.round.running,
 };
}

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const screenshot=name=>page.screenshot({path:artifacts+name+'.png'});
const state=()=>frame.evaluate(nativeGeometry);

async function screenBounds(nativeBounds){
 assert.ok(nativeBounds,'native control has bounds');
 const {canvas}=await state();
 const iframe=await page.$eval('iframe',element=>{
  const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};
 });
 assert.ok(canvas.width>0&&canvas.height>0&&canvas.pixelsWide>0&&canvas.pixelsHigh>0,'visible native canvas');
 // The iframe and canvas can be centered independently. Retinal/high-resolution
 // rendering changes backing pixels, so CSS pointer coordinates need both scales.
 const sx=canvas.width/canvas.pixelsWide,sy=canvas.height/canvas.pixelsHigh;
 return {
  x:iframe.x+canvas.x+nativeBounds.x*sx,
  y:iframe.y+canvas.y+nativeBounds.y*sy,
  width:nativeBounds.width*sx,height:nativeBounds.height*sy,
 };
}

async function physicalClick(nativeBounds){
 const r=await screenBounds(nativeBounds);
 assert.ok(r.width>0&&r.height>0,'physical native button is visible');
 await page.mouse.click(r.x+r.width/2,r.y+r.height/2,{delay:80});
}

async function assertCanvasPainted(label){
 const {canvas}=await state();
 const clip=await screenBounds({x:0,y:0,width:canvas.pixelsWide,height:canvas.pixelsHigh});
 const png=await page.screenshot({type:'png',clip});
 // Decode a screenshot instead of reading WebGL directly: this also detects
 // a black composited iframe while native scene geometry remains correct.
 const painted=await page.evaluate(async encoded=>{
  const image=new Image();image.src='data:image/png;base64,'+encoded;
  await image.decode();
  const sample=document.createElement('canvas');
  sample.width=image.naturalWidth;sample.height=image.naturalHeight;
  const context=sample.getContext('2d');context.drawImage(image,0,0);
  const pixels=context.getImageData(0,0,sample.width,sample.height).data;
  let colored=0,total=0;
  for(let i=0;i<pixels.length;i+=16){
   total++;
   if(Math.max(pixels[i],pixels[i+1],pixels[i+2])>40)colored++;
  }
  return {ratio:colored/total,width:sample.width,height:sample.height};
 },Buffer.from(png).toString('base64'));
 assert.ok(painted.ratio>.05,label+': native canvas is visibly painted '+JSON.stringify(painted));
}

async function waitPanel(open){
 await frame.waitForFunction(expected=>{
  try{
   const entities=desktop_Entry.walletRuntime().game._resourceManager.getEntityManager();
   const panel=entities.getByName('modal').getHierarchy('windows').getByName('AutoPlay');
   return Boolean(panel?.getDisplay('.').isVisible())===expected;
  }catch{return !expected;}
 },{timeout:8000},open);
 await pause(180);
}

async function assertPanel(label){
 const s=await state();
 assert.equal(s.open,true,label+': original autoplay is open');
 const {canvas,panel,cancel}=s;
 for(const [name,r]of [['panel',panel],['cancel',cancel]]){
  assert.ok(r&&[r.x,r.y,r.width,r.height].every(Number.isFinite),label+': '+name+' has finite native bounds');
  assert.ok(r.width>0&&r.height>0,label+': '+name+' has visible dimensions');
  assert.ok(r.x>=-3&&r.y>=-3&&r.x+r.width<=canvas.pixelsWide+3&&r.y+r.height<=canvas.pixelsHigh+3,label+': '+name+' stays within canvas '+JSON.stringify(s));
 }
 const center={x:panel.x+panel.width/2,y:panel.y+panel.height/2};
 assert.ok(Math.abs(center.x-canvas.pixelsWide/2)<=canvas.pixelsWide*.12,label+': autoplay is horizontally centered');
 assert.ok(Math.abs(center.y-canvas.pixelsHigh/2)<=canvas.pixelsHigh*.12,label+': autoplay is vertically centered');
 const physicalCancel=await screenBounds(cancel);
 assert.ok(physicalCancel.x>=0&&physicalCancel.y>=0,label+': cancel is inside visible page');
 const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
 assert.ok(physicalCancel.x+physicalCancel.width<=viewport.width+3&&physicalCancel.y+physicalCancel.height<=viewport.height+3,label+': cancel is not clipped by the host');
 assert.equal(s.running,false,label+': no round starts when opening autoplay');
 await assertCanvasPainted(label);
 await screenshot(label);
}

async function openPanel(label){
 assert.equal((await state()).open,false,label+': previous popup has closed');
 await physicalClick((await state()).autoplayButton);
 await waitPanel(true);
 await assertPanel(label);
}

async function cancelAndCheckCoins(label){
 await physicalClick((await state()).cancel);
 await waitPanel(false);
 const before=await state();
 await physicalClick(before.coinsButton);
 await frame.waitForFunction(previous=>desktop_Entry.walletRuntime().bet.coins!==previous,{timeout:5000},before.coins);
 await physicalClick((await state()).coinsMinusButton);
 await frame.waitForFunction(previous=>desktop_Entry.walletRuntime().bet.coins===previous,{timeout:5000},before.coins);
 const after=await state();
 assert.equal(after.coins,before.coins,label+': original minus button restores coins for the next check');
 assert.equal(after.running,false,label+': native coin button works after cancel without spinning');
 assert.equal(after.balance,initialNativeBalance,label+': native balance did not change');
 assert.equal(await f.balance(),initialBalance,label+': isolated ledger balance did not change');
 assert.equal(await f.count(),0,label+': no wager was submitted');
 await assertCanvasPainted(label+'-closed');
}

async function resize(width,height){
 await page.setViewport({width,height,deviceScaleFactor:dpr});
 await frame.waitForFunction(()=>{
  const c=document.querySelector('#gameContainer canvas');
  return c&&c.clientWidth>0&&c.clientHeight>0;
 });
 await pause(500);
}

async function fullscreen(enter){
 const label=enter?'Ekran i plotë horizontal':'Dil nga ekrani i plotë';
 await page.click('button[aria-label="'+label+'"]');
 await page.waitForFunction(expected=>Boolean(document.fullscreenElement)===expected,{timeout:8000},enter);
 await pause(500);
}

let initialBalance,initialNativeBalance;
try{
 assert.ok(Number.isFinite(dpr)&&dpr>0,'FORTUNE_DPR is a positive number');
 await mkdir(artifacts,{recursive:true});
 const bundle=await build({
  stdin:{contents:source,loader:'tsx',resolveDir:webRoot},bundle:true,write:false,
  format:'esm',platform:'browser',target:'es2020',jsx:'automatic',logLevel:'silent',
  define:{'process.env.NODE_ENV':'"production"','import.meta.env':JSON.stringify({BASE_URL:'/app/'})},
 });
 const styles=(await readdir(webRoot+'dist/assets')).filter(name=>/^index-.*\.css$/.test(name));
 assert.equal(styles.length,1,'build the current site CSS with npm run build:web first');
 const css=await readFile(webRoot+'dist/assets/'+styles[0],'utf8');
 f.app.get('/fixture-style.css',(_req,res)=>res.type('css').send(css));
 f.app.get('/fixture-code.js',(_req,res)=>res.type('js').send(bundle.outputFiles[0].text));
 f.app.get('/app/api/auth/me',async(_req,res)=>res.json({id:f.user,username:'Test',role:'PLAYER',status:'ACTIVE',balance:await f.balance()}));
 f.app.get('/app/api/casino/status',async(_req,res)=>res.json(await getCasinoSettings((...args)=>f.sql.query(...args))));
 f.app.get('/fixture',(_req,res)=>res.type('html').send(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture-style.css"></head>
<body class="bg-primary text-text-primary min-h-screen font-sans antialiased"><div id="root"><button id="launch" type="button">Open Fortune Teller</button></div>
<script>document.getElementById('launch').onclick=async()=>{
 try{
  await document.documentElement.requestFullscreen();
  window.__mountedWhileFullscreen=Boolean(document.fullscreenElement);
  await import('/fixture-code.js');
 }catch(error){window.__fixtureError=error.message;}
};</script></body></html>`));
 http=f.app.listen(0,'127.0.0.1');
 await new Promise(resolve=>http.once('listening',resolve));
 const origin='http://127.0.0.1:'+http.address().port;
 browser=await puppeteer.launch({headless:!headful,...(headful?{defaultViewport:null}:{}),...(process.env.FORTUNE_BROWSER?{executablePath:process.env.FORTUNE_BROWSER}:{})});
 page=await browser.newPage();
 if(!headful)await page.setViewport({width:1366,height:900,deviceScaleFactor:dpr});
 await page.evaluateOnNewDocument(()=>localStorage.setItem('token','isolated'));
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{
  if(response.status()>=400&&!response.url().endsWith('/favicon.ico'))httpErrors.push({status:response.status(),url:response.url()});
 });
 initialBalance=await f.balance();
 await page.goto(origin+'/fixture');
 await page.click('#launch');
 await page.waitForFunction(()=>window.__mountedWhileFullscreen||window.__fixtureError,{timeout:8000});
 assert.equal(await page.evaluate(()=>window.__fixtureError),undefined,'fullscreen entry before mount succeeded');
 assert.equal(await page.evaluate(()=>window.__mountedWhileFullscreen),true,'host mounts after native fullscreen entry');
 const element=await page.waitForSelector('iframe');frame=await element.contentFrame();
 await frame.waitForFunction(()=>{
  try{return desktop_Entry.walletRuntime().game.initializationStage===3&&desktop_Entry.walletRuntime().round.balance>0;}catch{return false;}
 },{timeout:40000});
 await pause(1000);
 initialNativeBalance=(await state()).balance;
 // Continue on the original splash. All subsequent controls use native bounds.
 const iframe=await element.boundingBox(),canvas=(await state()).canvas;
 await page.mouse.click(iframe.x+canvas.x+canvas.width*.5,iframe.y+canvas.y+canvas.height*.855,{delay:80});
 await pause(1000);
 await openPanel('fullscreen-before-mount');
 await cancelAndCheckCoins('fullscreen-before-mount');

 for(const [width,height]of [[1920,1080],[2560,1440],[844,390]]){
  await resize(width,height);
  const label='fullscreen-'+width+'x'+height;
  await openPanel(label);
  await cancelAndCheckCoins(label);
 }

 await openPanel('autoplay-before-resize');
 await resize(1920,1080);
 await assertPanel('autoplay-open-resize-1920x1080');
 await resize(2560,1440);
 await assertPanel('autoplay-open-resize-2560x1440');
 await fullscreen(false);
 await assertPanel('autoplay-exit-fullscreen');
 await cancelAndCheckCoins('autoplay-exit-fullscreen');

 await openPanel('autoplay-windowed');
 await fullscreen(true);
 await assertPanel('autoplay-reenter-fullscreen');
 await cancelAndCheckCoins('autoplay-reenter-fullscreen');
 await fullscreen(false);
 await openPanel('autoplay-after-fullscreen-cycle');
 await cancelAndCheckCoins('autoplay-after-fullscreen-cycle');
 await screenshot('menus-closed-clickable');
 assert.deepEqual(errors,[],'no browser exceptions');
 assert.deepEqual(httpErrors,[],'all host and original cabinet files loaded');
 assert.equal(await f.count(),0,'layout regression never places a wager');
 console.log('PASS Fortune Teller layout: real React iframe host, fullscreen before mount, native autoplay/cancel, 1920/2560/mobile widths, resize with popup open, exit/reenter fullscreen, physical coin controls after close, no wagers (DPR '+dpr+')');
}catch(error){
 if(page){
  await screenshot('failure').catch(()=>{});
  console.error('Fortune Teller layout state:',await state().catch(()=>null));
 }
 console.error('Browser errors:',errors,'HTTP errors:',httpErrors);
 throw error;
}finally{
 if(browser)await browser.close();
 if(http){http.closeAllConnections();await new Promise(resolve=>http.close(resolve));}
 await f.close();
}
