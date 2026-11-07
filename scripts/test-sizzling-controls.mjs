import assert from 'node:assert/strict';
import express from 'express';
import puppeteer from 'puppeteer';
import { createSizzlingDemoRouter, initResponse } from '../server/casino/sizzling-demo.mjs';

// Every denomination advertised to the original parser must have a bet ladder.
const ranges = initResponse({ credits: 10000, requestId: 1 }).init.ranges;
for (const denomination of Object.values(ranges.denomination)) {
  assert.deepEqual(ranges.bet[denomination], [1,2,3,5,10,20,30,50,100]);
}
if (process.argv.includes('--protocol-only')) {
  console.log('All five denomination bet ladders passed');
  process.exit(0);
}
const app = express();
app.use('/app/api/casino/sizzlinghotdeluxe', createSizzlingDemoRouter());
app.use('/app', express.static('web/dist'));
const server = await new Promise(resolve => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
});
let browser;
try {
  browser = await puppeteer.launch({headless:true,args:[
    '--no-sandbox','--disable-setuid-sandbox','--enable-unsafe-swiftshader',
    '--use-gl=angle','--use-angle=swiftshader',
  ]});
  for (const mobile of [false, true]) {
    const page = await browser.newPage();
    const errors = [], badAssets = [], spins = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400 && response.url().includes('/casino-original/'))
        badAssets.push(response.status()+' '+response.url());
    });
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().endsWith('/play')) {
        const data = request.postData() || '';
        const match = data.match(/\{[^\r\n]*"action"[^\r\n]*\}/);
        if (match) {
          const body = JSON.parse(match[0]);
          if (body.action === 'spin') spins.push(body);
        }
      }
      request.continue();
    });
    await page.setViewport({width:mobile?390:1024,height:mobile?844:768,
      deviceScaleFactor:mobile?2:1,isMobile:mobile,hasTouch:mobile});
    if (mobile) await page.setUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/app/casino-original/sizzling/index.html`);
      await page.waitForFunction(() => window.c2d?.env?.screenParams?.canvasScaleCoef > 0 &&
        !document.querySelector('#preloaderContainer'), {timeout:60000});
      assert.equal(await page.evaluate(() => c2d.env.isDesktop), true);
      // Rotation must preserve hit targets as well as initial portrait loading.
      if (mobile) {
        await page.setViewport({width:844,height:390,deviceScaleFactor:2,isMobile:true,hasTouch:true});
        await page.waitForFunction(() => c2d.env.screenParams.orientation === 'landscape');
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      const press = async (x, y) => {
        const point = await page.evaluate(({x,y}) => {
          const p=c2d.env.screenParams, r=document.querySelector('#slotCanvas').getBoundingClientRect();
          return {x:r.x+(x+p.paddingLeft)*p.canvasScaleCoef/p.pixelRatio,
            y:r.y+(y+p.paddingTop)*p.canvasScaleCoef/p.pixelRatio};
        }, {x,y});
        if(mobile) await page.touchscreen.tap(point.x,point.y);
        else await page.mouse.click(point.x,point.y);
        await new Promise(resolve => setTimeout(resolve,250));
      };
      // Original HD cabinet coordinates, including mainFrame offset (270,880).
      await press(784,1025); // 1 -> 2
      await press(784,1025); // 2 -> 3
      await press(625,1025); // 3 -> 2
      await press(960,1025); // denomination 1 -> 0.5 (previously empty ladder)
      await press(1570,1025); // spin with selected stake
      await new Promise(resolve => setTimeout(resolve,1000));
      assert.ok(spins.length > 0,'Spin button must send a request');
      assert.equal(Number(spins[0].bet),2,'Minus must undo one plus');
      assert.equal(Number(spins[0].denomination),0.5,'Coin minus must select lower denomination');
      assert.deepEqual(errors,[]);
      assert.deepEqual(badAssets,[]);
      console.log(`${mobile?'Mobile touch/rotation':'Desktop mouse'}: loader and bet +/- passed`);
    } catch(error) {
      console.error({mobile,errors,badAssets,spins});
      throw error;
    } finally { await page.close(); }
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
