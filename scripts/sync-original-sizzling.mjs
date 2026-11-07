/**
 * Install the actual Novomatic Pixi/Spine/Howler browser client from
 * mami12/New-folder/Sizzling Hot Deluxe. It is NOT the simplified Goldsvet
 * Sizzling777WD HTML slot. Game assets are pinned to an exact source commit.
 *
 * The original assembler requires attach-element ON the head and body tags;
 * inlining those files or moving the config before <head> breaks initialization.
 * The original, opaque upstream transport/signature script is deliberately not
 * included. The local, same-origin play endpoint supports the documented JSON
 * demo protocol and does not debit user wallets.
 */
import { mkdir, mkdtemp, readFile, writeFile, cp, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {createHash} from 'node:crypto';
import {applyPixiClientCompat} from './pixi-client-compat.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceSha = '507f7fdb7aee883f0d78cef0b02d6c4358462c69';

async function verifyPackagedClient(output) {
  const required = ['index.html','index-real.html','head.html','body.html','manifest.json',
    'manifest-7976fbc9075178.json','responsive-desktop.html','styles/bundle-3757edaaf8.css',
    'libs/assembler.js','libs/pixi-e5441a5223.min.js','libs/pixi-spine-885fb1e4b2.min.js',
    'libs/howler-e0747d16e3.core.min.js','scripts/c2d-3c891074da.js',
    'scripts/game-c269ffb1da.js','scripts/bundle-51f846f01a.js',
    'data/application-0113ecdf74.json','images/background-desktop-520de17f9c.jpg',
    'images/logo-0328a8ad8c.png'];
  const manifest = JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));
  const hashed = JSON.parse(await readFile(join(output,'manifest-7976fbc9075178.json'),'utf8'));
  if(JSON.stringify(manifest)!==JSON.stringify(hashed))throw Error('desktop resource manifests differ');
  const aliases = ['data/application.json','data/componentsDesktop.json',
    'data/strings_en.json','data/strings_base_en.json','data/reelsetConfig_hd.json',
    'data/reelsetResources-hd.json','data/paytableConfig-hd.json','data/audioConfig.json',
    'data/uiDesktopConfigDeluxe.json','data/uiDesktopConfigDeluxeSH.json',
    'data/uiDesktopResourcesDeluxe.json','images/logo.png','images/bg_0-hd.json',
    'images/bg_0-hd.webp','images/lines_deluxe_hd.json','images/lines_deluxe_hd.png',
    'images/ui_desktop_deluxe_en.json','images/ui_desktop_deluxe_en.webp',
    'images/paytable_hd.json','images/paytable_hd.webp',
    'images/gamble_desktop_en.json','images/gamble_desktop_en.webp'];
  for(let symbol=0;symbol<=7;symbol++) {
    const key='animations/'+symbol+'_symbol-hd.json';
    if(manifest['animations/'+symbol+'_symbol.json']!==manifest[key])
      throw Error('outdated desktop Spine mapping for symbol '+symbol);
    aliases.push(key);
  }
  for(let atlas=0;atlas<=2;atlas++)aliases.push('images/reelset_'+atlas+'-hd.json','images/reelset_'+atlas+'-hd.webp');
  // The pinned archive deliberately omits mobile/SD assets, MP3 alternatives and
  // optional languages. Check the desktop resources it actually ships instead.
  aliases.push(...Object.keys(manifest).filter(key=>key.startsWith('audio/')&&key.endsWith('.ogg')));
  for(const key of aliases) {
    const path=manifest[key];
    if(typeof path!=='string'||path.startsWith('/')||path.includes('\\')||path.split('/').includes('..'))
      throw Error('missing or invalid resource mapping: '+key);
    required.push(path);
  }
  for(const path of new Set(required)) {
    const info=await stat(join(output,path));
    if(!info.isFile()||info.size<=20)throw Error('missing or empty original asset: '+path);
    const contents=await readFile(join(output,path));
    const mediaHash=path.match(/-([a-f0-9]{10})\.(?:ogg|webp|png|jpe?g)$/);
    if(mediaHash&&!createHash('md5').update(contents).digest('hex').startsWith(mediaHash[1]))
      throw Error('original media checksum differs: '+path);
    if(path.endsWith('.json'))JSON.parse(contents.toString('utf8'));
    if(path.endsWith('.ogg')&&contents.subarray(0,4).toString()!=='OggS')throw Error('invalid audio asset: '+path);
    if(path.endsWith('.webp')&&(contents.subarray(0,4).toString()!=='RIFF'||contents.subarray(8,12).toString()!=='WEBP'))
      throw Error('invalid image asset: '+path);
    if(path.endsWith('.png')&&!contents.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
      throw Error('invalid image asset: '+path);
  }
  const entry=await readFile(join(output,'index.html'),'utf8');
  const real=await readFile(join(output,'index-real.html'),'utf8');
  for(const [name,page]of [['demo',entry],['wallet',real]]) {
    if(!page.includes('<head attach-element="./head.html">')||!page.includes('<body attach-element="./body.html">')||
       !page.includes('"desktop":true')||!page.includes('"resourcesBasePath":"./"')||page.includes('agame-nvm.ampxy2.com'))
      throw Error('incompatible '+name+' entry');
  }
  if(!entry.includes('"playURL":"/app/api/casino/sizzlinghotdeluxe/play"')||
     !real.includes('"playURL":"/app/api/casino/sizzlinghotdeluxe/real/play"'))throw Error('invalid local wallet endpoints');
  const head=await readFile(join(output,'head.html'),'utf8');
  const body=await readFile(join(output,'body.html'),'utf8');
  const engine=await readFile(join(output,'scripts/c2d-3c891074da.js'),'utf8');
  if(!engine.includes('faqja-pixi-render-budget-v1')||!head.includes('c2d-3c891074da.js?render-budget=1')||
     !body.includes('#slotCanvas {touch-action:none}'))
    throw Error('desktop renderer compatibility update is missing');
}

export async function syncOriginalSizzling({rootDir=repository,fetcher=globalThis.fetch,log=console.log}={}) {
const root=resolve(rootDir),output=join(root,'web/public/casino-original/sizzling');
let cacheError;
try {
  await verifyPackagedClient(output);
  log('[sizzling-original] Verified packaged desktop client ('+sourceSha.slice(0,12)+'); no download needed');
  return {cached:true,sourceSha};
} catch(error) {cacheError=error;}
const scratch = await mkdtemp(join(tmpdir(), 'sizzling-original-'));
try {
  const sourceArchive = 'https://codeload.github.com/mami12/New-folder/tar.gz/' + sourceSha;
  let response,body;
  try {
    response = await fetcher(sourceArchive, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error('HTTP '+response.status);
    body=Buffer.from(await response.arrayBuffer());
  } catch(error) {
    const reason=['TimeoutError','AbortError'].includes(error.name)?'timed out after 120 seconds':error.message;
    throw new Error('Sizzling local assets are missing or incomplete ('+cacheError.message+'). '+
      'The pinned client download '+reason+'. Copy the complete web/public/casino-original/sizzling folder '+
      'from the working computer, or restore the connection and run start.bat again.',{cause:error});
  }
  const archive = join(scratch, 'client.tar.gz');
  await writeFile(archive, body);
  const unpack = spawnSync('tar', ['-xzf', archive, '-C', scratch], { encoding: 'utf8' });
  if (unpack.status !== 0) throw new Error('Cannot extract Sizzling browser client: ' + unpack.stderr);
  const archiveRoots = (await readdir(scratch, { withFileTypes: true })).filter(x => x.isDirectory());
  if (archiveRoots.length !== 1) throw new Error('Unexpected source archive layout');
  const source = join(scratch, archiveRoots[0].name, 'Sizzling Hot Deluxe');
  await mkdir(output, { recursive: true });
  const dirs = ['scripts', 'libs', 'styles', 'images', 'audio', 'animations', 'data'];
  for (const folder of dirs) {
    await cp(join(source, folder), join(output, folder), { recursive: true, force: true });
  }
  const engine='scripts/c2d-3c891074da.js';
  await writeFile(join(output,engine),applyPixiClientCompat(await readFile(join(output,engine),'utf8')));
  for (const file of ['manifest.json', 'manifest-7976fbc9075178.json']) {
    await cp(join(source, file), join(output, file));
  }
  // The archive omits the mobile CSS background; reuse its original desktop art.
  const stylePath = join(output, 'styles/bundle-3757edaaf8.css');
  const style = await readFile(stylePath, 'utf8');
  await stat(join(output, 'images/background-desktop-520de17f9c.jpg'));
  await writeFile(stylePath, style.replaceAll('background-mobile-57f969fbc3.jpg',
    'background-desktop-520de17f9c.jpg'));
  // Preserve real head/body and Pixi/Spine loader; avoid missing icon 404s.
  const sourceHead = await readFile(join(source, 'head.html'), 'utf8');
  const head = sourceHead.replace(/<link\b[^>]*href=["'][^"']*icons\/[^"']+["'][^>]*>\s*/gi, '')
    .replace(engine+'"',engine+'?render-budget=1"');
  await writeFile(join(output, 'head.html'), head);
  // Original mobile components were not shipped in this archive. Force the
  // existing desktop Pixi component tree on narrow touch screens instead.
  // The canvas remains responsive via CSS scaling; no substitute art/math.
  const bodySource = await readFile(join(source, 'body.html'), 'utf8');
  await writeFile(join(output, 'body.html'), bodySource);
  // Let the original renderer own canvas dimensions and pointer coordinates.
  // object-fit letterboxing on a separately stretched canvas breaks hit tests.
  const responsive = `<style>
html,body {margin:0;width:100%;height:100%;overflow:hidden;background:#000}
#slotCanvas {touch-action:none}
</style>`;
  await writeFile(join(output,'responsive-desktop.html'),responsive);
  await writeFile(join(output,'body.html'),responsive + bodySource);
  const config = {
    sessionToken: 'local-demo',
    // Use the engine's supported switch for components, HD assets AND geometry.
    desktop: true,
    resourcesBasePath: './',
    displayTime: false,
    displayCurrency: false,
    doRedirect: false,
    language: 'en',
    playURL: '/app/api/casino/sizzlinghotdeluxe/play',
    exitURL: '',
    depositURL: '',
    debug: false,
    sentryURL: null,
    sentryEnv: null,
    logoURL: null,
  };
  // Required: attach-element on actual head/body nodes. The assembler will
  // GET head.html and body.html, replace {$game_path}, and start the real game.
  const page = '<!doctype html><html><head attach-element="./head.html">' +
    '<meta charset="utf-8"><title>Sizzling Hot Deluxe</title>' +
    '<link rel="icon" type="image/png" href="./images/logo-0328a8ad8c.png">' +
    '<script>window.clientConfig=' + JSON.stringify(config) + ';</script>' +
    '<script src="./libs/assembler.js" onload="assembler.startDOMLoading()"></script>' +
    '</head><body attach-element="./body.html"></body></html>';
  await writeFile(join(output, 'index.html'), page);
  // Same original media, animation, Pixi/Spine and sound. Only the server URL
  // changes; financial outcomes are supplied by the authenticated ledger.
  const realConfig = { ...config, sessionToken: 'wallet-session',
    playURL: '/app/api/casino/sizzlinghotdeluxe/real/play' };
  const realPage = page.replace(JSON.stringify(config), JSON.stringify(realConfig));
  await writeFile(join(output, 'index-real.html'), realPage);
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  // The archived desktop reelset resource references SD Spine filenames, but
  // only HD Spine animations were committed. Point the original resource names
  // at the existing HD JSON rather than serving missing files (99% stall).
  for (let symbol = 0; symbol <= 7; symbol++) {
    const normal = 'animations/' + symbol + '_symbol.json';
    const hd = 'animations/' + symbol + '_symbol-hd.json';
    const hdFile = manifest[hd];
    if (!hdFile) throw new Error('Missing original HD Spine manifest entry: ' + hd);
    await stat(join(output, hdFile));
    manifest[normal] = hdFile;
  }
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(output, 'manifest-7976fbc9075178.json'), JSON.stringify(manifest, null, 2));
  // Do not reject a working desktop build because the upstream manifest also
  // advertises mobile-only or optional assets missing from its own archive.
  for (const asset of ['data/application.json', 'images/logo.png', 'data/reelsetConfig_hd.json',
    'data/paytableConfig-hd.json', 'data/audioConfig.json']) {
    const resolvedAsset = join(output, manifest[asset] ?? asset);
    const info = await stat(resolvedAsset);
    if (!info.isFile() || info.size < 10) throw new Error('Missing original game asset: ' + asset);
  }
  log('[sizzling-original] Pixi/Spine/Howler client synchronized (' +
    sourceSha.slice(0, 12) + '), ' + dirs.join(', ') + ', local demo playURL');
  await verifyPackagedClient(output);
  return {cached:false,sourceSha};
} finally {
  await rm(scratch, { recursive: true, force: true });
}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {await syncOriginalSizzling();}
  catch(error) {console.error('[sizzling-original] '+error.message);process.exitCode=1;}
}

