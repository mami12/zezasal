import assert from 'node:assert/strict';
import {emitScopedOdds} from '../server/market-delivery.mjs';

const markets=[
 {key:'1x2',name:'Full Time Result',line:'',outcomes:[{key:'1',price:2.0},{key:'2',price:3.0}]},
 {key:'corners',name:'Total Corners',line:'8.5',outcomes:[{key:'Over',price:1.8}]},
 {key:'cards',name:'Total Cards',line:'3.5',outcomes:[{key:'Over',price:2.0}]}
];
const payload={matchId:'101',home:'Home',away:'Away',markets};
const rooms=new Map(),sent=[],sockets=new Map();
const io={
 sockets:{adapter:{rooms},sockets},
 to(room){return {emit(event,body){sent.push({room,event,body});}}}
};
const emit=()=>emitScopedOdds(io,payload,new Set(['1x2|']));
emit();
assert.deepEqual(sent,[],'An unobserved match must not serialize or emit any odds');

rooms.set('feed:board:101',new Set(['board']));
emit();
assert.deepEqual(sent.map(x=>x.room),['feed:board:101']);
assert.equal(sent[0].body.markets.length,1);
assert.equal(sent[0].body.markets[0].key,'1x2');

sent.length=0;
rooms.set('feed:detail:101:Corners',new Set(['detail']));
emit();
assert.deepEqual(sent.map(x=>x.room),['feed:board:101','feed:detail:101:Corners']);
assert.equal(sent[1].body.markets[0].key,'corners');

sent.length=0;
rooms.delete('feed:board:101');
rooms.delete('feed:detail:101:Corners');
rooms.set('feed:slip:101',new Set(['slip']));
sockets.set('slip',{data:{feedScope:{selectionIds:['101|corners|8.5|Over']}},emit(event,body){sent.push({room:'slip',event,body});}});
emit();
assert.deepEqual(sent.map(x=>x.room),['slip']);
assert.equal(sent[0].body.markets.length,1);
assert.equal(sent[0].body.markets[0].outcomes.length,1);
assert.equal(sent[0].body.markets[0].outcomes[0].key,'Over');

sent.length=0;
rooms.clear();
emit();
assert.deepEqual(sent,[],'Market feed stops work as soon as last socket leaves');
console.log('PASS odds broadcast avoids inactive board/detail/slip rooms while preserving active prices');
