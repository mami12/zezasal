/**
 * Fail a release unless the exact Goldsvet HTML plus all eight reel symbols
 * were copied into the Vite output served by the /app static middleware.
 * Checking source presence alone missed the web/web/public regression.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(repoRoot,'web/public/casino-goldsvet/sizzling');
const distDir = join(repoRoot,'web/dist/casino-goldsvet/sizzling');
const images = [
  'cherry.png','lemon.png','orange.png','plum.png',
  'star.png','grapes.png','watermelon.png','seven.png',
];
const pngHeader = Buffer.from([137,80,78,71,13,10,26,10]);
const audioNames = [
  'background_fs-8da5d6c953.ogg', 'reelset_moving-2da16a7a33.ogg',
  'reelset_reel_stop-5bd4b48edb.ogg', 'ui_click-a33df725de.ogg',
  'ui_changebet_deluxe-a32d4cdbb0.ogg',
  'ui_maxbetlines_deluxe-dac40c7240.ogg',
  'ui_autoplay_start_deluxe-f82e9171c3.ogg',
  'ui_autoplay_stop_deluxe-f8b12ea774.ogg',
  'collect-2691aee57c.ogg', '1_win25-3baac3ba30.ogg',
];
for (const dir of [srcDir,distDir]) {
  const html = join(dir,'index.html');
  assert.ok(existsSync(html), 'Goldsvet HTML missing from '+html);
  const markup = readFileSync(html,'utf8');
  assert.match(markup,/const PAYLINES/,'Goldsvet original payline implementation missing');
  assert.match(markup,/const REEL_STRIPS/,'Goldsvet original reel implementation missing');
  for (const name of images) {
    const path = join(dir,'images',name);
    assert.ok(existsSync(path), 'Missing Goldsvet image: '+path);
    const image=readFileSync(path);
    assert.ok(image.length>200&&image.subarray(0,8).equals(pngHeader),
      'Invalid Goldsvet PNG in Vite output: '+path);
  }
  for (const name of audioNames) {
    const path = join(dir,'audio',name);
    assert.ok(existsSync(path), 'Missing original Sizzling sound: '+path);
    const bytes=readFileSync(path);
    assert.ok(bytes.length>500 && bytes.toString('ascii',0,4)==='OggS',
      'Invalid Sizzling audio in Vite output: '+path);
  }
}
console.log('Goldsvet release verified: index.html, all 8 Goldsvet images and 10 original audio files in source and /app build output');
