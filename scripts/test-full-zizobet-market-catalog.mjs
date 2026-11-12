import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {marketIsEnabled,nativeMarketPolicyKeys} from '../server/market-catalog.mjs';
import {refreshMarketCatalog,seedNativeMarketCatalog,assertMarketEnabled} from '../server/ledger/market-catalog-store.mjs';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';

assert.match(LEDGER_SQL,/create table if not exists app_supplemental_match_incident/i,
 'Supplemental incidents must be created on ledger boot even with STATS_PROVIDERS_ENABLED=false');
assert.match(LEDGER_SQL,/create table if not exists app_supplemental_match_snapshot/i);

const db=new PGlite(),database={query:(...args)=>db.query(...args)};
try{
 await db.exec(`create table app_provider_market_definition(
    provider_id text not null,scope text not null,native_market_id text not null,
    native_market_name text not null,definition jsonb not null,
    primary key(provider_id,scope,native_market_id));`);
 await refreshMarketCatalog({initialize:true,database});
 await db.query(`insert into app_provider_market_definition
   (provider_id,scope,native_market_id,native_market_name,definition)
   values ('ZIZOBET','LIVE','800','Total Corners','{}'::jsonb),
          ('ZIZOBET','PREMATCH','448','Match result','{}'::jsonb),
          ('ZIZOBET','PREMATCH','800','Total Corners','{}'::jsonb)`);
 const list=await seedNativeMarketCatalog({database});
 const keys=['zizobet:live:800','zizobet:prematch:448','zizobet:prematch:800'];
 for(const key of keys)assert.ok(list.find(row=>row.key===key),'Dictionary market missing: '+key);
 const quoted={market_key:'zz800@e30',market_name:'Total Corners'};
 const live={service:'LIVE'},prematch={service:'PREMATCH'};
 assert.deepEqual(nativeMarketPolicyKeys(quoted,live),['zizobet:live:800']);
 assert.deepEqual(nativeMarketPolicyKeys(quoted,prematch),['zizobet:prematch:800']);
 await db.query("update app_market_catalog set enabled=false where key='zizobet:live:800'");
 await refreshMarketCatalog({database});
 assert.equal(marketIsEnabled(quoted,live),false,'Live native ID admin switch blocks this quote');
 assert.equal(marketIsEnabled(quoted,prematch),true,'Live switch does not block prematch scope');
 await assert.rejects(assertMarketEnabled(quoted,(...args)=>db.query(...args),live),
  error=>error?.code==='MARKET_NOT_OFFERED');
 await assertMarketEnabled(quoted,(...args)=>db.query(...args),prematch);
 await db.query("update app_market_catalog set enabled=false where key='zizobet:prematch:800'");
 await refreshMarketCatalog({database});
 assert.equal(marketIsEnabled(quoted,prematch),false,'Prematch native ID block applies');
}finally{await db.close();}
console.log('PASS complete native market catalog, LIVE/PREMATCH scoping, wager preflight and optional table migration');
