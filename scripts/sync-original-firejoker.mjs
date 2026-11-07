/**
 * Install the actual Play'n GO "Fire Joker" browser client (Pixi/Spine/Howler)
 * from the local disk into `/app/casino-original/firejoker/`, exactly the same
 * way `sync-original-sizzling.mjs` handles Novomatic's Sizzling Hot Deluxe.
 *
 * The game math (reels, paytable, RTP, free-spin chain, scatter, wild) is
 * supplied by the Slotopol port in `server/casino/firejoker-engine.mjs` and
 * exposed via the CT protocol in `server/casino/firejoker-protocol.mjs`.
 * Only the browser client — the graphics, audio, animation and UI — is
 * replaced by Play'n GO's original assets.
 *
 * Source: the Play'n GO client extracted under `D:\cassino\www.playngo.com`
 * (or wherever the folder lives — override with `PLAY_NGO_FIREJOKER_SOURCE`).
 * If the folder contains the standard Play'n GO layout (`head.html`,
 * `body.html`, `libs/`, `scripts/`, `data/`, `images/`, `audio/`,
 * `animations/`) the sync is a straight copy. If the client uses the same
 * assembler + `resourcesBasePath` scheme as Sizzling, only those two
 * values change (HOWTO §2).
 *
 * What this script does NOT do:
 *  - It never calls Play'n GO's live gateway.
 *  - It does not touch `firejoker-engine.mjs` / `firejoker-protocol.mjs`.
 *  - It leaves `assets/sounds_desktop.mp3` and `assets/symbols/*.svg` alone
 *    if they already exist (the current artisan client's fallbacks).
 */
import { existsSync, readdir, readFile } from 'node:fs';
import { mkdir, cp, writeFile, stat, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = process.env.PLAY_NGO_FIREJOKER_SOURCE
  || 'D:\\cassino\\www.playngo.com\\firejoker';
const ALT_SOURCES = [
  'D:\\cassino\\www.playngo.com',
  'D:\\cassino\\www.playngo.com\\games\\firejoker',
  'D:\\cassino\\www.playngo.com\\FireJoker',
  'D:\\cassino\\www.playngo.com\\fire-joker',
];
const TITLE = 'Fire Joker';
const SLUG = 'firejoker';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'web/public/casino-original', SLUG);
const legacy = join(output, '.legacy-artisan');

function locateSource() {
  const candidates = [SOURCE, ...ALT_SOURCES];
  for (const path of candidates) {
    if (existsSync(path) && existsSync(join(path, 'head.html'))) return path;
  }
  return null;
}

const source = locateSource();
if (!source) {
  console.error(`[firejoker-sync] no Play'n GO Fire Joker client found.`);
  console.error(`[firejoker-sync] looked in:`);
  for (const path of [SOURCE, ...ALT_SOURCES]) console.error('  ' + path);
  console.error('[firejoker-sync] copy the original Play\'n GO Fire Joker client there (with head.html + body.html)');
  console.error('[firejoker-sync] or set PLAY_NGO_FIREJOKER_SOURCE to the correct folder.');
  process.exit(1);
}

console.log(`[firejoker-sync] source = ${source}`);
console.log(`[firejoker-sync] output = ${output}`);

// 1) Preserve the current artisan client (JS/CSS/index.html fallback) under
//    `.legacy-artisan/` so a rollback is one `mv` away. The original files
//    are not deleted — they simply stop being referenced by index.html.
if (existsSync(join(output, 'firejoker.js')) && !existsSync(legacy)) {
  await mkdir(legacy, { recursive: true });
  for (const name of ['firejoker.js', 'firejoker.css', 'index.html', 'index-real.html']) {
    if (existsSync(join(output, name))) {
      await rename(join(output, name), join(legacy, name)).catch(() => {});
    }
  }
  console.log(`[firejoker-sync] preserved artisan client under ${basename(legacy)}/`);
}

// 2) Copy the whole Play'n GO client tree, but keep the existing
//    `assets/symbols/` (used as a graceful fallback when the original has
//    SVG names not covered by the Play'n GO atlases) and
//    `assets/sounds_desktop.mp3` if it is already there.
await mkdir(output, { recursive: true });
const dirs = ['scripts', 'libs', 'styles', 'images', 'audio', 'animations', 'data', 'assets', 'vendor', 'spine'];
let copiedFolders = 0;
for (const folder of dirs) {
  const src = join(source, folder);
  if (!existsSync(src)) continue;
  const dst = join(output, folder);
  const keepAssets = folder === 'assets' && existsSync(dst);
  if (keepAssets) {
    // copy only the missing subfolders, do not overwrite the artisan
    // symbol SVGs (they are the visual fallback when Play'n GO ships
    // different sprite names).
    for (const entry of await readdir(src, { withFileTypes: true })) {
      if (entry.name === 'symbols') continue;
      const from = join(src, entry.name);
      const to = join(dst, entry.name);
      if (entry.isDirectory()) await cp(from, to, { recursive: true, force: true });
      else if (!existsSync(to)) await cp(from, to, { force: true });
    }
  } else {
    await cp(src, dst, { recursive: true, force: true });
  }
  copiedFolders++;
}

// 3) Root-level files (manifest, head/body, sprites, etc.), but skip the
//    original index.html — we build our own (assembler + clientConfig).
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const name = entry.name;
  if (!/\.(html?|json|js|css|webp|png|jpg|svg|ogg|mp3|woff2?)$/i.test(name)) continue;
  if (name === 'index.html' || name === 'index-real.html') continue;
  if (name === 'head.html' || name === 'body.html') {
    // head/body are rewritten below after the icon cleanup that Sizzling
    // also needed (Play'n GO normally omits `icons/` from the archive).
    continue;
  }
  await cp(join(source, name), join(output, name), { force: true });
}

// 4) Rewrite head.html / body.html using the same fixes that
//    `sync-original-sizzling.mjs` applies:
//      - drop missing icon <link> tags to avoid 404s,
//      - add a render-budget query to the main engine (Play'n GO's engine
//        is Pixi; the flag is used by the bounded canvas renderer in
//        `applyPixiClientCompat`).
let head = await readFile(join(source, 'head.html'), 'utf8');
head = head.replace(/<link\b[^>]*href=["'][^"']*icons\/[^"']+["'][^>]*>\s*/gi, '');
for (const engine of ['c2d-', 'bundle-', 'game-']) {
  head = head.replace(new RegExp('(scripts/' + engine + '[^"\\s?]+\\.js)'), '$1?render-budget=1');
}
await writeFile(join(output, 'head.html'), head);

let body = await readFile(join(source, 'body.html'), 'utf8');
const responsive = `<style>
html,body {margin:0;width:100%;height:100%;overflow:hidden;background:#000}
#slotCanvas,canvas {touch-action:none}
</style>`;
await writeFile(join(output, 'body.html'), responsive + body);

// 5) Build the two shells. `resourcesBasePath` and `playURL` are the only
//    config fields that change relative to the original client (HOWTO §2).
const demoUrl  = `/app/api/casino/firejoker/rgsm`;
const realUrl  = `/app/api/casino/original/firejoker/rgsm`;
const shellFor = playUrl => `<!doctype html><html><head attach-element="./head.html">
<meta charset="utf-8"><title>${TITLE}</title>
<script>window.clientConfig={
  "sessionToken":"${playUrl === realUrl ? 'wallet-session' : 'local-demo'}",
  "desktop":true,
  "resourcesBasePath":"./",
  "displayTime":false,
  "displayCurrency":false,
  "doRedirect":false,
  "language":"en",
  "playURL":"${playUrl}",
  "exitURL":"",
  "depositURL":"",
  "debug":false,
  "sentryURL":null,
  "sentryEnv":null,
  "logoURL":null
};</script>
<script src="./libs/assembler.js" onload="assembler.startDOMLoading()"></script>
</head><body attach-element="./body.html"></body></html>`;

await writeFile(join(output, 'index.html'),      shellFor(demoUrl));
await writeFile(join(output, 'index-real.html'), shellFor(realUrl));

// 6) Sanity check — an incomplete copy must fail here, not in production.
for (const required of ['head.html', 'body.html']) {
  const file = join(output, required);
  if (!existsSync(file)) throw new Error(`[firejoker-sync] missing ${required} after copy`);
  if ((await stat(file)).size < 40) throw new Error(`[firejoker-sync] ${required} looks empty`);
}
console.log(`[firejoker-sync] copied ${copiedFolders} folder(s) from ${basename(source)}`);
console.log(`[firejoker-sync] demo:  /app/casino-original/firejoker/index.html`);
console.log(`[firejoker-sync] real:  /app/casino-original/firejoker/index-real.html`);
console.log(`[firejoker-sync] engine + protocol untouched (server/casino/firejoker-*.mjs)`);
