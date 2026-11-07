import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalPool } from '../server/local-database.mjs';

// All test databases are private disposable directories under ignored tmp/.
const repository = fileURLToPath(new URL('../', import.meta.url));
const temporaryRoot = resolve(repository, 'tmp');
await mkdir(temporaryRoot, { recursive: true });
const root = await mkdtemp(join(temporaryRoot, 'local-database-'));
const dataDir = join(root, 'database'), pools = [], children = new Set();
const pool = options => { const instance = createLocalPool(options); pools.push(instance); return instance; };
const deadline = (promise, description) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${description}`)), 15000); })]).finally(() => clearTimeout(timer));
};
const adapterUrl = new URL('../server/local-database.mjs', import.meta.url).href;
async function childDatabase(directory, { hold = false, mutate = false } = {}) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import {createLocalPool} from ${JSON.stringify(adapterUrl)};
    const db=createLocalPool({dataDir:process.argv[1]});
    try {
      await db.query('select 1');
      ${mutate ? "await db.query(\"insert into balances(id,amount) values('crash',777) on conflict(id) do update set amount=excluded.amount\");" : ''}
      console.log('LOCAL_DB_READY');
      ${hold ? 'setInterval(()=>{},1000);' : 'await db.end();'}
    } catch(error) { console.log('LOCAL_DB_ERROR:'+error.code); await db.end().catch(()=>{}); process.exitCode=2; }
  `, directory], { cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child); child.once('exit', () => children.delete(child));
  let stdout = '', stderr = '';
  const ready = new Promise((accept, reject) => {
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.includes('LOCAL_DB_READY') || stdout.includes('LOCAL_DB_ERROR:')) accept(stdout); });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => { if (!stdout.includes('LOCAL_DB_')) reject(new Error(`Child exited ${code}: ${stderr}`)); });
  });
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  return { child, output: await deadline(ready, 'child database startup'), exited };
}

try {
  assert.throws(() => createLocalPool({ dataDir: 'memory://unsafe' }), /persistent/);
  const first = pool({ dataDir });
  assert.equal(first.driver, 'local');
  assert.equal(first.dataDir, resolve(dataDir));
  const ownerlessFiles = await readdir(root);
  assert.deepEqual(ownerlessFiles, [], 'Constructing a pool must not initialize a database.');
  await first.query(`create table balances(id text primary key,amount numeric(14,2));
    insert into balances values('a',100),('b',100);`);
  const types = (await first.query("select 1234567890123::bigint as large,1.25::numeric as amount,now() as instant,'{\"yes\":true}'::jsonb as document,array[1,2]::int[] as numbers")).rows[0];
  assert.equal(types.large, 1234567890123); assert.equal(types.amount, 1.25);
  assert.ok(types.instant instanceof Date); assert.deepEqual(types.document, { yes: true }); assert.deepEqual(types.numbers, [1, 2]);
  assert.equal((await first.query('update balances set amount=amount+1')).rowCount, 2);
  assert.equal((await first.query('select * from balances')).rowCount, 2);

  const client = await first.connect();
  await client.query('begin');
  await client.query("update balances set amount=amount-10 where id='a'");
  let observed = false;
  const read = first.query('select sum(amount) as total from balances').then(result => { observed = true; return result; });
  await delay(20);
  assert.equal(observed, false, 'A pool query must wait outside another client transaction.');
  await client.query("update balances set amount=amount+10 where id='b'");
  await client.query('commit');
  assert.equal((await read).rows[0].total, 202);
  // Existing cashier code performs this read before release().
  assert.equal((await deadline(first.query("select amount from balances where id='a'"), 'post-commit global query')).rows[0].amount, 91);
  await client.query('select 1'); client.release(); client.release();
  await assert.rejects(client.query('select 1'), /released/);

  await Promise.all(Array.from({ length: 20 }, async () => {
    const transfer = await first.connect();
    try {
      await transfer.query('begin');
      await transfer.query("update balances set amount=amount-1 where id='a'");
      await transfer.query("update balances set amount=amount+1 where id='b'");
      await transfer.query('commit');
    } finally { transfer.release(); }
  }));
  assert.deepEqual((await first.query('select id,amount from balances order by id')).rows, [{ id: 'a', amount: 71 }, { id: 'b', amount: 131 }]);
  const failing = await first.connect();
  await failing.query('begin');
  await failing.query("update balances set amount=99999 where id='a'");
  await assert.rejects(failing.query('select absent_column from balances'), error => error.code === '42703');
  failing.release();
  assert.equal((await deadline(first.query("select amount from balances where id='a'"), 'release rollback')).rows[0].amount, 71);
  await assert.rejects(first.query('begin'), /pool.connect/);
  assert.equal((await first.query('select sum(amount) as total from balances')).rows[0].total, 202);

  const duplicate = pool({ dataDir });
  await assert.rejects(duplicate.query('select 1'), error => error.code === 'LOCAL_DATABASE_LOCKED');
  await duplicate.end();
  const secondProcess = await childDatabase(dataDir);
  assert.match(secondProcess.output, /LOCAL_DB_ERROR:LOCAL_DATABASE_LOCKED/);
  assert.equal(await secondProcess.exited, 2);
  const archive = await first.backup();
  assert.ok(archive instanceof Blob && archive.size > 1000);
  const restored = pool({ dataDir: join(root, 'restored'), loadDataDir: archive });
  assert.deepEqual((await restored.query('select id,amount from balances order by id')).rows, [{ id: 'a', amount: 71 }, { id: 'b', amount: 131 }]);
  await restored.end();
  await first.end(); await first.end();
  await assert.rejects(first.query('select 1'), error => error.code === 'LOCAL_DATABASE_CLOSED');
  const reopened = pool({ dataDir });
  assert.equal((await reopened.query('select sum(amount) as total from balances')).rows[0].total, 202);
  await reopened.end();

  const crashed = await childDatabase(dataDir, { hold: true, mutate: true });
  assert.match(crashed.output, /LOCAL_DB_READY/);
  crashed.child.kill('SIGKILL'); await crashed.exited;
  const recovered = pool({ dataDir });
  assert.equal((await recovered.query("select amount from balances where id='crash'")).rows[0].amount, 777, 'Committed changes survive an abrupt process stop.');
  await recovered.end();
  const brokenDir = join(root, 'broken');
  await mkdir(`${brokenDir}.lock`); await writeFile(join(`${brokenDir}.lock`, 'owner.json'), '{}');
  const broken = pool({ dataDir: brokenDir });
  await assert.rejects(broken.query('select 1'), error => error.code === 'LOCAL_DATABASE_LOCKED');
  await broken.end();

  const draining = pool({ dataDir });
  const finalClient = await draining.connect();
  await finalClient.query('begin');
  const ending = draining.end();
  await assert.rejects(draining.query('select 1'), error => error.code === 'LOCAL_DATABASE_CLOSED');
  await finalClient.query("update balances set amount=amount+1 where id='a'");
  await finalClient.query('commit'); finalClient.release();
  await deadline(ending, 'pool drain');
  const final = pool({ dataDir });
  assert.equal((await final.query("select amount from balances where id='a'")).rows[0].amount, 72);
  await final.end();
  console.log('Local database: persistent restart, isolated concurrent transactions, rollback, locks, crash recovery, backup restore and shutdown passed.');
} finally {
  for (const child of children) child.kill('SIGKILL');
  await Promise.allSettled(pools.map(instance => instance.end()));
  // The resolved mkdtemp directory is verified inside the intended test root.
  assert.equal(resolve(root).startsWith(`${temporaryRoot}\\`) || resolve(root).startsWith(`${temporaryRoot}/`), true);
  await rm(root, { recursive: true, force: true });
}
