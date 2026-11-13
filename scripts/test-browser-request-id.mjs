import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createClientRequestId} from '../web/src/utils/clientRequestId.mjs';

const v4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
assert.match(createClientRequestId(webcrypto),v4);
const insecureMobileBrowser={
  getRandomValues(bytes){return webcrypto.getRandomValues(bytes);}
};
const keys=new Set();
for(let i=0;i<2000;i++){
 const id=createClientRequestId(insecureMobileBrowser);
 assert.match(id,v4);
 assert.equal(keys.has(id),false,'financial retry key must be unique');
 keys.add(id);
}
const chosen='9f32048d-f017-4f0e-a029-c79cc31016c3';
assert.equal(createClientRequestId({
 randomUUID(){return chosen;},
 getRandomValues(){throw new Error('randomUUID branch should win');}
}),chosen);
for(const input of [null,{}, {randomUUID:null,getRandomValues:null}]){
 assert.throws(()=>createClientRequestId(input),/cannot generate secure payment request IDs/);
}
assert.equal(keys.size,2000);
console.log('PASS secure payment UUID v4 on HTTP/mobile without randomUUID, 2000 distinct fallback IDs, and no weak Math.random fallback.');
