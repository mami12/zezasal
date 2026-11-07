import assert from 'node:assert/strict';
import { fetchMatchPages } from '../server/match-pages.mjs';
const requests = [];
const result = await fetchMatchPages(async page => {
  requests.push(page);
  return { items: page.offset === 0 ? [{id:1,service:'PREMATCH'},{id:2,service:'LIVE'}]
    : page.offset === 2 ? [{id:1,service:'LIVE'},{id:3,service:'LIVE'}] : [{id:4,service:'PREMATCH'}] };
}, { pageSize: 2 });
assert.deepEqual(requests.map(request=>request.offset), [0,2,4]);
assert.deepEqual(result.items.map(item=>item.id), [1,2,3,4]);
assert.equal(result.items[0].service, 'LIVE'); assert.equal(result.complete,true);
const ignored = await fetchMatchPages(async () => ({ items: [{id:1},{id:2}] }), {pageSize:2});
assert.equal(ignored.complete,false); assert.equal(ignored.items.length,2);
await assert.rejects(fetchMatchPages(async ({offset}) => {if(offset)throw new Error('Unavailable second page');return {items:[{id:1},{id:2}]};},{pageSize:2}), /Unavailable second page/);
assert.equal((await fetchMatchPages(async()=>({items:[]}))).complete,true);
const cappedOffsets = [];
const capped = await fetchMatchPages(async ({offset}) => {
  cappedOffsets.push(offset);
  return {items:[{id:offset+1}],hasMore:offset<2};
},{pageSize:1000});
assert.deepEqual(cappedOffsets,[0,1,2], 'an explicit next page overrides a short server-capped page');
assert.deepEqual(capped.items.map(item=>item.id),[1,2,3]); assert.equal(capped.complete,true);
console.log('PASS complete upstream pagination: overlapping pages, LIVE preference, offset loops bounded and failed pages cannot silently replace the prior snapshot');
