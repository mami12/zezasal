/**
 * Install the actual Novomatic Pixi/Spine/Howler "Book of Ra Deluxe" browser
 * client from mami12/New-folder (same archive as Sizzling Hot Deluxe).
 *
 * The upstream transport/signature script is deliberately removed: the local,
 * same-origin play endpoint speaks the documented JSON protocol, so no request
 * body has to be obfuscated. Assets are pinned to the same source commit.
 */
import { mkdir, mkdtemp, readFile, writeFile, cp, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {applyPixiClientCompat} from './pixi-client-compat.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceSha = '507f7fdb7aee883f0d78cef0b02d6c4358462c69';
const sourceFolder = 'Book of Ra Deluxe';

async function validatePackagedBookofra(output) {
  const requireFile = async (file) => {
    if (typeof file !== 'string' || file.startsWith('/') || file.includes('\\') || file.split('/').includes('..'))
      throw new Error('Invalid original asset path: ' + file);
    const info = await stat(join(output, file));
    if (!info.isFile() || info.size < 10) throw new Error('Missing or empty original game asset: ' + file);
    if (file.endsWith('.json')) JSON.parse(await readFile(join(output, file), 'utf8'));
  };
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  const hashed = JSON.parse(await readFile(join(output, 'manifest-ecc4347a48712.json'), 'utf8'));
  if (JSON.stringify(manifest) !== JSON.stringify(hashed)) throw new Error('Book of Ra resource manifests differ');
  const engine = 'scripts/c2d-6242421041.js';
  for (const file of ['index.html', 'index-real.html', 'head.html', 'body.html',
    'responsive-desktop.html', 'libs/assembler.js', engine,
    'scripts/game-e8dc547825.js', 'scripts/bundle-60f2610b1f.js']) await requireFile(file);
  const [entry, real, head, body, code] = await Promise.all(['index.html', 'index-real.html', 'head.html', 'body.html', engine]
    .map(file => readFile(join(output, file), 'utf8')));
  for (const page of [entry, real]) {
    if (!page.includes('<head attach-element="./head.html">') || !page.includes('<body attach-element="./body.html">') ||
        !page.includes('"desktop":true') || /https?:\/\//.test(page)) throw new Error('Book of Ra local assembler entry is outdated');
  }
  if (!entry.includes('"playURL":"/app/api/casino/bookofra/play"') ||
      !real.includes('"playURL":"/app/api/casino/bookofra/real/play"')) throw new Error('Book of Ra local wallet URLs are missing');
  if (!code.includes('faqja-pixi-render-budget-v1') || !head.includes(engine + '?render-budget=1') ||
      !body.includes('#slotCanvas {touch-action:none}')) throw new Error('Book of Ra renderer compatibility patch is missing');
  for (const match of head.matchAll(/\bsrc="\{\$game_path\}([^"?]+)(?:\?[^" ]*)?"/g)) await requireFile(match[1]);
  // The pinned archive advertises optional mobile, MP3 and locale alternatives
  // which it does not ship. Validate the desktop/English resources actually used.
  for (const key of ['data/application.json', 'images/logo.png', 'data/reelsetConfig-hd.json',
    'data/reelsetResources-hd.json', 'data/paytableConfig-hd.json', 'data/paytableConfigFreespins-hd.json',
    'data/linesConfig-hd.json', 'data/mudConfig-hd.json', 'data/mudResources-hd.json',
    'images/bg_0-hd.json', 'images/bg_0-hd.webp', 'images/reelset_0-hd.webp', 'images/reelset_1-hd.webp',
    'images/reelset_2-hd.webp', 'images/reelset_3-hd.webp', 'images/reelset_4-hd.webp', 'images/reelset_5-hd.webp',
    'audio/reelset_moving.ogg', 'audio/reelset_reel_stop.ogg']) {
    if (!manifest[key]) throw new Error('Missing original resource mapping: ' + key);
    await requireFile(manifest[key]);
  }
  for (let symbol = 0; symbol <= 9; symbol++) {
    const key = 'animations/' + symbol + '_symbol-hd.json';
    if (!manifest[key] || manifest['animations/' + symbol + '_symbol.json'] !== manifest[key])
      throw new Error('Book of Ra original HD animation mapping is missing: ' + symbol);
    await requireFile(manifest[key]);
  }
  const configs = (await readdir(join(output, 'data'))).filter(file => file.endsWith('.json'));
  if (configs.length < 25) throw new Error('Original Book of Ra data folder is incomplete');
  for (const needed of ['paytableConfig', 'spoolsConfig', 'linesConfig', 'mudConfig']) {
    if (!configs.some(file => file.startsWith(needed))) throw new Error('Missing original config: ' + needed);
  }
}

export async function syncOriginalBookofra({rootDir = root, fetcher = globalThis.fetch, log = console.log} = {}) {
const output = join(rootDir, 'web/public/casino-original/bookofra');
let cacheError;
try {
  await validatePackagedBookofra(output);
  log('[bookofra-original] Verified packaged Pixi/Spine/Howler client reused; no download needed (' + sourceSha.slice(0, 12) + ')');
  return {cached: true, sourceSha};
} catch (error) { cacheError = error; }
const scratch = await mkdtemp(join(tmpdir(), 'bookofra-original-'));
try {
  const archiveUrl = 'https://codeload.github.com/mami12/New-folder/tar.gz/' + sourceSha;
  const archive = join(scratch, 'client.tar.gz');
  try {
    const response = await fetcher(archiveUrl, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    throw new Error('Book of Ra packaged assets are missing or incomplete (' + cacheError.message + '). ' +
      'The pinned original client could not be downloaded: ' + error.message + '. ' +
      'Copy the complete web/public/casino-original/bookofra folder from the working laptop, or retry with internet access.', {cause: error});
  }
  const unpack = spawnSync('tar', ['-xzf', archive, '-C', scratch], { encoding: 'utf8' });
  if (unpack.status !== 0) throw new Error('Cannot extract Book of Ra browser client: ' + unpack.stderr);
  const archiveRoots = (await readdir(scratch, { withFileTypes: true })).filter((x) => x.isDirectory());
  if (archiveRoots.length !== 1) throw new Error('Unexpected source archive layout');
  const source = join(scratch, archiveRoots[0].name, sourceFolder);

  await mkdir(output, { recursive: true });
  const dirs = ['scripts', 'libs', 'styles', 'images', 'audio', 'animations', 'data'];
  for (const folder of dirs) {
    await cp(join(source, folder), join(output, folder), { recursive: true, force: true });
  }
  const engine='scripts/c2d-6242421041.js';
  await writeFile(join(output,engine),applyPixiClientCompat(await readFile(join(output,engine),'utf8')));
  for (const file of ['manifest.json', 'manifest-ecc4347a48712.json']) {
    await cp(join(source, file), join(output, file));
  }

  // Original head/body keep the assembler contract; drop missing icon links.
  const sourceHead = await readFile(join(source, 'head.html'), 'utf8');
  const head = sourceHead.replace(/<link\b[^>]*href=["'][^"']*icons\/[^"']+["'][^>]*>\s*/gi, '')
    .replace(engine+'"',engine+'?render-budget=1"');
  await writeFile(join(output, 'head.html'), head);

  const bodySource = await readFile(join(source, 'body.html'), 'utf8');
  const responsive = `<style>
html,body {margin:0;width:100%;height:100%;overflow:hidden;background:#000}
#slotCanvas {touch-action:none}
</style>`;
  await writeFile(join(output, 'body.html'), responsive + bodySource);
  await writeFile(join(output, 'responsive-desktop.html'), responsive);

  const config = {
    sessionToken: 'local-demo',
    desktop: true,
    resourcesBasePath: './',
    displayTime: false,
    displayCurrency: true,
    doRedirect: false,
    language: 'en',
    playURL: '/app/api/casino/bookofra/play',
    exitURL: '',
    depositURL: '',
    debug: false,
    sentryURL: null,
    sentryEnv: null,
    logoURL: null,
  };
  const page = '<!doctype html><html><head attach-element="./head.html">' +
    '<meta charset="utf-8"><title>Book of Ra Deluxe</title>' +
    '<link rel="icon" type="image/png" href="./images/logo.png">' +
    '<script>window.clientConfig=' + JSON.stringify(config) + ';</script>' +
    '<script src="./libs/assembler.js" onload="assembler.startDOMLoading()"></script>' +
    '</head><body attach-element="./body.html"></body></html>';
  await writeFile(join(output, 'index.html'), page);

  const realConfig = { ...config, sessionToken: 'wallet-session',
    playURL: '/app/api/casino/bookofra/real/play' };
  await writeFile(join(output, 'index-real.html'),
    page.replace(JSON.stringify(config), JSON.stringify(realConfig)));

  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  // The archived desktop build references SD Spine names but ships the HD JSON.
  for (let symbol = 0; symbol <= 9; symbol++) {
    const normal = 'animations/' + symbol + '_symbol.json';
    const hd = 'animations/' + symbol + '_symbol-hd.json';
    if (manifest[hd] && manifest[normal] !== manifest[hd]) manifest[normal] = manifest[hd];
  }
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(output, 'manifest-ecc4347a48712.json'), JSON.stringify(manifest, null, 2));

  // Required original assets, resolved through the manifest (files are hashed).
  for (const asset of ['data/application.json', 'images/logo.png']) {
    const resolved = join(output, manifest[asset] ?? asset);
    const info = await stat(resolved);
    if (!info.isFile() || info.size < 10) throw new Error('Missing original game asset: ' + asset);
  }
  const configs = (await readdir(join(output, 'data'))).filter((f) => f.endsWith('.json'));
  if (configs.length < 25) throw new Error('Original Book of Ra data folder is incomplete');
  for (const needed of ['paytableConfig', 'spoolsConfig', 'linesConfig', 'mudConfig']) {
    if (!configs.some((f) => f.startsWith(needed))) throw new Error('Missing original config: ' + needed);
  }
  await validatePackagedBookofra(output);
  log('[bookofra-original] Pixi/Spine/Howler client synchronized (' +
    sourceSha.slice(0, 12) + '), ' + dirs.join(', ') + ', local playURL');
  return {cached: false, sourceSha};
} finally {
  await rm(scratch, { recursive: true, force: true });
}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await syncOriginalBookofra(); }
  catch (error) { console.error('[bookofra-original] ' + error.message); process.exitCode = 1; }
}
