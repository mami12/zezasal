import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {marketFamily,marketIsEnabled,setCatalogRows,setCategoryPolicies,setScopeBlocks} from '../server/market-catalog.mjs';
import {detailProjection} from '../server/market-delivery.mjs';
import {projectBoardMatches} from '../server/ledger/board-projection.mjs';
import {refreshMarketCatalog,saveMarketPolicy} from '../server/ledger/market-catalog-store.mjs';

process.env.MARKET_DIAGNOSTIC_ALL='1';
const result={market_name:'Full Time Result',market_key:'result'};
const total={market_name:'Total Goals',market_key:'total-goals'};
const resultKey=marketFamily(result).key;
const totalKey=marketFamily(total).key;
const match={id:'101',category_name:'England',tournament_name:'Premier League',markets:[
  {name:'Full Time Result',key:'result',extId:'result',marketType:'1X2',outcomes:[{name:'Home',odds:2}]},
  {name:'Total Goals',key:'total-goals',extId:'total',marketType:'OVER_UNDER',outcomes:[{name:'Over',odds:2}]},
]};

setScopeBlocks([]);
setCatalogRows([{key:resultKey,name:'Full Time Result',enabled:false},{key:totalKey,name:'Total Goals',enabled:true}]);
assert.equal(marketIsEnabled(result),false,'diagnostic mode must not override an admin-hidden market');
assert.equal(projectBoardMatches([match])[0].markets.some(m=>m.name==='Full Time Result'),false,'hidden market is absent from projected board');
assert.equal(detailProjection(match).markets.some(m=>m.name==='Full Time Result'),false,'hidden market is absent from detail/feed delivery');

setCatalogRows([{key:resultKey,name:'Full Time Result',enabled:true},{key:totalKey,name:'Total Goals',enabled:true}]);
setCategoryPolicies([{category:'totals',enabled:false}]);
assert.equal(marketIsEnabled(total),false,'diagnostic mode must not override an admin-hidden category');
assert.equal(detailProjection(match).markets.some(m=>m.name==='Total Goals'),false,'category-hidden market is absent from detail/feed delivery');

setCategoryPolicies([]);
setScopeBlocks([{country:'England',league:'Premier League',families:[totalKey],categories:[]}]);
assert.equal(detailProjection(match).markets.some(m=>m.name==='Total Goals'),false,'flat backend match metadata obeys scope policy');
assert.equal(detailProjection({...match,category_name:'Japan',tournament_name:'J1 League'}).markets.length,2,'unselected countries keep their markets');
assert.equal(detailProjection({...match,category_name:undefined,tournament_name:undefined,tournament:{name:'Premier League',category:{name:'England'}}}).markets.length,1,'client snapshot metadata obeys the same scope');
setScopeBlocks([]);

const db=new PGlite();
const database={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
try{
  await db.exec(`create table app_user(id text primary key,username text,role text,status text,deleted_at timestamptz);
    create table app_live_risk_settings(id integer primary key);
    create table app_admin_audit(actor_id text,actor_name text,actor_role text,action text,target_type text,target_id text,details jsonb);
    insert into app_user values('admin-1','admin','ADMIN','ACTIVE',null);
    insert into app_live_risk_settings values(1);`);
  await refreshMarketCatalog({initialize:true,database});
  const saved=await saveMarketPolicy({key:resultKey,enabled:false},{id:'admin-1',username:'admin'},{database});
  assert.equal(saved.find(row=>row.key===resultKey)?.enabled,false,'admin hide is persisted and reflected in the catalog');
  assert.equal(projectBoardMatches([match])[0].markets.some(m=>m.name==='Full Time Result'),false,'persisted admin hide removes the board market');
  assert.equal((await db.query("select count(*)::int as count from app_admin_audit where action='UPDATE MARKET_POLICY'")).rows[0].count,1,'admin action is audited');
}finally{
  await db.close();
}
console.log('PASS admin-hidden markets and categories stay hidden in diagnostic mode across admin save, board and feed projections');
