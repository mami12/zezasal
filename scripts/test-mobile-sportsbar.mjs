import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { Server as SocketServer } from 'socket.io';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import tailwindConfig from '../web/tailwind.config.js';

const root = fileURLToPath(new URL('../web', import.meta.url));
const now = new Date().toISOString();
const matches = Array.from({ length: 70 }, (_, index) => {
  const id = String(1000 + index);
  const resultId = `${id}|result|`;
  return { id, tournamentId: 1, homeTeam: `Home ${index}`, awayTeam: `Away ${index}`, status: 'PREMATCH',
    startTime: new Date(Date.now() + 86400000).toISOString(), snapshotAt: now, displayOrder: index, competitionOrder: 1,
    tournament: { id: 1, name: 'Premier League', category: { id: 1, name: 'England', sport: { id: 1, name: 'Football' } } },
    markets: [{ id: resultId, name: 'Full Time Result', marketType: '1X2', status: 'ACTIVE',
      outcomes: ['1', 'X', '2'].map((name, outcome) => ({ id: `${resultId}|${outcome}`, marketId: resultId, name, code: name, odds: 2 + outcome / 10, status: 'ACTIVE' })) }],
  };
});
const detail = { ...matches.at(-1), markets: [...matches.at(-1).markets,
  ...Array.from({ length: 30 }, (_, index) => {
    const id = `${matches.at(-1).id}|total|${index + 0.5}`;
    return { id, name: 'Total Goals', line: String(index + 0.5), marketType: 'OVER_UNDER', status: 'ACTIVE',
      outcomes: ['Over', 'Under'].map((name, outcome) => ({ id: `${id}|${outcome}`, marketId: id, name, code: name, odds: 2.1, status: 'ACTIVE' })) };
  }),
] };
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head>
<body class="min-h-screen"><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client'; import {BrowserRouter,Routes,Route} from 'react-router-dom';
import {LanguageProvider} from '/src/context/LanguageContext.tsx'; import {AuthProvider} from '/src/context/AuthContext.tsx';
import {BetslipProvider,useBetslip} from '/src/context/BetslipContext.tsx'; import {FavoritesProvider} from '/src/context/FavoritesContext.tsx';
import SportsbookPage from '/src/pages/SportsbookPage.tsx'; import '/src/index.css';
const e=React.createElement; function Probe(){window.slip=useBetslip();return null;}
createRoot(document.getElementById('root')).render(e(BrowserRouter,null,e(LanguageProvider,null,e(AuthProvider,null,
e(BetslipProvider,null,e(FavoritesProvider,null,e(Probe),e(Routes,null,e(Route,{path:'/',element:e(SportsbookPage)}),e(Route,{path:'/match/:id',element:e(SportsbookPage)}))))))));
</script></body></html>`;

let vite, server, socketServer, browser;
const errors = [], writes = [];
try {
  vite = await createServer({ root, configFile: false, cacheDir: `${root}/node_modules/.vite-mobile-sportsbar`, plugins: [react()],
    css: { postcss: { plugins: [tailwindcss({ ...tailwindConfig, content: [`${root}/src/**/*.{js,ts,jsx,tsx}`] }), autoprefixer()] } },
    optimizeDeps: { include: ['react', 'react-dom/client', 'react-router-dom', 'axios', 'lucide-react'] },
    server: { middlewareMode: true, hmr: false, fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } }, appType: 'custom' });
  const app = express();
  app.use('/app/api', (request, response) => {
    if (request.method !== 'GET') { writes.push(request.originalUrl); return response.status(400).json({ message: 'Scroll fixture never places bets' }); }
    if (request.path === '/auth/me') return response.json({ id: 'scroll-player', username: 'Mobile', role: 'PLAYER', balance: 10000, currency: 'ALL', status: 'ACTIVE' });
    if (request.path === '/matches') return response.json(matches);
    if (request.path === `/matches/${detail.id}`) return response.json(detail);
    return response.json([]);
  });
  app.get(['/', '/match/:id'], async (request, response) => response.type('html').send(await vite.transformIndexHtml(request.path, fixture)));
  app.use(vite.middlewares);
  server = http.createServer(app); socketServer = new SocketServer(server, { serveClient: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => request.url().startsWith(origin) || request.url().startsWith('data:') ? request.continue() : request.abort());
  await page.evaluateOnNewDocument(() => { if (location.protocol === 'http:') localStorage.setItem('token', 'scroll-test-only'); });
  const scrollSelector = '[data-sportsbook-scroll]';
  const headerSelector = '[data-mobile-sports-header]';
  const assertBar = async label => {
    const state = await page.evaluate(selector => {
      const header = document.querySelector(selector);
      const button = header.querySelector('button[title="Hap kuponin"]');
      const rect = header.getBoundingClientRect(), buttonRect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(buttonRect.left + buttonRect.width / 2, buttonRect.top + buttonRect.height / 2);
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: innerWidth,
        buttonHit: !!hit && button.contains(hit), scroll: scrollY };
    }, headerSelector);
    assert.ok(state.top >= -1 && state.bottom <= 100, `${label}: whole mobile bar stays at the viewport top: ${JSON.stringify(state)}`);
    assert.ok(state.left >= -1 && state.right <= state.width + 1, `${label}: the bar fits horizontally`);
    assert.equal(state.buttonHit, true, `${label}: betslip remains available without scrolling back`);
  };
  for (const viewport of [{ width: 390, height: 640, isMobile: true, hasTouch: true }, { width: 320, height: 568, isMobile: true, hasTouch: true }]) {
    const label = `${viewport.width}×${viewport.height}`;
    await page.setViewport(viewport); await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`button[title="${detail.homeTeam} - ${detail.awayTeam}"]`);
    await page.waitForSelector(scrollSelector);
    assert.ok(await page.$eval(scrollSelector, node => node.scrollHeight > node.clientHeight * 5), 'fixture has a real long board');
    await assertBar(`${label} before scrolling`);
    // Actual mouse-wheel and touch gestures must move the match list, never the header.
    await page.mouse.move(viewport.width / 2, viewport.height - 100); await page.mouse.wheel({ deltaY: 950 });
    await page.waitForFunction(selector => document.querySelector(selector).scrollTop > 100, {}, scrollSelector);
    await assertBar(`${label} after wheel scrolling`);
    const beforeTouch = await page.$eval(scrollSelector, node => node.scrollTop);
    const session = await page.createCDPSession();
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: viewport.height - 100 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y: 180 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
    await page.waitForFunction((selector, before) => document.querySelector(selector).scrollTop > before + 50, {}, scrollSelector, beforeTouch);
    await assertBar(`${label} after touch scrolling`);
    await page.$eval(scrollSelector, node => { node.scrollTop = node.scrollHeight; });
    await page.waitForFunction(selector => { const node = document.querySelector(selector); return node.scrollTop + node.clientHeight >= node.scrollHeight - 2; }, {}, scrollSelector);
    // The document can be taller than its visual viewport on phones (browser
    // chrome/zoom or a parent min-height). A board header must survive that scroll too.
    await page.evaluate(() => { document.body.style.minHeight = 'calc(100vh + 180px)'; window.scrollTo(0, 160); });
    assert.ok(await page.evaluate(() => scrollY >= 100), 'outer-document scrolling actually occurred');
    await assertBar(`${label} after outer-document scrolling`);
    await page.tap(`button[title="${detail.homeTeam} - ${detail.awayTeam}"]`);
    await page.waitForFunction(id => location.pathname === `/match/${id}`, {}, detail.id);
    await page.waitForFunction(() => document.body.innerText.includes('29.5'));
    await page.$eval(scrollSelector, node => { node.scrollTop = node.scrollHeight; });
    await assertBar(`${label} on scrolled match details`);
    await page.evaluate(() => window.slip.addSelection({ matchId: '1069', outcomeId: '1069|result||0', marketId: '1069|result|', marketName: 'Full Time Result', outcomeName: '1', odds: 2, matchName: 'Home 69 vs Away 69' }));
    await page.tap('button[title="Hap kuponin"]');
    await page.waitForSelector('[data-betslip-sheet] [data-betslip-place]');
    const footer = await page.$eval('[data-betslip-sheet] [data-betslip-place]', node => {
      const rect = node.getBoundingClientRect(); const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { top: rect.top, bottom: rect.bottom, height: innerHeight, visible: !!hit && node.contains(hit) };
    });
    assert.ok(footer.top >= 0 && footer.bottom <= footer.height + 1 && footer.visible, `${label}: the open slip submit control remains visible: ${JSON.stringify(footer)}`);
    await page.tap('[data-betslip-sheet] > button'); await page.waitForSelector('[data-betslip-sheet]', { hidden: true });
    await assertBar(`${label} after closing the slip`);
    await mkdir(new URL('../tmp/mobile-sportsbar/', import.meta.url), { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL(`../tmp/mobile-sportsbar/${viewport.width}.png`, import.meta.url)) });
    console.log(`PASS mobile sports bar ${label}: long board, wheel/touch, document scroll, match detail, reachable betslip and footer`);
  }
  await page.setViewport({ width: 1366, height: 800 }); await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-betslip-rail]');
  assert.equal(await page.$eval(headerSelector, node => getComputedStyle(node).display), 'none', 'desktop retains its separate header and betslip rail');
  assert.equal(await page.$eval('[data-sportsbook-shell]', node => getComputedStyle(node).position), 'static', 'mobile viewport anchoring does not change desktop positioning');
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
} finally {
  await browser?.close(); if (socketServer) await new Promise(resolve => socketServer.close(resolve)); await vite?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
