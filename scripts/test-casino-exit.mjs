import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../web/src/pages/casinoExit.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const exports={};vm.runInNewContext(compiled,{exports,Promise});
const {createCasinoExitController}=exports;
const never=()=>new Promise(()=>{});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(overrides={}){
 const calls=[];
 const target=Object.fromEntries(['releaseDisplay','closeWallet','refreshWallet','navigate'].map(name=>[name,()=>{
  calls.push(name);return overrides[name]?.();
 }]));
 return {calls,exit:createCasinoExitController(target)};
}

const unhandled=[];
const onUnhandled=reason=>unhandled.push(reason);
process.on('unhandledRejection',onUnhandled);
try{
 // Neither wallet HTTP nor a native fullscreen promise may trap Back in a frame.
 const hung=fixture({releaseDisplay:never,closeWallet:never});
 assert.equal(hung.exit(),undefined);
 assert.deepEqual(hung.calls,['releaseDisplay','closeWallet','navigate'],'Navigation must happen synchronously even when both cleanup tasks hang');
 for(let i=0;i<20;i++)hung.exit();
 await flush();
 assert.deepEqual(hung.calls,['releaseDisplay','closeWallet','navigate'],'Repeated clicks must not resend collection or navigation');

 // Collection starts before navigation, while balance refresh waits for collection.
 const collection=deferred();
 const delayed=fixture({closeWallet:()=>collection.promise});
 delayed.exit();
 assert.deepEqual(delayed.calls,['releaseDisplay','closeWallet','navigate']);
 await flush();
 assert.equal(delayed.calls.includes('refreshWallet'),false,'Do not refresh a stale balance before collection settles');
 collection.resolve();await flush();
 assert.deepEqual(delayed.calls,['releaseDisplay','closeWallet','navigate','refreshWallet']);
 delayed.exit();await flush();
 assert.equal(delayed.calls.filter(x=>x==='navigate').length,1,'A late response must never navigate again');

 // A slow balance endpoint is also independent from the already completed exit.
 const slowRefresh=fixture({refreshWallet:never});
 slowRefresh.exit();
 assert.deepEqual(slowRefresh.calls,['releaseDisplay','closeWallet','navigate']);
 await flush();
 assert.deepEqual(slowRefresh.calls,['releaseDisplay','closeWallet','navigate','refreshWallet']);
 slowRefresh.exit();
 assert.equal(slowRefresh.calls.filter(x=>x==='navigate').length,1);

 // All cleanup failures are best effort, both synchronous throws and rejections.
 for(const asynchronous of [false,true]){
  const fail=()=>{if(asynchronous)return Promise.reject(new Error('offline'));throw new Error('offline');};
  const failed=fixture({releaseDisplay:fail,closeWallet:fail,refreshWallet:fail});
  failed.exit();
  assert.deepEqual(failed.calls,['releaseDisplay','closeWallet','navigate']);
  await flush();
  assert.deepEqual(failed.calls,['releaseDisplay','closeWallet','navigate','refreshWallet'],'A failed collection should still attempt a balance refresh');
  failed.exit();await flush();
  assert.equal(failed.calls.filter(x=>x==='navigate').length,1);
 }
 assert.deepEqual(unhandled,[],'Detached cleanup errors must not create unhandled rejections');
}finally{process.removeListener('unhandledRejection',onUnhandled);}
console.log('PASS casino Back: immediate navigation, one collection per exit, ordered balance refresh and safe failed/hanging cleanup');
