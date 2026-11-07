import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(join(root,path),'utf8');
const page=read('web/src/pages/CasinoPage.tsx');
const wallet=read('web/src/pages/CasinoOriginalWallet.tsx');
const original=read('scripts/sync-original-sizzling.mjs');
const web=JSON.parse(read('web/package.json'));
const demo=read('server/casino/sizzling-demo.mjs');
const server=read('server/index.mjs');

// Keep the original Novomatic wallet cabinets alongside the original CT demo:
// no generic slot engine and no imitation frontend.
assert.ok(!page.includes('casinoEngine'),'no generic casino engine');
assert.ok(page.includes("id: 'sizzling'")&&page.includes("id: 'bookofra'"),
  'both original Novomatic wallet games must remain available');
assert.ok(!page.includes('slots.map(')&&!page.includes('CATALOG.map('),'no generic slot catalogue');
// Novomatic games must still use the verified wallet component. Lucky Clover
// has a separate, explicitly labelled demo entry.
assert.ok(page.includes('CasinoOriginalWallet'),'casino must use the real wallet component');
assert.ok(!page.includes('casino-original/sizzling/index.html'),'casino must not mount the demo entry');
assert.ok(page.includes('<CasinoFullscreen')||wallet.includes('<CasinoFullscreen'),'casino must keep mobile fullscreen');
assert.ok(page.includes('CasinoOriginalWallet'),'casino must verify the wallet session');
assert.ok(server.includes("app.use('/app/api/casino/sizzlinghotdeluxe/real', createSizzlingRealRouter())"),
  'production must expose the real-wallet play endpoint');
assert.ok(server.includes('casinoSessionRouter'),'production must expose the wallet session endpoint');
assert.ok(server.includes("app.use('/app/api/casino/sizzlinghotdeluxe',createSizzlingDemoRouter())"),
  'the isolated demo protocol must stay available for staff testing');
assert.ok(original.includes('index-real.html'),'production client build missing');
assert.ok(original.includes('scripts') && original.includes('images') &&
  original.includes('audio') && original.includes('animations'),'original assets must be copied');
assert.ok(original.includes('<head attach-element="./head.html">'));
assert.ok(original.includes('<body attach-element="./body.html">'));
assert.ok(original.includes("'/app/api/casino/sizzlinghotdeluxe/play'"));
assert.ok(demo.includes('gradeGrid'),'demo must use real reel paylines');
assert.ok(web.scripts.build.includes('sync-original-sizzling.mjs'));
assert.ok(web.scripts.build.includes('verify-original-sizzling.mjs'));
assert.ok(web.scripts.dev.includes('sync-original-sizzling.mjs'));
console.log('Original Novomatic artwork, wallet integration and client build verified');
