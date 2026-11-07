/**
 * Check the packaged `/app/casino-original/playngo-bookofdead/` build after
 * `npm run build:web`. A missing head/body, missing JS bundle or an entry
 * point still pointing at Play'n GO's live gateway must fail deployment.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'web/public/casino-original/playngo-bookofdead');
const output = join(root, 'web/dist/casino-original/playngo-bookofdead');
const needed = [
  'index.html', 'index-real.html', 'head.html', 'body.html',
];

for (const dir of [source, output]) {
  if (!existsSync(dir)) {
    console.warn(`[verify-playngo] skip (not present): ${dir}`);
    continue;
  }
  for (const relative of needed) {
    const p = join(dir, relative);
    assert.ok(existsSync(p), `Play'n GO original asset missing: ${p}`);
    assert.ok(statSync(p).size > 20, `Play'n GO original asset empty: ${p}`);
  }
  const entry = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.match(entry, /<head attach-element="\.\/head\.html">/,
    'assembler requires attach-element directly on head');
  assert.match(entry, /<body attach-element="\.\/body\.html">/,
    'assembler requires attach-element directly on body');
  assert.match(entry, /\/app\/api\/casino\/playngo-bookofdead\/play/,
    'demo entry must post to same-origin Node demo API');
  assert.doesNotMatch(entry, /agame-nvm\.ampxy2\.com/,
    'no upstream live casino endpoint allowed');
  const real = readFileSync(join(dir, 'index-real.html'), 'utf8');
  assert.match(real, /\/app\/api\/casino\/playngo-bookofdead\/real\/play/,
    'wallet client must reach the authenticated same-origin server');
  assert.match(real, /<head attach-element="\.\/head\.html">/,
    'wallet client must keep original assembler');
}

console.log('Play\'n GO Book of Dead client, assembler contract and same-origin endpoints verified');
