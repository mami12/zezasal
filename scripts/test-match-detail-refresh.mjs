import assert from 'node:assert/strict';
import {createMatchDetailRefresh} from '../server/match-detail-refresh.mjs';

let time=1000000,focusCalls=0,boosts=0,subscribeCalls=0,release;
const pending=new Promise(resolve=>{release=resolve;});
const request=createMatchDetailRefresh({
  boost:()=>{boosts++;},provider:()=> 'zizobet',now:()=>time,
  focus:async()=>{focusCalls++;await pending;},
  cooldownMs:10000
});
assert.equal(request(8_000_000_001_234),undefined,'HTTP caller must not wait for upstream refresh');
await Promise.resolve();
assert.equal(focusCalls,1);
request(8_000_000_001_234);
await Promise.resolve();
assert.equal(focusCalls,1,'simultaneous detail requests share one focus');
release();
await new Promise(resolve=>setImmediate(resolve));
request(8_000_000_001_234);
await Promise.resolve();
assert.equal(focusCalls,1,'cooldown keeps 20s client and tracker reloads cheap');
time+=10001;
request(8_000_000_001_234);
await Promise.resolve();
assert.equal(focusCalls,2,'next refresh allowed when cooldown expires');
assert.equal(boosts,4,'each detail visit boosts match priority');
const other=createMatchDetailRefresh({provider:()=> 'legacy',boost:()=>{},subscribe:()=>{subscribeCalls++;}});
other(123);
assert.equal(subscribeCalls,1,'non-Zizobet path still subscribes without waiting');
const errors=[];
const fail=createMatchDetailRefresh({provider:()=> 'zizobet',
 focus:()=>Promise.reject(Error('offline')),onError:(e)=>errors.push(e.message)});
fail(789);
await new Promise(resolve=>setImmediate(resolve));
assert.deepEqual(errors,['offline'],'provider failure does not block HTTP request');
console.log('PASS nonblocking deduplicated focused market refresh');
