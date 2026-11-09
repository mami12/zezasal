import assert from 'node:assert/strict';
import {probePublicProviders} from './probe-market-information-apis.mjs';

const requested=[];
const request=async (url,opts)=>{
 requested.push({url,method:opts.method,headerKeys:Object.keys(opts.headers??{})});
 assert.equal(opts.method,'GET');
 assert.ok(opts.signal);
 assert.equal(opts.headers.accept,'application/json');
 if(url.includes('live%2Fgames'))return new Response(JSON.stringify({data:[{id:1},{id:2}]}),
  {status:200,headers:{'Content-Type':'application/json'}});
 if(url.includes('prematch%2Fgames'))return new Response(JSON.stringify({data:[]}),
  {status:200,headers:{'Content-Type':'application/json'}});
 return new Response(JSON.stringify({data:{match:{id:'confirmed'},events:[]}}),
  {status:200,headers:{'Content-Type':'application/json'}});
};
const result=await probePublicProviders({request,aiscoreId:'abcde1234567'});
assert.equal(result.totalCalls,3,'One call to each public endpoint; no paid keys or rotation probes');
assert.equal(result.results.length,3);
assert.ok(result.results.every(x=>x.ok===true));
assert.equal(result.results[0].count,2);
assert.ok(result.results.every(x=>x.settlementProof===false));
assert.equal(requested.length,3);
assert.ok(requested.every(x=>x.headerKeys.join(',')==='accept'));
assert.ok(requested.every(x=>!x.url.includes('key=secret')));
await assert.rejects(probePublicProviders({request,aiscoreId:'invalid/host'}),/Invalid AiScore/);
const errors=await probePublicProviders({request:async(url)=>new Response('forbidden',{status:403})});
assert.deepEqual(errors.results.map(x=>x.reason),['HTTP_ERROR','HTTP_ERROR']);
const broken=await probePublicProviders({request:async()=>new Response('non-json',{status:200})});
assert.deepEqual(broken.results.map(x=>x.reason),['NOT_JSON','NOT_JSON']);
const giant=await probePublicProviders({
 request:async()=>new Response('A'.repeat(3001),{status:200}),
 maxBytes:3000
});
assert.ok(giant.results.every(x=>x.reason==='RESPONSE_TOO_LARGE'));
console.log('PASS bounded, allowlisted, no-auth, read-only GET diagnostics with invalid and huge responses');
