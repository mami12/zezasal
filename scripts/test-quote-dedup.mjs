import assert from 'node:assert/strict';
import {materialQuoteChange,mergeChangedFlags} from '../web/src/api/quote-dedup.mjs';
const original={price:2.25,validUntil:1794140000000,
 suspended:false,quoteSuspended:false};
assert.equal(materialQuoteChange(undefined,original),true);
assert.equal(materialQuoteChange(original,{...original}),false,
 'Repeated identical quote does not need a React odds refresh');
assert.equal(materialQuoteChange(original,{...original,price:2.35}),true,
 'New price always refreshes the button');
assert.equal(materialQuoteChange(original,{...original,validUntil:original.validUntil+15000}),true,
 'Extended official quote validity must be preserved');
assert.equal(materialQuoteChange(original,{...original,suspended:true}),true,
 'Provider suspension cannot be dropped because the price is unchanged');
assert.equal(materialQuoteChange(original,{...original,quoteSuspended:true}),true,
 'Separate quote suspension remains a material change');
assert.equal(materialQuoteChange(original,{...original,validUntil:null}),true,
 'Missing expiry cannot be silently reused');
const before={a:true,b:false};
const same=mergeChangedFlags(before,{a:true});
assert.equal(same,before,'Unchanged suspension map preserves React object identity');
const update=mergeChangedFlags(before,{a:false});
assert.deepEqual(update,{a:false,b:false});
assert.notEqual(update,before,'A real suspension change creates a new state');
assert.equal(mergeChangedFlags(update,{}),update);
assert.equal(mergeChangedFlags(update,{c:true}).c,true);
console.log('PASS duplicate socket odds and locked-outcome state suppression with all freshness signals');
