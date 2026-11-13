import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { Server as SocketServer } from 'socket.io';
import { buildSystemColumns, splitSystemStake, systemColumnPayout } from '../server/ledger/system-columns.mjs';

// The real React context, betslip and receipt run against local fake APIs only.
const root = fileURLToPath(new URL('../web', import.meta.url));
const fixture = `<!doctype html><html><body><div id="root"></div><script type="module">
import React from '/src/../node_modules/.vite/deps/react.js';
import {createRoot} from '/src/../node_modules/.vite/deps/react-dom_client.js';
import {MemoryRouter} from 'react-router-dom';
import {BetslipProvider,useBetslip} from '/src/context/BetslipContext.tsx';
import {LanguageProvider} from '/src/context/LanguageContext.tsx';
import {AuthProvider} from '/src/context/AuthContext.tsx';
import {LiveFeedProvider,useLiveFeed} from '/src/api/liveFeed.tsx';
import Betslip from '/src/components/Betslip/Betslip.tsx';
import OddsButton from '/src/components/Sports/OddsButton.tsx';
import LiveMatchTime from '/src/components/Sports/LiveMatchTime.tsx';
function Probe(){window.probeRenders=(window.probeRenders??0)+1;window.slip=useBetslip();window.feed=useLiveFeed();return null;}
function BuilderButtonFixture(){
  const [quote,setQuote]=React.useState(()=>({
    match:{id:'C',tournamentId:1,homeTeam:'Arsenal',awayTeam:'Chelsea',status:'PREMATCH',startTime:new Date(Date.now()+3600000).toISOString(),isSuspended:false},
    market:{id:'BB|C|automatic',matchId:'C',marketType:'BET_BUILDER',name:'Bet Builder · 1 + Over 2.5',status:'ACTIVE',sortOrder:1,builderQuotedAt:new Date().toISOString(),builderLegs:[
      {marketId:'C|result|',outcomeId:'C|result||1',odds:2},
      {marketId:'C|total|2.5',outcomeId:'C|total|2.5|Over',odds:3}
    ]},
    outcome:{id:'BB|C|automatic|combo',marketId:'BB|C|automatic',name:'1 + Over 2.5',odds:6,status:'ACTIVE'}
  }));
  window.builderQuote=quote;window.setBuilderQuote=setQuote;
  return React.createElement('div',{id:'fixture-combo'},React.createElement(OddsButton,quote));
}
createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,React.createElement(LanguageProvider,null,
  React.createElement(AuthProvider,null,React.createElement(BetslipProvider,null,
    React.createElement(LiveFeedProvider,null,React.createElement(Probe),React.createElement(BuilderButtonFixture),React.createElement('span',{id:'fixture-clock'},React.createElement(LiveMatchTime,{minute:12,second:10,seconds:true})),React.createElement(Betslip)))))));
</script></body></html>`;
// Resolve React through Vite's dependency optimizer rather than a fixed cache filename.
const html = fixture.replace("'/src/../node_modules/.vite/deps/react.js'", "'react'")
  .replace("'/src/../node_modules/.vite/deps/react-dom_client.js'", "'react-dom/client'");
let server, vite, browser, socketServer;
const requests = [], plainRequests = [], failures = [];
let failNextPlacement = false;
let oddsChangedResponse = null;
const selection = (matchId, outcomeId, odds, marketId = `${matchId}-1x2`, outcomeName = '1') => ({
  matchId, outcomeId, odds, marketId, outcomeName,
  marketName: marketId.includes('total') ? 'Total Goals' : 'Full Time Result',
  marketLine: marketId.includes('total') ? '3.5' : undefined,
  matchName: matchId === 'A' ? 'Al Arabi vs Al Nejmeh' : 'Saturn vs Rodina',
});
const fixtureSelections = [selection('A', 'A1', 5), selection('A', 'Aover', 2.1, 'A-total', 'Over'), selection('B', 'B1', 15.18)];
const alternativeOutcome=selection('A','A2',3);
const makeTickets = body => {
  const selections = body.selections.map(row => fixtureSelections.find(selection => selection.outcomeId === row.outcomeId) ?? (row.outcomeId === alternativeOutcome.outcomeId ? alternativeOutcome : null));
  const columns = buildSystemColumns(selections);
  const stakes = splitSystemStake(body.totalStake, columns.length);
  return columns.map((column, index) => ({
    id: `00000000-0000-0000-0000-00000000000${index}`, ticketType: column.length > 1 ? 'COMBO' : 'SINGLE',
    placedAt: new Date().toISOString(), status: 'PENDING', stake: stakes[index],
    totalOdds: column.reduce((product, row) => product * row.odds, 1),
    potentialPayout: systemColumnPayout(stakes[index], column.map(row => row.odds)),
    lines: column.map(row => ({ ...row, id: row.outcomeId, oddsAtPlacement: row.odds, status: 'PENDING' })),
  }));
};

try {
  vite = await createServer({ root, configFile: false, plugins: [(await import('@vitejs/plugin-react')).default()],
    server: { middlewareMode: true, hmr: false, fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
    appType: 'custom', optimizeDeps: { include: ['react', 'react-dom/client', 'react-router-dom', 'axios', 'lucide-react'] },
  });
  const app = express();
  app.use(express.json());
  app.get('/app/api/auth/me', (_request, response) => response.json({ id: 'test-player', username: 'isolated', role: 'PLAYER', balance: 10000, currency: 'ALL', status: 'ACTIVE' }));
  app.post('/app/api/bets/place-columns', async (request, response) => {
    requests.push(request.body);
    await new Promise(resolve => setTimeout(resolve, 120));
    if (failNextPlacement) {
      failNextPlacement = false;
      return response.status(500).json({ message: 'Test response lost; retry safely.' });
    }
    const columns = makeTickets(request.body);
    const uniqueLines = [...new Map(columns.flatMap(column => column.lines).map(line => [line.outcomeId, line])).values()];
    response.json({ id:'SYS-00000000-0000-4000-8000-000000000001', ticketType:'SYSTEM',
      placedAt:columns[0].placedAt, status:'PENDING', stake:request.body.totalStake, totalOdds:0,
      potentialPayout:columns.reduce((sum,column)=>sum+column.potentialPayout,0), lines:uniqueLines,
      system:{batchId:'00000000-0000-4000-8000-000000000001',columnCount:columns.length,columns,
        minColumnPayout:Math.min(...columns.map(column=>column.potentialPayout)),
        maxColumnPayout:Math.max(...columns.map(column=>column.potentialPayout)),paidOut:0,refunded:0,pendingColumns:columns.length} });
  });
  app.post('/app/api/bets/place', async (request, response) => {
    plainRequests.push(request.body);
    await new Promise(resolve=>setTimeout(resolve,120));
    if(failNextPlacement){
      failNextPlacement=false;
      return response.status(500).json({message:'Test response lost; retry safely.'});
    }
    if (oddsChangedResponse) {
      const changed = oddsChangedResponse;
      oddsChangedResponse = null;
      return response.status(409).json(changed);
    }
    const lines = request.body.selections.map(row => ({
      ...row, id: row.outcomeId, matchId: 'C', marketId: 'BB|C|automatic',
      matchName: 'Arsenal vs Chelsea', marketName: 'Bet Builder · 1 + Over 2.5',
      outcomeName: '1 + Over 2.5', status: 'PENDING',
    }));
    response.json({
      id: '00000000-0000-0000-0000-000000000099', ticketType: 'SINGLE', status: 'PENDING',
      placedAt: new Date().toISOString(), stake: request.body.stake, lines,
      totalOdds: lines.reduce((product, row) => product * row.oddsAtPlacement, 1),
      potentialPayout: systemColumnPayout(request.body.stake, lines.map(row => row.oddsAtPlacement)),
    });
  });
  app.get('/', async (_request, response) => {
    try { response.type('html').send(await vite.transformIndexHtml('/', html)); }
    catch (error) { failures.push(error.message); response.status(500).send('Fixture transform failed'); }
  });
  app.use(vite.middlewares);
  server = http.createServer(app);
  socketServer = new SocketServer(server, { serveClient: false });
  socketServer.on('connection', socket => socket.emit('combos:settings', { enabled: true }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  console.log('Local betslip fixture ready; opening isolated browser');
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', error => failures.push(error.message));
  page.on('dialog', dialog => dialog.dismiss());
  await page.setRequestInterception(true);
  page.on('request', request => request.url().startsWith(origin) || request.url().startsWith('data:') ? request.continue() : request.abort());
  await page.evaluateOnNewDocument(() => localStorage.setItem('token', 'isolated-test-token'));
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.slip, { timeout: 60000 });
  await page.waitForFunction(() => window.feed.connected);
  // Simulate a LAN HTTP/mobile WebView: crypto.randomUUID() is undefined
  // while crypto.getRandomValues() still works. Every placement below must
  // generate a valid stable key and survive an uncertain-response retry.
  const uuidFallback=await page.evaluate(()=>{
    Object.defineProperty(window.crypto,'randomUUID',{configurable:true,value:undefined});
    return {randomUUID:typeof window.crypto.randomUUID,getRandomValues:typeof window.crypto.getRandomValues};
  });
  assert.deepEqual(uuidFallback,{randomUUID:'undefined',getRandomValues:'function'});
  console.log('Real React betslip and local socket connected, without crypto.randomUUID');
  const snapshot = () => page.evaluate(() => ({
    stake: window.slip.stake, type: window.slip.ticketType,
    columns: window.slip.columns.map(column => column.map(row => row.outcomeId)),
    stakes: window.slip.columnStakes, payouts: window.slip.columnPreviews.map(column => column.payout),
    total: window.slip.potentialPayout, overflow: window.slip.columnsOverflow,
  }));
  const add = async rows => {
    const expected=await page.evaluate(rows=>{
      let picks=[...window.slip.selections];
      const identity=value=>{
        const parts=String(value.outcomeId??'').split('|');
        if(parts.length>=4&&parts[0]&&parts[1])
          return JSON.stringify(parts.slice(0,3));
        return JSON.stringify([String(value.matchId??''),String(value.marketId??''),
          String(value.marketLine??''),Number(value.period??0)]);
      };
      rows.forEach(row=>{
        const matched=picks.some(pick=>pick.outcomeId===row.outcomeId);
        const index=picks.findIndex(pick=>identity(pick)===identity(row));
        if(matched)picks=picks.filter(pick=>identity(pick)!==identity(row));
        else if(index>=0)picks.splice(index,1,row);
        else picks.push(row);
        window.slip.addSelection(row);
      });
      return picks.map(row=>row.outcomeId);
    },rows);
    await page.waitForFunction(ids=>
      JSON.stringify(window.slip.selections.map(row=>row.outcomeId))===JSON.stringify(ids)&&
      (!ids.length||[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Vendos Bastin')),
      {},expected);
  };
  const waitType=type=>page.waitForFunction(type=>window.slip.ticketType===type,{},type);
  const builderOptions=[{
    ...fixtureSelections[0],outcomeId:'BB|A|yes-over',marketId:'BB|A|yes-over|market',marketName:'Bet Builder: Both Teams to Score + Total Goals',
    builderLegs:[{marketId:'A|btts|',outcomeId:'A|btts||Yes'},{marketId:'A|total|2.5',outcomeId:'A|total|2.5|Over'}],
  },{
    ...fixtureSelections[0],outcomeId:'BB|A|no-under',marketId:'BB|A|no-under|market',marketName:'Bet Builder: Both Teams to Score + Total Goals',
    builderLegs:[{marketId:'A|total|2.5',outcomeId:'A|total|2.5|Under'},{marketId:'A|btts|',outcomeId:'A|btts||No'}],
  }];
  await page.evaluate(rows=>rows.forEach(row=>window.slip.addSelection(row)),builderOptions);
  await page.waitForFunction(()=>window.slip.selections.length===1&&window.slip.selections[0].outcomeId==='BB|A|no-under');
  await waitType('SINGLE');
  assert.equal((await snapshot()).columns.length,1,
    'two outcomes of the same builder source contracts must not create independent columns');
  await page.evaluate(()=>window.slip.clearAll());
  await page.waitForFunction(()=>window.slip.selections.length===0);

  // Different markets on the SAME match remain valid in one COMBO.
  await add([fixtureSelections[0],fixtureSelections[2]]);
  await waitType('COMBO');
  await add([fixtureSelections[1]]);
  assert.deepEqual((await snapshot()).columns,[['A1','B1','Aover']]);
  assert.equal((await snapshot()).stake,'100');
  assert.deepEqual((await snapshot()).stakes,[10000]);

  // Switching the 1X2 selection REPLACES it, not a parallel paid column.
  await add([alternativeOutcome]);
  await waitType('COMBO');
  assert.deepEqual((await snapshot()).columns,[['A2','B1','Aover']]);
  await add([alternativeOutcome]); // same choice removes itself
  await waitType('COMBO');
  assert.deepEqual((await snapshot()).columns,[['B1','Aover']]);
  const under=selection('A','Aunder',2,'A-total','Under');
  await add([under]);
  assert.deepEqual((await snapshot()).columns,[['B1','Aunder']]);
  await add([selection('A','Abtts',4,'A-btts','Yes')]);
  assert.deepEqual((await snapshot()).columns,[['B1','Aunder','Abtts']]);
  await page.evaluate(()=>window.slip.clearAll());
  await page.waitForFunction(()=>window.slip.selections.length===0);

  // The server should receive exactly ONE choice per market: no SYSTEM calls.
  // The ordinary idempotent COMBO endpoint handles a lost-response retry.
  await add([...fixtureSelections,alternativeOutcome]);
  await waitType('COMBO');
  assert.deepEqual((await snapshot()).columns,[['A2','Aover','B1']]);
  failNextPlacement=true;
  await page.evaluate(()=>{
    const button=[...document.querySelectorAll('button')]
      .find(button=>button.textContent.trim()==='Vendos Bastin');
    button.click();button.click();
  });
  await page.waitForFunction(()=>!window.slip.isPlacingBet);
  assert.equal(plainRequests.length,1,'a double click must not debit twice');
  assert.equal(plainRequests[0].stake,100);
  assert.equal(plainRequests[0].selections.length,3);
  assert.equal(requests.length,0,'there must be no system-column financial requests');
  await page.evaluate(()=>[...document.querySelectorAll('button')]
    .find(button=>button.textContent.trim()==='Vendos Bastin').click());
  await page.waitForFunction(()=>document.querySelector('.ticket-print-panel')?.innerText.includes('BILETË BASTI'));
  assert.equal(plainRequests.length,2);
  assert.equal(plainRequests[0].clientRequestId,plainRequests[1].clientRequestId,
    'a lost response must retry the same idempotency key');
  const receiptText=await page.$eval('.ticket-print-panel',el=>el.innerText);
  assert.ok(receiptText.includes('100.00 Lëk'));
  assert.ok(!receiptText.includes('2 kolona'),'ordinary COMBO is not an alternative system');
  plainRequests.length=0;
  await page.click('button[aria-label="Mbyll"]');
  await page.waitForFunction(()=>!document.body.innerText.includes('BILETË BASTI'));

  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  await add([...fixtureSelections,alternativeOutcome]);
  await waitType('COMBO');
  assert.deepEqual((await snapshot()).stakes,[10000]);
  await page.evaluate(()=>window.slip.clearAll());
  await page.waitForFunction(()=>window.slip.selections.length===0);
  // The real shared Socket.IO provider immediately disables a prefilled combo.
  await page.evaluate(() => window.slip.clearAll());
  await page.waitForFunction(() => window.slip.selections.length === 0);
  await add([{ ...fixtureSelections[0], outcomeId: 'BB|A|combo|1', marketName: 'Bet Builder · 1 + Over 2.5' }]);
  socketServer.emit('combos:settings', { enabled: false });
  await page.waitForFunction(() => window.feed.combosEnabled === false && document.body.innerText.includes('Combot janë çaktivizuar'));
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Vendos Bastin')?.disabled), true);
  assert.equal(await page.$eval('#fixture-combo button', button => button.disabled), true, 'combo setting also disables real market button');
  // An ordinary multi-match accumulator remains available with combos disabled.
  await page.evaluate(() => window.slip.clearAll());
  await page.waitForFunction(() => window.slip.selections.length === 0);
  await add([fixtureSelections[0], fixtureSelections[2]]);
  await waitType('COMBO');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Vendos Bastin')?.disabled), false);
  socketServer.emit('combos:settings', { enabled: true });
  await page.waitForFunction(() => window.feed.combosEnabled === true);
  await page.evaluate(() => window.slip.clearAll());
  await page.waitForFunction(() => window.slip.selections.length === 0);
  await add([{ ...fixtureSelections[0], outcomeId: 'native-mixed', marketName: 'Result and Total Goals' }]);
  socketServer.emit('combos:settings', { enabled: false });
  await page.waitForFunction(() => window.feed.combosEnabled === false && document.body.innerText.includes('Combot janë çaktivizuar'));
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Vendos Bastin')?.disabled), true);
  socketServer.emit('combos:settings', { enabled: true });
  await page.waitForFunction(() => window.feed.combosEnabled === true && !document.body.innerText.includes('Combot janë çaktivizuar'));
  await page.evaluate(() => window.slip.clearAll());
  await page.waitForFunction(() => window.slip.selections.length === 0);
  await page.waitForFunction(() => document.querySelector('#fixture-combo button').textContent.includes('6.00'));
  const quoteTime = await page.evaluate(() => Date.parse(window.builderQuote.market.builderQuotedAt));
  const legUpdate = (key, line, outcomeKey, price, offset, suspended = false) => socketServer.emit('odds:update', {
    matchId: 'C', at: new Date(quoteTime + offset).toISOString(),
    markets: [{ key, line, outcomes: [{ key: outcomeKey, price, suspended }] }],
  });
  const socketBarrier = async () => {
    // Socket.IO preserves event order. Wait for a following state message so
    // rejected stale ticks have definitely been received before assertions.
    socketServer.emit('feed:state', { mode: 'idle' });
    await page.waitForFunction(() => window.feed.feedMode === 'idle');
    socketServer.emit('feed:state', { mode: 'live' });
    await page.waitForFunction(() => window.feed.feedMode === 'live');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  // The first socket price for a leg must be published, even without a previous socket tick.
  legUpdate('result', '', '1', 2.5, 1000);
  await page.waitForFunction(() => document.querySelector('#fixture-combo button').textContent.includes('7.50'));
  assert.equal(await page.evaluate(() => window.feed.oddsDeltas['C|result||1'].newOdds), 2.5);
  await page.click('#fixture-combo button');
  await page.waitForFunction(() => window.slip.selections.some(selection => selection.outcomeId === 'BB|C|automatic|combo'));
  assert.equal(await page.evaluate(() => window.slip.selections[0].odds), 7.5, 'button adds current derived product, not stale REST odds');
  legUpdate('total', '2.5', 'Over', 3.2, 1500);
  await page.waitForFunction(() => document.querySelector('#fixture-combo button').textContent.includes('8.00'));
  assert.equal(await page.evaluate(() => window.slip.selections[0].odds), 7.5, 'socket quote changes never silently accept a new betslip price');
  // A fresh REST response supersedes cached socket prices older than its quote timestamp.
  await page.evaluate(quotedAt => window.setBuilderQuote(previous => ({
    ...previous,
    market: { ...previous.market, builderQuotedAt: quotedAt,
      builderLegs: previous.market.builderLegs.map((leg, index) => ({ ...leg, odds: index ? 4 : 3 })) },
    outcome: { ...previous.outcome, odds: 12 },
  })), new Date(quoteTime + 5000).toISOString());
  await page.waitForFunction(() => document.querySelector('#fixture-combo button').textContent.includes('12.00'));
  legUpdate('result', '', '1', 1.8, 2500);
  await page.waitForFunction(() => window.feed.oddsDeltas['C|result||1'].newOdds === 1.8);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.ok((await page.$eval('#fixture-combo button', button => button.textContent)).includes('12.00'), 'old socket message cannot roll back fresh REST quote');
  legUpdate('result', '', '1', 3.5, 6000);
  await page.waitForFunction(() => document.querySelector('#fixture-combo button').textContent.includes('14.00'));
  // Older socket data cannot replace a newer tick even when both follow the REST quote.
  legUpdate('result', '', '1', 3.2, 5500);
  await socketBarrier();
  assert.equal(await page.evaluate(() => window.feed.oddsDeltas['C|result||1'].newOdds), 3.5, 'out-of-order socket price is discarded');
  assert.ok((await page.$eval('#fixture-combo button', button => button.textContent)).includes('14.00'));
  // An older provider suspension must not lock a current, active price either.
  legUpdate('result', '', '1', 3.2, 5500, true);
  await socketBarrier();
  assert.equal(await page.$eval('#fixture-combo button', button => button.disabled), false, 'out-of-order provider lock is discarded');
  assert.equal(await page.evaluate(() => window.slip.selections[0].odds), 7.5);
  socketServer.emit('risk:locks', { locks: { 'C|result||1': true } });
  await page.waitForFunction(() => document.querySelector('#fixture-combo button').disabled);
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Vendos Bastin').disabled),true,'a source lock must block a combo already in the slip');
  await page.$eval('#fixture-combo button', button => button.click());
  assert.equal(await page.evaluate(() => window.slip.selections.length), 1, 'risk-locked combo ignores clicks');
  socketServer.emit('risk:locks', { locks: { 'C|result||1': false } });
  await page.waitForFunction(() => !document.querySelector('#fixture-combo button').disabled);
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Vendos Bastin').disabled),false);
  legUpdate('result', '', '1', 3.5, 6500, true);
  await page.waitForFunction(() => document.querySelector('#fixture-combo button').disabled);
  legUpdate('result', '', '1', 3.5, 7000, false);
  await page.waitForFunction(() => !document.querySelector('#fixture-combo button').disabled);
  await page.click('#fixture-combo button');
  await page.waitForFunction(() => window.slip.selections.length === 0);
  await page.click('#fixture-combo button');
  await page.waitForFunction(() => window.slip.selections.length === 1);
  assert.equal(await page.evaluate(() => window.slip.selections[0].odds), 14, 'explicit removal and re-add uses latest quote');
  // A repeated source price still carries freshness after a newer REST quote.
  await page.evaluate(quotedAt => window.setBuilderQuote(previous => ({
    ...previous,
    market: { ...previous.market, builderQuotedAt: quotedAt,
      builderLegs: previous.market.builderLegs.map(leg => ({ ...leg, odds: 4 })) },
    outcome: { ...previous.outcome, odds: 16 },
  })), new Date(quoteTime + 7500).toISOString());
  await page.waitForFunction(() => document.querySelector('#fixture-combo button').textContent.includes('16.00'));
  legUpdate('result', '', '1', 3.5, 8000);
  await socketBarrier();
  await page.waitForFunction(() => document.querySelector('#fixture-combo button').textContent.includes('14.00'));
  assert.equal(await page.evaluate(() => window.feed.oddsDeltas['C|result||1'].at), quoteTime + 8000);
  assert.equal(await page.evaluate(() => window.slip.selections[0].odds), 14, 'fresh same-price ticks still do not auto-accept betslip odds');
  // Offered two-decimal price changes still require an explicit acceptance.
  await page.evaluate(() => window.slip.clearAll());
  await page.waitForFunction(() => window.slip.selections.length === 0);
  await add([{ ...fixtureSelections[0], outcomeId: 'BB|C|tiny-change|combo', odds: 3.96, marketName: 'Bet Builder · 1 + Over 2.5' }]);
  oddsChangedResponse = { code: 'ODDS_CHANGED', message: 'Odds have changed',
    outcomeId: 'BB|C|tiny-change|combo', oldOdds: 3.96, newOdds: 3.97 };
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Vendos Bastin').click());
  await page.waitForSelector('[role="dialog"]');
  assert.equal(await page.$eval('[role="dialog"]', modal => [...modal.querySelectorAll('div')].some(node => node.textContent.trim() === '@3.96')), true);
  assert.equal(await page.$eval('[role="dialog"]', modal => [...modal.querySelectorAll('div')].some(node => node.textContent.trim() === '@3.97')), true);
  assert.equal(await page.evaluate(() => window.slip.selections[0].odds), 3.96);
  await page.evaluate(() => [...document.querySelector('[role="dialog"]').querySelectorAll('button')].find(button => button.textContent.includes('Përditëso Biletën')).click());
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]') && window.slip.selections[0].odds === 3.97);
  assert.equal(plainRequests.length, 1, 'accepting a quote updates the slip without automatically placing it');
  assert.ok((await page.$eval('body', body => body.innerText)).includes('397.00'), 'the accepted two-decimal quote matches the money preview');
  // Long products use the same rounded quote on button, slip and receipt.
  await page.evaluate(quotedAt => {
    window.slip.clearAll();
    window.setBuilderQuote(previous => ({ ...previous,
      market: { ...previous.market, builderQuotedAt: quotedAt,
        builderLegs: previous.market.builderLegs.map((leg, index) => ({ ...leg, odds: index ? 1.9 : 4.31 })) },
      outcome: { ...previous.outcome, odds: 8.19 },
    }));
  }, new Date(quoteTime + 9000).toISOString());
  await page.waitForFunction(() => document.querySelector('#fixture-combo button').textContent.includes('8.19') && window.slip.selections.length === 0);
  await page.click('#fixture-combo button');
  await page.waitForFunction(() => window.slip.selections[0]?.odds === 8.19);
  assert.equal(await page.evaluate(() => window.slip.potentialPayout), 819);
  assert.ok((await page.$eval('body', body => body.innerText)).includes('819.00'));
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('strong')].some(node => node.textContent.trim() === '8.19')));
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Vendos Bastin').click());
  await page.waitForSelector('.ticket-print-panel');
  assert.equal(plainRequests[1].selections[0].oddsAtPlacement, 8.19);
  assert.equal(await page.$eval('.ticket-print-panel', receipt => [...receipt.querySelectorAll('strong')].filter(node => node.textContent.trim() === '8.19').length), 2);
  assert.ok((await page.$eval('.ticket-print-panel', receipt => receipt.innerText)).includes('819.00'));
  await page.click('button[aria-label="Mbyll"]');
  await page.waitForFunction(() => !document.querySelector('.ticket-print-panel'));
  // Definitive rejection suspends the real selection and every combo using it;
  // do not leave a repeatedly clickable stale quote behind the warning.
  await add([{...fixtureSelections[0],outcomeId:'C|result||1',matchId:'C',marketId:'C|result|',odds:4.31}]);
  oddsChangedResponse={code:'SELECTION_UNAVAILABLE',message:'Selection unavailable',outcomeId:'C|result||1'};
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Vendos Bastin').click());
  await page.waitForFunction(()=>document.querySelector('#fixture-combo button').disabled);
  assert.ok(!(await page.$eval('body',body=>body.innerText)).includes('Kuota joaktive u pezullua'), 'closed quotes are disabled without the removed warning');
  assert.ok((await page.$eval('body',body=>body.innerText)).includes('Pezulluar'));
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Vendos Bastin').disabled),true);
  const beforeRetry=plainRequests.length;
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Vendos Bastin').click());
  assert.equal(plainRequests.length,beforeRetry,'refused quote cannot be submitted again');
  socketServer.emit('odds:update',{matchId:'C',at:new Date(Math.max(Date.now()+1000,quoteTime+10000)).toISOString(),markets:[{key:'result',line:'',outcomes:[{key:'1',price:4.31,suspended:false}]}]});
  await page.waitForFunction(()=>!document.querySelector('#fixture-combo button').disabled&&!document.body.innerText.includes('Ka kuota të pezulluara'));
  // A live score invalidates a jointly impossible combination immediately,
  // even though both source markets would be independently undecided.
  await page.evaluate(()=>window.setBuilderQuote(previous=>({...previous,
    match:{...previous.match,status:'LIVE',homeScore:1,awayScore:2},
    market:{...previous.market,name:'Bet Builder: 1 + Under 3.5'},
    outcome:{...previous.outcome,name:'1X2 1 + TOTAL Under 3.5'}})));
  await page.waitForFunction(()=>document.querySelector('#fixture-combo button').disabled);
  await page.evaluate(()=>window.slip.clearAll());
  await page.waitForFunction(()=>window.slip.selections.length===0);
  await add([{...fixtureSelections[0],matchId:'D',outcomeId:'D|total|2.5|Under',marketId:'D|total|2.5',marketName:'Total Goals',marketType:'OVER_UNDER',marketLine:'2.5',outcomeName:'Under',matchSnapshot:{status:'LIVE',homeScore:0,awayScore:0}}]);
  socketServer.emit('match:info',{match_id:'D',home_score:1,away_score:2,feed_status:'2H',match_time_ms:3600000});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Vendos Bastin')?.disabled);
  assert.ok(!(await page.$eval('body',body=>body.innerText)).includes('Ka kuota të pezulluara'), 'decided selections close without the removed warning');
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Vendos Bastin').disabled),true,'a settled total already in the slip must close on the live score push');
  // Seconds continue advancing without refreshing the shared feed consumers.
  await socketBarrier();
  const idleClock=await page.evaluate(()=>({text:document.querySelector('#fixture-clock').textContent,renders:window.probeRenders}));
  await page.waitForFunction(text=>document.querySelector('#fixture-clock').textContent!==text,{},idleClock.text);
  assert.equal(await page.evaluate(()=>window.probeRenders),idleClock.renders,'clock ticks must not redraw the shared odds/slip consumers');
  // Repeated alternatives from five distinct matches cannot inflate the
  // Cartesian system: each pair is represented by the latest choice only.
  const alternatives=Array.from({length:5},(_,index)=>[
    selection(`M${index}`,`M${index}1`,2,`M${index}-1x2`,'1'),
    selection(`M${index}`,`M${index}2`,3,`M${index}-1x2`,'2')
  ]).flat();
  await page.evaluate(rows=>{window.slip.clearAll();rows.forEach(row=>window.slip.addSelection(row));},alternatives);
  await page.waitForFunction(()=>window.slip.selections.length===5);
  assert.equal((await snapshot()).columns.length,1);
  assert.equal((await snapshot()).overflow,false);
  assert.equal(await page.evaluate(()=>window.slip.selections.every(s=>String(s.outcomeId).endsWith('2'))),true);
  assert.deepEqual(failures, []);
  console.log('PASS React betslip: one choice per market, normal combos on desktop/mobile, no duplicate columns, retries, receipts and live quote controls');
} catch (error) {
  console.error('Betslip browser regression failed:', error.message, failures);
  throw error;
} finally {
  await browser?.close();
  if (socketServer) await new Promise(resolve => socketServer.close(resolve));
  await vite?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
