import assert from 'node:assert/strict';
import { fetchRealFootball, loadCatalog } from '../server/upstream.mjs';
import { upsert, getSubscriptionIds, getMatches } from '../server/match-store.mjs';
const savedFetch=globalThis.fetch;
const countries=[{id:1,slug:'england',name:'England'},{id:2,slug:'italy',name:'Italy'},{id:3,slug:'world',name:'World'},{id:4,slug:'cyberfifa',name:'CyberFIFA'},{id:5,slug:'india',name:'India'}];
const definitions=[[10,1,'Premier League'],[11,1,'League Two'],[12,2,'Serie C. Group A'],[13,3,'National teams. Friendlies'],[14,3,'FIFA World Cup'],[15,3,'UEFA Youth League'],[16,4,'Premier League'],[17,5,'I-League. Division 3'],[18,2,'Coppa Italia'],[19,2,'Unknown Local League']];
const tournaments=definitions.map(([id,categoryId,name])=>({id,categoryId,name,sportId:18,category:countries.find(c=>c.id===categoryId)}));
const fixtures=tournaments.flatMap(t=>['LIVE','PREMATCH'].map((service,index)=>({id:t.id*10+index,sportId:18,sportTag:'football',categoryId:t.categoryId,tournamentId:t.id,startAt:Math.floor(Date.now()/1000)+(index?3600:-600),service,competitors:[{name:'Home United'},{name:'Away City'}]})));
const paths=[];
globalThis.fetch=async(url)=>{
  const endpoint=new URL(url).pathname.replace(/^\//,'');paths.push(endpoint);
  const items=endpoint==='sports/get-many'?[{sport:{id:18,tag:'football',sportType:'default'}}]
    :endpoint==='categories/get-many'?countries.map(category=>({category}))
    :endpoint==='tournaments/get-many'?tournaments.map(tournament=>({tournament}))
    :endpoint==='matches/get-many'?fixtures:null;
  assert.ok(items,endpoint);
  return {ok:true,json:async()=>({result:{items,hasMore:false}})};
};
try {
  const result=await fetchRealFootball();
  const allowed=[10,12,13,14,18].flatMap(id=>[id*10,id*10+1]).sort((a,b)=>a-b);
  assert.deepEqual(result.rows.map(row=>row.match_id).sort((a,b)=>a-b),allowed);
  assert.equal(result.complete,true);assert.equal(result.received,20);assert.equal(result.skipped,10);
  const catalog=await loadCatalog();assert.equal(catalog.competitionPolicy.get(11).allowed,false);
  assert.equal(catalog.competitionPolicy.get(12).tier,3);
  assert.equal(paths.filter(p=>p==='tournaments/get-many').length,1,'catalog policy cached');
  upsert(result.rows);
  const ids=getSubscriptionIds({liveLimit:200,prematchLimit:200});
  assert.deepEqual([...ids.live,...ids.prematch].sort((a,b)=>a-b),allowed,'excluded matches never enter ordinary odds subscriptions');
  assert.equal(getMatches({limit:2000}).length,10);
  console.log('PASS upstream catalog -> country/ID policy -> LIVE/PREMATCH rows -> match store -> odds subscription IDs; cups/friendlies retained and lower/youth/virtual/unknown absent');
} finally {globalThis.fetch=savedFetch;}
