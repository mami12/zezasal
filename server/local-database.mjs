/** One durable PostgreSQL backend, owned by exactly one local server process. */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { mkdir, open, readFile, realpath, rename, rmdir, unlink, readdir, access } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import {assertDatabaseRequestCurrent} from './database-request-context.mjs';

const locked = () => Object.assign(new Error('Local database is already open, or its ownership cannot be verified. Stop the other server before trying again.'), { code: 'LOCAL_DATABASE_LOCKED' });
const closed = () => Object.assign(new Error('Local database pool is closed.'), { code: 'LOCAL_DATABASE_CLOSED' });
const readOwner = async path => { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } };
const sameOwner = (a, b) => a && b && a.pid === b.pid && a.token === b.token && a.host === b.host;
function ownerIsDead(owner) {
  if (!owner || owner.version !== 1 || owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.token !== 'string') return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; } // EPERM and PID reuse both fail closed.
}
async function privateJson(path, value) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
}

async function lockDirectory(dataDir) {
  const lockDir = `${dataDir}.lock`, ownerPath = resolve(lockDir, 'owner.json');
  const owner = { version: 1, pid: process.pid, token: randomUUID(), host: hostname(), createdAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await mkdir(lockDir, { mode: 0o700 });
      try { await privateJson(ownerPath, owner); }
      catch (error) { await rmdir(lockDir).catch(() => {}); throw error; }
      return async () => {
        if (!sameOwner(await readOwner(ownerPath), owner)) return;
        await unlink(ownerPath);
        await rmdir(lockDir);
      };
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const previous = await readOwner(ownerPath);
    if (!ownerIsDead(previous)) throw locked();
    // Only one reclaimer may rename the dead owner's directory. Without this
    // claim, a delayed reclaimer could rename a newly acquired live lock.
    const claimPath = resolve(lockDir, 'reclaim.json');
    try { await privateJson(claimPath, owner); }
    catch (error) { if (error.code === 'EEXIST' || error.code === 'ENOENT') throw locked(); throw error; }
    const deadDir = `${lockDir}.stale-${owner.token}`;
    let moved = false;
    try {
      if (!sameOwner(await readOwner(ownerPath), previous) || !ownerIsDead(previous)) throw locked();
      await rename(lockDir, deadDir); moved = true;
    } finally {
      if (moved) {
        await unlink(resolve(deadDir, 'owner.json')).catch(() => {});
        await unlink(resolve(deadDir, 'reclaim.json')).catch(() => {});
        await rmdir(deadDir).catch(() => {});
      } else if (sameOwner(await readOwner(claimPath), owner)) await unlink(claimPath).catch(() => {});
    }
  }
  throw locked();
}

function sqlInput(text, params) {
  const query = typeof text === 'object' && text !== null ? text : { text, values: params };
  if (typeof query.text !== 'string' || !query.text.trim()) throw new TypeError('A SQL query string is required.');
  if (query.values !== undefined && !Array.isArray(query.values)) throw new TypeError('SQL parameters must be an array.');
  return { text: query.text, params: query.values ?? [] };
}
function pgResult(result = {}) {
  const rows = result.rows ?? [];
  return { ...result, rows, rowCount: result.rowCount ?? result.affectedRows ?? rows.length, fields: result.fields ?? [] };
}

export class LocalDatabasePool extends EventEmitter {
  constructor({ dataDir, loadDataDir, allowIncompleteMigration = false } = {}) {
    super();
    if (typeof dataDir !== 'string' || !dataDir.trim() || /^(?:memory|idb):/i.test(dataDir)) throw new TypeError('A persistent local database directory is required.');
    this.dataDir = resolve(dataDir);
    this.driver = 'local';
    this._loadDataDir = loadDataDir;
    this._allowIncompleteMigration = allowIncompleteMigration;
    this._tail = Promise.resolve();
    this._closing = false;
    this._fatal = null;
    this.generation = 0;
  }

  async _ready() {
    if (!this._initializing) this._initializing = (async () => {
      await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
      this.dataDir = await realpath(this.dataDir); // Symlink aliases share the same lock.
      this._unlock = await lockDirectory(this.dataDir);
      try {
        // ZIP and Git preserve files but omit empty PostgreSQL directories.
        // Recreate only structural directories of an existing database.
        if (!this._loadDataDir) {
          try {
            await access(resolve(this.dataDir, 'PG_VERSION'));
            for (const folder of ['pg_commit_ts','pg_dynshmem','pg_notify','pg_replslot','pg_serial','pg_snapshots','pg_stat','pg_stat_tmp','pg_tblspc','pg_twophase','base/pgsql_tmp','pg_wal/archive_status','pg_wal/summaries','pg_logical/snapshots','pg_logical/mappings'])
              await mkdir(resolve(this.dataDir, folder), { recursive: true, mode: 0o700 });
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        if (!this._allowIncompleteMigration) try {
          await access(resolve(this.dataDir, 'migration.incomplete'));
          throw new Error('Local database migration is incomplete. Keep the original configuration and finish the migration before starting.');
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (this._loadDataDir && (await readdir(this.dataDir)).length) throw new Error('A backup can only be restored into an empty local database directory.');
        this._database = new PGlite(this.dataDir, {
          relaxedDurability: false,
          parsers: { 20: value => Number(value), 1700: value => Number(value) },
          ...(this._loadDataDir ? { loadDataDir: this._loadDataDir } : {}),
        });
        await this._database.waitReady;
        return this._database;
      } catch (error) {
        await this._database?.close().catch(() => {});
        await this._unlock(); this._unlock = null;
        throw error;
      }
    })();
    return this._initializing;
  }

  _assertOpen() {
    if (this._closing) throw closed();
    if (this._fatal) throw this._fatal;
  }

  async _acquire() {
    let unlock;
    const next = new Promise(resolve => { unlock = resolve; });
    const previous = this._tail;
    this._tail = next;
    await previous;
    let released = false;
    return () => { if (!released) { released = true; unlock(); } };
  }

  async _execute(input) {
    assertDatabaseRequestCurrent(this,this.generation);
    if (this._fatal) throw this._fatal;
    const database = await this._ready();
    if (input.params.length) return pgResult(await database.query(input.text, input.params));
    // Schemas contain many statements; the extended query protocol cannot parse
    // those as a single prepared statement. exec also handles SQL semicolons.
    const results = await database.exec(input.text);
    return pgResult(results.at(-1));
  }

  async query(text, params) {
    this._assertOpen();
    const input = sqlInput(text, params), unlock = await this._acquire();
    try {
      const result = await this._execute(input);
      if (this._database.isInTransaction()) {
        await this._database.exec('rollback');
        throw new Error('Use pool.connect() for a transaction; pool.query() cannot leave one open.');
      }
      return result;
    } catch (error) {
      if (this._database?.isInTransaction()) await this._database.exec('rollback').catch(failure => { this._fatal = failure; });
      throw error;
    } finally { unlock(); }
  }

  async connect() {
    this._assertOpen();
    let unlock = await this._acquire(), released = false, tail = Promise.resolve();
    try { await this._ready(); } catch (error) { unlock(); throw error; }
    const unlease = () => { unlock?.(); unlock = null; };
    const enqueue = operation => {
      const current = tail.then(operation); tail = current.catch(() => {}); return current;
    };
    return {
      query: (text, params) => {
        if (released) return Promise.reject(new Error('Local database client has been released.'));
        if (!unlock && this._closing) return Promise.reject(closed());
        let input; try { input = sqlInput(text, params); } catch (error) { return Promise.reject(error); }
        return enqueue(async () => {
          if (!unlock) unlock = await this._acquire();
          try { return await this._execute(input); }
          finally {
            // COMMIT/ROLLBACK must release before global post-commit reads,
            // which several existing cashier functions await before release().
            if (!this._database?.isInTransaction()) unlease();
          }
        });
      },
      release: () => {
        if (released) return;
        released = true;
        void enqueue(async () => {
          try {
            if (unlock && this._database?.isInTransaction()) await this._database.exec('rollback');
          } catch (error) {
            // A failed cleanup must never expose an aborted transaction to the
            // next request. Future operations fail, and end() still closes it.
            this._fatal = error;
            if (this.listenerCount('error')) this.emit('error', error);
          } finally { unlease(); }
        });
      },
    };
  }

  async backup(compression = 'gzip') {
    this._assertOpen();
    const unlock = await this._acquire();
    try { return await (await this._ready()).dumpDataDir(compression); }
    finally { unlock(); }
  }

  dumpDataDir(compression = 'gzip') { return this.backup(compression); }

  /** Lease the complete database across backup + reset with no intervening writes. */
  async exclusive(operation){
    this._assertOpen();const unlock=await this._acquire();
    try{
      assertDatabaseRequestCurrent(this,this.generation);const database=await this._ready();
      const client={query:(text,params)=>this._execute(sqlInput(text,params)),backup:(compression='gzip')=>database.dumpDataDir(compression),invalidateGeneration:()=>{this.generation++;}};
      return await operation(client);
    }finally{
      try{if(this._database?.isInTransaction())await this._database.exec('rollback');}catch(error){this._fatal=error;}finally{unlock();}
    }
  }

  end() {
    if (this._ending) return this._ending;
    this._closing = true;
    this._ending = (async () => {
      const unlock = await this._acquire();
      try {
        if (this._initializing) {
          try { await this._initializing; } catch { return; }
          await this._database.close();
        }
      } finally {
        try { await this._unlock?.(); } finally { this._unlock = null; unlock(); }
      }
    })();
    return this._ending;
  }
}

export const createLocalPool = options => new LocalDatabasePool(options);
