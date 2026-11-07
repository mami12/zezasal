import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseEnv } from 'node:util';
import { createLocalPool } from '../server/local-database.mjs';
import { assertNoDatabaseMaintenance, maintenancePath } from '../server/database-location.mjs';
import { localEnvironment, switchDatabaseToLocal, backupLocalDatabase, restoreLocalDatabase, inspectRestoredDatabase } from './local-db-setup.mjs';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import bcrypt from 'bcryptjs';

const parent=resolve('tmp');await mkdir(parent,{recursive:true});
const root=await mkdtemp(join(parent,'local-setup-test-'));
const original='NODE_ENV=production\nPORT=3000\nDATABASE_URL="postgresql://test:test@127.0.0.1:1/test_only"\nJWT_SECRET=private-test-key-unchanged\nINGEST_TOKEN=private-test-ingest-unchanged\nIDLE_FEED=false\n';
const envPath=join(root,'.env');await writeFile(envPath,original);
const sequence=[];
const stop=async()=>{sequence.push('stop');assert.throws(()=>assertNoDatabaseMaintenance(root),/in progress/);};
const assertStopped=async()=>{sequence.push('port-check');};
const log=()=>{};
let restored,source,checked;
try {
  const fakeFailure=async()=>{sequence.push('migrate');throw Error('Injected copy failure');};
  await assert.rejects(switchDatabaseToLocal({rootDir:root,stop,assertStopped,log,migrate:fakeFailure}),/copy failure/);
  assert.equal(await readFile(envPath,'utf8'),original,'failed migration must leave the old environment byte-for-byte unchanged');
  await assert.rejects(stat(maintenancePath(root)),error=>error.code==='ENOENT');
  sequence.length=0;
  const migrate=async({envPath:backup,targetDir})=>{
    sequence.push('migrate');assert.equal(await readFile(backup,'utf8'),original);
    assert.throws(()=>assertNoDatabaseMaintenance(root),/in progress/);
    const database=createLocalPool({dataDir:targetDir});
    try{await database.query('create table protected_balance(amount numeric(14,2)); insert into protected_balance values(123.45)');}finally{await database.end();}
    return {version:1,tables:{app_user:{count:1}},balance:'123.45'};
  };
  const result=await switchDatabaseToLocal({rootDir:root,stop,assertStopped,log,migrate});
  assert.deepEqual(sequence,['stop','port-check','migrate']);
  const changed=await readFile(envPath,'utf8'),env=parseEnv(changed);
  assert.equal(env.DB_DRIVER,'local');assert.equal(env.DATABASE_URL,'');assert.equal(env.JWT_SECRET,'private-test-key-unchanged');assert.equal(env.INGEST_TOKEN,'private-test-ingest-unchanged');
  assert.equal(env.SEED_DEFAULT_ACCOUNTS,'false');assert.equal(env.LOG_RAW_FRAMES,'false');assert.equal(env.DB_INIT_STRICT,'true');
  assert.equal(await readFile(result.backupPath,'utf8'),original);
  assert.equal((await switchDatabaseToLocal({rootDir:root,stop,assertStopped,log,migrate})).alreadyLocal,true,'repeating setup must not re-import or reset local accounts');
  const path=await backupLocalDatabase({rootDir:root,stop,assertStopped,log});
  const archive=new Blob([await readFile(path)]);
  restored=createLocalPool({dataDir:join(root,'restored'),loadDataDir:archive});
  assert.equal((await restored.query('select amount from protected_balance')).rows[0].amount,123.45);
  await restored.end();restored=null;
  assert.equal((await readdir(join(root,'backups'))).length,1);

  // A real application backup is restored into a new destination; credentials,
  // balances, history and pending casino state survive byte-for-byte table hashes.
  source=createLocalPool({dataDir:join(root,'transfer-source')});
  await source.query(LEDGER_SQL);
  const player='00000000-0000-4000-8000-000000000099',session='00000000-0000-4000-8000-000000000098';
  const passwordHash=bcrypt.hashSync('isolated-restore-password',10);
  await source.query("insert into app_user(id,username,password_hash,role,balance) values($1,'restore-player',$2,'PLAYER',123.45)",[player,passwordHash]);
  await source.query("insert into app_transaction(user_id,amount,type,balance_after) values($1,123.45,'DEPOSIT',123.45)",[player]);
  await source.query("insert into app_ticket(user_id,stake,total_odds,potential_payout,status) values($1,20,2,40,'PENDING')",[player]);
  await source.query("insert into app_casino_original_state(user_id,game_id,session_id,state) values($1,'bookofra',$2,$3)",[player,session,JSON.stringify({pending:12.34,free:{left:5}})]);
  const sourceReport=await inspectRestoredDatabase(source),transferBytes=new Uint8Array(await (await source.backup()).arrayBuffer());
  await source.end();source=null;
  const destination=join(root,'transfer-destination');await mkdir(destination);
  const destinationEnv=localEnvironment(original+'EXTERNAL_API_KEY=isolated-server-value\n','data/previous');
  await writeFile(join(destination,'.env'),destinationEnv);
  await mkdir(join(destination,'data/previous'),{recursive:true});await writeFile(join(destination,'data/previous/keep.txt'),'previous database files');
  const transferPath=join(destination,'database-transfer.tgz');await writeFile(transferPath,transferBytes);
  const transferManifest={verified:true,archive:'database-transfer.tgz',archiveBytes:transferBytes.length,
    archiveSha256:createHash('sha256').update(transferBytes).digest('hex'),accounts:sourceReport.accounts,tables:sourceReport.tables};
  await writeFile(join(destination,'DATABASE-TRANSFER.json'),JSON.stringify(transferManifest));
  const restoreSequence=[];
  const stopRestore=async()=>{restoreSequence.push('stop');assert.throws(()=>assertNoDatabaseMaintenance(destination),/in progress/);};
  const assertRestoreStopped=async()=>{restoreSequence.push('port-check');};
  const restoredResult=await restoreLocalDatabase({rootDir:destination,stop:stopRestore,assertStopped:assertRestoreStopped,log});
  assert.deepEqual(restoreSequence,['stop','port-check']);
  assert.deepEqual(restoredResult.report.tables,sourceReport.tables);
  assert.equal(restoredResult.report.credentialsSha256,sourceReport.credentialsSha256);
  assert.equal(restoredResult.report.accounts,1);assert.equal(restoredResult.report.balance,'123.45');
  const destinationAfter=await readFile(join(destination,'.env'),'utf8'),configured=parseEnv(destinationAfter);
  assert.equal(configured.JWT_SECRET,'private-test-key-unchanged');assert.equal(configured.INGEST_TOKEN,'private-test-ingest-unchanged');
  assert.equal(configured.EXTERNAL_API_KEY,'isolated-server-value');assert.equal(configured.DB_DRIVER,'local');
  assert.match(configured.LOCAL_DATABASE_DIR,/^data\/database-restored-/);
  assert.equal(await readFile(restoredResult.backupPath,'utf8'),destinationEnv);
  assert.equal(await readFile(join(destination,'data/previous/keep.txt'),'utf8'),'previous database files');
  checked=createLocalPool({dataDir:restoredResult.directory});
  const account=(await checked.query('select password_hash,balance from app_user')).rows[0];
  assert.equal(account.password_hash,passwordHash);assert.equal(account.balance,123.45);
  assert.equal(bcrypt.compareSync('isolated-restore-password',account.password_hash),true);
  assert.equal((await checked.query('select status from app_ticket')).rows[0].status,'PENDING');
  assert.deepEqual((await checked.query('select state from app_casino_original_state')).rows[0].state,{pending:12.34,free:{left:5}});
  await checked.end();checked=null;
  assert.equal(await readFile(transferPath).then(bytes=>createHash('sha256').update(bytes).digest('hex')),transferManifest.archiveSha256,'selected archive is not modified');
  const wrongManifest={...transferManifest,tables:{...transferManifest.tables,app_user:{rows:1,sha256:'0'.repeat(64)}}};
  await assert.rejects(restoreLocalDatabase({rootDir:destination,expectedReport:wrongManifest,stop:stopRestore,assertStopped:assertRestoreStopped,log}),/contents do not match/);
  assert.equal(await readFile(join(destination,'.env'),'utf8'),destinationAfter,'manifest mismatch must not switch databases');
  await writeFile(join(destination,'broken.tgz'),'not a gzip database');
  await assert.rejects(restoreLocalDatabase({rootDir:destination,archivePath:'broken.tgz',stop:stopRestore,assertStopped:assertRestoreStopped,log}),/not a gzip/);
  assert.equal(await readFile(join(destination,'.env'),'utf8'),destinationAfter,'bad archive must not change configuration');
  await assert.rejects(stat(maintenancePath(destination)),error=>error.code==='ENOENT');
  console.log('PASS database restore: verified whole-table snapshot, original password login/balances/history/bonus, preserved server secrets and old files, manifest mismatch and corrupt archive leave configuration unchanged');
  await mkdir(join(root,'.runtime'),{recursive:true});await writeFile(maintenancePath(root),'another owner');
  await assert.rejects(switchDatabaseToLocal({rootDir:root,stop,assertStopped,log,migrate}),error=>error.code==='EEXIST');
  assert.equal(await readFile(maintenancePath(root),'utf8'),'another owner');
  assert.equal(parseEnv(localEnvironment(original+'DATABASE_URL="old-again"\n','data/database')).DATABASE_URL,'','duplicate cloud settings are removed');
  console.log('PASS local setup: stop-before-copy, protected configuration switch after verification only, preserved JWT/password settings, retry safety, maintenance lock and usable backup archive');
} finally {
  await restored?.end();
  await source?.end();await checked?.end();
  assert.ok(resolve(root).startsWith(parent+(process.platform==='win32'?'\\':'/')));
  await rm(root,{recursive:true,force:true});
}
