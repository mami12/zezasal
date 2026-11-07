import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import bcrypt from 'bcryptjs';
import { SCHEMA_SQL } from '../server/schema.mjs';
import { LEDGER_SQL } from '../server/ledger/schema.mjs';
import { createLocalPool } from '../server/local-database.mjs';
import { migrateLocalDatabase, sourceConnectionOptions } from './local-db-migrate.mjs';
import { inspectTickets } from './diagnose-tickets.mjs';

const parent = resolve('tmp'); await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, 'migration-test-'));
const sourceDb = new PGlite(), pools = [];
const sourceQueries = [];
const source = { query: async (text, values) => {
  sourceQueries.push(text);
  return values?.length ? sourceDb.query(text, values) : (await sourceDb.exec(text)).at(-1) ?? { rows: [] };
} };
const target = name => { const pool = createLocalPool({ dataDir: join(root, name) }); pools.push(pool); return pool; };
try {
  await sourceDb.exec(SCHEMA_SQL + LEDGER_SQL);
  const admin = randomUUID(), manager = randomUUID(), player = randomUUID(), deleted = randomUUID(), ticket = randomUUID();
  const password = await bcrypt.hash('isolated-test-password', 4);
  for (const [id, username, role, balance, owner] of [[admin,'admin-test','ADMIN','100000.17',null],[manager,'manager-test','MANAGER','98765.43',admin],[player,"player's test",'PLAYER','123.45',manager],[deleted,'deleted-test','PLAYER','0',manager]]) {
    await sourceDb.query('insert into app_user(id,username,password_hash,role,balance,manager_id) values($1,$2,$3,$4,$5,$6)', [id,username,password,role,balance,owner]);
  }
  await sourceDb.query("update app_user set status='BANNED',deleted_at='2026-10-25T12:01:02.123456Z',deleted_by=$2 where id=$1",[deleted,admin]);
  await sourceDb.query("insert into app_ticket(id,user_id,stake,total_odds,potential_payout,ticket_type) values($1,$2,100,2.1234,212.34,'SYSTEM')",[ticket,player]);
  await sourceDb.query("insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,odds_at_placement,builder_legs) values($1,12345,'total','under','Under 2.5','Total Goals','Home vs Away',2.1234,$2)",[ticket,JSON.stringify([{price:2.1234,name:"O'Brien"}])]);
  await sourceDb.query("insert into app_ticket_batch(user_id,client_request_id,request_payload_hash,ticket_ids,selection_order) values($1,$2,'test',$3,$4)",[player,randomUUID(),[ticket],['12345|total|2.5|under']]);
  await sourceDb.query("insert into app_transaction(user_id,amount,type,balance_after,description) values($1,123.45,'DEPOSIT',123.45,$2)",[player,"Private description O'Brien / shqip ë ç"]);
  const session = randomUUID();
  await sourceDb.query("insert into app_casino_original_state(user_id,game_id,session_id,state) values($1,'bookofra',$2,$3)",[player,session,JSON.stringify({pending:12.34,free:{left:5},symbols:[1,2,3]})]);
  await sourceDb.query("insert into app_casino_original_event(user_id,session_id,request_id,fingerprint,response) values($1,$2,'retry-test','fingerprint',$3)",[player,session,JSON.stringify({credit:123.45,response:"preserve retries"})]);
  await sourceDb.query("insert into app_admin_audit(id,actor_id,actor_name,actor_role,action,target_type,target_id) values(9999,$1,'admin-test','ADMIN','TEST','user',$2)",[admin,player]);
  const originalBalance = (await sourceDb.query('select sum(balance)::text amount from app_user')).rows[0].amount;
  const first = target('success');
  const report = await migrateLocalDatabase({ source, target: first, batchSize: 2 });
  assert.equal(report.tables.app_user.count,4); assert.equal(report.tables.app_ticket.count,1);
  const preserved = (await first.query('select password_hash,balance from app_user where id=$1',[player])).rows[0];
  assert.equal(preserved.password_hash,password); assert.equal(preserved.balance,123.45);
  assert.equal(await bcrypt.compare('isolated-test-password',preserved.password_hash),true);
  assert.equal((await first.query('select status from app_ticket where id=$1',[ticket])).rows[0].status,'PENDING');
  assert.equal((await inspectTickets({codes:[ticket.replaceAll('-','').slice(0,8)],runQuery:first.query.bind(first)})).length,1);
  const batchCode=(await first.query("select 'SYS-'||left(replace(id::text,'-',''),4) code from app_ticket_batch")).rows[0].code;
  assert.equal((await inspectTickets({codes:[batchCode],runQuery:first.query.bind(first)})).length,1,'system public codes find their original ticket columns without broad account access');
  assert.deepEqual((await first.query('select ticket_ids from app_ticket_batch')).rows[0].ticket_ids,[ticket]);
  assert.deepEqual((await first.query('select state from app_casino_original_state')).rows[0].state,{pending:12.34,free:{left:5},symbols:[1,2,3]});
  assert.equal((await first.query("select deleted_at::text stamp from app_user where id=$1",[deleted])).rows[0].stamp.includes('123456'),true);
  assert.equal((await first.query("insert into app_admin_audit(actor_name,actor_role,action,target_type) values('test','ADMIN','TEST','user') returning id")).rows[0].id,10000);
  assert.equal((await sourceDb.query('select sum(balance)::text amount from app_user')).rows[0].amount,originalBalance);
  assert.match(sourceQueries[0],/repeatable read read only/); assert.equal(sourceQueries.at(-1),'rollback');
  assert.equal((await first.query("select count(*)::int n from pg_constraint c join pg_class t on t.oid=c.conrelid where left(t.relname,4)='app_' and c.contype='f' and c.condeferrable")).rows[0].n,0);
  await assert.rejects(migrateLocalDatabase({source,target:first}),/already been migrated/);
  console.log('PASS local migration: every application table verified, exact balances/passwords/timestamps, pending tickets/bonuses/retries, sequence reset, source unchanged');

  const failed = target('failure');
  const faultyTarget = {connect:async()=>{const client=await failed.connect();return {release:client.release,query:(text,values)=>text.startsWith('insert into public."app_ticket_line"')?Promise.reject(new Error('Injected copy failure')):client.query(text,values)};}};
  await assert.rejects(migrateLocalDatabase({source,target:faultyTarget}),/Injected copy failure/);
  assert.equal((await failed.query("select to_regclass('public.app_user')::text name")).rows[0].name,null,'failed import rolls back schema and rows together');
  await sourceDb.exec('create table app_unknown_history(id int)');
  const unknown = target('unknown');
  await assert.rejects(migrateLocalDatabase({source,target:unknown}),/unsupported application table/);
  assert.equal((await unknown.query("select to_regclass('public.app_user')::text name")).rows[0].name,null);
  const incompleteDir=join(root,'incomplete'); await mkdir(incompleteDir); await writeFile(join(incompleteDir,'migration.incomplete'),'incomplete');
  const incomplete=createLocalPool({dataDir:incompleteDir});pools.push(incomplete);
  await assert.rejects(incomplete.query('select 1'),/migration is incomplete/);
  assert.equal((await sourceDb.query('select sum(balance)::text amount from app_user')).rows[0].amount,originalBalance);
  assert.throws(()=>sourceConnectionOptions({DATABASE_URL:'https://invalid.test'}),/external PostgreSQL/);
  console.log('PASS migration failure safeguards: no target overwrite, all-or-nothing rollback, unknown schema rejected, incomplete directory cannot serve accounts');
} finally {
  await Promise.allSettled(pools.map(pool=>pool.end())); await sourceDb.close();
  assert.ok(resolve(root).startsWith(parent+ (process.platform==='win32'?'\\':'/')));
  await rm(root,{recursive:true,force:true});
}
