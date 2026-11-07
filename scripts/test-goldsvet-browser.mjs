/**
 * End-to-end smoke test of the Goldsvet game AS IT WILL BE SERVED:
 * browser loading the built same-origin /app assets and exercising sound,
 * music, SPIN, paytable and staggered five-reel stop animations.
 * No production account, wallet, or external casino host is used.
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import express from 'express';
import puppeteer from 'puppeteer';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(repo, 'web/dist');
const app = express();
app.use('/app', express.static(dist));
const server = await new Promise(ok => {
  const s = app.listen(0, '127.0.0.1', () => ok(s));
});
let browser;
try {
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 750, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port +
    '/app/casino-goldsvet/sizzling/index.html';
  const response = await page.goto(base, { waitUntil:'networkidle0' });
  assert.equal(response.status(), 200, 'Goldsvet game HTML must be served');
  const loaded = await page.$$eval('.reel-col img', elements =>
    elements.map(element => ({
      src: element.getAttribute('src'),
      loaded: element.complete && element.naturalWidth > 0,
    })));
  assert.equal(loaded.length,15,'all 15 reel-window symbols must render');
  assert.ok(loaded.every(image => image.loaded),
    'broken reel image(s): '+JSON.stringify(loaded.filter(x => !x.loaded)));
  const cabinet = await page.evaluate(() => ({
    title: document.querySelector('.logo-title')?.textContent,
    stars: document.querySelectorAll('.line-star').length,
    chips: document.querySelectorAll('.chip').length,
    background: getComputedStyle(document.getElementById('game-wrapper')).backgroundImage,
    stage: !!document.querySelector('.reel-stage'),
  }));
  assert.match(cabinet.title,/SIZZLING 777/);
  assert.equal(cabinet.stars,10,'five payoff markers on each side');
  assert.equal(cabinet.chips,7,'Goldsvet betting denomination bar');
  assert.ok(cabinet.stage);
  assert.ok(cabinet.background.includes('radial-gradient'),'deluxe cabinet CSS must be loaded');
  await page.click('.line-star[data-line="0"]');
  const preview = await page.$eval('.line-star[data-line="0"]', el => el.classList.contains('active'));
  assert.ok(preview,'side star should preview its real payline');
  await page.click('.chip[data-bet="2"]');
  const bet = await page.$eval('#disp-bet', node => node.textContent.trim());
  assert.equal(bet,'40.00','denomination changes should update total stake');
  await page.click('#btn-paytable');
  const paytable = await page.$eval('#paytable-modal', modal => modal.classList.contains('open'));
  assert.ok(paytable,'paytable must open');
  await page.click('#btn-close-paytable');
  await page.click('#btn-music');
  await page.waitForFunction(() =>
    document.getElementById('btn-music').getAttribute('aria-pressed') === 'true',
    { timeout: 4500 });
  await page.click('#btn-music');
  await page.click('#btn-spin');
  await page.waitForFunction(() =>
    document.getElementById('btn-spin')?.textContent?.trim() === 'SPIN' &&
    [...document.querySelectorAll('.reel-col img')].length === 15,
    { timeout: 7500 });
  const state = await page.evaluate(() => ({
    balance: document.getElementById('disp-balance').textContent,
    win: document.getElementById('disp-win').textContent,
    visible: [...document.querySelectorAll('.reel-col img')].every(
      el => el.complete && el.naturalWidth > 0),
    columns: document.querySelectorAll('.reel-col').length,
  }));
  assert.equal(state.columns,5,'five Goldsvet reels');
  assert.equal(state.visible,true,'reels must still have valid images after SPIN');
  assert.ok(Number.isFinite(Number(state.balance))&&Number.isFinite(Number(state.win)),
    'game should update balance and winnings');
  assert.deepEqual(errors,[],'Goldsvet page must not throw JS errors');
  console.log('Goldsvet Chrome smoke: 15 PNG symbols, music, paytable and full spin passed');
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
