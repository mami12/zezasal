import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {oddsOf} from '../server/zizobet/normalize.mjs';
import {normalizeProviderOffer,persistProviderOffers,createProviderOfferArchive,persistProviderMarketDefinitions} from '../server/ledger/provider-offer-archive.mjs';

const rawDefs=new Map([
 [81,{Name:'Next Goal 1st'}],[82,{Name:'Next Goal 2nd'}],
 [83,{Name:'Goal at minute 10'}],[84,{Name:'Goal in minute 23'}],
 [85,{Name:'Anytime Goalscorer'}],[86,{Name:'Future provider market that has no settlement logic'}]
]);
const meta={liveMarkets:rawDefs,preMarkets:new Map(),positions:new Map([
 ['home','1'],['away','2'],['yes','Yes']])};
const quotes=[
 {mid:81,id:100,pid:'home',v:2.12,seq:1},
 {mid:82,id:101,pid:'away',v:2.8,seq:2},
 {mid:83,id:102,pid:'yes',v:1.75},
 {mid:84,id:103,pid:'yes',v:3.15},
 {mid:85,id:104,pid:'yes',v:2.4,pl:'Alpha Forward'},
 {mid:86,id:105,pid:'yes',v:8.6}
];
const rows=oddsOf({match_id:800000071223},quotes,meta,true);
assert.equal(rows.length,6,'No normalized provider offer silently discarded');
assert.deepEqual(rows.slice(0,2).map(q=>q.marketName),['Next Goal 1st','Next Goal 2nd']);
assert.deepEqual(rows.slice(0,2).map(q=>q.nativeMarketName),['Next Goal 1st','Next Goal 2nd']);
const normalized=rows.map(normalizeProviderOffer);
assert.deepEqual(normalized.slice(0,2).map(q=>q.contract_hint?.target),[1,2]);
assert.deepEqual(normalized.slice(2,4).map(q=>[q.contract_hint?.kind,q.contract_hint?.from,q.contract_hint?.to]),
 [['window',10,10],['window',23,23]],'Exact event minutes are separate, immutable contracts');
assert.equal(normalized[4].native_parameters.pl,'Alpha Forward');
assert.equal(normalized[5].contract_hint,null,
 'Complex unimplemented contracts are archived as evidence, never auto-approved for payment');
assert.equal(normalized[0].native_quote.v,2.12);

const db=new PGlite();
try{
 await db.exec(LEDGER_SQL);
 const execute=(sql,params=[])=>db.query(sql,params);
 const user=(await execute("insert into app_user(username,password_hash,balance) values('quote-archive','isolated',1000) returning id")).rows[0].id;

 const dictionary=[
  {provider:'ZIZOBET',scope:'LIVE',id:81,name:'Next Goal 1st',definition:{ID:81,Name:'Next Goal 1st'}},
  {provider:'ZIZOBET',scope:'LIVE',id:99330,name:'Hard player interval prop',
   definition:{ID:99330,Name:'Hard player interval prop',RequiredParams:['pl','p1','p2']}},
  {provider:'ZIZOBET',scope:'PREMATCH',id:99330,name:'Hard player interval prop',
   definition:{ID:99330,Name:'Hard player interval prop',pos:[{id:1,nm:'Yes'}]}}
 ];
 assert.deepEqual(await persistProviderMarketDefinitions(dictionary,{execute}),{seen:3,stored:3});
 assert.deepEqual(await persistProviderMarketDefinitions(dictionary,{execute}),{seen:3,stored:0});
 const notQuoted=(await execute(
  "select definition from app_provider_market_definition where native_market_id='99330' and scope='LIVE'"
 )).rows[0];
 assert.deepEqual(notQuoted.definition.RequiredParams,['pl','p1','p2'],
  'Store every original API market definition even if nobody opens its match');
 assert.deepEqual(await persistProviderMarketDefinitions(
  [{...dictionary[1],name:'Hard player interval prop (v2)',
    definition:{...dictionary[1].definition,Name:'Hard player interval prop (v2)'}}],{execute}
 ),{seen:1,stored:1},'Changed provider dictionary is recorded without deleting old quotes');

 const a=await persistProviderOffers(rows,{execute});
 assert.deepEqual(a,{seen:6,recorded:6});
 const current=(await execute('select * from app_provider_offer_current order by native_market_id::integer')).rows;
 assert.equal(current.length,6);
 assert.equal(current[0].market_name,'Next Goal 1st');
 assert.equal(current[1].market_name,'Next Goal 2nd');
 assert.equal(current[2].native_quote.v,1.75);
 assert.equal(current[3].contract_hint.from,23);
 assert.equal(current[5].contract_hint,null);
 assert.equal((await execute('select count(*)::integer as n from app_provider_offer_change')).rows[0].n,6);
 const duplicate=await persistProviderOffers(rows,{execute});
 assert.deepEqual(duplicate,{seen:6,recorded:0},
  'Repeated identical API polls do not create history duplicates or update rows');
 const updated={...rows[1],price:3.2};
 const change=await persistProviderOffers([updated],{execute});
 assert.equal(change.recorded,1);
 assert.equal(Number((await execute('select price from app_provider_offer_current where market_key=$1',[updated.marketKey])).rows[0].price),3.2);
 const suspended=await persistProviderOffers([{...updated,suspended:true}],{execute});
 assert.equal(suspended.recorded,1,'Suspended market is preserved, not silently deleted');
 assert.equal((await execute('select count(*)::integer as n from app_provider_offer_change')).rows[0].n,8);
 const history=(await execute('select price,suspended from app_provider_offer_change where market_key=$1 order by id',[updated.marketKey])).rows;
 assert.deepEqual(history.map(x=>[Number(x.price),x.suspended]),[[2.8,false],[3.2,false],[3.2,true]]);
 const restarted=await persistProviderOffers(rows,{execute});
 assert.equal(restarted.recorded,1,'Provider correction is retained as another change');
 let ready=false,failed=0,down=true;
 const archive=createProviderOfferArchive({
  ready:()=>ready,onError:()=>{failed++;},
  execute:async (...args)=>{if(down)throw Error('database connection lost');return execute(...args);}
 });
 const novel={...rows[0],price:4.25,nativeMarketName:'Next Goal {seq}',nativeQuote:{id:100,mid:81,seq:1,v:4.25}};
 archive.observe([novel]);assert.equal(archive.status().pending,0,'No writes before schema is ready');
 ready=true;archive.observe([novel]);await archive.flush();
 assert.equal(failed,1);assert.equal(archive.status().pending,1,'DB outage retains pending archive item');
 down=false;archive.observe([novel]);await archive.flush();
 assert.equal(archive.status().pending,0,'Next provider poll retries unarchived quotes');
 assert.equal(Number((await execute('select price from app_provider_offer_current where market_key=$1',[novel.marketKey])).rows[0].price),4.25);
 const queued=(await execute('select native_market_name,native_quote,native_parameters from app_provider_offer_current where market_key=$1',
  [novel.marketKey])).rows[0];
 assert.equal(queued.native_market_name,'Next Goal {seq}',
  'Asynchronous retry must not replace raw source name with its display label');
 assert.equal(queued.native_quote.seq,1,'Asynchronous retry retains the raw source quote');
 assert.equal(queued.native_parameters.seq,1,'Asynchronous retry retains native numbered market parameters');
 // Frequent unchanged MQTT/REST snapshots must not rerun every
 // provider contract regex, but price and suspension still create history.
 archive.observe([{...novel,updatedAt:'2026-11-08T13:31:00Z'}]);
 await archive.flush();
 assert.ok(archive.status().skippedUnchanged>0,
  'Identical price/contract/suspension snapshots skip re-normalization');
 const changedAgain={...novel,price:4.35,updatedAt:'2026-11-08T13:31:30Z'};
 archive.observe([changedAgain]);
 await archive.flush();
 assert.equal(Number((await execute('select price from app_provider_offer_current where market_key=$1',
  [novel.marketKey])).rows[0].price),4.35,
  'A genuine price update is never hidden by raw quote deduplication');
 assert.equal(Number((await execute('select balance from app_user where id=$1',[user])).rows[0].balance),1000,
  'Archiving odds cannot change wallet balances');
 console.log('PASS PostgreSQL provider-offer archive: original quote IDs, English market names, exact minutes, prices, suspended history, dedupe and retry');
}finally{await db.close();}
