import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { Server as SocketServer } from 'socket.io';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import tailwindConfig from '../web/tailwind.config.js';

// Exercise the actual page, its rail/sheet and generated Tailwind CSS. All APIs
// and sockets stay on this isolated loopback server; no real bets are placed.
const root = fileURLToPath(new URL('../web', import.meta.url));
const fixture = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
</head><body><div id="root"></div><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {BetslipProvider,useBetslip} from '/src/context/BetslipContext.tsx';
import {LanguageProvider} from '/src/context/LanguageContext.tsx';
import {AuthProvider} from '/src/context/AuthContext.tsx';
import {FavoritesProvider} from '/src/context/FavoritesContext.tsx';
import {LiveFeedProvider} from '/src/api/liveFeed.tsx';
import SportsbookPage from '/src/pages/SportsbookPage.tsx';
import '/src/index.css';
import '/src/styles/zshop.css';
import '/src/styles/ecco-sports.css';
function Probe(){window.slip=useBetslip();return null;}
createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,
  React.createElement(LanguageProvider,null,React.createElement(AuthProvider,null,
  React.createElement(BetslipProvider,null,React.createElement(LiveFeedProvider,null,
  React.createElement(FavoritesProvider,null,React.createElement(Probe),React.createElement(SportsbookPage))))))));
</script></body></html>`;

const selections = [
  { matchId: 'A', outcomeId: 'A1', marketId: 'A-result', marketName: 'Full Time Result', outcomeName: '1', odds: 5 },
  { matchId: 'A', outcomeId: 'Aover', marketId: 'A-total', marketName: 'Total Goals', marketLine: '2.5', outcomeName: 'Over', odds: 2.1 },
  ...Array.from({length: 7}, (_, index) => ({
    matchId: `M${index}`, outcomeId: `M${index}-selection`, marketId: `M${index}-builder`,
    marketName: 'Bet Builder: Both Teams to Score + Total Goals', outcomeName: 'BTTS Yes + Over 2.5', odds: 2.243492358,
  })),
].map(row => ({...row, matchName: row.matchId === 'A' ? 'Arsenal vs Chelsea' : 'Klubi me emër shumë të gjatë i qytetit vs Skuadra tjetër me emër të gjatë'}));

let vite, server, socketServer, browser;
const failures = [];
let attemptedBets = 0;
try {
  vite = await createServer({root, configFile: false, cacheDir: `${root}/node_modules/.vite-betslip-layout`, plugins: [(await import('@vitejs/plugin-react')).default()],
    css: {postcss: {plugins: [tailwindcss({...tailwindConfig, content: [`${root}/src/**/*.{js,ts,jsx,tsx}`]}), autoprefixer()]}},
    server: {middlewareMode: true, hmr: false, fs: {allow: [fileURLToPath(new URL('..', import.meta.url))]}},
    appType: 'custom', optimizeDeps: {include: ['react', 'react-dom/client', 'react-router-dom', 'axios', 'lucide-react']},
  });
  const app = express();
  app.get('/app/api/auth/me', (_request, response) => response.json({id: 'layout-player', username: 'Layout', role: 'PLAYER', balance: 10000, currency: 'ALL', status: 'ACTIVE'}));
  app.get('/app/api/{*path}', (_request, response) => response.json([]));
  app.post('/app/api/{*path}', (_request, response) => {attemptedBets += 1; response.status(500).json({message: 'Layout fixture never places bets'});});
  app.get('/', async (_request, response) => {
    try {response.type('html').send(await vite.transformIndexHtml('/', fixture));}
    catch (error) {failures.push(error.message); response.status(500).send('Fixture transform failed');}
  });
  app.use(vite.middlewares);
  server = http.createServer(app);
  socketServer = new SocketServer(server, {serveClient: false});
  socketServer.on('connection', socket => socket.emit('combos:settings', {enabled: true}));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  console.log('Isolated sportsbook layout fixture ready');
  browser = await puppeteer.launch({headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox']});
  const page = await browser.newPage();
  page.on('pageerror', error => {failures.push(error.message); console.error('Layout page error:', error.message);});
  await page.setRequestInterception(true);
  page.on('request', request => request.url().startsWith(origin) || request.url().startsWith('data:') ? request.continue() : request.abort());
  await page.evaluateOnNewDocument(() => localStorage.setItem('token', 'layout-test-only'));

  const measure = selector => page.evaluate(selector => {
    const panel = document.querySelector(selector);
    const place = panel?.querySelector('[data-betslip-place]');
    const stake = panel?.querySelector('#betslip-stake');
    const scroll = panel?.querySelector('[data-betslip-scroll]');
    const rect = element => {const r = element.getBoundingClientRect(); return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height};};
    const hit = element => {const r = element.getBoundingClientRect(); const top = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return !!top && (top === element || element.contains(top));};
    return {place: rect(place), stake: rect(stake), panel: rect(panel),
      viewport: {width: window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight, top: window.visualViewport?.offsetTop ?? 0},
      placeHit: hit(place), stakeHit: hit(stake), fontSize: Number.parseFloat(getComputedStyle(stake).fontSize),
      scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight,
      horizontalOverflow: panel.scrollWidth - panel.clientWidth,
    };
  }, selector);
  const assertControls = (state, label) => {
    const bottom = state.viewport.top + state.viewport.height;
    for (const [name, rect] of [['place button', state.place], ['stake', state.stake]]) {
      assert.ok(rect.height >= 30, `${label}: ${name} has a usable height`);
      assert.ok(rect.top >= state.viewport.top - 1 && rect.bottom <= bottom + 1, `${label}: ${name} is inside the visible viewport: ${JSON.stringify(state)}`);
      assert.ok(rect.left >= 0 && rect.right <= state.viewport.width + 1, `${label}: ${name} fits horizontally`);
    }
    assert.equal(state.placeHit, true, `${label}: place button is uncovered`);
    assert.equal(state.stakeHit, true, `${label}: stake is uncovered`);
    assert.ok(state.clientHeight >= 30, `${label}: selections keep a usable scroll area: ${JSON.stringify(state)}`);
    assert.ok(state.scrollHeight > state.clientHeight, `${label}: long selection/column list scrolls independently`);
    assert.ok(state.horizontalOverflow <= 1, `${label}: long labels never widen the panel`);
    assert.ok(state.fontSize >= 16, `${label}: stake does not trigger phone input zoom`);
  };

  for (const viewport of [
    {width: 1366, height: 600}, {width: 1280, height: 450},
    {width: 390, height: 640, isMobile: true, hasTouch: true},
    {width: 320, height: 568, isMobile: true, hasTouch: true},
    {width: 844, height: 390, isMobile: true, hasTouch: true},
  ]) {
    const label = `${viewport.width}×${viewport.height}`;
    await page.setViewport(viewport);
    await page.goto(origin);
    await page.waitForFunction(() => !!window.slip);
    await page.evaluate(rows => rows.forEach(row => window.slip.addSelection(row)), selections);
    await page.waitForFunction(() => window.slip.ticketType === 'SYSTEM' && window.slip.columns.length === 2);
    const mobileSheet = viewport.width < 1280;
    if (mobileSheet) {
      await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find(button => button.title === 'Hap kuponin' && button.getBoundingClientRect().height > 0)
          ?? [...document.querySelectorAll('button')].find(button => button.innerText.includes('Sistem · 2 kolona') && button.getBoundingClientRect().height > 0);
        button.click();
      });
      await page.waitForSelector('[data-betslip-sheet]');
    }
    const selector = mobileSheet ? '[data-betslip-sheet]' : '[data-betslip-rail]';
    await page.waitForFunction(selector => !!document.querySelector(`${selector} [data-betslip-place]`), {}, selector);
    const before = await measure(selector);
    assertControls(before, label);
    await page.evaluate(selector => {document.querySelector(`${selector} [data-betslip-columns]`).open = true;}, selector);
    const expanded = await measure(selector);
    assertControls(expanded, `${label} with expanded columns`);
    assert.ok(Math.abs(expanded.place.top - before.place.top) < 1, `${label}: expanding columns cannot move the submit control`);
    await page.evaluate(selector => document.querySelector(`${selector} .betslip-heading button[aria-expanded]`).click(), selector);
    assertControls(await measure(selector), `${label} with ticket search open`);
    await page.evaluate(selector => {const scroll = document.querySelector(`${selector} [data-betslip-scroll]`); scroll.scrollTop = scroll.scrollHeight;}, selector);
    assertControls(await measure(selector), `${label} after scrolling the last selection/column`);
    await page.focus(`${selector} #betslip-stake`);
    assertControls(await measure(selector), `${label} while editing the stake`);
    console.log(`PASS betslip layout ${label}: stake and submit remain visible with nine selections and expanded SYSTEM columns`);
  }

  // Model a keyboard that changes only the visual viewport (as on mobile
  // browsers where the layout viewport and 100dvh retain their old height).
  await page.setViewport({width: 390, height: 640, isMobile: true, hasTouch: true});
  await page.goto(origin);
  await page.waitForFunction(() => !!window.slip);
  await page.evaluate(rows => rows.forEach(row => window.slip.addSelection(row)), selections);
  await page.waitForFunction(() => window.slip.ticketType === 'SYSTEM');
  await page.click('button[title="Hap kuponin"]');
  await page.waitForSelector('[data-betslip-sheet] [data-betslip-place]');
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', {configurable: true, get: () => 330});
    Object.defineProperty(window.visualViewport, 'offsetTop', {configurable: true, get: () => 10});
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.waitForFunction(() => document.querySelector('[data-betslip-sheet]').getBoundingClientRect().bottom <= 341);
  const keyboard = await measure('[data-betslip-sheet]');
  assertControls(keyboard, 'visual viewport keyboard 390×330');
  assert.equal(await page.evaluate(() => window.innerHeight), 640, 'keyboard case keeps the larger layout viewport');
  assert.equal(attemptedBets, 0);
  assert.deepEqual(failures, []);
  console.log('PASS keyboard visual viewport: stake and place button stay inside the keyboard-free visible area');
} finally {
  await browser?.close();
  if (socketServer) await new Promise(resolve => socketServer.close(resolve));
  await vite?.close();
  if (server) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
}
