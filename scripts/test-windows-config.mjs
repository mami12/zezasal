import assert from 'node:assert/strict';
import { mkdtemp, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ensureWindowsEnv, loadWindowsConfig, parseWindowsConfig, ensureWindowsLocalDatabase } from './windows-config.mjs';

const root = await mkdtemp(resolve(tmpdir(), 'faqja windows config '));
try {
  await copyFile(fileURLToPath(new URL('../.env.windows.example', import.meta.url)), resolve(root, '.env.windows.example'));
  const results = await Promise.all([
    ensureWindowsEnv({ rootDir: root }), ensureWindowsEnv({ rootDir: root }),
  ]);
  assert.equal(results.filter(result => result.created).length, 1, 'Only one first start creates the file');
  const first = await readFile(resolve(root, '.env'), 'utf8');
  const generated = parseEnv(first);
  assert.match(generated.JWT_SECRET, /^[A-Za-z0-9_-]{64}$/);
  assert.match(generated.INGEST_TOKEN, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(generated.JWT_SECRET, generated.INGEST_TOKEN);
  assert.equal(generated.SEED_DEFAULT_ACCOUNTS, 'false');
  assert.equal(generated.IDLE_FEED, 'false');
  const firstStart = await loadWindowsConfig({ rootDir: root, baseEnv: { DATABASE_URL: 'must-not-connect-to-cloud' } });
  assert.deepEqual(firstStart.errors, [], 'First start needs no manual database credentials');
  assert.equal(firstStart.env.DB_DRIVER, 'local');
  assert.equal(firstStart.env.DATABASE_URL, '', 'Inherited cloud settings cannot override a new local installation');
  assert.equal(firstStart.env.LOCAL_DATABASE_DIR, 'data/database');
  assert.equal(firstStart.env.DB_INIT_STRICT, 'true');

  const database = 'postgresql://testuser:test%40password@127.0.0.1:5432/disposable_test';
  const ready = first.replace(/^DB_DRIVER=.*$/m, 'DB_DRIVER=postgres').replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${database}`);
  await writeFile(resolve(root, '.env'), ready);
  const config = await loadWindowsConfig({
    rootDir: root,
    baseEnv: { PORT: '9000', DATABASE_URL: 'invalid inherited DB', JWT_SECRET: 'weak inherited key', PATH: 'inherited path' },
  });
  assert.deepEqual(config.errors, []);
  assert.equal(config.port, 3000);
  assert.equal(config.url, 'http://localhost:3000/app/');
  assert.equal(config.env.DATABASE_URL, database, '.env beats inherited process settings');
  assert.equal(config.env.JWT_SECRET, generated.JWT_SECRET);
  assert.equal(config.env.PATH, 'inherited path');
  assert.equal(config.env.PARTNER_ID, 'd3edfa27-7cac-4f77-9e6e-4e2fa2d1ab5f');
  assert.equal((await ensureWindowsEnv({ rootDir: root })).created, false);
  assert.equal(await readFile(resolve(root, '.env'), 'utf8'), ready, 'Existing secrets and comments are preserved exactly');

  for (const [key, value] of [
    ['PORT', '0'], ['PORT', '65536'], ['PORT', '30.2'],
    ['DATABASE_URL', 'postgresql://user:REPLACE_WITH_NEW_DATABASE_PASSWORD@host/db'],
    ['DATABASE_URL', 'https://user:secret-password@example.com/db'],
    ['JWT_SECRET', 'faqja-dev-secret-change-me'], ['INGEST_TOKEN', 'your-random-secret-token'],
    ['SEED_DEFAULT_ACCOUNTS', 'true'], ['NODE_ENV', 'development'],
    ['POLL_INTERVAL_MS', 'NaN'], ['ODDS_SOCKET', 'yes'], ['MATCH_CLOCK_OFFSET_MIN', '3.5'],
  ]) {
    const invalid = parseWindowsConfig(`${ready}\n${key}=${value}\n`);
    assert(invalid.errors.some(error => error.includes(key)), `${key} must be rejected`);
    assert(!invalid.errors.some(error => error.includes(value)), 'Never print a secret or invalid configuration value');
  }
  const local = parseWindowsConfig(ready+'\nDB_DRIVER=local\nDATABASE_URL=\nLOCAL_DATABASE_DIR=data/database\n');
  assert.deepEqual(local.errors, []);
  assert.equal(local.env.DATABASE_URL, '');
  assert.equal(local.env.DB_INIT_STRICT, 'true');
  assert.equal(local.env.LOG_RAW_FRAMES, 'false');
  const inheritedCloud = parseWindowsConfig(ready+'\nDB_DRIVER=local\n', {DATABASE_URL:database});
  assert.equal(inheritedCloud.env.DATABASE_URL, '', 'Local mode never falls back to inherited cloud credentials');
  for(const directory of ['memory://volatile','web/public/database','docs/database','.git/database','.']){
    assert.ok(parseWindowsConfig(ready+'\nDB_DRIVER=local\nLOCAL_DATABASE_DIR='+directory+'\n').errors.some(error=>error.includes('LOCAL_DATABASE_DIR')));
  }
  assert.ok(parseWindowsConfig(ready+'\nDB_DRIVER=unknown\n').errors.some(error=>error.includes('DB_DRIVER')));
  const quoted = parseWindowsConfig(`${ready}\nMATCH_CLOCK_OFFSET_MIN=-3\nEXTRA_SETTING="some $literal & value" # comment\n`);
  assert.deepEqual(quoted.errors, []);
  assert.equal(quoted.env.EXTRA_SETTING, 'some $literal & value', 'Values are not shell-evaluated');
  let migrations=0;
  await writeFile(resolve(root,'.env'),first);
  const alreadyLocal=await ensureWindowsLocalDatabase({rootDir:root,log:()=>{},migrate:async()=>{migrations++;}});
  assert.equal(alreadyLocal.env.DB_DRIVER,'local');assert.equal(migrations,0,'local data is never reimported');
  await writeFile(resolve(root,'.env'),ready);
  const converted=await ensureWindowsLocalDatabase({rootDir:root,log:()=>{},migrate:async options=>{
    migrations++;assert.equal(await readFile(resolve(root,'.env'),'utf8'),ready);
    await options.stop(); // Must not send the launcher an IPC stop request.
    await writeFile(resolve(root,'.env'),ready+'\nDB_DRIVER=local\nDATABASE_URL=\n');
  }});
  assert.equal(converted.env.DB_DRIVER,'local');assert.equal(converted.env.DATABASE_URL,'');
  assert.equal(converted.env.JWT_SECRET,generated.JWT_SECRET);assert.equal(migrations,1);
  await writeFile(resolve(root,'.env'),ready);
  await assert.rejects(ensureWindowsLocalDatabase({rootDir:root,log:()=>{},migrate:async()=>{throw Error('private database failure detail')}}),error=>{
    assert.match(error.message,/previous database configuration was preserved/);
    assert.ok(!error.message.includes('private database failure detail'));return true;
  });
  assert.equal(await readFile(resolve(root,'.env'),'utf8'),ready,'failed conversion leaves previous account source unchanged');
  await rm(resolve(root, '.env'));
  const missing = await loadWindowsConfig({ rootDir: root, baseEnv: {} });
  assert.deepEqual(missing.errors, ['.env is missing. Run start.bat to create it.']);
  console.log('Windows config tests passed (create once, safe secrets, local precedence, validation).');
} finally {
  await rm(root, { recursive: true, force: true });
}
