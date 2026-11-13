import assert from 'node:assert/strict';import{mkdtemp,mkdir,rm}from'node:fs/promises';import{resolve,join}from'node:path';import{spawnSync}from'node:child_process';import express from'express';
const parent=resolve('tmp');await mkdir(parent,{recursive:true});const temp=await mkdtemp(join(parent,'board-settings-'));
Object.assign(process.env,{DB_DRIVER:'local',LOCAL_DATABASE_DIR:join(temp,'database'),DATABASE_URL:'',JWT_SECRET:'isolated-board-settings-test-secret',SEED_DEFAULT_ACCOUNTS:'false',MATCH_STORE:'memory',ODDS_STORE:'memory'});
const {pool,initSchema,getMatches:getDatabaseMatches,upsertMatches}=await import('../server/db.mjs');
const ledger=await import('../server/ledger/store.mjs');const{signToken,hashPassword}=await import('../server/ledger/auth.mjs');const{ledgerRouter}=await import('../server/ledger/routes.mjs');
const {refreshBoardSettings,filterPublishedRows}=await import('../server/ledger/board-settings-store.mjs');const{setBoardSettings,boardSettings}=await import('../server/board-settings.mjs');const store=await import('../server/match-store.mjs');
let server,ended=false;
try{
 await initSchema();await ledger.initLedgerSchema();
 const make=(username,role)=>ledger.createUser({username,role,balance:0,passwordHash:hashPassword('fixture-password')});
 const admin=await make('board-admin','ADMIN'),actors=await Promise.all(['AGENT','MANAGER','PLAYER'].map(role=>make('board-'+role.toLowerCase(),role)));
 const app=express();app.use(express.json(),ledgerRouter);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=async(method,path,actor,body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{...(actor?{authorization:`Bearer ${signToken(actor)}`} :{}),'content-type':'application/json'},...(body&&method!=='GET'?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json(),cache:r.headers.get('cache-control')};};
 const endpoint='/admin/board-settings';assert.equal((await call('GET',endpoint)).status,401);
 for(const actor of actors)for(const method of ['GET','PUT'])assert.equal((await call(method,endpoint,actor,{settings:{prematchLimit:1}})).status,403);
 const initial=await call('GET',endpoint,admin);assert.equal(initial.status,200);assert.equal(initial.body.settings.prematchLimit,0);
 for(const settings of [{prematchLimit:'2'},{prematchLimit:-1},{prematchLimit:1.5},{prematchLimit:10001},{prematchLimit:2,liveLimit:1},{}])assert.equal((await call('PUT',endpoint,admin,{settings})).status,400);
 const fixture=(id,country,name,service='PREMATCH')=>({match_id:id,home:'Home'+id,away:'Away',category_slug:country,category_name:country,tournament_id:id,tournament_name:name,sport_id:18,service,active:true,start_at:new Date(Date.now()+86400000),raw:{}});
 const rows=[fixture(1,'england','League Two'),fixture(2,'sweden','Superettan'),fixture(3,'england','Premier League'),fixture(4,'italy','Serie A'),fixture(5,'england','Championship','LIVE')];store.upsert(rows);
 const saved=await call('PUT',endpoint,admin,{settings:{prematchLimit:1}});assert.equal(saved.status,200);assert.equal(saved.body.summary.protectedExceedsLimit,false);
 const all=await call('GET','/matches?view=board&limit=1&catalog=true&includeEnded=true');assert.equal(all.status,200);assert.match(all.cache,/no-store/);assert.deepEqual(all.body.map(m=>m.id).sort(),['3','5']);
 assert.equal(all.body.find(m=>m.id==='3').protectedPrematch,true);assert.ok(all.body.find(m=>m.id==='3').listingPriority<100);
 const q=await call('GET','/matches?q=Home1');assert.deepEqual(q.body.map(m=>m.id),[],'search cannot bypass the admin limit');
 assert.deepEqual((await call('GET','/matches?status=PREMATCH&categoryId=sweden')).body.map(m=>m.id),[]);
 assert.deepEqual((await call('GET','/sports/18/matches?limit=10000')).body.map(m=>m.id).sort(),['3','5']);
 const tree=await call('GET','/sports');assert.equal(tree.body[0].categories.reduce((n,c)=>n+c.count,0),2);
 assert.equal((await call('GET','/matches/1')).status,200,'hidden fixture still reachable for existing tickets and detail');assert.equal(store.getMatches({catalog:true}).length,5,'no ingestion rows deleted');
 assert.equal(filterPublishedRows(rows,{q:'Home3'})[0].match_id,3);
 await pool.query("update app_user set status='FROZEN' where id=$1",[admin.id]);assert.equal((await call('PUT',endpoint,admin,{settings:{prematchLimit:0}})).status,403);assert.equal((await call('GET',endpoint,admin)).status,403);await pool.query("update app_user set status='ACTIVE' where id=$1",[admin.id]);
 assert.equal(Number((await pool.query("select count(*) n from app_admin_audit where action='UPDATE BOARD_SETTINGS'")).rows[0].n),1);
 const unlimited=await call('PUT',endpoint,admin,{settings:{prematchLimit:0}});assert.equal(unlimited.body.summary.visiblePrematch,4);assert.equal((await call('GET','/matches?view=board')).body.length,5);
 // The old array response remains untouched, even when legacy consumers
 // supply limit=. Progressive clients explicitly opt in with page=1.
 assert.equal(Array.isArray((await call('GET','/matches?view=board&limit=1')).body),true);
 const pages=await Promise.all([0,2,4].map(offset=>call('GET','/matches?view=board&page=1&limit=2&offset='+offset)));
 assert.ok(pages.every(result=>result.status===200));
 assert.equal(pages[0].body.total,5);
 assert.equal(pages[0].body.items.length,2);
 assert.equal(pages[0].body.nextOffset,2);
 assert.equal(pages[0].body.hasMore,true);
 assert.equal(pages[2].body.hasMore,false);
 const loaded=pages.flatMap(result=>result.body.items.map(item=>String(item.id)));
 assert.equal(new Set(loaded).size,5,'Every fixture is loaded once across all pages');
 assert.deepEqual([...loaded].sort(),['1','2','3','4','5']);
 const favorites=await call('GET','/matches?view=board&page=1&limit=2&offset=0&favoriteIds=3,5');
 assert.deepEqual(favorites.body.items.map(item=>item.id).sort(),['3','5']);
 assert.equal(favorites.body.hasMore,false);
 const searched=await call('GET','/matches?view=board&page=1&limit=2&offset=0&q=Home1');
 assert.deepEqual(searched.body.items.map(item=>item.id),['1']);
 const {detailProjection}=await import('../server/market-delivery.mjs');
 const offers=Array.from({length:7},(_,i)=>({
   extId:'zz-market-'+i,name:'Total Goals '+i,line:String(i),
   outcomes:[{key:'over',name:i===6?'Special player selection':'Over',price:2}],
 }));
 const fixtureDetail={id:'3',markets:offers};
 const firstMarkets=detailProjection(fixtureDetail,'all',{limit:3,offset:0});
 const nextMarkets=detailProjection(fixtureDetail,'all',{limit:3,offset:3});
 assert.equal(firstMarkets.marketPagination.total,7);
 assert.equal(firstMarkets.marketPagination.hasMore,true);
 assert.deepEqual([...firstMarkets.markets,...nextMarkets.markets].map(m=>m.extId),
   offers.slice(0,6).map(m=>m.extId),'The selected market contract survives across catalog pages');
 assert.equal(firstMarkets.marketCategories.all,7,'Category count remains full while page is partial');
 assert.equal(detailProjection(fixtureDetail,'Goals',{limit:3,offset:0}).marketPagination.total,7);
 const marketSearch=detailProjection(fixtureDetail,'all',{limit:3,offset:0,search:'special player'});
 assert.deepEqual(marketSearch.markets.map(m=>m.extId),['zz-market-6']);
 await call('PUT',endpoint,admin,{settings:{prematchLimit:1}});
 setBoardSettings({prematchLimit:0});await refreshBoardSettings();assert.equal(boardSettings().prematchLimit,1);
 // Verify the database-backed catalogue also bypasses the old pagination cap.
 await upsertMatches([{...fixture(901,'italy','Serie A'),is_hot:false,is_real:true,status:'prematch'}]);assert.equal((await getDatabaseMatches({catalog:true})).length,1);
 await pool.query("insert into matches(match_id,sport_id,home,away,service,status,start_at) select 10000+n,18,'Home','Away','PREMATCH','prematch',now()+interval '1 day' from generate_series(1,2001) n");
 assert.equal((await getDatabaseMatches({limit:2000})).length,2000);assert.equal((await getDatabaseMatches({catalog:true})).length,2002);
 server.closeAllConnections?.();await new Promise(r=>server.close(r));server=null;await pool.end();ended=true;
 const restart=spawnSync(process.execPath,['--input-type=module','-e',"const {pool}=await import('./server/db.mjs');const {refreshBoardSettings}=await import('./server/ledger/board-settings-store.mjs');const r=await refreshBoardSettings();if(r.settings.prematchLimit!==1)throw Error('Settings lost after restart');console.log('persistent');await pool.end();"],{cwd:resolve('.'),env:process.env,encoding:'utf8',timeout:60000});assert.equal(restart.status,0,restart.stderr);assert.match(restart.stdout,/persistent/);
 console.log('PASS board API/PGlite: ADMIN-only, frozen denial, strict input, audit, persisted restart, canonical public lists/tree/search, no query bypass, preserved hidden fixture and feed facts');
}finally{if(server){server.closeAllConnections?.();await new Promise(r=>server.close(r));}if(!ended)await pool.end();store.clear();assert.ok(resolve(temp).startsWith(parent));await rm(temp,{recursive:true,force:true});}
