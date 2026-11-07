/** Real server boot/restart with local files and loopback-only upstream traffic. */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import net from 'node:net';
import { resolve, join } from 'node:path';
import bcrypt from 'bcryptjs';
import { createLocalPool } from '../server/local-database.mjs';
import { LEDGER_SQL } from '../server/ledger/schema.mjs';

const parent=resolve('tmp');await mkdir(parent,{recursive:true});
const root=await mkdtemp(join(parent,'local-server-test-')),directory=join(root,'database');
const portServer=net.createServer();await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));
const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));
const env={...process.env,PORT:String(port),DB_DRIVER:'local',LOCAL_DATABASE_DIR:directory,DATABASE_URL:'invalid-cloud-url-never-used',JWT_SECRET:'test-only-local-server-secret-without-cloud',SEED_DEFAULT_ACCOUNTS:'false',DB_INIT_STRICT:'true',
  UPSTREAM_GATEWAY:'http://127.0.0.1:1',ODDS_SOCKET:'false',ISCTRL_SOCKET:'false',LUCKYBET_REST:'false',LOG_RAW_FRAMES:'false',IDLE_FEED:'true',IDLE_AFTER_MS:'1',IDLE_COLD_BOOT_MS:'1'};
const origin=`http://127.0.0.1:${port}`;let child,exit,logs='';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function stop(){if(!child)return;if(child.connected)child.send({type:'faqja:stop'});else child.kill('SIGTERM');await Promise.race([exit,new Promise((_,reject)=>setTimeout(()=>reject(Error('Server stop timed out')),15000).unref())]);child=null;}
async function start(){
  child=fork('server/index.mjs',[],{cwd:resolve('.'),env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  exit=new Promise(resolve=>child.once('exit',resolve));
  child.stdout.on('data',chunk=>{logs+=chunk;});child.stderr.on('data',chunk=>{logs+=chunk;});
  let state;
  const until=Date.now()+30000;
  while(Date.now()<until){
    try{const response=await fetch(origin+'/health',{signal:AbortSignal.timeout(2000)});state=await response.json();if(state.ledger?.ready&&state.settlement?.lastSuccessAt)return state;}catch{}
    if(child.exitCode!==null)throw Error('Isolated server exited before ready: '+logs);
    await wait(100);
  }
  throw Error('Isolated local server not ready: '+logs);
}
try {
  const initial=createLocalPool({dataDir:directory});
  try{await initial.query(LEDGER_SQL);await initial.query("insert into app_user(username,password_hash,balance) values('local-server-player',$1,42.50)",[await bcrypt.hash('test-local-password',4)]);}finally{await initial.end();}
  for(let attempt=0;attempt<2;attempt++){
    const health=await start();assert.equal(health.target.driver,'local');
    assert.equal(health.idle.enabled,false);assert.equal(health.feedMode,'live');
    await wait(100); // Far beyond the inherited one-millisecond sleep flags.
    const after=await (await fetch(origin+'/health')).json();
    assert.equal(after.collector.paused,false);assert.equal(after.idle.sleeps,0);assert.ok(after.settlement.lastSuccessAt);
    const login=await fetch(origin+'/app/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'local-server-player',password:'test-local-password'})});
    assert.equal(login.status,200);const account=await login.json();assert.equal(account.user.balance,42.5);
    await stop();
  }
  assert.ok(!/LOCAL_DATABASE_LOCKED/.test(logs));
  console.log('PASS full local server: schema initialization, authenticated unchanged balance across restart, graceful database close, active settlement and legacy sleep flags ignored');
} finally {
  await stop();assert.ok(resolve(root).startsWith(parent+(process.platform==='win32'?'\\':'/')));
  await rm(root,{recursive:true,force:true});
}
