import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import puppeteer from 'puppeteer';
import { build } from 'esbuild';

// Real React/AuthContext/Axios, with manually released localhost responses.
// No production database, account, tokens or money are accessed.
const root = fileURLToPath(new URL('../web', import.meta.url));
const requests = [], loginRequests = [], probeRequests = [], failures = [];
let wake = () => {};
const queued = async (list, count) => {
  if (list.length >= count) return list[count - 1];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Expected ${count} queued local requests, got ${list.length}`)), 10000);
    wake = () => { if (list.length >= count) { clearTimeout(timer); resolve(); } };
  });
  return list[count - 1];
};
const user = (id, balance) => ({ id, username:id, role:'PLAYER', status:'ACTIVE', currency:'ALL', balance });
const reply = (request, body, status = 200) => request.response.status(status).json(body);
const client = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {AuthProvider,useAuth} from './src/context/AuthContext.tsx';
import {apiClient} from './src/api/client.ts';
window.tasks={};window.api=apiClient;
function Probe(){window.auth=useAuth();return React.createElement('div',null,window.auth.user?.username??'logged out');}
createRoot(document.getElementById('root')).render(React.createElement(AuthProvider,null,React.createElement(Probe)));
`;
const html = '<!doctype html><html><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
let server, browser;
try {
  const bundled=await build({stdin:{contents:client,loader:'tsx',resolveDir:root},bundle:true,write:false,format:'esm',platform:'browser',target:'es2020',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},logLevel:'silent'});
  const app = express();app.use(express.json());
  const collect = list => (request,response) => {list.push({request,response});wake();};
  app.get('/app/api/auth/me',collect(requests));
  app.post('/app/api/auth/login',collect(loginRequests));
  app.get('/app/api/probe',collect(probeRequests));
  app.get('/empty',(_request,response)=>response.send('<!doctype html><title>Storage fixture</title>'));
  app.get('/fixture.js',(_request,response)=>response.type('js').send(bundled.outputFiles[0].text));
  app.get(['/', '/app/login'],(_request,response)=>response.type('html').send(html));
  server = http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
  const page=await browser.newPage();
  await page.setCacheEnabled(false);
  page.on('pageerror',error=>failures.push(error.message));
  await page.setRequestInterception(true);
  let abortNextMe=false;
  page.on('request',request=>{
    if(abortNextMe&&request.url()===origin+'/app/api/auth/me'){abortNextMe=false;return request.abort('failed');}
    return request.url().startsWith(origin)||request.url().startsWith('data:')?request.continue():request.abort();
  });
  await page.evaluateOnNewDocument(()=>{if(!sessionStorage.getItem('fixture-started')){
    localStorage.setItem('token','local-token-A');sessionStorage.setItem('fixture-started','yes');
  }});
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.auth,{timeout:45000});
  reply(await queued(requests,1),user('A',100));
  await page.waitForFunction(()=>window.auth?.user?.balance===100&&!window.auth.isLoading);
  console.log('Local auth fixture ready; testing manually ordered account responses');
  await page.evaluate(()=>{window.initialRefresh=window.auth.refreshUser;});
  const state=()=>page.evaluate(()=>({user:window.auth.user,token:localStorage.getItem('token'),loading:window.auth.isLoading,stable:window.initialRefresh===window.auth.refreshUser}));
  const start=async(name,action,...args)=>page.evaluate((name,action,args)=>{
    window.tasks[name]=(action==='probe'?window.api.get('/probe'):window.auth[action](...args))
      .then(()=>({ok:true}),error=>({ok:false,status:error.response?.status??null}));
  },name,action,args);
  const finish=async name=>{
    let timer;
    try{return await Promise.race([
      page.evaluate(async name=>await window.tasks[name],name),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Auth action ${name} did not settle`)),15000);}),
    ]);}finally{clearTimeout(timer);}
  };
  let meCount=1,loginCount=0;
  const refresh=async name=>{await start(name,'refreshUser');return queued(requests,++meCount);};
  const login=async (name,id,balance,{release=true}={})=>{
    await start(name,'login',id,'test-only');
    const request=await queued(loginRequests,++loginCount);
    if(!release)return request;
    reply(request,{token:`local-token-${id}`,user:user(id,balance)});
    return queued(requests,++meCount);
  };

  const older=await refresh('older'),newer=await refresh('newer');
  reply(newer,user('A',200));await finish('newer');
  reply(older,user('A',110));await finish('older');
  assert.equal((await state()).user.balance,200,'late earlier balance cannot overwrite a newer refresh');
  assert.equal((await state()).stable,true,'refreshUser identity remains stable after user updates');
  const staleInvalid=await refresh('staleInvalid'),newest=await refresh('newest');
  reply(newest,user('A',250));await finish('newest');
  reply(staleInvalid,{message:'not authenticated'},401);await finish('staleInvalid');
  assert.equal((await state()).user.balance,250,'an obsolete auth read cannot log out a newer confirmed read');
  assert.equal((await state()).token,'local-token-A');
  const unavailable=await refresh('unavailable');reply(unavailable,{message:'temporary failure'},503);await finish('unavailable');
  // Abort before dispatch: destroying a GET response can make Chromium retry it
  // automatically, which would leave an intentionally queued retry unanswered.
  abortNextMe=true;await start('offline','refreshUser');await finish('offline');
  assert.equal((await state()).user.balance,250,'temporary server/network failures retain the last confirmed account');
  assert.equal((await state()).token,'local-token-A');

  await start('sameTokenProbe','probe');const sameTokenProbe=await queued(probeRequests,1);
  const sameAccountLogin=await login('sameAccountLogin','A',250);reply(sameAccountLogin,user('A',260));await finish('sameAccountLogin');
  reply(sameTokenProbe,{message:'not authenticated'},401);await finish('sameTokenProbe');
  assert.equal((await state()).token,'local-token-A','session generation protects a new login even when its token text is unchanged');
  assert.equal((await state()).user.balance,260);

  const priorAccount=await refresh('priorAccount');
  await start('oldProbe','probe');const oldProbe=await queued(probeRequests,2);
  const currentAccount=await login('loginB','B',300);
  reply(currentAccount,user('B',350));await finish('loginB');
  reply(priorAccount,user('A',999));await finish('priorAccount');
  reply(oldProbe,{message:'not authenticated'},401);await finish('oldProbe');
  assert.equal((await state()).user.id,'B');assert.equal((await state()).user.balance,350);
  assert.equal((await state()).token,'local-token-B','old-session HTTP errors cannot remove a new login token');
  assert.equal(new URL(page.url()).pathname,'/','stale request cannot redirect the new account to login');

  const beforeLogout=await refresh('beforeLogout');
  await page.evaluate(()=>window.auth.logout());reply(beforeLogout,user('B',999));await finish('beforeLogout');
  assert.equal((await state()).user,null);assert.equal((await state()).token,null,'late balance response cannot revive a logged-out account');
  const pendingLogin=await login('pendingLogin','C',400,{release:false});
  await page.evaluate(()=>window.auth.logout());reply(pendingLogin,{token:'local-token-C',user:user('C',400)});await finish('pendingLogin');
  assert.equal((await state()).token,null,'late login response cannot undo a later logout');
  assert.equal(requests.length,meCount,'cancelled login does not start another account read');

  const firstLogin=await login('firstLogin','C',400,{release:false});
  const secondLogin=await login('secondLogin','D',500);reply(secondLogin,user('D',550));await finish('secondLogin');
  reply(firstLogin,{token:'local-token-C',user:user('C',400)});await finish('firstLogin');
  assert.equal((await state()).user.id,'D');assert.equal((await state()).token,'local-token-D','older login cannot replace the more recent login');
  // A login failure must not expire an already authenticated account.
  const failedLogin=await login('failedLogin','wrong',0,{release:false});
  reply(failedLogin,{message:'invalid username or password'},401);assert.equal((await finish('failedLogin')).ok,false);
  assert.equal((await state()).user.id,'D');assert.equal((await state()).token,'local-token-D');

  const forbidden=await refresh('forbidden');reply(forbidden,{message:'account is banned'},403);await finish('forbidden');
  assert.equal((await state()).user,null);assert.equal((await state()).token,null,'a current authoritative 403 expires the account');
  const temporaryLogin=await login('temporaryLogin','E',600);reply(temporaryLogin,{message:'temporary failure'},503);await finish('temporaryLogin');
  assert.equal((await state()).user.id,'E','successful login remains valid when the follow-up refresh temporarily fails');
  assert.equal((await state()).token,'local-token-E');
  const invalid=await refresh('invalid');reply(invalid,{message:'not authenticated'},401);await finish('invalid');
  assert.equal((await state()).user,null);assert.equal((await state()).token,null,'a current authoritative 401 removes an invalid token');

  // Real cross-tab token changes invalidate the first tab's in-flight read.
  const storagePage=await browser.newPage();await storagePage.goto(origin+'/empty');
  await storagePage.evaluate(()=>localStorage.setItem('token','local-token-F'));
  reply(await queued(requests,++meCount),user('F',700));
  await page.waitForFunction(()=>window.auth.user?.id==='F');
  const storageOld=await refresh('storageOld');
  await storagePage.evaluate(()=>localStorage.removeItem('token'));
  await page.waitForFunction(()=>window.auth.user===null);
  reply(storageOld,user('F',999));await finish('storageOld');
  assert.equal((await state()).user,null);assert.equal((await state()).token,null);
  assert.equal((await state()).stable,true);assert.deepEqual(failures,[]);
  await storagePage.close();await page.bringToFront();
  // Preserve the interceptor's current-session expiry on ordinary API calls.
  const finalLogin=await login('finalLogin','G',800);reply(finalLogin,user('G',850));await finish('finalLogin');
  await start('currentProbe','probe');reply(await queued(probeRequests,3),{message:'not authenticated'},401);
  await page.waitForFunction(()=>location.pathname==='/app/login'&&localStorage.getItem('token')===null,{polling:100});
  await page.waitForFunction(()=>window.auth?.user===null,{polling:100});
  assert.deepEqual(failures,[]);
  console.log('PASS real AuthContext/Axios: stable refresh, latest balance wins, login/logout and cross-tab races, stale 401 isolation, transient failure retention and current 401/403 expiration');
} catch(error) {
  console.error('Auth browser fixture failed:',error.message,failures);
  throw error;
} finally {
  for(const {response} of [...requests,...loginRequests,...probeRequests])if(!response.writableEnded)response.destroy();
  if(browser){
    // Closing during an intentional navigation/network refusal can leave a
    // headless Chromium child waiting on Windows. This process belongs only to
    // this isolated fixture; always release it before the next suite starts.
    let forced=false,timer;
    const closed=browser.close().then(()=>true,error=>{if(!forced)throw error;return true;});
    const finished=await Promise.race([closed,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),5000);})]);
    clearTimeout(timer);
    if(!finished){forced=true;browser.disconnect();browser.process()?.kill('SIGKILL');}
  }
  if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
}
