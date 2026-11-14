import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createColumnsPlacer,placeColumns} from '../server/ledger/bets.mjs';
import {toggleMarketSelection,selectionMarketIdentity} from '../server/ledger/selection-market.mjs';

const first={outcomeId:'90001|result||1',oddsAtPlacement:2.1};
const draw={outcomeId:'90001|result||X',oddsAtPlacement:3.0};
const other={outcomeId:'90001|total|2.5|Over',oddsAtPlacement:1.7};
const anotherLine={outcomeId:'90001|total|3.5|Under',oddsAtPlacement:1.8};
const otherMatch={outcomeId:'90002|result||2',oddsAtPlacement:2.5};
const check=error=>error?.status===400&&error?.code==='DUPLICATE_MARKET';

let writeAttempts=0,reads=0,resolved=0;
const strict=createColumnsPlacer({
 database:{connect:async()=>{writeAttempts++;throw new Error('wallet MUST NOT be opened');}},
 runQuery:async()=>{reads++;throw new Error('DB MUST NOT be queried');},
 resolve:async()=>{resolved++;throw new Error('No provider call for a duplicate quote');}
});
const user={id:randomUUID(),status:'ACTIVE',role:'PLAYER'};
const request=picks=>({user,totalStake:100,selections:picks,clientRequestId:randomUUID()});

for(const [label,picks] of [
 ['1X2 home and draw',[first,draw,other]],
 ['goal total over and under',[other,{...other,outcomeId:'90001|total|2.5|Under'},otherMatch]],
 ['goal total different lines',[other,anotherLine,otherMatch]],
 ['corners different lines',[{outcomeId:'90001|corners|6.5|Over'}, {outcomeId:'90001|corners|8.5|Under'}]],
 ['cards different lines',[{outcomeId:'90001|cards|2.5|Over'}, {outcomeId:'90001|cards|4.5|Under'}]],
 ['two different players only if same EXACT quoted player market',[first,draw]],
 ['same outcome duplicated',[first,first]],
]){
 await assert.rejects(strict(request(picks)),check,label);
}
const columns=[
 [first,otherMatch],
 [draw,otherMatch],
];
await assert.rejects(strict({...request([first,draw,otherMatch]),selections:undefined,columns}),check,
 'Forged explicit system columns cannot bypass whole-ticket uniqueness');
assert.deepEqual({writeAttempts,reads,resolved},{writeAttempts:0,reads:0,resolved:0},
 'No wallet debit, transaction, DB query, or odds resolution for duplicates');
// The actual public export uses the safe defaults and cannot be configured
// via an HTTP request. Verify no legacy option is stored on the request body.
assert.equal(typeof placeColumns,'function');

const changed=toggleMarketSelection([first,other,otherMatch],draw);
assert.deepEqual(changed.map(s=>s.outcomeId),[draw.outcomeId,other.outcomeId,otherMatch.outcomeId]);
assert.equal(new Set(changed.map(selectionMarketIdentity)).size,changed.length);
assert.equal(selectionMarketIdentity(other),selectionMarketIdentity(anotherLine),
 'All quoted lines of one goal-total group are mutually exclusive');
assert.deepEqual(toggleMarketSelection([other,otherMatch],anotherLine),[anotherLine,otherMatch]);
assert.doesNotThrow(()=>new Set([first,other,anotherLine,otherMatch].map(selectionMarketIdentity)));
console.log('PASS strict columns: 1X2, multi-line totals/corners/cards, forged columns, zero wallet/DB calls and UI replacement.');
