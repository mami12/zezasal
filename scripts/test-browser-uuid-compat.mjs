import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {withBrowserUuidCompat,UUID_COMPAT_MARKER} from '../server/browser-uuid-compat.mjs';

const oldHtml='<html><head><title>Existing deployed bundle</title></head>'+
 '<body><script defer src="/app/assets/index-oldhash.js"></script></body></html>';
const injected=withBrowserUuidCompat(oldHtml);
assert.ok(injected.includes(UUID_COMPAT_MARKER));
assert.ok(injected.indexOf(UUID_COMPAT_MARKER)<injected.indexOf('index-oldhash.js'),
 'UUID bootstrap must run before even an old immutable JS bundle');
assert.equal(withBrowserUuidCompat(injected),injected,'No repeated injection');
assert.ok(withBrowserUuidCompat('<html>old bundle</html>').startsWith('<script '));
const snippet=injected.match(/<script data-uuid-compat="v2">([\s\S]*?)<\/script>/)?.[1];
assert.ok(snippet,'Expected synchronous compatibility script');

const uuidV4=/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const cryptoApi={getRandomValues(bytes){return webcrypto.getRandomValues(bytes);}};
const context={window:{crypto:cryptoApi},Uint8Array,Math:{random(){throw new Error('Do not use weak randomness');}}};
runInNewContext(snippet,context,{timeout:1000});
assert.equal(typeof cryptoApi.randomUUID,'function');
const ids=new Set();
for(let n=0;n<1000;n++){
 const id=runInNewContext('window.crypto.randomUUID()',context,{timeout:1000});
 assert.match(id,uuidV4);
 assert.ok(!ids.has(id),'Generated browser payment IDs must not collide');
 ids.add(id);
}
const preserved='d1b80544-4228-46ff-9662-480f5228a04c';
const native={randomUUID(){return preserved;},getRandomValues(){throw new Error('native branch');}};
runInNewContext(snippet,{window:{crypto:native},Uint8Array},{timeout:1000});
assert.equal(native.randomUUID(),preserved,'Existing native secure API must not be overridden');
const noEntropy={};
runInNewContext(snippet,{window:{crypto:noEntropy},Uint8Array},{timeout:1000});
assert.equal(noEntropy.randomUUID,undefined,'Do not create insecure payment IDs if entropy is unavailable');
console.log('PASS stale immutable browser bundle UUID: shim-before-old-JS, secure 1000 IDs, no weak fallback, native unchanged, one-time injection.');
