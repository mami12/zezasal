import assert from 'node:assert/strict';
import {nativeZizobetContractRow} from '../server/ledger/native-zizobet-contract.mjs';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';
const offer=(id,native,params,line='')=>({
 provider_id:'ZIZOBET',market_key:'zz'+id+'@'+Buffer.from(JSON.stringify(params)).toString('base64url'),
 native_market_id:String(id),native_market_name:native,native_parameters:params,
 market_name:'Përkthim që nuk përdoret për shlyerje',outcome_name:'Over',line
});
const home=offer(9001,'Total [total] Corners HomeTeam in 5 minutes interval [from]-[to]',
 {p1:16,p2:20},'0.5');
const resolved=nativeZizobetContractRow(home);
assert.equal(resolved.market_name,'Total 0.5 home team corners in minutes 16-20 (5-minute interval)');
assert.deepEqual(liveContract(resolved),{
 version:1,kind:'window-total',event:'corner',side:'home',from:16,to:20,
 choice:'over',threshold:0.5
});
assert.equal(home.market_name,'Përkthim që nuk përdoret për shlyerje','never mutate stored quote');
const race=offer(9002,'Which team wins race to X corners?',{},'7');
assert.equal(nativeZizobetContractRow(race).market_name,'Which team wins race to 7 corners');
const score=offer(18639,'Correct score [{score}]',{p3:'1:0'});
assert.equal(nativeZizobetContractRow(score).market_name,'Correct score rest of match (from 1:0)');
assert.throws(()=>nativeZizobetContractRow({...home,native_parameters:{p1:16,p2:21}}),
 e=>e.code==='MARKET_EVIDENCE_UNSUPPORTED');
assert.throws(()=>nativeZizobetContractRow({...home,line:'0.5',native_market_id:'9002'}),
 e=>e.code==='MARKET_EVIDENCE_UNSUPPORTED');
assert.throws(()=>nativeZizobetContractRow(offer(9001,'Total [total] Corners HomeTeam in 5 minutes interval [from]-[to]',{p1:16,p2:21},'0.5')),
 e=>e.code==='MARKET_EVIDENCE_UNSUPPORTED');
assert.equal(nativeZizobetContractRow({...home,provider_id:'OTHER'}).market_name,home.market_name);
console.log('PASS Zizobet quoted dynamic parameters and native settlement contract');
