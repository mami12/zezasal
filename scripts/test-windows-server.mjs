/** Integration tests use loopback and disposable processes only; no real backend or database. */
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { ensureWindowsEnv } from './windows-config.mjs';
import { controlPaths, controlRequest, stopWindowsServer, prepareWindowsInstall } from './windows-server.mjs';

const scratch = await mkdtemp(join(tmpdir(), 'faqja Windows server test '));
const workers = [];
const extras = [];
const parentServers = [];
const ownerSockets = new Set();
const tokens = [];
const stopLogs = [];
const moduleUrl = new URL('./windows-server.mjs', import.meta.url).href;
const template = fileURLToPath(new URL('../.env.windows.example', import.meta.url));
let fixtureNumber = 0;

async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function waitFor(check, message, timeout = 8000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await delay(30);
  }
  throw Error(message);
}
function doneWithin(promise, message, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(message)), timeout);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function fixture(port, { prepareDelay = 0, earlyExit = false } = {}) {
  port ??= await freePort();
  const rootDir = join(scratch, `server copy ${++fixtureNumber}`);
  await mkdir(rootDir);
  await copyFile(template, join(rootDir, '.env.windows.example'));
  await ensureWindowsEnv({ rootDir });
  const profile = await readFile(join(rootDir, '.env'), 'utf8');
  await writeFile(join(rootDir, '.env'), profile
    .replace(/^PORT=.*$/m, `PORT=${port}`)
    .replace(/^DATABASE_URL=.*$/m, 'DATABASE_URL=postgresql://fixture:local-only-password@127.0.0.1:1/disposable_test'));
  const entry = join(rootDir, 'fake backend.mjs');
  await writeFile(entry, `
import http from 'node:http';
import {appendFileSync,writeFileSync} from 'node:fs';
appendFileSync('backend-starts.txt',String(process.pid)+'\\n');
writeFileSync('backend-env.txt',JSON.stringify({port:process.env.PORT,production:process.env.NODE_ENV,seed:process.env.SEED_DEFAULT_ACCOUNTS}));
${earlyExit ? 'process.exit(7);' : ''}
const server=http.createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,ledger:{ready:true}}));});
server.listen(Number(process.env.PORT),'127.0.0.1');
process.on('message',message=>{if(message?.type==='faqja:stop'){appendFileSync('backend-stops.txt','stopped\\n');server.close(()=>process.exit(0));}});
`);
  const worker = join(rootDir, 'controller worker.mjs');
  await writeFile(worker, `
import {startWindowsServer} from ${JSON.stringify(moduleUrl)};
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
try{process.exitCode=await startWindowsServer({
 rootDir:${JSON.stringify(rootDir)},entry:${JSON.stringify(entry)},
 prepare:async()=>{writeFileSync('prepare-started.txt','preparing');await delay(${prepareDelay});},
 launchBrowser:()=>{},editConfig:()=>{throw Error('Unexpected config editor');},startupTimeoutMs:5000,
});}catch(error){console.error(error.message);process.exitCode=1;}
`);
  return { rootDir, port, worker, entry, paths: controlPaths(rootDir) };
}
function startWorker(setup) {
  const process = spawn(globalThis.process.execPath, [setup.worker], {
    cwd: setup.rootDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...globalThis.process.env, NODE_ENV: 'development', PORT: '1', DATABASE_URL: 'invalid-inherited-url' },
  });
  const record = { process, setup, output: '', done: null };
  process.stdout.on('data', chunk => { record.output += chunk; });
  process.stderr.on('data', chunk => { record.output += chunk; });
  record.done = new Promise((resolve, reject) => {
    process.once('error', reject);
    process.once('exit', (code, signal) => resolve({ code, signal }));
  });
  workers.push(record);
  return record;
}
async function running(record) {
  await waitFor(async () => {
    if (record.process.exitCode !== null) throw Error(`Controller exited before ready: ${record.output}`);
    try {
      const state = JSON.parse(await readFile(record.setup.paths.state, 'utf8'));
      if (state.phase !== 'running') return false;
      tokens.push(state.token);
      return (await controlRequest(record.setup.paths)).phase === 'running';
    } catch { return false; }
  }, 'Controller never entered running phase');
}

try {
  const normal = await fixture();
  const controller = startWorker(normal);
  await running(controller);
  assert.match(normal.paths.pipe, globalThis.process.platform === 'win32' ? /^\\\\\.\\pipe\\faqja-/ : /faqja-.+\.sock$/);
  assert.equal(controller.process.exitCode, null, 'The controller must remain active until explicitly stopped');
  assert.deepEqual(JSON.parse(await readFile(join(normal.rootDir, 'backend-env.txt'), 'utf8')), {
    port: String(normal.port), production: 'production', seed: 'false',
  }, 'The backend receives the local production profile rather than inherited settings');
  assert.deepEqual(await controlRequest(normal.paths, { command: 'stop', token: 'incorrect-control-token' }), { ok: false });
  assert.equal((await controlRequest(normal.paths)).phase, 'running', 'A wrong token must not stop the server');

  const duplicate = startWorker(normal);
  assert.equal((await doneWithin(duplicate.done, 'Duplicate controller remained active')).code, 0);
  assert.match(duplicate.output, /already running/);
  assert.equal((await readFile(join(normal.rootDir, 'backend-starts.txt'), 'utf8')).trim().split('\n').length, 1,
    'Duplicate start must not launch a second backend');
  await stopWindowsServer({ rootDir: normal.rootDir, log: value => stopLogs.push(value), timeoutMs: 5000 });
  assert.equal((await doneWithin(controller.done, 'Controller did not exit after stop')).code, 0);
  assert.equal(await exists(normal.paths.state), false, 'Successful shutdown removes private control state');
  assert.equal(await readFile(join(normal.rootDir, 'backend-stops.txt'), 'utf8'), 'stopped\n', 'Shutdown reaches only the owned backend through IPC');
  assert.deepEqual(await stopWindowsServer({ rootDir: normal.rootDir, log: value => stopLogs.push(value) }), { running: false });

  const stale = await fixture();
  const unrelated = spawn(globalThis.process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
  extras.push(unrelated);
  await new Promise((resolve, reject) => { unrelated.once('spawn', resolve); unrelated.once('error', reject); });
  await mkdir(stale.paths.dir);
  const staleToken = 'a'.repeat(64);
  tokens.push(staleToken);
  await writeFile(stale.paths.state, JSON.stringify({ pid: unrelated.pid, token: staleToken, phase: 'running' }));
  assert.deepEqual(await stopWindowsServer({ rootDir: stale.rootDir, log: value => stopLogs.push(value) }), { running: false });
  assert.equal(await exists(stale.paths.state), false);
  assert.equal(unrelated.exitCode, null);
  assert.equal(unrelated.signalCode, null);
  assert.doesNotThrow(() => globalThis.process.kill(unrelated.pid, 0), 'Stale PID state must never kill an unrelated Node process');

  const early = await fixture(undefined, { earlyExit: true });
  const failed = startWorker(early);
  assert.notEqual((await doneWithin(failed.done, 'Early backend exit trapped its controller')).code, 0);
  assert.equal(await exists(early.paths.state), false, 'Early backend exit must not recreate stale state during cleanup');
  assert(!failed.output.includes('Server started:'), 'An exited backend must not be reported as running');

  const preparing = await fixture(undefined, { prepareDelay: 800 });
  const cancelled = startWorker(preparing);
  await waitFor(() => exists(join(preparing.rootDir, 'prepare-started.txt')), 'Preparation never began');
  await stopWindowsServer({ rootDir: preparing.rootDir, log: value => stopLogs.push(value), timeoutMs: 3000 });
  assert.equal((await doneWithin(cancelled.done, 'Stopping preparation trapped its controller')).code, 0);
  assert.equal(await exists(preparing.paths.state), false, 'An async preparation completing after Stop must not recreate state');
  assert.equal(await exists(join(preparing.rootDir, 'backend-starts.txt')), false, 'Cancelled preparation must not launch the backend');

  const owner = net.createServer(socket => {
    ownerSockets.add(socket);
    socket.once('close', () => ownerSockets.delete(socket));
    socket.end('still-owned', () => socket.destroy());
  });
  parentServers.push(owner);
  await new Promise((resolve, reject) => { owner.once('error', reject); owner.listen(0, '127.0.0.1', resolve); });
  const busy = await fixture(owner.address().port);
  const blocked = startWorker(busy);
  assert.equal((await doneWithin(blocked.done, 'Busy port check did not finish')).code, 1);
  assert.match(blocked.output, /Port \d+ is busy/);
  assert.equal(await exists(join(busy.rootDir, 'backend-starts.txt')), false, 'Do not start the backend on an occupied port');
  assert.equal(await exists(busy.paths.state), false, 'Failed start removes its control state');
  const received = await new Promise((resolve, reject) => {
    const client = net.createConnection({ host: '127.0.0.1', port: busy.port });
    let text = '';
    client.on('data', chunk => { text += chunk; });
    client.once('error', reject); client.once('end', () => resolve(text));
  });
  assert.equal(received, 'still-owned', 'The process that owns a busy port remains available');

  const output = workers.map(worker => worker.output).concat(stopLogs).join('\n');
  for (const token of tokens) assert(!output.includes(token), 'Private control tokens must never appear in logs');
  assert(!output.includes('local-only-password'), 'Database credentials must never appear in launcher logs');

  const installation = join(scratch, 'fresh installation with spaces');
  await mkdir(join(installation, '.runtime'), { recursive: true });
  // Minimal source fixture: run() records commands instead of downloading or building anything.
  for (const file of [
    'package.json', 'package-lock.json', 'web/package.json', 'web/index.html', 'web/vite.config.ts',
    'web/tsconfig.json', 'web/tailwind.config.js', 'web/postcss.config.js',
    'scripts/sync-original-sizzling.mjs', 'scripts/sync-original-bookofra.mjs',
    'scripts/pixi-client-compat.mjs', 'scripts/verify-original-sizzling.mjs',
  ]) {
    const path = join(installation, file);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, file.endsWith('.json') ? '{}' : '// disposable fixture\n');
  }
  const commands = [];
  const prepare = () => prepareWindowsInstall({
    rootDir: installation,
    env: { NODE_ENV: 'production', DATABASE_URL: 'private-db', JWT_SECRET: 'private-jwt', INGEST_TOKEN: 'private-ingest', ADMIN_PASSWORD: 'private-admin', DEMO_PASSWORD: 'private-demo' },
    log: () => {},
    run: async (args, env) => {
      commands.push(args.slice(1));
      for (const key of ['DATABASE_URL', 'JWT_SECRET', 'INGEST_TOKEN', 'ADMIN_PASSWORD', 'DEMO_PASSWORD']) {
        assert.equal(env[key], undefined, `${key} must not reach package installation or frontend builds`);
      }
      assert.equal(env.PUPPETEER_SKIP_DOWNLOAD, 'true');
      if (args[1] === 'ci') {
        assert(args.includes('--include=dev'), 'Production profiles must still install frontend build tools');
        await mkdir(join(installation, 'node_modules/dotenv'), { recursive: true });
        await writeFile(join(installation, 'node_modules/dotenv/package.json'), '{}');
      } else {
        assert.deepEqual(args.slice(1), ['run', 'build:web']);
        await mkdir(join(installation, 'web/dist'), { recursive: true });
        await writeFile(join(installation, 'web/dist/index.html'), '<!doctype html>');
      }
    },
  });
  await prepare();
  assert.equal(commands.length, 2, 'Fresh installation installs dependencies then builds the frontend');
  assert.equal(commands[0][0], 'ci');
  assert.deepEqual(commands[1], ['run', 'build:web']);
  await prepare();
  assert.equal(commands.length, 2, 'An unchanged server skips installation and build on the next start');
  await mkdir(join(installation, 'web/src'), { recursive: true });
  await writeFile(join(installation, 'web/src/fixture.ts'), 'export const changed=true;');
  await prepare();
  assert.equal(commands.length, 3, 'A frontend source change requires one rebuild');
  assert.deepEqual(commands[2], ['run', 'build:web']);
  await mkdir(join(installation, 'server/ledger'), { recursive: true });
  const sharedSource = join(installation, 'server/ledger/shared.mjs');
  await writeFile(sharedSource, 'export const shared=1;');
  await prepare();
  assert.equal(commands.length, 4, 'Adding a shared server helper requires a frontend rebuild');
  assert.deepEqual(commands[3], ['run', 'build:web']);
  await prepare();
  assert.equal(commands.length, 4, 'Unchanged shared helpers preserve the build cache');
  await writeFile(sharedSource, 'export const shared=2;');
  await prepare();
  assert.equal(commands.length, 5, 'Changing a shared server helper invalidates the frontend build cache');
  assert.deepEqual(commands[4], ['run', 'build:web']);
  await writeFile(join(installation, 'server/ledger/.env'), 'PRIVATE_TEST_SETTING=not-a-source-file');
  await prepare();
  assert.equal(commands.length, 5, 'Private environment files must not enter the source fingerprint');

  if (globalThis.process.platform === 'win32') {
    const batchRoot = join(scratch, 'batch copy with spaces');
    const launchFrom = join(batchRoot, 'launch from here');
    await mkdir(join(batchRoot, 'scripts'), { recursive: true });
    await mkdir(launchFrom);
    for (const name of ['start.bat', 'stop.bat']) {
      await copyFile(fileURLToPath(new URL('../' + name, import.meta.url)), join(batchRoot, name));
    }
    await writeFile(join(batchRoot, 'scripts/windows-server.mjs'), `
import {appendFileSync} from 'node:fs';
appendFileSync(new URL('../batch-actions.txt',import.meta.url),JSON.stringify({cwd:process.cwd(),action:process.argv[2]})+'\\n');
`);
    for (const action of ['start', 'stop']) {
      // The command is a fixed relative filename; paths with spaces never become shell text.
      const child = spawn('cmd.exe', ['/d', '/s', '/c', `..\\${action}.bat`], {
        cwd: launchFrom, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let text = '';
      child.stdout.on('data', chunk => { text += chunk; });
      child.stderr.on('data', chunk => { text += chunk; });
      child.stdin.end('\r\n');
      try {
        const code = await doneWithin(new Promise((resolve, reject) => {
          child.once('error', reject); child.once('exit', resolve);
        }), `${action}.bat did not finish`, 5000);
        assert.equal(code, 0, `${action}.bat failed: ${text}`);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      }
    }
    const actions = (await readFile(join(batchRoot, 'batch-actions.txt'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(actions, [{ cwd: batchRoot, action: 'start' }, { cwd: batchRoot, action: 'stop' }],
      'Actual batch files locate their own copy and pass the correct action from a different working directory');
  }
  console.log('Windows server integration passed (lifecycle, IPC auth, port safety, first install/build cache, batch files).');
} finally {
  for (const worker of workers) {
    if (worker.process.exitCode !== null || worker.process.signalCode !== null) continue;
    try { await stopWindowsServer({ rootDir: worker.setup.rootDir, log: () => {}, timeoutMs: 3000 }); } catch {}
    if (worker.process.exitCode === null && worker.process.signalCode === null) worker.process.kill('SIGTERM');
    try { await doneWithin(worker.done, 'Worker cleanup timed out', 4000); } catch { worker.process.kill('SIGKILL'); }
  }
  for (const child of extras) {
    if (child.exitCode === null && child.signalCode === null) {
      const done = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await doneWithin(done, 'Disposable process cleanup timed out', 3000);
    }
  }
  for (const socket of ownerSockets) socket.destroy();
  for (const server of parentServers) {
    if (server.listening) await doneWithin(new Promise(resolve => server.close(resolve)), 'Port owner cleanup timed out', 2000);
  }
  // This is the exact disposable directory created by mkdtemp above.
  await rm(scratch, { recursive: true, force: true });
}
