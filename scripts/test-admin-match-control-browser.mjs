import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdirSync} from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import tailwindConfig from '../web/tailwind.config.js';

// Render the production component and Tailwind styles. The only backend is this
// loopback fixture; writes are captured in memory and cannot reach real funds.
const root = fileURLToPath(new URL('../web', import.meta.url));
const artifactRoot = fileURLToPath(new URL('../tmp/admin-match-control', import.meta.url));
mkdirSync(artifactRoot, {recursive: true});
const fixture = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>#test-sidebar{display:none}@media(min-width:1024px){body.with-admin-sidebar #root{margin-left:256px}body.with-admin-sidebar #test-sidebar{display:block;position:fixed;inset:0 auto 0 0;width:256px;border-right:1px solid #243347;background:#0c1622}}@media(min-width:1280px){body.with-admin-sidebar #root{margin-left:288px}body.with-admin-sidebar #test-sidebar{width:288px}}</style>
</head><body><aside id="test-sidebar" aria-hidden="true"></aside><main id="root"></main><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import {LanguageProvider} from '/src/context/LanguageContext.tsx';
import MatchControl from '/src/components/Admin/MatchControl.tsx';
import '/src/index.css';
createRoot(document.getElementById('root')).render(React.createElement(LanguageProvider,null,React.createElement(MatchControl)));
</script></body></html>`;

const nativeOutcomeId = '101|1X2|1/native?line=0';
const nativeMarketId = '101|total/goals|2.5';
const initialMatches = () => [
  {id: '101', homeTeam: 'Arsenal', awayTeam: 'Chelsea', status: 'LIVE', currentMinute: 68,
    homeScore: 1, awayScore: 2, isSuspended: false, tournament: {id: 'premier', name: 'Premier League'},
    startTime: '2026-10-25T12:00:00Z', markets: [
      {id: '101|1X2|', name: 'Full Time Result', marketType: '1x2', status: 'ACTIVE', outcomes: [
        {id: nativeOutcomeId, name: '1', code: '1', odds: 2.2, status: 'ACTIVE'},
        {id: '101|1X2|X', name: 'X', code: 'X', odds: 3.3, status: 'ACTIVE'},
        {id: '101|1X2|2', name: '2', code: '2', odds: 4.4, status: 'ACTIVE'},
      ]},
      {id: nativeMarketId, name: 'Total Goals', line: '2.5', marketType: 'over_under', status: 'ACTIVE', outcomes: [
        {id: '101|total|over', name: 'Over', code: 'OVER', odds: 1.9, status: 'ACTIVE'},
        {id: '101|total|under', name: 'Under', code: 'UNDER', odds: 2, status: 'ACTIVE'},
      ]},
      {id: '101|corners|9.5', name: 'Total Corners', line: '9.5', marketType: 'corners', status: 'ACTIVE', outcomes: [
        {id: '101|corners|over', name: 'Over', code: 'OVER', odds: 1.8, status: 'ACTIVE'},
        {id: '101|corners|under', name: 'Under', code: 'UNDER', odds: 2, status: 'ACTIVE'},
      ]},
    ]},
  {id: '102', homeTeam: 'Barcelona', awayTeam: 'Real Madrid', status: 'LIVE', currentMinute: 32,
    homeScore: 0, awayScore: 0, isSuspended: false, tournament: {id: 'laliga', name: 'La Liga'}, markets: []},
  {id: '103', homeTeam: 'Juventus', awayTeam: 'Milan', status: 'PREMATCH', isSuspended: false,
    tournament: {id: 'seriea', name: 'Serie A'}, markets: []},
  {id: '104', homeTeam: 'Inter', awayTeam: 'Napoli', status: 'UPCOMING', isSuspended: false,
    tournament: {id: 'seriea', name: 'Serie A'}, markets: []},
  {id: '105', homeTeam: 'Klubi me emër shumë të gjatë i kryeqytetit',
    awayTeam: 'Skuadra kundërshtare me emër të gjatë për provën e telefonit', status: 'ENDED',
    homeScore: 3, awayScore: 1, isSuspended: false, tournament: {id: 'cup', name: 'Kupa ndërkombëtare me emër shumë të gjatë'}, markets: []},
].map(match => ({startTime: '2026-10-26T18:00:00Z', ...match}));

let matches = initialMatches();
const overrides = [{kind: 'match', ref: '102', suspended: true, price: null, updatedAt: '2026-10-25T13:00:00Z'}];
const writes = [];
const reads = [];
const failures = [];
const unexpected = [];
let holdWrites = false;
const waitingWrites = [];
const heldDetails = new Set();
const waitingDetails = [];
const failedWrites = new Set();
const failedDetails = new Set();
let vite, server, browser;

const responseMatches = () => matches.map(match => {
  const matchLocked = match.isSuspended || overrides.some(item => item.kind === 'match' && item.ref === match.id && item.suspended === true);
  return {...match, isSuspended: matchLocked, markets: match.markets.map(market => {
    const marketLocked = matchLocked || market.status === 'SUSPENDED'
      || overrides.some(item => item.kind === 'market' && item.ref === market.id && item.suspended === true);
    return {...market, status: marketLocked ? 'SUSPENDED' : 'ACTIVE', outcomes: market.outcomes.map(outcome => {
      const outcomeLocked = marketLocked || outcome.status === 'SUSPENDED'
        || overrides.some(item => item.kind === 'outcome' && item.ref === outcome.id && item.suspended === true);
      return {...outcome, status: outcomeLocked ? 'SUSPENDED' : 'ACTIVE', feedSuspended: outcomeLocked, riskSuspended: false};
    })};
  })};
});

function applyWrite(method, route, body) {
  const action = route.match(/^\/admin\/(matches|markets|outcomes)\/(.+)\/(suspend|odds|settle|visibility)$/);
  if (!action) return false;
  const [, kind, encodedId, verb] = action;
  const id = decodeURIComponent(encodedId);
  const overrideKind = {matches: 'match', markets: 'market', outcomes: 'outcome'}[kind];
  if ((verb === 'settle' ? 'POST' : 'PATCH') !== method) return false;
  const allMarkets = matches.flatMap(match => match.markets);
  const allOutcomes = allMarkets.flatMap(market => market.outcomes);
  const row = (kind === 'matches' ? matches : kind === 'markets' ? allMarkets : allOutcomes).find(row => row.id === id);
  if (!row) return false;
  let override = overrides.find(item => item.kind === overrideKind && item.ref === id);
  if (verb !== 'settle' && !override) {
    override = {kind: overrideKind, ref: id, suspended: null, price: null, updatedAt: '2026-10-25T13:01:00Z'};
    overrides.push(override);
  }
  if(verb==='visibility'){row.isHidden=body.hidden;return true;}
  if (verb === 'suspend') {
    override.suspended = kind === 'matches' ? body.isSuspended === true : body.status === 'SUSPENDED';
  } else if (verb === 'odds') {row.odds = body.odds; override.price = body.odds;}
  else {row.status = 'ENDED'; row.homeScore = body.homeScore; row.awayScore = body.awayScore;}
  return true;
}

try {
  vite = await createServer({root, configFile: false, cacheDir: `${root}/node_modules/.vite-admin-match-control`,
    plugins: [(await import('@vitejs/plugin-react')).default()],
    css: {postcss: {plugins: [tailwindcss({...tailwindConfig, content: [`${root}/src/**/*.{js,ts,jsx,tsx}`]}), autoprefixer()]}},
    server: {middlewareMode: true, hmr: false, fs: {allow: [fileURLToPath(new URL('..', import.meta.url))]}},
    appType: 'custom', optimizeDeps: {include: ['react', 'react-dom/client', 'axios', 'lucide-react']},
  });
  const app = express();
  app.use(express.json());
  app.use('/app/api', (request, response) => {
    const route = request.originalUrl.slice('/app/api'.length);
    if (request.method === 'GET' && route.split('?')[0] === '/admin/matches') {
      reads.push(route);
      response.set('Cache-Control', 'no-store').json({items: responseMatches().map(({markets, ...match}) => ({...match, markets: [], marketCount: null})), overrides, summary: true});
      return;
    }
    if (request.method === 'GET' && route.startsWith('/admin/matches/')) {
      reads.push(route);
      const id = decodeURIComponent(route.slice('/admin/matches/'.length).split('?')[0]);
      if (failedDetails.has(id)) {response.status(503).json({error: 'Tregjet nuk u ngarkuan. Provo rifreskimin.'}); return;}
      const item = responseMatches().find(match => match.id === id);
      if (!item) response.status(404).json({error: 'Unknown isolated fixture match'});
      else {
        const relevantOverrides = overrides.filter(override => override.ref === id || override.ref.startsWith(`${id}|`));
        const finish = () => {if (!response.destroyed) response.set('Cache-Control', 'no-store').json({item, overrides: relevantOverrides});};
        if (heldDetails.has(id)) waitingDetails.push(finish); else finish();
      }
      return;
    }
    if (request.method === 'PATCH' || request.method === 'POST') {
      const write = {method: request.method, route, body: structuredClone(request.body)};
      writes.push(write);
      const finish = () => {
        if (failedWrites.delete(route)) response.status(503).json({error: 'Veprimi i simuluar nuk u konfirmua.'});
        else if (!applyWrite(request.method, route, request.body)) {
          unexpected.push(write); response.status(400).json({error: 'Unexpected isolated fixture write'});
        } else response.json({success: true, overrides: []});
      };
      if (holdWrites) waitingWrites.push(finish); else finish();
      return;
    }
    unexpected.push({method: request.method, route});
    response.status(404).json({error: 'Unexpected isolated fixture endpoint'});
  });
  app.get('/', async (_request, response) => {
    try {response.type('html').send(await vite.transformIndexHtml('/', fixture));}
    catch (error) {failures.push(error.message); response.status(500).send('Fixture transform failed');}
  });
  app.use(vite.middlewares);
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  console.log('Isolated admin match-control fixture ready');
  browser = await puppeteer.launch({headless: true, args: []});
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(60000);
  page.on('pageerror', error => {failures.push(error.message); console.error('Admin fixture error:', error.message);});
  page.on('dialog', async dialog => {unexpected.push({dialog: dialog.message()}); await dialog.dismiss();});
  await page.setRequestInterception(true);
  page.on('request', request => request.url().startsWith(origin) || request.url().startsWith('data:') ? request.continue() : request.abort());
  await page.evaluateOnNewDocument(() => localStorage.setItem('token', 'isolated-admin-ui-test-only'));

  // UI scenarios are kept below the fixture so every action uses the real
  // component, rather than mirroring its state or implementation in this test.
  const attr = (name, value) => `[${name}=${JSON.stringify(value)}]`;
  const byLabel = text => `[aria-label=${JSON.stringify(text)}]`;
  const matchSelector = id => attr('data-admin-match-id', id);
  const marketSelector = id => attr('data-admin-market-id', id);
  const outcomeSelector = id => attr('data-admin-outcome-id', id);
  const dialog = label => `[role="dialog"][aria-label=${JSON.stringify(label)}]`;
  const visibleMatchIds = () => page.$$eval('[data-admin-match-id]', rows => rows.filter(row => row.getBoundingClientRect().height > 0).map(row => row.getAttribute('data-admin-match-id')).sort());
  const visibleMarketIds = () => page.$$eval('[data-admin-market-id]', rows => rows.filter(row => row.getBoundingClientRect().height > 0).map(row => row.getAttribute('data-admin-market-id')).sort());
  const expectIds = async (attribute, expected, label = attribute) => {
    try {
      await page.waitForFunction((attribute, expected) => {
        const ids = [...document.querySelectorAll(`[${attribute}]`)].filter(row => row.getBoundingClientRect().height > 0).map(row => row.getAttribute(attribute)).sort();
        return JSON.stringify(ids) === JSON.stringify(expected);
      }, {}, attribute, expected);
    } catch (error) {
      console.error('Admin filter state:', await page.evaluate(() => [...document.querySelectorAll('input, select')].map(input => ({label: input.getAttribute('aria-label'), value: input.value}))));
      await page.screenshot({path: `${artifactRoot}/failure.png`, fullPage: true});
      throw error;
    }
    const actual = attribute === 'data-admin-match-id' ? await visibleMatchIds() : await visibleMarketIds();
    assert.deepEqual(actual, expected, label);
  };
  const waitFor = async (check, label) => {
    const deadline = Date.now() + 10000;
    while (!check()) {
      assert.ok(Date.now() < deadline, `Timed out waiting for ${label}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const fill = async (selector, value) => {
    await page.waitForSelector(selector, {visible: true});
    await page.focus(selector);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    if (value !== '') await page.type(selector, String(value));
  };
  const button = async (text, scope = '') => {
    await page.waitForFunction((text, scope) => [...document.querySelectorAll(`${scope} button`)].some(row => row.textContent.trim() === text && row.getBoundingClientRect().height > 0), {}, text, scope);
    await page.evaluate((text, scope) => [...document.querySelectorAll(`${scope} button`)].find(row => row.textContent.trim() === text && row.getBoundingClientRect().height > 0).click(), text, scope);
  };
  const waitIdle = () => page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  const selectMatch = async id => {
    await page.click(matchSelector(id));
    await page.waitForSelector(attr('data-admin-selected-match', id), {visible: true});
    await waitIdle();
  };
  const assertFits = async label => {
    const layout = await page.evaluate(() => ({width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      overflows: [...document.querySelectorAll('input, select, button, [role="dialog"], [data-admin-market-id]')]
        .filter(element => {const r = element.getBoundingClientRect(); return r.height > 0 && (r.left < -1 || r.right > innerWidth + 1);})
        .map(element => ({text: (element.getAttribute('aria-label') || element.textContent || element.tagName).slice(0, 80), left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right})),
    }));
    assert.ok(layout.documentWidth <= layout.width + 1, `${label}: document fits viewport: ${JSON.stringify(layout)}`);
    assert.deepEqual(layout.overflows, [], `${label}: controls and dialog fit viewport`);
  };
  const assertDialogAction = async (label, text) => {
    const layout = await page.evaluate((selector, text) => {
      const action = [...document.querySelector(selector).querySelectorAll('button')].find(button => button.textContent.trim() === text);
      action.scrollIntoView({block: 'nearest'});
      const rect = action.getBoundingClientRect();
      const hit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
      return {top: rect.top, bottom: rect.bottom, height: rect.height, viewportHeight: innerHeight,
        uncovered: action === hit || action.contains(hit)};
    }, dialog(label), text);
    assert.ok(layout.height >= 40 && layout.top >= -1 && layout.bottom <= layout.viewportHeight + 1,
      `${label}: final action is large enough and reachable inside the visible dialog: ${JSON.stringify(layout)}`);
    assert.equal(layout.uncovered, true, `${label}: final action is not covered by another panel`);
  };

  await page.setViewport({width: 1366, height: 600});
  await page.goto(origin, {waitUntil: 'domcontentloaded'});
  await page.waitForSelector(matchSelector('101'));
  assert.equal(await page.$eval(byLabel('Rifreskim automatik'), input => input.checked), true, 'live admin refresh is enabled initially');
  await page.click(byLabel('Rifreskim automatik'));
  await expectIds('data-admin-match-id', ['101', '102', '103', '104', '105']);
  assert.match(reads[0], /summary=true/, 'initial list requests the light summary projection');
  await fill(byLabel('Kërko ndeshje'), 'arsenal');
  await expectIds('data-admin-match-id', ['101'], 'team search narrows the match list');
  await fill(byLabel('Kërko ndeshje'), '');
  await page.select(byLabel('Gjendja e ndeshjeve'), 'PREMATCH');
  await expectIds('data-admin-match-id', ['103', '104'], 'prematch includes UPCOMING');
  await page.select(byLabel('Gjendja e ndeshjeve'), 'LIVE');
  await expectIds('data-admin-match-id', ['101', '102']);
  await page.select(byLabel('Gjendja e ndeshjeve'), 'ENDED');
  await expectIds('data-admin-match-id', ['105']);
  await page.select(byLabel('Gjendja e ndeshjeve'), 'ALL');
  const serieA = await page.$eval(byLabel('Kampionati'), select => [...select.options].find(option => option.textContent.includes('Serie A')).value);
  await page.select(byLabel('Kampionati'), serieA);
  await expectIds('data-admin-match-id', ['103', '104'], 'tournament filter is independent of status');
  await page.select(byLabel('Kampionati'), 'ALL');
  await page.select(byLabel('Pezullimi i ndeshjeve'), 'SUSPENDED');
  await expectIds('data-admin-match-id', ['102']);
  await page.select(byLabel('Pezullimi i ndeshjeve'), 'ACTIVE');
  await expectIds('data-admin-match-id', ['101', '103', '104', '105']);
  await page.select(byLabel('Pezullimi i ndeshjeve'), 'ALL');
  await fill(byLabel('Kërko ndeshje'), 'asnje-ekip-i-tille');
  await expectIds('data-admin-match-id', [], 'empty search results have no stale rows');
  await fill(byLabel('Kërko ndeshje'), '');
  assert.equal(writes.length, 0, 'search and filters never write overrides');
  console.log('PASS admin match filters: team, status, tournament, suspension and empty results');

  heldDetails.add('103');
  await page.click(matchSelector('103'));
  await waitFor(() => reads.includes('/admin/matches/103'), 'first delayed detail');
  await selectMatch('104');
  heldDetails.delete('103');
  while (waitingDetails.length) waitingDetails.shift()();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.$eval('[data-admin-selected-match]', row => row.getAttribute('data-admin-selected-match')), '104', 'late older detail cannot replace the newly selected match');
  console.log('PASS match detail ordering: a delayed response cannot replace a newer selection');

  await selectMatch('101');
  assert.ok(reads.includes('/admin/matches/101'), 'selection fetches full details only for the chosen fixture');
  await page.waitForSelector(marketSelector(nativeMarketId));
  assert.equal((await visibleMarketIds()).length, 3);
  await button('Golat', '[data-admin-selected-match]');
  await expectIds('data-admin-market-id', [nativeMarketId], 'category filters preserve native market identity');
  await button('Të gjitha', '[data-admin-selected-match]');
  await fill(byLabel('Kërko treg ose zgjedhje'), '2.5');
  await expectIds('data-admin-market-id', [nativeMarketId], 'market search also finds the original line');
  await fill(byLabel('Kërko treg ose zgjedhje'), '');
  await page.select(byLabel('Gjendja e tregjeve'), 'SUSPENDED');
  await expectIds('data-admin-market-id', [], 'suspended market filter excludes active markets');
  await page.select(byLabel('Gjendja e tregjeve'), 'ALL');
  await expectIds('data-admin-market-id', ['101|1X2|', '101|corners|9.5', nativeMarketId].sort());
  await assertFits('desktop detail');
  await page.screenshot({path: `${artifactRoot}/desktop-1366.png`, fullPage: true});

  await page.click(attr('data-admin-edit-outcome', nativeOutcomeId));
  await page.waitForSelector(dialog('Ndrysho kuotën'), {visible: true});
  await assertDialogAction('Ndrysho kuotën', 'Ruaj kuotën');
  await fill(byLabel('Kuota e re'), '1');
  await button('Ruaj kuotën', dialog('Ndrysho kuotën'));
  assert.equal(writes.length, 0, 'odds of one cannot create a financial override');
  await fill(byLabel('Kuota e re'), '2.85');
  holdWrites = true;
  await page.evaluate(selector => {
    const form = document.querySelector(selector).querySelector('form');
    form.requestSubmit(); form.requestSubmit();
  }, dialog('Ndrysho kuotën'));
  await waitFor(() => writes.length > 0, 'odds save');
  assert.equal(writes.length, 1, 'double submission creates exactly one price override');
  assert.deepEqual(writes[0], {method: 'PATCH', route: `/admin/outcomes/${encodeURIComponent(nativeOutcomeId)}/odds`, body: {odds: 2.85}});
  await page.keyboard.press('Escape');
  assert.ok(await page.$(dialog('Ndrysho kuotën')), 'Escape cannot close a price write that is awaiting confirmation');
  holdWrites = false;
  while (waitingWrites.length) waitingWrites.shift()();
  while (waitingDetails.length) waitingDetails.shift()();
  await page.waitForSelector(dialog('Ndrysho kuotën'), {hidden: true});
  await waitIdle();
  await page.waitForFunction(selector => document.activeElement === document.querySelector(selector), {}, attr('data-admin-edit-outcome', nativeOutcomeId));
  await page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('2.85'), {}, outcomeSelector(nativeOutcomeId));
  console.log('PASS admin odds editing: validation, full native ID encoding, saved price and double-submit lock');

  const toggle = async (kind, id, body) => {
    const count = writes.length;
    const readCount = reads.length;
    await page.click(attr(`data-admin-toggle-${kind}`, id));
    await waitFor(() => writes.length === count + 1, `${kind} suspension`);
    assert.deepEqual(writes[count], {method: 'PATCH', route: `/admin/${kind === 'match' ? 'matches' : `${kind}s`}/${encodeURIComponent(id)}/suspend`, body});
    await waitFor(() => reads.length > readCount, 'refreshed admin overrides');
    await waitIdle();
  };
  await toggle('outcome', nativeOutcomeId, {status: 'SUSPENDED'});
  await toggle('market', '101|1X2|', {status: 'SUSPENDED'});
  await toggle('outcome', nativeOutcomeId, {status: 'ACTIVE'});
  await page.waitForFunction(selector => /pezull/i.test(document.querySelector(selector)?.textContent ?? ''), {}, outcomeSelector(nativeOutcomeId));
  await toggle('match', '101', {isSuspended: true});
  await toggle('market', '101|1X2|', {status: 'ACTIVE'});
  await page.waitForFunction(selector => /pezull/i.test(document.querySelector(selector)?.textContent ?? ''), {}, marketSelector('101|1X2|'));
  await toggle('match', '101', {isSuspended: false});
  console.log('PASS suspension contracts: match, market, outcome and inherited parent locks');
  await button('Fshih ndeshjen');await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Shfaq ndeshjen'));assert.equal(writes.at(-1).body.hidden,true);
  await button('Shfaq ndeshjen');await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Fshih ndeshjen'));assert.equal(writes.at(-1).body.hidden,false);console.log('PASS actual admin hide/show controls');

  const adjust = `${attr('data-admin-adjust-scope', 'market')}${attr('data-admin-adjust-id', nativeMarketId)}`;
  await page.click(adjust);
  await page.waitForSelector(dialog('Rregullo kuotat'), {visible: true});
  await assertDialogAction('Rregullo kuotat', 'Zbato ndryshimin');
  const beforePercentage = writes.length;
  await fill(byLabel('Përqindja e ndryshimit'), '-100');
  await button('Zbato ndryshimin', dialog('Rregullo kuotat'));
  assert.equal(writes.length, beforePercentage, 'invalid percentages do not change prices');
  await fill(byLabel('Përqindja e ndryshimit'), '5');
  assert.equal(writes.length, beforePercentage, 'preview cannot save a price without apply');
  const preview = await page.$eval(dialog('Rregullo kuotat'), element => element.textContent);
  assert.match(preview, /1[.,]90/, 'preview includes old prices');
  assert.match(preview, /2[.,]00/, 'preview includes adjusted prices');
  holdWrites = true;
  await page.evaluate(selector => {
    const form = document.querySelector(selector).querySelector('form');
    form.requestSubmit(); form.requestSubmit();
  }, dialog('Rregullo kuotat'));
  await waitFor(() => writes.length > beforePercentage, 'first market price');
  const percentageDeadline = Date.now() + 10000;
  while (writes.length < beforePercentage + 2) {
    while (waitingWrites.length) waitingWrites.shift()();
    assert.ok(Date.now() < percentageDeadline, 'all eligible outcomes are submitted');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await waitFor(() => writes.length === beforePercentage + 2, 'two market prices');
  assert.deepEqual(writes.slice(beforePercentage).map(write => ({route: write.route, body: write.body})), [
    {route: `/admin/outcomes/${encodeURIComponent('101|total|over')}/odds`, body: {odds: 1.995}},
    {route: `/admin/outcomes/${encodeURIComponent('101|total|under')}/odds`, body: {odds: 2.1}},
  ], 'bulk adjustment uses each original outcome endpoint, once, with preserved three-decimal contract');
  holdWrites = false;
  while (waitingWrites.length) waitingWrites.shift()();
  await page.waitForSelector(dialog('Rregullo kuotat'), {hidden: true});
  await waitIdle();
  console.log('PASS percentage preview and explicit apply: valid originals, per-outcome writes and double-submit lock');

  await page.click(adjust);
  await page.waitForSelector(dialog('Rregullo kuotat'), {visible: true});
  const partialStart = writes.length;
  failedWrites.add(`/admin/outcomes/${encodeURIComponent('101|total|under')}/odds`);
  await button('Zbato ndryshimin', dialog('Rregullo kuotat'));
  await waitFor(() => writes.length === partialStart + 2, 'partial percentage response');
  await waitIdle();
  await page.waitForFunction(selector => /U konfirmuan 1 nga 2 kuota/.test(document.querySelector(selector)?.textContent ?? ''), {}, dialog('Rregullo kuotat'));
  const over = matches[0].markets[1].outcomes[0];
  const under = matches[0].markets[1].outcomes[1];
  assert.equal(over.odds, 2.095, 'the confirmed part of a bulk update is refreshed accurately');
  assert.equal(under.odds, 2.1, 'a rejected write cannot change the other price');
  assert.equal(writes.length, partialStart + 2, 'failed batch writes are not retried silently');
  await button('Anulo', dialog('Rregullo kuotat'));
  console.log('PASS partial write failure: exact success count, authoritative refresh and no automatic retry');

  await page.click(attr('data-admin-edit-outcome', nativeOutcomeId));
  await page.waitForSelector(dialog('Ndrysho kuotën'), {visible: true});
  await page.$eval(dialog('Ndrysho kuotën'), container => {
    const fields = [...container.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
    fields.at(-1).focus();
  });
  await page.keyboard.press('Tab');
  assert.equal(await page.$eval(dialog('Ndrysho kuotën'), container => document.activeElement === container.querySelector('button:not(:disabled),input:not(:disabled)')), true, 'Tab wraps from the last control to the first');
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
  assert.equal(await page.$eval(dialog('Ndrysho kuotën'), container => document.activeElement === [...container.querySelectorAll('button:not(:disabled),input:not(:disabled)')].at(-1)), true, 'Shift+Tab wraps back to the final control');
  await page.keyboard.press('Escape');
  await page.waitForSelector(dialog('Ndrysho kuotën'), {hidden: true});
  assert.equal(await page.$eval(attr('data-admin-edit-outcome', nativeOutcomeId), button => document.activeElement === button), true, 'Escape restores the original price button focus');
  console.log('PASS keyboard dialog accessibility: forward/backward focus trap and safe Escape/focus restore');

  await button('Vendos rezultatin', '[data-admin-selected-match]');
  await page.waitForSelector(dialog('Vendos rezultatin'), {visible: true});
  await assertDialogAction('Vendos rezultatin', 'Ruaj dhe përditëso skedinat');
  const beforeSettlement = writes.length;
  for (const invalid of ['', '-1', '1.5']) {
    await fill(byLabel('Golat e Arsenal'), invalid);
    await button('Ruaj dhe përditëso skedinat', dialog('Vendos rezultatin'));
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(writes.length, beforeSettlement, `settlement score ${JSON.stringify(invalid)} cannot change results or money`);
  }
  await fill(byLabel('Golat e Arsenal'), '2');
  await fill(byLabel('Golat e Chelsea'), '1');
  const settlementReview = await page.$eval(dialog('Vendos rezultatin'), element => element.textContent);
  assert.match(settlementReview, /Arsenal/, 'review names the selected home team');
  assert.match(settlementReview, /Chelsea/, 'review names the selected away team');
  assert.match(settlementReview, /skedin|pages|fitim/i, 'review explains the financial consequence before submit');
  assert.equal(writes.length, beforeSettlement, 'editing the final score never settles automatically');
  holdWrites = true;
  await page.evaluate(selector => {
    const form = document.querySelector(selector).querySelector('form');
    form.requestSubmit(); form.requestSubmit();
  }, dialog('Vendos rezultatin'));
  await waitFor(() => writes.length === beforeSettlement + 1, 'reviewed settlement');
  assert.deepEqual(writes[beforeSettlement], {method: 'POST', route: '/admin/matches/101/settle', body: {homeScore: 2, awayScore: 1}});
  holdWrites = false;
  while (waitingWrites.length) waitingWrites.shift()();
  await page.waitForSelector(dialog('Vendos rezultatin'), {hidden: true});
  await waitIdle();
  console.log('PASS settlement: explicit result review, integer validation and exactly one financial submit');
  matches = initialMatches();
  overrides.splice(0, overrides.length, {kind: 'match', ref: '102', suspended: true, price: null, updatedAt: '2026-10-25T13:00:00Z'});

  for (const viewport of [
    {width: 390, height: 844, isMobile: true, hasTouch: true},
    {width: 320, height: 568, isMobile: true, hasTouch: true},
  ]) {
    await page.setViewport(viewport);
    await page.goto(origin, {waitUntil: 'domcontentloaded'});
    await page.waitForSelector(matchSelector('101'));
    await assertFits(`${viewport.width}px match list`);
    await selectMatch('101');
    await assertFits(`${viewport.width}px detail`);
    await page.screenshot({path: `${artifactRoot}/phone-${viewport.width}.png`, fullPage: true});
    await page.click(attr('data-admin-edit-outcome', nativeOutcomeId));
    await page.waitForSelector(dialog('Ndrysho kuotën'), {visible: true});
    await assertFits(`${viewport.width}px price dialog`);
    await assertDialogAction('Ndrysho kuotën', 'Ruaj kuotën');
    const fontSize = await page.$eval(byLabel('Kuota e re'), input => Number.parseFloat(getComputedStyle(input).fontSize));
    assert.ok(fontSize >= 16, 'mobile amount input does not trigger automatic zoom');
    await button('Anulo', dialog('Ndrysho kuotën'));
    await page.waitForSelector(dialog('Ndrysho kuotën'), {hidden: true});
    await page.click(adjust);
    await page.waitForSelector(dialog('Rregullo kuotat'), {visible: true});
    await assertFits(`${viewport.width}px adjustment preview`);
    await page.screenshot({path: `${artifactRoot}/adjustment-${viewport.width}.png`, fullPage: false});
    await assertDialogAction('Rregullo kuotat', 'Zbato ndryshimin');
    await button('Anulo', dialog('Rregullo kuotat'));
    await button('Vendos rezultatin', '[data-admin-selected-match]');
    await page.waitForSelector(dialog('Vendos rezultatin'), {visible: true});
    await assertFits(`${viewport.width}px result review`);
    await assertDialogAction('Vendos rezultatin', 'Ruaj dhe përditëso skedinat');
    await button('Anulo', dialog('Vendos rezultatin'));
    await button('Kthehu te ndeshjet');
    await page.waitForSelector(matchSelector('105'), {visible: true});
    await selectMatch('105');
    await assertFits(`${viewport.width}px long team names`);
    await button('Kthehu te ndeshjet');
    console.log(`PASS admin mobile ${viewport.width}px: master/detail, native odds dialog and long names fit the viewport`);
  }

  for (const viewport of [{width: 1366, height: 768}, {width: 1024, height: 768}]) {
    await page.setViewport(viewport);
    await page.goto(origin, {waitUntil: 'domcontentloaded'});
    await page.waitForSelector(matchSelector('101'));
    await page.evaluate(() => document.body.classList.add('with-admin-sidebar'));
    await selectMatch('101');
    await assertFits(`${viewport.width}px with the actual admin sidebar space`);
    const widths = await page.evaluate(() => ({list: document.querySelector('.mc-list').getBoundingClientRect().width,
      detail: document.querySelector('.mc-detail').getBoundingClientRect().width}));
    assert.ok(widths.list >= 220 && widths.detail >= 320, 'both desktop panels remain practical beside the admin sidebar');
    await page.screenshot({path: `${artifactRoot}/sidebar-${viewport.width}.png`, fullPage: true});
    console.log(`PASS admin sidebar layout ${viewport.width}px: match list ${Math.round(widths.list)}px, detail ${Math.round(widths.detail)}px`);
  }

  const staleWriteCount = writes.length;
  failedDetails.add('101');
  await button('Rifresko');
  await page.waitForFunction(() => document.querySelector('[data-admin-toggle-match="101"]')?.disabled === true
    && [...document.querySelectorAll('[role="alert"]')].some(alert => /Tregjet nuk u ngarkuan/.test(alert.textContent)));
  const disabled = await page.$$eval('[data-admin-toggle-match], [data-admin-toggle-market], [data-admin-toggle-outcome], [data-admin-edit-outcome], [data-admin-adjust-scope]',
    buttons => buttons.every(button => button.disabled));
  assert.equal(disabled, true, 'a failed detail refresh blocks writes on every stale market and outcome');
  failedDetails.delete('101');
  await button('Rifresko');
  await page.waitForFunction(() => document.querySelector('[data-admin-toggle-match="101"]')?.disabled === false
    && ![...document.querySelectorAll('[role="alert"]')].some(alert => /Tregjet nuk u ngarkuan/.test(alert.textContent)));
  assert.equal(writes.length, staleWriteCount, 'read errors and their recovery never write a market or account');
  console.log('PASS failed detail refresh: stale actions stay disabled until a successful authoritative refresh');

  assert.deepEqual(unexpected, [], 'all requests use the existing isolated admin contract');
  assert.deepEqual(failures, [], 'the real admin component has no browser errors');
  console.log('PASS isolated admin match control: filters, prices, suspensions, reviewed mutations and desktop/mobile layout');
} finally {
  holdWrites = false;
  while (waitingWrites.length) waitingWrites.shift()();
  while (waitingDetails.length) waitingDetails.shift()();
  await browser?.close();
  await vite?.close();
  if (server) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
}
