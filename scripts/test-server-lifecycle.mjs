import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { io as connectSocket } from 'socket.io-client';
import { installGracefulShutdown } from '../server/lifecycle.mjs';

const quiet = { log() {}, error() {} };
function fakeProcess(ipc = true) {
  const target = new EventEmitter();
  target.exits = [];
  target.exit = code => target.exits.push(code);
  if (ipc) target.send = () => {};
  return target;
}
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

// No real database, sport provider, credentials or public listener is used.
{
  const accepted = deferred();
  const completeRequest = deferred();
  const backgroundDone = deferred();
  const events = [];
  let responseFinished = false;
  const server = http.createServer(async (_req, res) => {
    accepted.resolve();
    await completeRequest.promise;
    res.end('transaction complete');
    responseFinished = true;
    events.push('response');
  });
  const io = new SocketServer(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const socket = connectSocket(base, { transports: ['websocket'], reconnection: false });
  await once(socket, 'connect');
  const response = new Promise((resolve, reject) => {
    http.get(`${base}/slow`, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
  await accepted.promise;
  const processRef = fakeProcess();
  const lifecycle = installGracefulShutdown({
    server, io, processRef, timeoutMs: 2000, log: quiet,
    stopBackground: () => { events.push('stop'); },
    waitForBackground: () => backgroundDone.promise,
    closePool: async () => {
      assert.equal(responseFinished, true, 'HTTP work must finish before the pool ends');
      assert.equal(io.engine.clientsCount, 0, 'Socket.IO must disconnect before the pool ends');
      events.push('pool');
    },
  });
  processRef.emit('message', { type: 'unknown' });
  assert.equal(lifecycle.isStopping(), false);
  processRef.emit('message', { type: 'faqja:stop' });
  const closing = lifecycle.shutdown('duplicate');
  assert.equal(lifecycle.shutdown('duplicate again'), closing);
  assert.equal(lifecycle.isStopping(), true);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(events, ['stop']);
  assert.deepEqual(processRef.exits, []);
  completeRequest.resolve();
  assert.equal(await response, 'transaction complete');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(events.includes('pool'), false, 'in-flight background work must drain too');
  backgroundDone.resolve();
  assert.equal(await closing, 0);
  assert.deepEqual(events, ['stop', 'response', 'pool']);
  assert.deepEqual(processRef.exits, [0]);
  assert.equal(processRef.listenerCount('message'), 0);
  socket.disconnect();
}

{
  const processRef = fakeProcess(false);
  let poolClosed = 0;
  const lifecycle = installGracefulShutdown({
    server: { close: done => done(), closeIdleConnections() {} },
    processRef, log: quiet,
    closePool: async () => { poolClosed++; },
  });
  processRef.emit('message', { type: 'faqja:stop' });
  processRef.emit('disconnect');
  assert.equal(lifecycle.isStopping(), false, 'unforked servers must not accept IPC events');
  processRef.emit('SIGTERM');
  assert.equal(await lifecycle.shutdown(), 0);
  assert.equal(poolClosed, 1);
  assert.deepEqual(processRef.exits, [0]);
}

{
  const processRef = fakeProcess();
  let forcedConnections = 0;
  let poolClosed = 0;
  const lifecycle = installGracefulShutdown({
    server: { close() {}, closeAllConnections() { forcedConnections++; } },
    processRef, log: quiet, timeoutMs: 50,
    closePool: async () => { poolClosed++; },
  });
  processRef.emit('disconnect');
  assert.equal(await lifecycle.shutdown(), 1);
  assert.equal(forcedConnections, 1);
  assert.equal(poolClosed, 0, 'never close the pool ahead of an undrained HTTP request');
  assert.deepEqual(processRef.exits, [1]);
}

{
  const processRef = fakeProcess();
  const lifecycle = installGracefulShutdown({
    server: { close: done => done() }, processRef, log: quiet, timeoutMs: 50,
    closePool: () => new Promise(() => {}),
  });
  processRef.emit('SIGINT');
  assert.equal(await lifecycle.shutdown(), 1, 'the deadline also covers a stuck database close');
  assert.deepEqual(processRef.exits, [1]);
}

console.log('Server lifecycle: private launcher IPC, HTTP/socket/background drain, signals and deadline passed.');
