/** Private parent/child IPC lets the Windows launcher stop only the server it owns. */
export function installGracefulShutdown({
  server,
  io,
  stopBackground = () => {},
  waitForBackground = () => {},
  closePool,
  processRef = process,
  timeoutMs = 8000,
  log = console,
}) {
  let stopping = false;
  let shutdownPromise;
  const hasParent = typeof processRef.send === 'function';
  const signals = ['SIGTERM', 'SIGINT'];
  const handlers = new Map();
  const dispose = () => {
    for (const [event, handler] of handlers) processRef.removeListener(event, handler);
    handlers.clear();
  };

  function shutdown(reason = 'stop') {
    if (stopping) return shutdownPromise;
    stopping = true;
    shutdownPromise = new Promise((resolve) => {
      let finished = false;
      // A request active at server.close() can become an idle keep-alive later.
      // Reap only idle connections; never abort the response carrying its result.
      const drainIdle = setInterval(() => server.closeIdleConnections?.(), 25);
      const finish = (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        clearInterval(drainIdle);
        dispose();
        resolve(code);
        processRef.exit(code);
      };
      const deadline = setTimeout(() => {
        log.error?.('[app] shutdown deadline reached; closing remaining connections');
        try { io?.engine?.close(); } catch {}
        try { server.closeAllConnections?.(); } catch {}
        finish(1);
      }, Math.max(1, timeoutMs));

      void (async () => {
        log.log?.(`[app] ${reason} received, shutting down`);
        await stopBackground();
        // HTTP responses may still contain pending ledger transactions. Finish those
        // and disconnect Socket.IO before ending the database pool.
        await Promise.all([
          new Promise((done, reject) => {
            server.close((error) => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : done());
            server.closeIdleConnections?.();
          }),
          new Promise((done, reject) => {
            if (!io) return done();
            try {
              const closing = io.close((error) => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : done());
              void Promise.resolve(closing).catch(reject);
            } catch (error) { reject(error); }
          }),
        ]);
        await waitForBackground();
        if (finished) return;
        await closePool();
        finish(0);
      })().catch((error) => {
        log.error?.('[app] shutdown failed:', error?.message ?? error);
        finish(1);
      });
    });
    return shutdownPromise;
  }

  for (const signal of signals) handlers.set(signal, () => void shutdown(signal));
  if (hasParent) {
    handlers.set('message', (message) => {
      if (message && typeof message === 'object' && message.type === 'faqja:stop') void shutdown('launcher stop');
    });
    handlers.set('disconnect', () => void shutdown('launcher disconnected'));
  }
  for (const [event, handler] of handlers) processRef.on(event, handler);
  return { shutdown, isStopping: () => stopping, dispose };
}
