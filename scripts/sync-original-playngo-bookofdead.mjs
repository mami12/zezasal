/**
 * Copy the Play'n GO original client from the local disk into the packaged
 * `/app/casino-original/playngo-bookofdead/` folder, and write the local
 * `index.html` + `index-real.html` shells that point at this Node backend.
 *
 * Run AFTER you copy your Play'n GO game files to:
 *   D:\cassino\www.playngo.com\
 *
 * This script only copies; it never calls the live Play'n GO gateway. Only
 * `resourcesBasePath` and `playURL` change relative to the original client
 * (per the Sizzling HOWTO §2).
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, cp, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SLUG = 'playngo-bookofdead';
const TITLE = 'Book of Dead';
const SOURCE = process.env.PLAY_NGO_SOURCE || 'D:\\cassino\\www.playngo.com';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'web/public/casino-original', SLUG);

if (!existsSync(SOURCE)) {
  console.error(`[playngo-sync] source not found: ${SOURCE}`);
  console.error('[playngo-sync] copy your Play\'n GO game files there first (or set PLAY_NGO_SOURCE).');
  process.exit(1);
}

console.log(`[playngo-sync] source = ${SOURCE}`);
console.log(`[playngo-sync] output = ${output}`);

await mkdir(output, { recursive: true });

// Copy every folder we know a Play'n GO client ships with. `fs.cp` with
// `recursive:true` skips nothing, so absent folders are simply not created.
const wanted = ['scripts', 'libs', 'styles', 'images', 'audio', 'animations', 'data', 'assets', 'vendor', 'spine'];
let copiedFolders = 0;
for (const folder of wanted) {
  const src = join(SOURCE, folder);
  if (!existsSync(src)) continue;
  await cp(src, join(output, folder), { recursive: true, force: true });
  copiedFolders++;
}

// Root-level files (manifest, html shells, index.*, sprites, etc.).
for (const entry of await readdir(SOURCE, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const name = entry.name;
  if (!/\.(html?|json|js|css|webp|png|jpg|svg|ogg|mp3|woff2?)$/i.test(name)) continue;
  if (name === 'index.html' || name === 'index-real.html') continue;
  await cp(join(SOURCE, name), join(output, name), { force: true });
}

// Build the two launch shells. Both point to this backend; only the URL differs.
const shellFor = playUrl => `<!doctype html><html><head attach-element="./head.html">
<meta charset="utf-8"><title>${TITLE}</title>
<script>window.clientConfig={"sessionToken":"${playUrl.includes('/real/') ? 'wallet-session' : 'local-demo'}","desktop":true,"resourcesBasePath":"./","displayTime":false,"displayCurrency":false,"doRedirect":false,"language":"en","playURL":"${playUrl}","exitURL":"","depositURL":"","debug":false,"sentryURL":null,"sentryEnv":null,"logoURL":null};</script>
<script src="./libs/assembler.js" onload="assembler.startDOMLoading()"></script>
</head><body attach-element="./body.html"></body></html>`;

await writeFile(join(output, 'index.html'), shellFor(`/app/api/casino/${SLUG}/play`));
await writeFile(join(output, 'index-real.html'), shellFor(`/app/api/casino/${SLUG}/real/play`));

// Quick sanity check so a half-copied folder cannot silently break the deploy.
const required = ['head.html', 'body.html'];
for (const name of required) {
  const p = join(output, name);
  if (!existsSync(p)) throw new Error(`[playngo-sync] missing required ${name} (copy the original head/body from Play'n GO)`);
}
const headStat = await stat(join(output, 'head.html'));
if (headStat.size < 40) throw new Error('[playngo-sync] head.html looks empty');

console.log(`[playngo-sync] copied ${copiedFolders} folder(s) from ${basename(SOURCE)} -> ${basename(output)}`);
console.log(`[playngo-sync] wrote index.html -> /app/api/casino/${SLUG}/play`);
console.log(`[playngo-sync] wrote index-real.html -> /app/api/casino/${SLUG}/real/play`);
