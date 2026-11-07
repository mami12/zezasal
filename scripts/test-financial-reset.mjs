/** Destructive-path tests operate only on a disposable database under tmp/. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import express from 'express';

const parent=resolve('tmp');await mkdir(parent,{recursive:true});
const temp=await mkdtemp(join(parent,'financial-reset-'));
Object.assign(process.env,{
  DB_DRIVER:'local',LOCAL_DATABASE_DIR:join(temp,'database'),DATABASE_URL:'',
  JWT_SECRET:'isolated-financial-reset-test-secret-not-production',
  SEED_DEFAULT_ACCOUNTS:'false',FINANCIAL_RESET_CODE:'1122',
});
const {pool,initSchema}=await import('../server/db.mjs');
const ledger=await import('../server/ledger/store.mjs');
const {signToken,hashPassword,authenticate}=await import('../server/ledger/auth.mjs');
const {createLocalPool}=await import('../server/local-database.mjs');
const {withDatabaseRequest}=await import('../server/database-request-context.mjs');

const erasedTables=[
  'app_manager_commission','app_ticket_line','app_ticket_batch','app_ticket','app_bet_rejection',
  'app_transaction','app_staff_transfer','app_casino_gamble_event',
  'app_casino_gamble_state','app_casino_freespin_state','app_casino_original_event',
  'app_casino_original_state','app_casino_round',
];
let server,backupCalls=0,failBackup=false,resetSignals=0;
const count=async table=>Number((await pool.query(`select count(*)::int as n from ${table}`)).rows[0].n);
const snapshot=async()=>({
  tables:Object.fromEntries(await Promise.all(erasedTables.map(async name=>[name,await count(name)]))),
  users:(await pool.query('select id,username,password_hash,role,status,balance,manager_id,agent_id,deleted_at from app_user order by id')).rows,
});

async function seedHistory(admin,manager,player){
  const ticket=randomUUID(),round=randomUUID(),session=randomUUID();
  await pool.query(`insert into app_ticket(id,booking_code,user_id,stake,total_odds,potential_payout,status)
    values($1,$2,$3,100,2,200,'PENDING')`,[ticket,'RESET-'+randomUUID(),player.id]);
  await pool.query(`insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,odds_at_placement)
    values($1,777,'result','1','Home','1X2','Home vs Away',2)`,[ticket]);
  await pool.query(`insert into app_ticket_batch(user_id,client_request_id,request_payload_hash,ticket_ids)
    values($1,$2,'test-reset',ARRAY[$3]::uuid[])`,[player.id,randomUUID(),ticket]);
  await pool.query(`insert into app_transaction(user_id,amount,type,reference_id,balance_after)
    values($1,-100,'BET_PLACED',$2,321.09),($3,-3,'MANAGER_COMMISSION_DEBIT',$2,-5.50)`,[player.id,ticket,manager.id]);
  await pool.query(`insert into app_bet_rejection(user_id,client_request_id,stake,selection_count,reason)
    values($1,$2,100,1,'test refusal')`,[player.id,randomUUID()]);
  await pool.query(`insert into app_staff_transfer(actor_id,request_id,payload,response)
    values($1,$2,'test-reset','{"success":true}')`,[admin.id,randomUUID()]);
  await pool.query(`insert into app_casino_round(id,user_id,client_request_id,game_id,game_version,bet,denomination,lines,stake,payout,balance_after,result)
    values($1,$2,$3,'sizzling','test-reset',20,1,5,20,50,321.09,'{}')`,[round,player.id,randomUUID()]);
  await pool.query(`insert into app_casino_gamble_state(user_id,round_id,pending) values($1,$2,50)`,[player.id,round]);
  await pool.query(`insert into app_casino_gamble_event(user_id,request_id,action,response) values($1,$2,'collect','{}')`,[player.id,randomUUID()]);
  await pool.query(`insert into app_casino_freespin_state(user_id,round_id,left_spins,done_spins,mud,bet,lines)
    values($1,$2,5,2,1,20,5)`,[player.id,round]);
  await pool.query(`insert into app_casino_original_state(user_id,game_id,session_id,state)
    values($1,'lucky-clover-x3',$2,'{"pending":50}')`,[player.id,session]);
  await pool.query(`insert into app_casino_original_event(user_id,session_id,request_id,fingerprint,response)
    values($1,$2,'request-reset','fingerprint-reset','{}')`,[player.id,session]);
  await pool.query(`insert into app_match_result(match_id,home_score,away_score) values(777,2,1)`);
  await pool.query(`insert into app_match_snapshot(match_id,snapshot) values(777,'{"home_score":2,"away_score":1}')`);
}

try{
  await initSchema();await ledger.initLedgerSchema();
  const passwordHash=hashPassword('isolated-reset-password');
  const make=(username,role,balance,managerId=null)=>ledger.createUser({username,passwordHash,role,balance,managerId});
  const admin=await make('reset-admin','ADMIN',500),agent=await make('reset-agent','AGENT',123.45),manager=await make('reset-manager','MANAGER',-5.5),player=await make('reset-player','PLAYER',321.09,manager.id);
  const banned=await make('reset-banned','PLAYER',1.23,manager.id);await pool.query("update app_user set status='BANNED' where id=$1",[banned.id]);
  await pool.query('update app_user set agent_id=$2 where id=$1',[manager.id,agent.id]);
  await pool.query('update app_commission_config set single_pct=9.25,multi_pct=11 where id=1');
  await pool.query(`update app_casino_settings set enabled=false,game_controls='{"sizzling":{"mode":"custom","rtp":55,"hitFrequency":15}}' where id=1`);
  await pool.query(`insert into app_player_controls(user_id,daily_limit,self_excluded_until) values($1,250,now()+interval '2 days')`,[player.id]);
  await pool.query(`insert into app_feed_override(kind,ref,suspended,price) values('outcome','777|result||1',true,2.25)`);
  await pool.query(`insert into app_bet_builder_template(name,legs,active) values('Preserved template','[]',false)`);
  await pool.query(`insert into app_live_risk_settings(id,settings) values(1,'{"enabled":true,"testSetting":"preserve"}') on conflict(id) do update set settings=excluded.settings`);
  await seedHistory(admin,manager,player);
  // The module/router contract is completed by the parent implementation.
  const module=await import('../server/ledger/financial-reset.mjs');
  const router=module.createFinancialResetRouter({backup:async()=>{
    backupCalls++;if(failBackup)throw new Error('injected-test-backup-failure');
    return {backupFile:join(temp,'test-before-reset.tgz')};
  },onReset:async()=>{resetSignals++;}});
  const app=express();app.use(express.json(),router);
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const call=async(actor,path,method='GET',body,token=null)=>{
    const current=actor?await ledger.getUserById(actor.id):null;
    const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'content-type':'application/json',...(actor?{authorization:`Bearer ${token||signToken(current)}`}:{})},body:body?JSON.stringify(body):undefined});
    return {status:r.status,body:await r.text().then(text=>{try{return JSON.parse(text);}catch{return {raw:text};}})};
  };
  const input=requestId=>({code:'1122',confirmation:'RESET',requestId});
  const before=await snapshot();
  const preview=await call(admin,'/admin/financial-reset/preview');assert.equal(preview.status,200);assert.deepEqual(await snapshot(),before);assert.equal(backupCalls,0,'preview cannot create backups or mutate data');
  for(const actor of [null,agent,manager,player]){
    const read=await call(actor,'/admin/financial-reset/preview');assert.ok([401,403].includes(read.status));
    const reset=await call(actor,'/admin/financial-reset','POST',input(randomUUID()));assert.ok([401,403].includes(reset.status));
  }
  for(const body of [{...input(randomUUID()),code:'9999'},{...input(randomUUID()),confirmation:'reset'},{...input(randomUUID()),requestId:'not-a-uuid'}]){
    const refused=await call(admin,'/admin/financial-reset','POST',body);assert.ok([400,403].includes(refused.status),JSON.stringify(refused));assert.deepEqual(await snapshot(),before);
  }
  failBackup=true;const failedBackup=await call(admin,'/admin/financial-reset','POST',input(randomUUID()));assert.ok(failedBackup.status>=500);assert.deepEqual(await snapshot(),before,'failed backup aborts reset');failBackup=false;
  await pool.query(`create function reject_financial_reset_test() returns trigger language plpgsql as $$ begin if NEW.balance=0 then raise exception 'injected-reset-failure'; end if; return NEW; end $$`);
  await pool.query(`create trigger reject_financial_reset_test before update on app_user for each row execute function reject_financial_reset_test()`);
  const failedWrite=await call(admin,'/admin/financial-reset','POST',input(randomUUID()));assert.ok(failedWrite.status>=500);assert.deepEqual(await snapshot(),before,'all prior deletions roll back after a balance write fails');
  await pool.query('drop trigger reject_financial_reset_test on app_user');await pool.query('drop function reject_financial_reset_test()');
  const identity=before.users.map(({balance,...rest})=>rest);
  const settingsBefore={commission:(await pool.query('select * from app_commission_config')).rows,casino:(await pool.query('select * from app_casino_settings')).rows,controls:(await pool.query('select * from app_player_controls')).rows,overrides:(await pool.query('select * from app_feed_override')).rows,templates:(await pool.query('select * from app_bet_builder_template')).rows,risk:(await pool.query('select * from app_live_risk_settings')).rows,results:(await pool.query('select * from app_match_result')).rows,snapshots:(await pool.query('select * from app_match_snapshot')).rows};
  const oldAdminToken=signToken(await ledger.getUserById(admin.id));
  const requestId=randomUUID();const [first,repeated]=await Promise.all([call(admin,'/admin/financial-reset','POST',input(requestId)),call(admin,'/admin/financial-reset','POST',input(requestId))]);
  assert.equal(first.status,200,JSON.stringify(first));assert.ok([200,401,409].includes(repeated.status),JSON.stringify(repeated));assert.equal(resetSignals,1,'identical concurrent requests commit only one reset');
  assert.equal(first.body.requiresLogin,true);assert.match(first.body.resetId,/^[0-9a-f-]{36}$/i);assert.equal(await count('app_financial_reset'),1,'successful receipt survives history reset');
  if(repeated.status===200)assert.equal(repeated.body.resetId,first.body.resetId);
  for(const table of erasedTables)assert.equal(await count(table),0,`${table} cleared`);
  const after=await snapshot();assert.deepEqual(after.users.map(({balance,...rest})=>rest),identity,'logins, ownership and roles survive');assert.ok(after.users.every(u=>Number(u.balance)===0),'all balances, including staff/debt, zeroed');
  assert.equal((await authenticate('reset-player','isolated-reset-password')).user.id,player.id,'existing password still works');
  const settingsAfter={commission:(await pool.query('select * from app_commission_config')).rows,casino:(await pool.query('select * from app_casino_settings')).rows,controls:(await pool.query('select * from app_player_controls')).rows,overrides:(await pool.query('select * from app_feed_override')).rows,templates:(await pool.query('select * from app_bet_builder_template')).rows,risk:(await pool.query('select * from app_live_risk_settings')).rows,results:(await pool.query('select * from app_match_result')).rows,snapshots:(await pool.query('select * from app_match_snapshot')).rows};
  assert.deepEqual(settingsAfter,settingsBefore,'reset preserves operator settings and player safety limits');
  assert.equal((await call(admin,'/admin/financial-reset/preview','GET',undefined,oldAdminToken)).status,401,'old authenticated sessions cannot resume old requests after reset');
  await ledger.moveMoney(player.id,25,{type:'DEPOSIT',description:'after reset test deposit'});
  const replay=await call(admin,'/admin/financial-reset','POST',input(requestId));assert.equal(replay.status,200);assert.equal((await ledger.getUserById(player.id)).balance,25);assert.equal(await count('app_transaction'),1,'lost-response retry cannot erase new money or history');
  assert.equal(replay.body.resetId,first.body.resetId);assert.equal(await count('app_financial_reset'),1);assert.equal(resetSignals,1);
  // A request authenticated before the reset must not resume a delayed cashier
  // operation afterwards and recreate money from the pre-reset session.
  let releasePending;const pendingGate=new Promise(r=>{releasePending=r;});
  const pendingCashier=withDatabaseRequest(pool,pool.generation,async()=>{
    await pendingGate;return ledger.moveMoney(player.id,10,{type:'DEPOSIT',description:'stale request must fail'});
  });
  const rejectedCashier=assert.rejects(pendingCashier,error=>error.status===401&&error.code==='FINANCIAL_SESSION_RESET');
  const second=await module.executeFinancialReset(await ledger.getUserById(admin.id),input(randomUUID()),{database:pool,backupDir:join(temp,'real-backups')});
  releasePending();await rejectedCashier;assert.equal((await ledger.getUserById(player.id)).balance,0);assert.equal(await count('app_transaction'),0);
  assert.ok(resolve(second.backupFile).startsWith(join(temp,'real-backups')+sep));
  const bytes=await readFile(second.backupFile);assert.ok(bytes.byteLength>100,'default backup persisted bytes');
  const restored=createLocalPool({dataDir:join(temp,'restored-backup'),loadDataDir:new Blob([bytes])});
  try{
    const restoredPlayer=(await restored.query('select balance,password_hash,manager_id from app_user where id=$1',[player.id])).rows[0];
    assert.equal(Number(restoredPlayer.balance),25,'backup contains exact pre-reset funds');assert.equal(restoredPlayer.password_hash,passwordHash);assert.equal(restoredPlayer.manager_id,manager.id);
    assert.equal(Number((await restored.query('select count(*)::int as n from app_transaction')).rows[0].n),1,'backup contains pre-reset transaction');
    assert.equal(Number((await restored.query('select count(*)::int as n from app_financial_reset')).rows[0].n),1,'backup precedes second reset receipt');
  }finally{await restored.end();}
  assert.equal(JSON.stringify(preview.body).includes(passwordHash),false,'preview does not expose passwords');
  console.log('PASS financial reset: admin-only/PIN/confirmation, preview, backup failure, transaction rollback, history/balances cleared, identity/settings retained, retry/later-deposit protection, old JWT/delayed cashier blocked, actual gzip backup restored with exact pre-reset data');
}finally{
  if(server)await new Promise(r=>server.close(r));await pool.end();
  assert.ok(resolve(temp).startsWith(parent+sep));await rm(temp,{recursive:true,force:true});
}
