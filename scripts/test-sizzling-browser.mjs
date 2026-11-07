/**
 * Chrome smoke for the ORIGINAL Pixi/Spine/Howler Sizzling Hot Deluxe client.
 * Serves the actual /app Vite build and our isolated same-origin Node demo API.
 * Confirms live loader POSTs init, WebGL canvas initializes, all game assets
 * resolve locally and a real user gesture triggers spin.
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import express from 'express';
import puppeteer from 'puppeteer';
import { createSizzlingDemoRouter } from '../server/casino/sizzling-demo.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'web/dist');
const app = express();
app.use(express.json());
app.use('/app/api/casino/sizzlinghotdeluxe', createSizzlingDemoRouter());
app.use('/app', express.static(dist));
const server = await new Promise(ok => {
  const s = app.listen(0, '127.0.0.1', () => ok(s));
});
let browser;
try {
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader',
      '--use-gl=angle','--use-angle=swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1 });
  const jsErrors = [], badAssets = [], posts = [], browserConsole = [], notFound = [];
  const rootUrl = 'http://127.0.0.1:' + server.address().port;
  page.on('pageerror', error => jsErrors.push(error.message));
  page.on('console', event => {
    if (['error','warning','warn'].includes(event.type())) browserConsole.push(event.type()+': '+event.text());
  });
  page.on('response', response => {
    const url = response.url();
    if (response.status() >= 400 && url.startsWith(rootUrl)) {
      notFound.push(response.status() + ' ' + url);
      if (url.startsWith(rootUrl + '/app/casino-original/sizzling/')) {
        badAssets.push(response.status() + ' ' + url);
      }
    }
    if (url.includes('/app/api/casino/sizzlinghotdeluxe/play')) {
      posts.push({ code:response.status(), request:response.request().postData()?.slice(0,500) ?? '' });
    }
  });
  const response = await page.goto(rootUrl + '/app/casino-original/sizzling/index.html',
    { waitUntil:'domcontentloaded', timeout:30000 });
  assert.equal(response.status(),200);
  await page.waitForFunction(() => {
    const canvas=document.querySelector('#slotCanvas');
    return !!canvas && canvas.width > 100 && canvas.height > 100;
  }, { timeout:60000 });
  await page.waitForFunction(() => document.querySelector('#preloaderContainer')?.style.display === 'none' ||
    !!document.querySelector('.app-container:not(.loading)'), { timeout:2500 }).catch(() => {});
  await new Promise(ok=>setTimeout(ok,3500));
  const visible = await page.evaluate(() => {
    const canvas = document.querySelector('#slotCanvas');
    return {
      width:canvas?.width ?? 0,height:canvas?.height ?? 0,
      head:document.head?.hasAttribute('attach-element'),
      body:document.body?.hasAttribute('attach-element'),
      game: !!document.getElementById('container'),
      pixi: typeof window.PIXI,
      howler: typeof window.Howler,
      preloader:document.querySelector('#preloaderContainer')?.outerHTML.slice(0,250),
      preloaderStyle:document.querySelector('#preloaderContainer') ? {
        display:getComputedStyle(document.querySelector('#preloaderContainer')).display,
        visibility:getComputedStyle(document.querySelector('#preloaderContainer')).visibility,
        opacity:getComputedStyle(document.querySelector('#preloaderContainer')).opacity,
      } : null,
      text: document.body.innerText.slice(0,500),
      canvases: document.querySelectorAll('canvas').length,
    };
  });
  assert.equal(visible.head,false,'assembler must load head.html');
  assert.equal(visible.body,false,'assembler must load body.html');
  assert.equal(visible.game,true);
  assert.ok(visible.width>100 && visible.height>100,'original canvas should be drawn');
  assert.equal(visible.pixi,'object','Pixi must load');
  assert.equal(visible.howler,'object','Howler must load');
  assert.ok(posts.length>=1,'Original game must call local demo init API');
  assert.ok(posts.every(post=>post.code===200),
    'Original init API must return 200: '+JSON.stringify(posts));
  assert.deepEqual(badAssets,[],'Missing original game graphic/sound/script assets');

  // Input is in the Pixi canvas, not a DOM button. Screenshot recorded for
  // visual regression review; spin click at the original cabinet's position.
  const artifacts = join(root,'/tmp/sizzling-browser-check');
  await mkdir(artifacts,{recursive:true});
  await page.screenshot({path:join(artifacts,'sizzling-original.png')});
  const bounds=await page.$eval('#slotCanvas', canvas => {
    const r=canvas.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height};
  });
  // Desktop reference cabinet SPIN center ≈83% across, 94% down.
  console.log('Canvas bounds:',bounds);
  // Never hammer the Pixi cabinet while its first spin animation is active.
  // The game is WebGL, so there is no DOM button to await.
  const points=[[.83,.94],[.83,.91],[.84,.86],[.84,.96],[.82,.80]];
  for(const [x,y] of points){
    await page.mouse.click(bounds.x+bounds.w*x,bounds.y+bounds.h*y);
    await new Promise(ok=>setTimeout(ok,1600));
    if(posts.length>=2)break;
  }
  await new Promise(ok=>setTimeout(ok,4700));
  await page.screenshot({path:join(artifacts,'sizzling-after-spin.png')});
  console.log('Pixi runtime:',JSON.stringify(visible));
  console.log('Casino protocol calls:',posts.map(p=>({code:p.code, body:p.request.slice(0,120)})));
  console.log('Browser warnings:',browserConsole.slice(-20));
  console.log('All local HTTP errors:',notFound);
  const actions=posts.map(p=>{
    const matched=/"action"\s*:\s*"([^"]+)"/.exec(p.request);
    return matched?.[1] ?? 'unknown';
  });
  console.log('Protocol actions:', actions);
  assert.ok(actions.includes('init'),'Original client must initialize');
  assert.ok(actions.includes('spin'),'Pixi SPIN button must reach demo backend');
  console.log('Browser screenshots captured at',artifacts);
  assert.ok(posts.length>=2, 'Canvas clicks must trigger a real spin protocol request');
  assert.deepEqual(jsErrors,[],'Original browser client must not throw JS errors');
  console.log('Original Pixi Sizzling: client initialized, same-origin API called, assets loaded, canvas rendered');
} finally {
  await browser?.close();
  await new Promise(done=>server.close(done));
}
