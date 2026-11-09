import assert from 'node:assert/strict';
import {TEST_STAKE_LEK,detailOffers,nativeOffers,collectOfferUniverse,
 categorizeAttempt,exerciseFixture,createClient} from './bulk-market-bet-test.mjs';

assert.equal(TEST_STAKE_LEK,100);
const fixture={id:'1001',status:'LIVE',homeTeam:'CS Herediano',
 awayTeam:'Inter San Carlos',markets:[
 {id:'1001|zz777||',extId:'zz777',name:'Who scores goal 1 in minutes 56-60 (5-minute interval)',
  status:'ACTIVE',line:'',period:0,outcomes:[
  {id:'1001|zz777||1',code:'1',name:'1',odds:9,status:'ACTIVE'},
  {id:'1001|zz777||2',code:'2',name:'2',odds:4,status:'ACTIVE'},
  {id:'1001|zz777||none',code:'none',name:'No goal',odds:1.12,status:'ACTIVE'}]},
 {id:'1001|zz800||',extId:'zz800',name:'Total Corners',status:'ACTIVE',outcomes:[
  {id:'1001|zz800||over',code:'over',name:'Over',odds:1.7,status:'SUSPENDED'}]},
 {id:'1001|zz810||',extId:'zz810',name:'Total Yellow Cards',status:'ACTIVE',outcomes:[
  {id:'1001|zz810||under',code:'under',name:'Under',odds:3,status:'ACTIVE'}]}
 ]};
const live=detailOffers(fixture);
assert.equal(live.length,5);
assert.equal(live[0].outcomeId,'1001|zz777||1');
const raw=nativeOffers('1001',[
 {market_key:'zz777',line:'',outcome_key:'1',market_name:fixture.markets[0].name,
  outcome_name:'1',period:0,price:8,suspended:false},
 {market_key:'zz999',line:'',outcome_key:'other',market_name:'Hidden provider market',
  outcome_name:'Other',period:0,price:7,suspended:false}
]);
const universe=collectOfferUniverse(live,raw);
assert.equal(universe.length,6,'Native/HTTP duplicates count only once');
assert.equal(universe.find(x=>x.outcomeId==='1001|zz777||1').price,9,
 'HTTP quote wins over DB archive');
assert.equal(universe.find(x=>x.outcomeId==='1001|zz777||1').source,'detail+db');
assert.equal(categorizeAttempt(universe.find(x=>x.selection==='Over')).status,'UNAVAILABLE');

let called=0;
const dry=await exerciseFixture({
 type:'live',matchId:'1001',fetchDetail:async()=>fixture,loadNative:async()=>raw,
 place:async()=>{called++;throw Error('Dry run placed real bet!');}
});
assert.equal(called,0,'Dry run may never send any POST');
assert.equal(dry.captured,6);
assert.equal(dry.eligible,5);
assert.equal(dry.expectedTotalStake,500);
assert.equal(dry.counts.DRY_RUN,5);
assert.equal(dry.counts.UNAVAILABLE,1);

const sent=[],logs=[],placed=await exerciseFixture({
 type:'live',matchId:1001,fetchDetail:async()=>fixture,loadNative:async()=>raw,
 execute:true,onAttempt:async(row)=>logs.push(row),
 uuid:()=>('00000000-0000-4000-8000-'+String(sent.length+1).padStart(12,'0')),
 place:async request=>{
  sent.push(request);
  const id=request.selections[0].outcomeId;
  if(id.includes('zz999'))throw Object.assign(new Error('MARKET_NOT_OFFERED'),{httpStatus:422});
  return {id:'ticket-'+sent.length,totalOdds:request.selections[0].odds};
 }
});
assert.equal(sent.length,5,'One SINGLE ticket per available outcome, no market combinations');
assert.ok(sent.every(req=>req.stake===100&&req.ticketType==='SINGLE'&&
 req.selections.length===1&&req.clientRequestId),'Every request is idempotent and 100 LEK');
assert.equal(placed.counts.ACCEPTED,4);
assert.equal(placed.counts.REJECTED,1);
assert.equal(logs.filter(x=>x.status==='SENDING').length,5,
 'Persist request ID BEFORE sending real-money POST');
assert.equal(logs.filter(x=>x.status==='ACCEPTED').length,4);
assert.equal(placed.results.find(x=>x.market==='Hidden provider market').reason,
 'MARKET_NOT_OFFERED');
assert.equal(placed.results.find(x=>x.selection==='Over').status,'UNAVAILABLE');

let oneAttempt=0;
const uncertain=await exerciseFixture({type:'live',matchId:1001,
 fetchDetail:async()=>fixture,execute:true,
 place:async()=>{oneAttempt++;throw Error('TCP lost after POST');}
});
assert.equal(oneAttempt,1,'Ambiguous network response immediately stops real wagers');
assert.equal(uncertain.counts.UNCERTAIN,1);
assert.equal(uncertain.counts.NOT_TESTED,3);
assert.ok(uncertain.results.some(row=>row.reason==='STOPPED_AFTER_UNCERTAIN_NETWORK_OR_SERVER_RESULT'));

await assert.rejects(exerciseFixture({type:'prematch',matchId:1001,
 fetchDetail:async()=>fixture}),/MATCH_STATUS_MISMATCH/);
await assert.rejects(createClient({baseUrl:'http://outside.example:8123'}),
 /Require HTTPS/,'Never leak credentials over remote plain HTTP');

const http=[];
const client=await createClient({baseUrl:'http://127.0.0.1:3000',username:'testing',
 password:'not-logged',request:async(url,opts)=>{
  http.push({path:url.pathname,method:opts.method,headers:opts.headers,body:opts.body});
  if(url.pathname.endsWith('auth/login'))
   return new Response(JSON.stringify({token:'private-fixture-token'}),{status:200});
  if(url.pathname.endsWith('bets/place'))
   return new Response(JSON.stringify({message:'MARKET_EVIDENCE_UNSUPPORTED',code:'MARKET_EVIDENCE_UNSUPPORTED'}),{status:422});
  return new Response(JSON.stringify(fixture),{status:200});
 }});
assert.equal(client.loggedIn,true);
assert.equal((await client.fetchDetail(1001)).id,'1001');
await assert.rejects(client.place({stake:100}),err=>
 err.httpStatus===422&&err.code==='MARKET_EVIDENCE_UNSUPPORTED');
assert.equal(http[0].body,JSON.stringify({username:'testing',password:'not-logged'}));
assert.equal(http[1].headers.authorization,'Bearer private-fixture-token');
assert.equal(http[2].headers.authorization,'Bearer private-fixture-token');
console.log('PASS 100 LEK each quote; API+DB full offer audit, dry-run no POST, separate receipts/refusals, no auto-retry after ambiguous debit, and HTTPS auth');
