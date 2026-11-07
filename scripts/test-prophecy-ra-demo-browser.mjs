import assert from 'node:assert/strict';
import express from 'express';
import puppeteer from 'puppeteer';
import { resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';

const root = resolve('web/dist/casino-original/prophecy-ra-demo');
const manifest = JSON.parse(await readFile(join(root, 'assets/manifest.webp.json'), 'utf8'));
const assetPaths = [...new Set(Object.values(manifest).filter(value => typeof value === 'string'))];
const app = express();
app.use('/app/casino-original/prophecy-ra-demo', express.static(root, { fallthrough: false }));
const server = await new Promise(resolveServer => {
  const instance = app.listen(0, '127.0.0.1', () => resolveServer(instance));
});
let browser;

try {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const errors = [], missingAssets = [];
  const origin = `http://127.0.0.1:${server.address().port}`;
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && response.url().includes('/app/casino-original/prophecy-ra-demo/')) missingAssets.push(response.status() + ' ' + response.url());
  });

  const response = await page.goto(origin + '/app/casino-original/prophecy-ra-demo/src/index.html', {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  assert.equal(response.status(), 200);
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#player canvas');
    return canvas && canvas.width > 100 && canvas.height > 100;
  }, { timeout: 90000 });

  const before = await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)));
  await page.mouse.click(414, 470);
  await page.waitForFunction(previous => JSON.stringify(Object.entries(sessionStorage)) !== previous, { timeout: 30000 }, before);
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find(item => item.innerText.trim() === 'Spin');
    return button && !button.disabled;
  }, { timeout: 30000 });

  assert.deepEqual(missingAssets, []);
  assert.deepEqual(errors, []);
  console.log(`PASS demo player rendered, Spin control responded, ${assetPaths.length} manifest assets served`);
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}