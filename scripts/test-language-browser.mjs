import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import tailwindConfig from '../web/tailwind.config.js';
const root = fileURLToPath(new URL('../web', import.meta.url));
const match = { id: '101', tournamentId: 1, homeTeam: 'Arsenal', awayTeam: 'Chelsea', status: 'LIVE', currentMinute: 62,
  period: '2H', homeScore: 3, awayScore: 0, scoreAt: new Date().toISOString(), isSuspended: false,
  startTime: new Date().toISOString(), tournament: { id: 1, name: 'Premier League' }, markets: [
    { id: '101|btts|', name: 'Both Teams to Score', marketType: 'BTTS', status: 'ACTIVE', outcomes: [
      { id: '101|btts||yes', marketId: '101|btts|', name: 'Yes', code: 'yes', odds: 2.2, status: 'ACTIVE' },
      { id: '101|btts||no', marketId: '101|btts|', name: 'No', code: 'no', odds: 1.8, status: 'ACTIVE' }] },
    { id: '101|total|1.5', name: 'Total Goals', line: '1.5', marketType: 'OVER_UNDER', status: 'ACTIVE', outcomes: [
      { id: '101|total|1.5|1', name: 'Over', code: '1', odds: 1.2, status: 'ACTIVE' },
      { id: '101|total|1.5|2', name: 'Under', code: '2', odds: 9, status: 'ACTIVE' }] },
    { id: '101|total|4.5', name: 'Total Goals', line: '4.5', marketType: 'OVER_UNDER', status: 'ACTIVE', outcomes: [
      { id: '101|total|4.5|1', name: 'Over', code: '1', odds: 2.9, status: 'ACTIVE' },
      { id: '101|total|4.5|2', name: 'Under', code: '2', odds: 1.4, status: 'ACTIVE' }] },
  ] };
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
import {LanguageProvider,useLanguage} from '/src/context/LanguageContext.tsx'; import {AuthProvider} from '/src/context/AuthContext.tsx';
import {BetslipProvider,useBetslip} from '/src/context/BetslipContext.tsx'; import {FavoritesProvider} from '/src/context/FavoritesContext.tsx';
import Header from '/src/components/Layout/Header.tsx'; import MobileSportsHeader from '/src/components/Layout/MobileSportsHeader.tsx';
import MarketPanel from '/src/components/Sports/MarketPanel.tsx'; import Betslip from '/src/components/Betslip/Betslip.tsx';
import MatchControl from '/src/components/Admin/MatchControl.tsx'; import '/src/index.css';
const e=React.createElement; function Fixture(){window.slip=useBetslip(); const {lang}=useLanguage(); window.testLang=lang;
return e('main',null,e('div',{className:'hidden md:block'},e(Header)),e(MobileSportsHeader,{onOpenLeagues(){},onOpenBetslip(){}}),
e('div',{id:'playerMarkets'},e(MarketPanel,{match:${JSON.stringify(match)}})),e('div',{id:'playerSlip'},e(Betslip)),e('div',{id:'adminMarkets'},e(MatchControl)));}
createRoot(document.getElementById('root')).render(e(MemoryRouter,null,e(LanguageProvider,null,e(AuthProvider,null,e(BetslipProvider,null,e(FavoritesProvider,null,e(Fixture)))))));
</script></body></html>`;
let vite, server, browser;
const errors = [], writes = [];
try {
  vite = await createServer({ root, configFile: false, cacheDir: `${root}/node_modules/.vite-language-test`, plugins: [react()],
    css: { postcss: { plugins: [tailwindcss({ ...tailwindConfig, content: [`${root}/src/**/*.{js,ts,jsx,tsx}`] }), autoprefixer()] } },
    optimizeDeps: { include: ['react', 'react-dom/client', 'react-router-dom', 'axios', 'lucide-react'] },
    server: { middlewareMode: true, hmr: false, fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } }, appType: 'custom' });
  const app = express(); app.use(express.json());
  app.use('/app/api', (req, res) => {
    if (req.method !== 'GET') { writes.push(req.originalUrl); return res.status(400).json({ error: 'No financial writes in language tests' }); }
    if (req.path === '/display-error') return res.status(400).json({message:'invalid username or password',code:'TEST_CREDENTIALS',retryable:false});
    if (req.path === '/auth/me') return res.json({ id: 'language-only-player', username: 'player_language', role: 'PLAYER', status: 'ACTIVE', balance: 999, currency: 'LEK' });
    if (req.path === '/admin/matches') return res.json({ items: [{ ...match, markets: [], marketCount: null }], overrides: [], summary: true });
    if (req.path === '/admin/matches/101') return res.json({ item: match, overrides: [] });
    return res.json([]);
  });
  app.get('/', async (_req, res) => res.type('html').send(await vite.transformIndexHtml('/', fixture)));
  app.use(vite.middlewares); server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true); page.on('request', request => request.url().startsWith(origin) || request.url().startsWith('data:') ? request.continue() : request.abort());
  await page.evaluateOnNewDocument(() => { localStorage.setItem('token', 'language-fixture-only'); });
  const visiblePicker = async () => {
    const handle = await page.evaluateHandle(() => [...document.querySelectorAll('[data-language-picker]')].find(select => select.getBoundingClientRect().height > 0));
    const element = handle.asElement(); assert.ok(element, 'one language picker is visible'); return element;
  };
  await page.setViewport({ width: 1366, height: 900 }); await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-admin-selected-match="101"]');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'sq');
  const displayError=await page.evaluate(async()=>{
    const {apiClient}=await import('/src/api/client.ts');
    try{await apiClient.get('/display-error');}catch(error){return {shown:error.response.data.message,original:error.serverResponse.data.message,status:error.response.status,code:error.response.data.code,retryable:error.response.data.retryable};}
  });
  assert.deepEqual(displayError,{shown:'Emri i përdoruesit ose fjalëkalimi është i pasaktë.',original:'invalid username or password',status:400,code:'TEST_CREDENTIALS',retryable:false});
  const picker = await visiblePicker();
  assert.deepEqual(await picker.evaluate(select => [...select.options].map(option => option.value)), ['al', 'en']);
  await page.waitForFunction(() => document.querySelector('#playerMarkets').innerText.includes('Shënojnë të dyja skuadrat'));
  assert.ok(!(await page.$eval('#playerMarkets', node => node.innerText)).includes('1.5'), 'numeric provider codes cannot leave the settled Under 1.5 market visible at 3–0');
  await picker.select('en');
  await page.waitForFunction(() => document.querySelector('#playerMarkets').innerText.includes('Both Teams to Score') && document.querySelector('#adminMarkets').innerText.includes('Matches and odds'));
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  await page.click('[data-admin-edit-outcome="101|btts||yes"]');
  await page.waitForSelector('[role="dialog"][aria-label="Edit odds"]');
  assert.equal(await page.$eval('[aria-label="New odds"]', input => input.value), '2.2');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { hidden: true });
  await page.evaluate(() => [...document.querySelectorAll('#playerMarkets button')].find(button => /^Yes\s/.test(button.innerText)).click());
  await page.waitForFunction(() => window.slip.selections.length === 1);
  const chosen = await page.evaluate(() => structuredClone(window.slip.selections[0]));
  assert.equal(chosen.outcomeId, '101|btts||yes'); assert.equal(chosen.marketName, 'Both Teams to Score'); assert.equal(chosen.odds, 2.2);
  assert.match(await page.$eval('#playerSlip', node => node.innerText), /Both Teams to Score/);
  await picker.select('al'); await page.waitForFunction(() => document.querySelector('#playerSlip').innerText.includes('Shënojnë të dyja skuadrat'));
  assert.equal((await page.evaluate(() => window.slip.selections[0])).outcomeId, chosen.outcomeId, 'language switching never changes the betting contract');
  await picker.select('en'); await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.testLang === 'en');
  for (const width of [390, 320]) {
    await page.setViewport({ width, height: 844, isMobile: true, hasTouch: true });
    const mobilePicker = await visiblePicker(); await mobilePicker.select('al');
    await page.waitForFunction(() => window.testLang === 'al');
    const fit = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth,
      pickers: [...document.querySelectorAll('[data-language-picker]')].filter(element => element.getBoundingClientRect().height > 0).map(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right })) }));
    assert.ok(fit.document <= fit.width + 1, JSON.stringify(fit)); assert.ok(fit.pickers.every(element => element.left >= 0 && element.right <= width));
    await mobilePicker.select('en'); await page.waitForFunction(() => window.testLang === 'en');
  }
  await page.evaluate(() => { localStorage.setItem('lang', 'de'); }); await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.testLang === 'al' && localStorage.getItem('lang') === 'al');
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  await mkdir(new URL('../tmp/language-browser/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../tmp/language-browser/phone-320.png', import.meta.url)), fullPage: true });
  console.log('PASS real language UI: only Shqip/English, persistence, desktop/mobile picker, Fito24 market and odds labels, native contract preservation, numeric-code expired market hidden before betting');
} finally { await browser?.close(); await vite?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
