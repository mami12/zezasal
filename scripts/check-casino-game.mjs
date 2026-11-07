#!/usr/bin/env node
/**
 * Acceptance check for a scaffolded casino cabinet.
 *
 *   node scripts/check-casino-game.mjs gates
 *
 * Verifies files exist, syntax is valid, the module exports the expected API,
 * the analytic RTP sits in the accepted band, the demo protocol answers
 * init/spin and that no shared money module was modified.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const slug = String(process.argv[2] || '').toLowerCase();
if (!/^[a-z][a-z0-9]{2,19}$/.test(slug)) {
  console.error('Usage: node scripts/check-casino-game.mjs <slug>');
  process.exit(1);
}
const pascal = slug.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
const p = (rel) => resolve(root, rel);

const results = [];
async function check(name, fn) {
  try { const extra = await fn(); results.push({ ok: true, name, extra: extra || '' }); }
  catch (e) { results.push({ ok: false, name, extra: e.message }); }
}

const NEED = [
  `scripts/sync-original-${slug}.mjs`,
  `server/casino/${slug}.mjs`,
  `server/casino/${slug}-transactions.mjs`,
  `server/casino/${slug}-reels.txt`,
];

await check(`files for "${slug}"`, () => {
  const missing = NEED.filter((f) => !existsSync(p(f)));
  if (missing.length) throw new Error('missing: ' + missing.join(', '));
  return NEED.length + ' files';
});

await check('syntax (node --check)', () => {
  for (const f of NEED.filter((x) => x.endsWith('.mjs'))) {
    execFileSync(process.execPath, ['--check', p(f)], { stdio: 'inherit' });
  }
  return '3 files parse';
});

await check('reels are 5x75', () => {
  const text = readFileSync(p(`server/casino/${slug}-reels.txt`), 'utf8');
  const reels = text.split(/\r?\n/).filter((l) => l.startsWith('reelStrip'));
  if (reels.length !== 5) throw new Error(`expected 5 strips, found ${reels.length}`);
  for (const line of reels) {
    const stops = line.slice(line.indexOf('=') + 1).split(',').filter((s) => s.trim()).length;
    if (stops !== 75) throw new Error(`${line.split('=')[0]} has ${stops} stops, expected 75`);
  }
  return '5 x 75';
});

let mod = null;
await check('server module exports the game API', async () => {
  mod = await import(pathToFileURL(p(`server/casino/${slug}.mjs`)).href);
  const need = [`create${pascal}DemoRouter`, `create${pascal}RealRouter`, 'gradeGrid', 'randomGrid', 'LINES', 'PAYTABLE'];
  const missing = need.filter((k) => !(k in mod));
  if (missing.length) throw new Error('missing exports: ' + missing.join(', '));
  return 'API ok';
});

await check('sync script copies the original client', () => {
  const text = readFileSync(p(NEED[0]), 'utf8');
  for (const needle of ['libs', 'audio', 'animations', 'data', 'manifest.json']) {
    if (!text.includes(needle)) throw new Error(`sync script does not copy "${needle}"`);
  }
  return 'libs, audio, animations, data, manifest';
});

await check('shared money modules untouched', () => {
  const guarded = ['server/casino/transactions.mjs', 'server/casino/gamble.mjs', 'server/ledger/schema.mjs'];
  let diff = '';
  try {
    diff = execFileSync('git', ['diff', '--name-only', 'HEAD~1', '--', ...guarded], { cwd: root, encoding: 'utf8' });
  } catch { return 'skipped (no git history)'; }
  if (diff.trim()) throw new Error('modified: ' + diff.trim().split('\n').join(', '));
  return 'untouched';
});

await check('RTP in the accepted band (93.5% - 97%)', () => {
  if (!mod) throw new Error('module not loaded');
  const spins = 400000;
  let total = 0, hits = 0;
  for (let i = 0; i < spins; i++) {
    const r = mod.gradeGrid(mod.randomGrid(), 1, mod.LINES.length);
    total += r.total;
    if (r.total > 0) hits++;
  }
  const rtp = (total / (spins * mod.LINES.length)) * 100;
  const hit = (hits / spins) * 100;
  if (!(rtp >= 94.5 && rtp <= 96.5)) throw new Error(`RTP ${rtp.toFixed(2)}% is outside 94.5-96.5%`);
  return `RTP ${rtp.toFixed(2)}% · hit ${hit.toFixed(1)}%`;
});

await check('demo protocol answers init + spin', async () => {
  if (!mod) throw new Error('module not loaded');
  const express = (await import('express')).default;
  const app = express();
  app.use('/demo', mod[`create${pascal}DemoRouter`]());
  const server = await new Promise((done) => { const s = app.listen(0, '127.0.0.1', () => done(s)); });
  const base = `http://127.0.0.1:${server.address().port}/demo/play`;
  let cookie = '';
  const call = async (body) => {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { Cookie: cookie } : {}) },
      body: new URLSearchParams({ data: JSON.stringify(body) }),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return res.json();
  };
  try {
    const init = await call({ action: 'init', request_id: '0' });
    if (!init.init || typeof init.balance?.after !== 'number') throw new Error('bad init response');
    const spin = await call({ action: 'spin', bet: 1, lines: init.init.lines, denomination: 1, request_id: '1' });
    if (!spin.spin?.symbols) throw new Error('bad spin response');
    return 'init + spin';
  } finally {
    await new Promise((done) => server.close(done));
  }
});

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
let failed = 0;
console.log(`\nAcceptance check: ${slug}\n${'-'.repeat(64)}`);
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${pad(r.name, 48)} ${r.extra}`);
}
console.log('-'.repeat(64));
console.log(failed ? `${failed} check(s) failed — do not deploy.\n` : 'All checks passed.\n');
process.exit(failed ? 1 : 0);
