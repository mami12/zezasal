#!/usr/bin/env node
/**
 * Scaffold a new casino cabinet by copying the Book of Ra implementation.
 *
 *   node scripts/new-casino-game.mjs gates
 *
 * Creates:
 *   scripts/sync-original-<slug>.mjs
 *   server/casino/<slug>.mjs
 *   server/casino/<slug>-transactions.mjs
 *   server/casino/<slug>-reels.txt
 *
 * and prints the exact lines to add to server/index.mjs, CasinoPage.tsx and
 * web/package.json. Everything game-specific that a human must supply is
 * printed as TODO at the end.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const slug = String(process.argv[2] || '').toLowerCase();
if (!/^[a-z][a-z0-9]{2,19}$/.test(slug)) {
  console.error('Usage: node scripts/new-casino-game.mjs <slug>   (a-z0-9, 3-20 chars, e.g. gates)');
  process.exit(1);
}
const pascal = slug.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
const TITLE = slug.replace(/-/g, ' ');

const files = [
  ['scripts/sync-original-bookofra.mjs', `scripts/sync-original-${slug}.mjs`],
  ['server/casino/bookofra.mjs', `server/casino/${slug}.mjs`],
  ['server/casino/bookofra-transactions.mjs', `server/casino/${slug}-transactions.mjs`],
  ['server/casino/bookofra-reels.txt', `server/casino/${slug}-reels.txt`],
];

for (const [, out] of files) {
  if (existsSync(resolve(root, out))) {
    console.error(`Refusing to overwrite existing file: ${out}`);
    process.exit(1);
  }
}

let written = 0;
for (const [from, to] of files) {
  let text = readFileSync(resolve(root, from), 'utf8');
  text = text
    .replaceAll('bookofra', slug)
    .replaceAll('BookOfRa', pascal)
    .replaceAll('Book of Ra Deluxe', TITLE)
    .replaceAll('Book of Ra', TITLE)
    .replaceAll('BOOKOFRA', slug.toUpperCase())
    .replaceAll('Sizzling Hot Deluxe', TITLE); // comments reused by the template
  writeFileSync(resolve(root, to), text, 'utf8');
  written++;
}

console.log(`\nCreated ${written} files for "${slug}":`);
for (const [, to] of files) console.log('  ' + to);

console.log(`
NEXT STEPS (in this order)
--------------------------
1) Fill the game-specific math in server/casino/${slug}.mjs:
   - LINES      → copy ids/rows from the client's data/linesConfig-hd-*.json
   - PAYTABLE   → the real paytable of the cabinet (no guesses)
   - SCATTER_PAY / FREE_SPINS → only if the game has free spins
   - gradeGrid() → keep the wild/substitution rules of THIS game
2) Put the calibrated strips in server/casino/${slug}-reels.txt
   (5 reels x 75 stops; run an analytic RTP check before going live)
3) Add to server/index.mjs (after the bookofra block):
   import {create${pascal}DemoRouter, create${pascal}RealRouter, casino${pascal}SessionRouter} from './casino/${slug}.mjs';
   app.use('/app/api/casino/${slug}/real', create${pascal}RealRouter());
   app.use('/app/api', casino${pascal}SessionRouter);
   app.use('/app/api/casino/${slug}', create${pascal}DemoRouter());
   app.use('/app/casino-original/${slug}', express.static(path.join(webDist,'casino-original/${slug}'),{fallthrough:false,
     setHeaders:(res,file)=>{ if(/(?:index|index-real|head|body)\\.html$|\\/libs\\/assembler\\.js$|\\/manifest\\.json$/.test(file))
       res.setHeader('Cache-Control','no-store, max-age=0'); }}));
4) web/src/pages/CasinoPage.tsx:
   - add to GAMES:   { id: '${slug}', title: '${TITLE}', subtitle: '<linjat> · <karakteristikat>' }
   - add to the wallet GAMES map:  ${slug}: { title:'${TITLE}', session:'/casino/${slug}/session',
       play:'/app/api/casino/${slug}/real/play', prefix:'/app/casino-original/${slug}/' }
   - allow the game in the type union: export type CasinoGame = ... | '${slug}';
5) web/package.json: add "&& node ../scripts/sync-original-${slug}.mjs" to dev and build.
6) Run: node scripts/check-casino-game.mjs ${slug}
`);
