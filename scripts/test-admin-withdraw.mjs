import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import express from 'express';

const parent=resolve('tmp');await mkdir(parent,{recursive:true});const temp=await mkdtemp(join(parent,'admin-withdraw-'));
Object.assign(process.env,{DB_DRIVER:'local',LOCAL_DATABASE_DIR:join(temp,'database'),DATABASE_URL:'',JWT_SECRET:'isolated-admin-withdraw-test-secret',SEED_DEFAULT_ACCOUNTS:'false'});
const {pool,initSchema}=await import('../server/db.mjs');
const ledger=await import('../server/ledger/store.mjs');
const {signToken,hashPassword}=await import('../server/ledger/auth.mjs');
const {directoryRouter}=await import('../server/ledger/directory.mjs');
let server;
try{
 await initSchema();await ledger.initLedgerSchema();
 const make=(username,role,balance)=>ledger.createUser({username,role,balance,passwordHash:hashPassword('test-password')});
 const admin=await make('withdraw-admin','ADMIN',200),agent=await make('withdraw-agent','AGENT',100),manager=await make('withdraw-manager','MANAGER',100),player=await make('withdraw-player','PLAYER',80);
 const app=express();app.use(express.json(),directoryRouter);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=async(actor,target,amount,requestId=randomUUID())=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/admin/directory/${target.id}/funds`,{method:'POST',headers:{authorization:`Bearer ${signToken(actor)}`,'content-type':'application/json'},body:JSON.stringify({amount,direction:'withdraw',requestId})});return {status:r.status,body:await r.json()};};
 for(const actor of [agent,manager,player])assert.equal((await call(actor,player,1)).status,403,'only ADMIN can use admin withdrawals');
 const key=randomUUID(),first=await call(admin,player,25.5,key),retry=await call(admin,player,25.5,key);
 assert.equal(first.status,200);assert.equal(retry.status,200);assert.deepEqual(first.body,retry.body);assert.equal((await ledger.getUserById(player.id)).balance,54.5);
 assert.equal(Number((await pool.query("select count(*) as n from app_transaction where user_id=$1 and type='WITHDRAWAL'",[player.id])).rows[0].n),1,'retry is recorded once');
 assert.equal((await call(admin,player,10,key)).status,409,'same request cannot be reused for a different amount');
 assert.equal((await call(admin,admin,35)).status,200);assert.equal((await ledger.getUserById(admin.id)).balance,165,'admin own-wallet withdrawal');
 for(const amount of [0,-1,0.001,1.234,null,true,{},'12.456',1000])assert.ok((await call(admin,player,amount)).status>=400,`invalid/insufficient ${String(amount)}`);
 assert.equal((await ledger.getUserById(player.id)).balance,54.5);
 const competing=await Promise.all([call(admin,player,40),call(admin,player,40)]);assert.equal(competing.filter(r=>r.status===200).length,1);assert.equal((await ledger.getUserById(player.id)).balance,14.5,'concurrent requests never overdraw');
 assert.equal((await ledger.getUserById(admin.id)).balance,165,'withdrawing user funds does not manufacture an admin wallet credit');
 const audit=await pool.query("select count(*) as n from app_admin_audit where actor_id=$1 and action='ADJUST DIRECTORY_FUNDS'",[admin.id]);assert.equal(Number(audit.rows[0].n),3);
 console.log('PASS ADMIN own/user withdrawals: role enforcement, retry, mismatch, invalid input, insufficient funds, concurrent overdraft prevention and audit');
}finally{if(server){server.closeAllConnections?.();await new Promise(r=>server.close(r));}await pool.end();assert.ok(resolve(temp).startsWith(parent));await rm(temp,{recursive:true,force:true});}
