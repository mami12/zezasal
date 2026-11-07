/** Windows operator tools. Importing this file never reads .env or contacts a database. */
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, writeFile, unlink } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { localDatabaseDirectory, maintenancePath } from '../server/database-location.mjs';
import { stopWindowsServer } from './windows-server.mjs';
import { migrateFromEnv } from './local-db-migrate.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const stamp = () => new Date().toISOString().replace(/[:.]/g,'-');
async function withMaintenance(rootDir, work) {
  await mkdir(resolve(rootDir,'.runtime'),{recursive:true});
  const path=maintenancePath(rootDir),token=randomUUID(),owner=JSON.stringify({pid:process.pid,token,startedAt:new Date().toISOString()});
  const file=await open(path,'wx',0o600);
  try {await file.writeFile(owner);await file.sync();} finally {await file.close();}
  try {return await work();}
  finally {if(await readFile(path,'utf8').catch(()=>null)===owner)await unlink(path);}
}
export async function assertServerPortFree(env) {
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid server port.');
  for (const host of ['0.0.0.0','::']) await new Promise((accept,reject)=>{
    const server = net.createServer(); server.once('error',error=>{
      if (['EAFNOSUPPORT','EADDRNOTAVAIL'].includes(error.code)) accept();
      else reject(Error('The website port is still in use. Stop the server before changing its database.'));
    });
    server.listen({port,host,exclusive:true},()=>server.close(accept));
  });
}

export function localEnvironment(source, directory) {
  const replace = new Set(['DB_DRIVER','LOCAL_DATABASE_DIR','DATABASE_URL','DB_INIT_STRICT','LOG_RAW_FRAMES','MATCH_STORE','ODDS_STORE','SEED_DEFAULT_ACCOUNTS']);
  const lines = source.split(/\r?\n/).filter(line=>!replace.has(line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=/)?.[1]));
  return lines.join('\n').trimEnd() + '\n\n# Local database: existing accounts and JWT_SECRET are preserved.\nDB_DRIVER=local\n' +
    'LOCAL_DATABASE_DIR='+JSON.stringify(directory.replaceAll('\\','/'))+'\nDATABASE_URL=\nDB_INIT_STRICT=true\nLOG_RAW_FRAMES=false\nMATCH_STORE=memory\nODDS_STORE=memory\nSEED_DEFAULT_ACCOUNTS=false\n';
}

export async function switchDatabaseToLocal(options={}) {
  const rootDir=options.rootDir||repository;
  return withMaintenance(rootDir,()=>switchStoppedDatabaseToLocal({...options,rootDir}));
}
async function switchStoppedDatabaseToLocal({rootDir=repository,stop=stopWindowsServer,migrate=migrateFromEnv,assertStopped=assertServerPortFree,log=console.log}={}) {
  const path=resolve(rootDir,'.env'), original=await readFile(path,'utf8'), env=parseEnv(original);
  if(env.DB_DRIVER==='local') return {alreadyLocal:true,directory:localDatabaseDirectory(env.LOCAL_DATABASE_DIR||'data/database',rootDir)};
  if(!env.DATABASE_URL) throw Error('The current database URL is missing. Existing accounts must be imported before switching.');
  await stop({rootDir,log}); await assertStopped(env);
  const backupPath=resolve(rootDir,'.env.cloud-backup-'+stamp()+'-'+randomUUID().slice(0,8));
  await writeFile(backupPath,original,{flag:'wx',mode:0o600});
  let directory=localDatabaseDirectory('data/database',rootDir);
  try { await stat(directory); directory=localDatabaseDirectory('data/database-'+stamp()+'-'+randomUUID().slice(0,8),rootDir); }
  catch(error) {if(error.code!=='ENOENT')throw error;}
  log('Copying existing accounts, balances and history into the local database. Keep all other servers stopped.');
  const report=await migrate({envPath:backupPath,targetDir:directory,assertStopped});
  if(await readFile(path,'utf8')!==original) throw Error('The environment file changed during migration. It was preserved; the verified local database is ready for manual configuration.');
  const next=localEnvironment(original,relative(rootDir,directory));
  const temporary=resolve(rootDir,'.env.local-switch-'+randomUUID());
  const file=await open(temporary,'wx',0o600);
  try {await file.writeFile(next);await file.sync();} finally {await file.close();}
  await rename(temporary,path);
  log('Local migration verified. The source database was not changed. Run start.bat to use the local database.');
  return {alreadyLocal:false,directory,backupPath,report};
}

export async function backupLocalDatabase(options={}) {
  const rootDir=options.rootDir||repository;
  return withMaintenance(rootDir,()=>backupStoppedLocalDatabase({...options,rootDir}));
}
async function backupStoppedLocalDatabase({rootDir=repository,stop=stopWindowsServer,assertStopped=assertServerPortFree,log=console.log}={}) {
  const env=parseEnv(await readFile(resolve(rootDir,'.env'),'utf8'));
  if(env.DB_DRIVER!=='local') throw Error('Backup requires DB_DRIVER=local.');
  const directory=localDatabaseDirectory(env.LOCAL_DATABASE_DIR||'data/database',rootDir);
  // A mistyped path must never turn a backup command into a new empty database.
  await stat(resolve(directory,'PG_VERSION'));
  await stop({rootDir,log}); await assertStopped(env);
  const {createLocalPool}=await import('../server/local-database.mjs');
  const database=createLocalPool({dataDir:directory});
  try {
    const archive=await database.backup();
    const folder=resolve(rootDir,'backups');await mkdir(folder,{recursive:true,mode:0o700});
    const path=resolve(folder,'database-'+stamp()+'-'+randomUUID().slice(0,8)+'.tgz');
    await writeFile(path,new Uint8Array(await archive.arrayBuffer()),{flag:'wx',mode:0o600});
    log('Backup saved in backups/. Run start.bat to reopen the website.');return path;
  } finally {await database.end();}
}

const quoteIdentifier=value=>'"'+String(value).replaceAll('"','""')+'"';
/** Read-only validation; returned hashes never contain usernames/password hashes. */
export async function inspectRestoredDatabase(database) {
  await database.query("set time zone 'UTC'");
  const tables=(await database.query(`select tablename as name from pg_tables
    where schemaname='public' and left(tablename,4)='app_' order by tablename collate "C"`)).rows.map(row=>row.name);
  for(const required of ['app_user','app_ticket','app_transaction','app_casino_round'])
    if(!tables.includes(required))throw Error('The backup is not a complete application database.');
  const columns=(await database.query(`select table_name,column_name,data_type from information_schema.columns
    where table_schema='public' and left(table_name,4)='app_'`)).rows;
  const required={app_user:['id','username','password_hash','role','balance'],
    app_ticket:['stake','potential_payout'],app_transaction:['user_id','amount','balance_after'],
    app_casino_round:['stake','payout','balance_after']};
  for(const [table,names]of Object.entries(required))for(const name of names)
    if(!columns.some(column=>column.table_name===table&&column.column_name===name))throw Error('The backup has an incompatible application schema.');
  const users=(await database.query('select id::text as id,username,password_hash from app_user order by id::text collate "C"')).rows;
  if(!users.length||users.some(user=>typeof user.username!=='string'||!user.username.trim()||typeof user.password_hash!=='string'||!user.password_hash))
    throw Error('The backup does not contain usable application accounts.');
  if(!users.some(user=>/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(user.password_hash)))
    throw Error('The backup does not contain application password hashes.');
  const credentials=createHash('sha256');
  for(const user of users)credentials.update(JSON.stringify([user.id,user.username,user.password_hash])).update('\0');
  const report={version:1,accounts:users.length,credentialsSha256:credentials.digest('hex'),tables:{},balance:null};
  for(const table of tables){
    const numeric=columns.filter(column=>column.table_name===table&&['numeric','real','double precision'].includes(column.data_type));
    if(numeric.length){
      const predicate=numeric.map(column=>`${quoteIdentifier(column.column_name)}::text in ('NaN','Infinity','-Infinity')`).join(' or ');
      const bad=(await database.query(`select count(*)::int as count from public.${quoteIdentifier(table)} where ${predicate}`)).rows[0].count;
      if(bad)throw Error('The backup contains non-finite financial values.');
    }
    const rows=(await database.query(`select to_jsonb(t)::text as row from public.${quoteIdentifier(table)} t
      order by to_jsonb(t)::text collate "C"`)).rows;
    const hash=createHash('sha256');for(const row of rows)hash.update(row.row).update('\0');
    report.tables[table]={rows:rows.length,sha256:hash.digest('hex')};
  }
  report.balance=(await database.query('select trim_scale(coalesce(sum(balance),0))::text as balance from app_user')).rows[0].balance;
  return report;
}

function compareTransferReport(actual,expected){
  if(!expected||typeof expected!=='object')throw Error('The database transfer manifest is invalid.');
  if(expected.accounts!==actual.accounts)throw Error('Restored account count does not match the transfer manifest.');
  const names=Object.keys(actual.tables).sort();
  if(JSON.stringify(names)!==JSON.stringify(Object.keys(expected.tables||{}).sort()))throw Error('Restored tables do not match the transfer manifest.');
  for(const name of names){
    const wanted=expected.tables[name],got=actual.tables[name];
    if(!wanted||!Number.isSafeInteger(wanted.rows)||wanted.rows<0||!/[a-f0-9]{64}/i.test(wanted.sha256)||wanted.rows!==got.rows||wanted.sha256!==got.sha256)
      throw Error('Restored database contents do not match the transfer manifest.');
  }
}

/** Restore into a NEW directory; preserve the existing database and server secrets. */
export async function restoreLocalDatabase(options={}) {
  const rootDir=options.rootDir||repository;
  return withMaintenance(rootDir,()=>restoreStoppedLocalDatabase({...options,rootDir}));
}
async function restoreStoppedLocalDatabase({archivePath='database-transfer.tgz',rootDir=repository,
  expectedReport,stop=stopWindowsServer,assertStopped=assertServerPortFree,log=console.log}={}) {
  const selected=resolve(rootDir,archivePath),info=await stat(selected);
  if(!info.isFile()||!/(?:\.tgz|\.tar\.gz)$/i.test(selected))throw Error('Choose a PGlite .tgz database backup.');
  const archive=await readFile(selected);
  if(archive.length<18||archive[0]!==0x1f||archive[1]!==0x8b||archive[2]!==8)throw Error('The selected file is not a gzip database backup.');
  const archiveSha256=createHash('sha256').update(archive).digest('hex');
  if(!expectedReport){
    try {expectedReport=JSON.parse(await readFile(resolve(dirname(selected),'DATABASE-TRANSFER.json'),'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw Error('The database transfer manifest could not be read.');}
  }
  if(expectedReport){
    if(expectedReport.verified!==true||expectedReport.archive!==basename(selected)||expectedReport.archiveSha256!==archiveSha256||
      (expectedReport.archiveBytes!==undefined&&expectedReport.archiveBytes!==archive.length))throw Error('The database backup does not match its verified transfer manifest.');
  }
  const path=resolve(rootDir,'.env'),original=await readFile(path,'utf8'),env=parseEnv(original);
  await stop({rootDir,log});await assertStopped(env);
  const directory=localDatabaseDirectory('data/database-restored-'+stamp()+'-'+randomUUID().slice(0,8),rootDir);
  await mkdir(dirname(directory),{recursive:true,mode:0o700});await mkdir(directory,{mode:0o700});
  const {createLocalPool}=await import('../server/local-database.mjs');
  let database,verified=false;
  try {
    database=createLocalPool({dataDir:directory,loadDataDir:new Blob([archive])});
    const report=await inspectRestoredDatabase(database);
    if(expectedReport)compareTransferReport(report,expectedReport);
    await database.end();database=null;verified=true;
    if(await readFile(path,'utf8')!==original)throw Error('The server configuration changed during restore. It was not replaced.');
    const backupPath=resolve(rootDir,'.env.before-restore-'+stamp()+'-'+randomUUID().slice(0,8));
    await writeFile(backupPath,original,{flag:'wx',mode:0o600});
    const temporary=resolve(rootDir,'.env.restore-switch-'+randomUUID());
    const file=await open(temporary,'wx',0o600);
    try{await file.writeFile(localEnvironment(original,relative(rootDir,directory)));await file.sync();}finally{await file.close();}
    await rename(temporary,path);
    log('Database restored and verified: '+report.accounts+' accounts. The previous database and server secrets were preserved. Run start.bat.');
    return {directory,backupPath,archiveSha256,report};
  } catch(error){
    if(database)await database.end().catch(()=>{});
    if(!verified)await writeFile(resolve(directory,'migration.incomplete'),'Restore verification did not finish. Do not use this database.\n',{flag:'wx',mode:0o600}).catch(()=>{});
    throw error;
  }
}

if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const action=process.argv[2];
  const work=action==='migrate'?switchDatabaseToLocal():action==='backup'?backupLocalDatabase():action==='restore'?restoreLocalDatabase({archivePath:process.argv[3]||'database-transfer.tgz'}):Promise.reject(Error('Use migrate-db-local.bat, backup-db.bat or restore-db.bat.'));
  work.catch(()=>{console.error('The database operation did not finish. The previous configuration and database were preserved unless a full verification succeeded. Check that the selected backup and DATABASE-TRANSFER.json belong together, keep the server stopped, and read LOCAL-DATABASE.md. No private database values are printed.');process.exitCode=1;});
}
