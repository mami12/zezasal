/** One-way, read-only PostgreSQL snapshot into a NEW private local database. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { localDatabaseDirectory } from '../server/database-location.mjs';
import { SCHEMA_SQL } from '../server/schema.mjs';
import { LEDGER_SQL } from '../server/ledger/schema.mjs';

const quote = value => `"${String(value).replaceAll('"', '""')}"`;
const tableSql = name => `public.${quote(name)}`;
const metadataSql = `select c.relname as table_name, a.attname as column_name,
  t.typname as type_name, pg_catalog.format_type(a.atttypid,a.atttypmod) as column_type,
  a.attnum as column_order
 from pg_catalog.pg_class c
 join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 join pg_catalog.pg_attribute a on a.attrelid=c.oid
 join pg_catalog.pg_type t on t.oid=a.atttypid
 where n.nspname='public' and c.relkind in ('r','p')
   and left(c.relname,4)='app_' and a.attnum>0 and not a.attisdropped
 order by c.relname,a.attnum`;

function schemaMap(rows) {
  const tables = new Map();
  for (const row of rows) {
    if (!tables.has(row.table_name)) tables.set(row.table_name, []);
    tables.get(row.table_name).push(row);
  }
  return tables;
}
function projection(columns) {
  // Text transfer avoids JavaScript rounding of NUMERIC/BIGINT and truncating
  // PostgreSQL timestamps to Date milliseconds. PostgreSQL parses its own array
  // and JSON text on insertion; values are always parameters, never SQL text.
  return columns.map(column => `${column.type_name === 'numeric' ? `trim_scale(${quote(column.column_name)})` : quote(column.column_name)}::text as ${quote(column.column_name)}`).join(',');
}
function orderedSelect(name, columns) {
  const names = columns.map(column => `${quote(column.column_name)} collate "C" nulls first`).join(',');
  return `select * from (select ${projection(columns)} from ${tableSql(name)}) migration_rows order by ${names}`;
}
function digestRows(hash, rows, columns) {
  for (const row of rows) hash.update(JSON.stringify(columns.map(column => row[column.column_name])) + '\n');
}
async function scanTable(client, name, columns, batchSize, onRows) {
  let offset = 0;
  const hash = createHash('sha256');
  while (true) {
    const { rows } = await client.query(`${orderedSelect(name, columns)} limit $1 offset $2`, [batchSize, offset]);
    digestRows(hash, rows, columns);
    if (onRows && rows.length) await onRows(rows);
    offset += rows.length;
    if (rows.length < batchSize) break;
  }
  return { count: offset, sha256: hash.digest('hex') };
}
async function resetSequences(client, tables) {
  for (const [name, columns] of tables) {
    for (const column of columns) {
      const sequence = (await client.query('select pg_get_serial_sequence($1,$2) as name', [`public.${quote(name)}`, column.column_name])).rows[0]?.name;
      if (!sequence) continue;
      const info = (await client.query(`select n.nspname as schema_name,c.relname as sequence_name,
        s.seqstart::text,s.seqincrement::text,s.seqmin::text,s.seqmax::text
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        join pg_sequence s on s.seqrelid=c.oid where c.oid=$1::regclass`, [sequence])).rows[0];
      if (!info || BigInt(info.seqincrement) <= 0n) throw Error(`Unsupported sequence on ${name}.${column.column_name}.`);
      const maximum = (await client.query(`select max(${quote(column.column_name)})::text as maximum from ${tableSql(name)}`)).rows[0]?.maximum;
      const next = maximum == null ? BigInt(info.seqstart) : BigInt(maximum) + BigInt(info.seqincrement);
      if (next < BigInt(info.seqmin) || next > BigInt(info.seqmax)) throw Error(`Sequence is exhausted on ${name}.${column.column_name}.`);
      // ALTER ... RESTART is transactional, unlike setval(), so a later failure
      // cannot leave a partially imported target's sequence counters changed.
      await client.query(`alter sequence ${quote(info.schema_name)}.${quote(info.sequence_name)} restart with ${next}`);
    }
  }
}

/** Source must be one connected pg-compatible client; target must be a pool.
 * All source operations are inside a repeatable-read READ ONLY transaction.
 * No live code or .env is imported, and neither database is ever seeded with users.
 */
export async function migrateLocalDatabase({ source, target, batchSize = 250 }) {
  if (!source?.query || !target?.connect) throw Error('Migration requires a source client and a target pool.');
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw Error('Invalid migration batch size.');
  const client = await target.connect();
  let sourceStarted = false, targetStarted = false;
  try {
    await source.query('begin isolation level repeatable read read only'); sourceStarted = true;
    await source.query("set local time zone 'UTC'");
    const sources = schemaMap((await source.query(metadataSql)).rows);
    if (!sources.has('app_user') || !sources.has('app_ticket')) throw Error('Source is not a complete application database.');
    await client.query('begin'); targetStarted = true;
    await client.query("set local time zone 'UTC'");
    await client.query(SCHEMA_SQL);
    await client.query(LEDGER_SQL);
    const targets = schemaMap((await client.query(metadataSql)).rows);
    for (const [name, columns] of sources) {
      const targetColumns = targets.get(name);
      if (!targetColumns) throw Error(`Source has an unsupported application table: ${name}. Update the application before migrating.`);
      const byName = new Map(targetColumns.map(column => [column.column_name, column]));
      for (const column of columns) {
        const targetColumn = byName.get(column.column_name);
        if (!targetColumn) throw Error(`Source has an unsupported column: ${name}.${column.column_name}.`);
        if (column.type_name !== targetColumn.type_name) throw Error(`Incompatible column type: ${name}.${column.column_name}.`);
      }
    }
    const hasMarker = (await client.query("select to_regclass('public.faqja_local_migration')::text as name")).rows[0]?.name;
    if (hasMarker) throw Error('Target has already been migrated. Choose a new local database directory.');
    const defaults = new Set(['app_commission_config', 'app_casino_settings']);
    for (const name of targets.keys()) {
      const count = Number((await client.query(`select count(*)::text as count from ${tableSql(name)}`)).rows[0].count);
      if (count && !defaults.has(name)) throw Error(`Target is not empty (${name}). Existing data will not be overwritten.`);
    }
    const foreignKeys = (await client.query(`select c.relname as table_name,k.conname,k.condeferrable,k.condeferred
      from pg_constraint k join pg_class c on c.oid=k.conrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and left(c.relname,4)='app_' and k.contype='f'
      order by c.relname,k.conname`)).rows;
    for (const key of foreignKeys) await client.query(`alter table ${tableSql(key.table_name)} alter constraint ${quote(key.conname)} deferrable initially deferred`);
    await client.query('set constraints all deferred');
    // Only source-present tables replace target defaults. A newer target-only
    // settings table keeps its canonical safe initialization.
    for (const name of [...sources.keys()].reverse()) await client.query(`delete from ${tableSql(name)}`);
    const report = { version: 1, tables: {}, balance: null, completedAt: null };
    for (const [name, columns] of sources) {
      const names = columns.map(column => quote(column.column_name)).join(',');
      const copied = await scanTable(source, name, columns, batchSize, async rows => {
        const parameters = [];
        const values = rows.map(row => `(${columns.map(column => { parameters.push(row[column.column_name]); return `$${parameters.length}`; }).join(',')})`).join(',');
        await client.query(`insert into ${tableSql(name)} (${names}) values ${values}`, parameters);
      });
      const verified = await scanTable(client, name, columns, batchSize);
      if (copied.count !== verified.count || copied.sha256 !== verified.sha256) throw Error(`Verification failed for ${name}; the entire import was rolled back.`);
      report.tables[name] = copied;
    }
    const balanceSql = 'select trim_scale(coalesce(sum(balance),0))::text as balance from public.app_user';
    const sourceBalance = (await source.query(balanceSql)).rows[0].balance;
    const targetBalance = (await client.query(balanceSql)).rows[0].balance;
    if (sourceBalance !== targetBalance) throw Error('Wallet balance verification failed; the entire import was rolled back.');
    report.balance = targetBalance;
    // This validates every deferred relationship before restoring its original
    // semantics. Constraints are never disabled or left NOT VALID.
    await client.query('set constraints all immediate');
    for (const key of foreignKeys) await client.query(`alter table ${tableSql(key.table_name)} alter constraint ${quote(key.conname)} ${key.condeferrable ? 'deferrable' : 'not deferrable'} initially ${key.condeferred ? 'deferred' : 'immediate'}`);
    await resetSequences(client, sources);
    report.completedAt = new Date().toISOString();
    await client.query('create table public.faqja_local_migration (id smallint primary key check(id=1), completed_at timestamptz not null, report jsonb not null)');
    await client.query('insert into public.faqja_local_migration(id,completed_at,report) values(1,$1,$2)', [report.completedAt, JSON.stringify(report)]);
    await client.query('commit'); targetStarted = false;
    return report;
  } catch (error) {
    if (targetStarted) { try { await client.query('rollback'); } catch {} }
    throw error;
  } finally {
    if (sourceStarted) { try { await source.query('rollback'); } catch {} }
    client.release();
  }
}

export function sourceConnectionOptions(env) {
  if (!env.DATABASE_URL) throw Error('The selected source environment file has no DATABASE_URL.');
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw Error('The selected source DATABASE_URL is invalid.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw Error('The source must be an external PostgreSQL database.');
  url.searchParams.delete('sslmode');
  return { connectionString: url.toString(), ssl: ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 };
}

/** The caller must stop all application writers before invoking this function.
 * The source .env is read only when explicitly supplied and is never rewritten.
 */
export async function migrateFromEnv({ envPath, targetDir, assertStopped } = {}) {
  if (!envPath || !targetDir) throw Error('Supply an explicit source environment file and a NEW target directory.');
  const sourceFile = resolve(envPath), destination = localDatabaseDirectory(targetDir);
  if (sourceFile === destination) throw Error('Source environment and target directory must be different.');
  try { await stat(destination); throw Error('Target directory already exists. Choose a new directory; nothing was overwritten.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const env = parseEnv(await readFile(sourceFile, 'utf8'));
  const options = sourceConnectionOptions(env);
  if (assertStopped) await assertStopped(env);
  const [{ default: pg }, { createLocalPool }] = await Promise.all([import('pg'), import('../server/local-database.mjs')]);
  await mkdir(dirname(destination), { recursive: true });
  await mkdir(destination);
  const incomplete = resolve(destination, 'migration.incomplete');
  await writeFile(incomplete, 'Migration is not complete. Do not start the application using this directory.\n', { flag: 'wx', mode: 0o600 });
  let source, target;
  try {
    source = new pg.Client(options);
    await source.connect();
    target = createLocalPool({ dataDir: destination, allowIncompleteMigration: true });
    const report = await migrateLocalDatabase({ source, target });
    await target.end(); target = null;
    await writeFile(resolve(destination, 'migration-complete.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await unlink(incomplete);
    return report;
  } finally {
    if (target) await target.end();
    if (source) await source.end();
  }
}

async function cli() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Stop all servers first. Then: node scripts/local-db-migrate.mjs --source-env .env --target data/database-local --server-stopped');
    return;
  }
  const value = flag => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  if (!args.includes('--server-stopped')) throw Error('Stop every application server first, then supply --server-stopped.');
  const report = await migrateFromEnv({ envPath: value('--source-env'), targetDir: value('--target') });
  console.log(`Local database verified: ${Object.keys(report.tables).length} application tables copied. Source database and .env were not changed.`);
  console.log('Keep the existing JWT_SECRET. Select the local database in .env only after this migration succeeds.');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  cli().catch(() => {
    // pg exceptions can include credentials or copied private row values. The
    // operator receives a fixed safe message; no raw source error is printed.
    console.error('Migration did not complete. The source database was not modified. Keep the original configuration and check that all servers are stopped, the source database is reachable, and the target directory is new.');
    process.exitCode = 1;
  });
}
