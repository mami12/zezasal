/** Windows launcher. Control is authenticated local IPC, never a public URL or PID kill list. */
import net from 'node:net';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,unlinkSync,readdirSync,realpathSync} from 'node:fs';
import {join,dirname,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn,spawnSync,fork} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {ensureWindowsEnv,loadWindowsConfig,ensureWindowsLocalDatabase} from './windows-config.mjs';
import {assertNoDatabaseMaintenance} from '../server/database-location.mjs';

const repository=fileURLToPath(new URL('../',import.meta.url));
const alive=child=>child&&child.exitCode===null&&child.signalCode===null;
export function controlPaths(rootDir){
 const canonical=realpathSync(rootDir);
 const identity=createHash('sha256').update(process.platform==='win32'?canonical.toLowerCase():canonical).digest('hex').slice(0,24);
 return {dir:join(canonical,'.runtime'),state:join(canonical,'.runtime','server.json'),
  pipe:process.platform==='win32'?'\\\\.\\pipe\\faqja-'+identity:join(tmpdir(),'faqja-'+identity+'.sock')};
}
function readState(paths){try{return JSON.parse(readFileSync(paths.state,'utf8'));}catch{return null;}}
function clearState(paths,token){if(readState(paths)?.token===token){try{unlinkSync(paths.state);}catch{}}}
function sameToken(left,right){
 if(typeof left!=='string'||typeof right!=='string')return false;
 const a=Buffer.from(left),b=Buffer.from(right);
 return a.length===b.length&&timingSafeEqual(a,b);
}
export function controlRequest(paths,{command='status',token=readState(paths)?.token,timeoutMs=3000}={}){
 return new Promise((resolve,reject)=>{
  const socket=net.createConnection(paths.pipe);let body='';
  socket.setEncoding('utf8');socket.setTimeout(timeoutMs,()=>socket.destroy(Error('Local server control timed out.')));
  socket.once('connect',()=>socket.write(JSON.stringify({command,token})+'\n'));
  socket.on('data',chunk=>{
   body+=chunk;
   if(body.length>4096){socket.destroy(Error('Invalid control response'));return;}
   const end=body.indexOf('\n');if(end<0)return;
   try{resolve(JSON.parse(body.slice(0,end)));}catch{reject(Error('Invalid control response'));}
   socket.destroy();
  });
  socket.once('error',reject);
  socket.once('end',()=>{if(!body.includes('\n'))reject(Error('Server control closed without a response.'));});
 });
}

export async function stopWindowsServer({rootDir=repository,log=console.log,timeoutMs=15000}={}){
 const paths=controlPaths(rootDir),state=readState(paths);
 if(!state?.token){log('This copy of the server is not running.');return {running:false};}
 let response;
 try{response=await controlRequest(paths,{command:'stop',token:state.token});}
 catch(error){
  if(['ENOENT','ECONNREFUSED'].includes(error.code)){clearState(paths,state.token);log('Server is not running; stale launcher state was cleared.');return {running:false};}
  throw error;
 }
 if(!response.ok)throw Error('Server control refused the stop request. Use Ctrl+C in its own window.');
 log('Stopping this server and finishing active requests...');
 const until=Date.now()+timeoutMs;
 while(Date.now()<until){
  if(readState(paths)?.token!==state.token){log('Server stopped.');return {running:false};}
  await delay(100);
 }
 throw Error('Server has not finished stopping. Check its console window.');
}

function sourceFingerprint(rootDir){
 const hash=createHash('sha256');
 const add=(path,include=()=>true)=>{
  if(!existsSync(path))return;
  const rel=relative(rootDir,path).replaceAll('\\','/');
  if(/^web\/public\/casino-original\/(sizzling|bookofra)(\/|$)/.test(rel))return;
  for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   const file=join(path,entry.name);
   if(entry.isDirectory())add(file,include);
   else if(entry.isFile()&&include(file)){hash.update(relative(rootDir,file));hash.update('\0');hash.update(readFileSync(file));hash.update('\0');}
  }
 };
 for(const name of ['package.json','package-lock.json','web/package.json','web/index.html','web/vite.config.ts','web/tsconfig.json','web/tailwind.config.js','web/postcss.config.js',
  'scripts/sync-original-sizzling.mjs','scripts/sync-original-bookofra.mjs','scripts/pixi-client-compat.mjs','scripts/verify-original-sizzling.mjs']){
  hash.update(name);hash.update(readFileSync(join(rootDir,name)));
 }
 add(join(rootDir,'web/src'));add(join(rootDir,'web/public'));
 // The frontend imports pure ledger helpers; updating those must rebuild it.
 add(join(rootDir,'server/ledger'),file=>/\.(?:mjs|d\.mts)$/.test(file));
 return hash.digest('hex');
}
function stamp(path){try{return readFileSync(path,'utf8').trim();}catch{return '';}}
async function terminateOwned(child,{graceful=false}={}){
 if(!alive(child))return;
 const done=new Promise(resolve=>child.once('exit',resolve));
 const wait=async(ms)=>{
  let timer;
  try{await Promise.race([done,new Promise(resolve=>{timer=setTimeout(resolve,ms);})]);}
  finally{clearTimeout(timer);}
 };
 if(graceful&&child.connected){try{child.send({type:'faqja:stop'},()=>{});}catch{}}
 else if(process.platform==='win32'){
  // Only a still-owned child process tree; never read PIDs from a file or kill by image name.
  const kill=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  await new Promise(resolve=>{kill.once('error',resolve);kill.once('exit',resolve);});
 }else child.kill('SIGTERM');
 await wait(graceful?10000:2000);
 if(alive(child))child.kill('SIGKILL');
 await wait(1000);
}

export async function prepareWindowsInstall({rootDir,env,run,log}){
 const npmCli=join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
 if(!existsSync(npmCli))throw Error('npm was not found next to Node.js. Reinstall Node.js 24 LTS with npm selected.');
 const runtime=join(rootDir,'.runtime');
 const buildEnv={...env,PUPPETEER_SKIP_DOWNLOAD:'true'};
 for(const key of ['DATABASE_URL','JWT_SECRET','INGEST_TOKEN','ADMIN_PASSWORD','DEMO_PASSWORD'])delete buildEnv[key];
 const installed=createHash('sha256').update(process.versions.node.split('.')[0]+process.platform+process.arch)
  .update(readFileSync(join(rootDir,'package.json'))).update(readFileSync(join(rootDir,'package-lock.json'))).digest('hex');
 if(stamp(join(runtime,'install.sha256'))!==installed||!existsSync(join(rootDir,'node_modules','dotenv','package.json'))){
  log('First installation / dependency update: downloading packages. Please wait...');
  await run([npmCli,'ci','--include=dev','--no-audit','--no-fund'],buildEnv);
  writeFileSync(join(runtime,'install.sha256'),installed);
 }
 const fingerprint=sourceFingerprint(rootDir);
 if(stamp(join(runtime,'build.sha256'))!==fingerprint||!existsSync(join(rootDir,'web/dist/index.html'))){
  if(spawnSync('tar',['--version'],{windowsHide:true,stdio:'ignore'}).status!==0)throw Error('Windows tar was not found. Install the current Windows 10 updates (or Git for Windows with tar), then run start.bat again.');
  log('Building the website and original game assets. This can take several minutes...');
  await run([npmCli,'run','build:web'],buildEnv);
  writeFileSync(join(runtime,'build.sha256'),sourceFingerprint(rootDir));
 }
}

function openWindows(target,{editor=false}={}){
 if(process.platform!=='win32')return;
 // Paths/URLs stay arguments, never become shell command text.
 const child=spawn(editor?'notepad.exe':'explorer.exe',[target],{detached:true,stdio:'ignore',windowsHide:!editor});
 child.once('error',()=>{});child.unref();
}

export async function startWindowsServer({rootDir=repository,log=console.log,prepare=prepareWindowsInstall,
 entry=join(rootDir,'scripts','start-local.mjs'),launchBrowser=url=>openWindows(url),editConfig=path=>openWindows(path,{editor:true}),
 startupTimeoutMs=30000}={}){
 assertNoDatabaseMaintenance(rootDir);
 const paths=controlPaths(rootDir);mkdirSync(paths.dir,{recursive:true});
 const token=randomBytes(32).toString('hex');let phase='configuration',current=null,backend=false,stopping=false,stopPromise=null,cleaned=false;
 let finish;
 const finished=new Promise(resolve=>{finish=resolve;});
 const control=net.createServer(socket=>{
  socket.setEncoding('utf8');socket.setTimeout(2000,()=>socket.destroy());let input='';
  socket.on('error',()=>{});
  socket.on('data',chunk=>{
   input+=chunk;if(input.length>2048){socket.destroy();return;}
   const end=input.indexOf('\n');if(end<0)return;
   let request;try{request=JSON.parse(input.slice(0,end));}catch{socket.destroy();return;}
   input='';
   if(!sameToken(request.token,token)){socket.end(JSON.stringify({ok:false})+'\n');return;}
   socket.end(JSON.stringify({ok:true,phase})+'\n');
   if(request.command==='stop')void stop();
  });
 });
 const cleanup=()=>{
  if(cleaned)return;cleaned=true;
  clearState(paths,token);control.close();
  process.removeListener('SIGINT',signalStop);process.removeListener('SIGTERM',signalStop);
 };
 const save=()=>{if(!cleaned)writeFileSync(paths.state,JSON.stringify({pid:process.pid,token,phase}),{mode:0o600});};
 const stop=()=>stopPromise??=(async()=>{
  stopping=true;phase='stopping';save();
  await terminateOwned(current,{graceful:backend});
  cleanup();finish(0);
 })();
 const signalStop=()=>{void stop();};
 try{
  await new Promise((resolve,reject)=>{control.once('error',reject);control.listen(paths.pipe,resolve);});
 }catch(error){
  if(error.code==='EADDRINUSE'){log('This copy of the server is already running or being prepared. Use stop.bat first.');return 0;}
  throw error;
 }
 save();process.on('SIGINT',signalStop);process.on('SIGTERM',signalStop);
 const run=(args,env)=>new Promise((resolve,reject)=>{
  if(stopping){reject(Error('Start cancelled.'));return;}
  current=spawn(process.execPath,args,{cwd:rootDir,env,stdio:'inherit',windowsHide:true});
  current.once('error',reject);
  current.once('exit',code=>{current=null;code===0&&!stopping?resolve():reject(Error(stopping?'Start cancelled.':'Preparation failed. See the messages above.'));});
 });
 try{
  const setup=await ensureWindowsEnv({rootDir});
  if(stopping)return await finished;
  if(setup.created)log('Created .env with your Windows settings. Server secrets were configured without printing their values.');
  let config=await loadWindowsConfig({rootDir});
  if(stopping)return await finished;
  if(config.errors.length){
   editConfig(config.envPath);
   throw Error(config.errors.join('\n')+'\nEdit and save .env, then run start.bat again. Secret values are not printed.');
  }
  // Fail before building if another application owns the chosen website port.
  for(const host of ['127.0.0.1','::1','0.0.0.0','::'])await new Promise((resolve,reject)=>{
   const probe=net.createServer();probe.once('error',error=>{
    if(host.includes(':')&&['EAFNOSUPPORT','EADDRNOTAVAIL'].includes(error.code)){resolve();return;}
    reject(Error('Port '+config.port+' is busy. Use stop.bat or choose another PORT in .env.'));
   });
   probe.listen({port:config.port,host,exclusive:true},()=>probe.close(resolve));
  });
  if(stopping)return await finished;
  phase='preparing';save();
  await prepare({rootDir,env:config.env,run,log});
  if(stopping)return await finished;
  config=await ensureWindowsLocalDatabase({rootDir,log});
  if(stopping)return await finished;
  phase='starting';save();backend=true;
  current=fork(entry,[],{cwd:rootDir,env:config.env,stdio:['inherit','inherit','inherit','ipc'],windowsHide:true});
  let childFailure=null;
  current.once('error',error=>{childFailure=error;});
  current.once('exit',code=>{current=null;if(!stopping){cleanup();finish(code||1);}});
   const until=Date.now()+Math.max(startupTimeoutMs,config.env.DB_DRIVER==='local'?90000:0);
  while(!stopping&&current&&Date.now()<until){
   if(childFailure)throw childFailure;
   try{
    const response=await fetch('http://127.0.0.1:'+config.port+'/health',{signal:AbortSignal.timeout(1000)});
    const health=await response.json();
    if(response.ok&&health.ok===true&&health.ledger){
     if(!current||stopping)break;
     phase='running';save();
     log('Server started: '+config.url);
     log('Keep this window open. Use stop.bat (or Ctrl+C here) to close this server.');
     if(!health.ledger.ready)log('Database is still connecting. Login and wallet actions require a ready ledger; check this window for database status.');
     launchBrowser(config.url);
     return await finished;
    }
   }catch{/* The child can still be binding its port. */}
   await delay(200);
  }
  if(stopping)return await finished;
  throw Error('Server did not become available. Read the server messages above and check .env.');
 }catch(error){
  await stop();
  if(error.message==='Start cancelled.')return 0;
  throw error;
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(Number(process.versions.node.split('.')[0])<24)throw Error('Install Node.js 24 LTS, then reopen start.bat / stop.bat.');
  const action=process.argv[2];
  if(action==='start')process.exitCode=await startWindowsServer();
  else if(action==='stop')await stopWindowsServer();
  else throw Error('Use start.bat or stop.bat from the project folder.');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
