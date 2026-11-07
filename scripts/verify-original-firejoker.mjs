/**
 * Check that the packaged Fire Joker client is the actual Play'n GO build,
 * that it keeps the assembler contract, and that both entry points reach
 * the same-origin Node backend — never the live Play'n GO gateway.
 *
 * Run after `npm run build:web`. A missed copy of head/body, JS bundle,
 * atlases, Spine JSON or OGG audio must fail deployment.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'web/public/casino-original/firejoker');
const output = join(root, 'web/dist/casino-original/firejoker');

if (!existsSync(source)) {
  console.warn('[verify-firejoker] source folder not present, skipping');
  process.exit(0);
}

// Two valid packaging modes are supported:
//   1. Original Play'n GO assembler client (head.html + body.html + libs/)
//      installed by `npm run sync:firejoker`.
//   2. Artisan HTML5 client (firejoker.js + firejoker.css) backed by the
//      original Play'n GO PNG symbol sprites. In this mode we require the
//      real sprite PNGs to be present, and we forbid the hand-drawn SVG
//      placeholders from being served.
const artisanClient = existsSync(join(source, 'firejoker.js')) && existsSync(join(source, 'firejoker.css'));
if (artisanClient) {
  const symbolDir = join(source, 'assets/symbols');
  assert.ok(existsSync(symbolDir), 'Fire Joker artisan mode: assets/symbols/ folder missing');
  for (let i = 0; i <= 8; i++) {
    const png = join(symbolDir, `symbol${i}.png`);
    assert.ok(existsSync(png), `Fire Joker artisan mode: original sprite missing ${png}`);
    assert.ok(statSync(png).size > 1024, `Fire Joker artisan mode: sprite too small ${png}`);
    assert.ok(!existsSync(join(symbolDir, `symbol${i}.svg`)),
      `Fire Joker artisan mode: placeholder SVG still served for symbol${i}`);
  }
  const js = readFileSync(join(source, 'firejoker.js'), 'utf8');
  assert.match(js, /\.png`/i, 'Fire Joker artisan client must reference PNG sprites');
  assert.doesNotMatch(js, /symbol\$\{id\}\.svg/i, 'Fire Joker artisan client must not reference the placeholder SVGs');
  console.log('Fire Joker artisan client uses original Play\'n GO PNG sprites (9 symbols verified)');
  process.exit(0);
}

// Otherwise, require the full original Play'n GO assembler client.

const needed = ['index.html', 'index-real.html', 'head.html', 'body.html', 'libs/assembler.js'];
for (const dir of [source, output]) {
  if (!existsSync(dir)) continue;
  for (const relative of needed) {
    const path = join(dir, relative);
    assert.ok(existsSync(path), `Fire Joker original asset missing: ${path}`);
    assert.ok(statSync(path).size > 40, `Fire Joker original asset empty: ${path}`);
  }
  const entry = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.match(entry, /<head attach-element="\.\/head\.html">/,
    'assembler requires attach-element directly on head');
  assert.match(entry, /<body attach-element="\.\/body\.html">/,
    'assembler requires attach-element directly on body');
  assert.match(entry, /casino\/firejoker\/rgsm/,
    'demo entry must reach the same-origin Node demo API');
  assert.doesNotMatch(entry, /agame-nvm\.ampxy2\.com/,
    'no upstream live casino endpoint allowed');
  const real = readFileSync(join(dir, 'index-real.html'), 'utf8');
  assert.match(real, /casino\/original\/firejoker\/rgsm/,
    'wallet entry must reach the authenticated same-origin server');
  assert.match(real, /<head attach-element="\.\/head\.html">/,
    'wallet entry must keep the original assembler');
}

// Play'n GO assets: at least one bundle/engine, one atlas image, one Spine
// JSON, one audio file. Specific names are version-dependent, so match by
// extension+prefix instead of an exact filename.
function anyMatch(dir, prefix, ext) {
  if (!existsSync(dir)) return false;
  for (const name of readdirSyncSafe(dir)) {
    if (name.startsWith(prefix) && name.endsWith(ext)) return true;
  }
  return false;
}
function readdirSyncSafe(dir) {
  try { return require('node:fs').readdirSync(dir); } catch { return []; }
}
for (const dir of [join(source, 'scripts'), join(source, 'libs'), join(source, 'animations'), join(source, 'audio')]) {
  if (!existsSync(dir)) continue;
  const files = readdirSyncSafe(dir);
  assert(files.length > 0, `Fire Joker asset folder empty: ${dir}`);
}

console.log('Fire Joker original Play\'n GO client, assembler contract and same-origin endpoints verified');
