import {pool,query} from '../db.mjs';
import {catalogRows,setCatalogRows,marketFamily,nativeMarketPolicyKeys,marketCategories,MARKET_CATEGORY_IDS,setCategoryPolicies,categoryPolicies,setScopeBlocks,scopeBlockRows,marketScopeBlocked} from '../market-catalog.mjs';
const listeners=new Set();export const onMarketPolicy=fn=>listeners.add(fn);
let flight,saving=0;
/** The provider dictionary contains markets not quoted by the board yet.
 * Import native LIVE/PREMATCH IDs into the admin's persisted market catalog,
 * so every quoted offer can later be enabled/disabled by that native identity.
 */
export async function seedNativeMarketCatalog({database=pool}={}){
 await database.query(`insert into app_market_catalog(key,name)
   select 'zizobet:'||lower(scope)||':'||native_market_id,
          '['||scope||'] '||native_market_name
     from app_provider_market_definition
    where provider_id='ZIZOBET' and scope in ('LIVE','PREMATCH')
      and native_market_name is not null and trim(native_market_name)<>''
    on conflict(key) do nothing`);
 return refreshMarketCatalog({database});
}
const invalid=(message,status=400)=>Object.assign(new Error(message),{status});
const changed=()=>{for(const fn of listeners)fn();};
export async function refreshMarketCatalog({initialize=false,database=pool}={}){
 if(saving&&!initialize)return catalogRows();
 if(initialize){
  await database.query(`create table if not exists app_market_catalog(key text primary key,name text not null,enabled boolean not null default true,updated_at timestamptz not null default now())`);
  await database.query('alter table app_market_catalog add column if not exists sort_order integer not null default 1000000');
  await database.query(`create table if not exists app_market_category_policy(category text primary key,enabled boolean not null default true,updated_at timestamptz not null default now())`);
  await database.query(`create table if not exists app_market_scope_policy(id serial primary key,country text not null default '',league text not null default '',categories text[] not null default '{}',families text[] not null default '{}',updated_at timestamptz not null default now())`);
 }
 if(flight)return flight;
 flight=(async()=>{
  const local=catalogRows();
  if(local.length)await database.query(`insert into app_market_catalog(key,name) select key,name from jsonb_to_recordset($1::jsonb) as x(key text,name text) on conflict(key) do nothing`,[JSON.stringify(local)]);
  const before=JSON.stringify({markets:catalogRows(),categories:categoryPolicies(),scopes:scopeBlockRows()});
  const r=await database.query('select key,name,enabled,sort_order from app_market_catalog');
  const policies=await database.query('select category,enabled from app_market_category_policy');
  const scopes=await database.query('select country,league,categories,families from app_market_scope_policy').catch(()=>({rows:[]}));
  setCatalogRows(r.rows);setCategoryPolicies(policies.rows);setScopeBlocks(scopes.rows);
  if(before!==JSON.stringify({markets:catalogRows(),categories:categoryPolicies(),scopes:scopeBlockRows()}))changed();
  return catalogRows();
 })();
 try{return await flight;}finally{flight=null;}
}
// Used during NEW wager validation only. Historical settlement keeps its saved contract.
export async function assertMarketEnabled(m,executor=query,match){
 const f=marketFamily(m);if(!f)return;
 // One database round-trip per validation instead of three, while keeping
 // all policy reads on the supplied transaction connection.
 const policy=await executor(`select
   exists(select 1 from app_market_catalog where key=any($1::text[]) and enabled=false) as market_disabled,
   exists(select 1 from app_market_category_policy where enabled=false and category=any($2::text[])) as category_disabled,
   case when $3::boolean then
     (select coalesce(jsonb_agg(jsonb_build_object('country',country,'league',league,'categories',categories,'families',families)),'[]'::jsonb) from app_market_scope_policy)
   else '[]'::jsonb end as scopes`,[[f.key,...nativeMarketPolicyKeys(m,match)],marketCategories(f.name),Boolean(match)]);
 const state=policy.rows[0]??{};
 const scopeDenied=Boolean(match)&&marketScopeBlocked(m,match,state.scopes??[]);
 if(state.market_disabled||state.category_disabled||scopeDenied)throw Object.assign(new Error('Ky treg nuk ofrohet.'),{status:400,code:'MARKET_NOT_OFFERED'});
}
export async function saveMarketPolicy(input,actor,{database=pool}={}){
 const {key,keys,category,enabled,position}=input??{};
 const modes=[category!=null,keys!=null,key!=null].filter(Boolean).length;
 if(modes!==1)throw invalid('Zgjidh tregjet ose kategorinë që do të ndryshosh.');
 if(position!=null&&(key==null||!Number.isInteger(position)||position<1))throw invalid('Pozicion i pavlefshëm.');
 if(position==null&&typeof enabled!=='boolean')throw invalid('Gjendje e pavlefshme.');
 if(key!=null&&(typeof key!=='string'||!key.trim()))throw invalid('Treg i pavlefshëm.');
 if(keys!=null&&(!Array.isArray(keys)||!keys.length||keys.length>10000||keys.some(k=>typeof k!=='string'||!k.trim())))throw invalid('Përzgjedhje e pavlefshme.');
 if(category!=null&&category!=='all'&&!MARKET_CATEGORY_IDS.includes(category))throw invalid('Kategori e pavlefshme.');
 saving++;let c;
 try{
  await flight;c=await database.connect();await c.query('begin');
  const user=(await c.query('select role,status,deleted_at from app_user where id=$1 for share',[actor.id])).rows[0];
  if(user?.role!=='ADMIN'||user.status!=='ACTIVE'||user.deleted_at)throw invalid('Vetëm administratori aktiv.',403);
  // Wager revalidation takes this same lock before its wallet write.
  await c.query('select id from app_live_risk_settings where id=1 for update');
  const all=(await c.query('select key,name,sort_order from app_market_catalog for update')).rows.sort((a,b)=>a.sort_order-b.sort_order||a.name.localeCompare(b.name));
  let affected=[];
  if(position!=null){
   const ordered=all.map(r=>r.key),index=ordered.indexOf(key);
   if(index<0||position>ordered.length)throw invalid('Pozicion i pavlefshëm.');
   ordered.splice(index,1);ordered.splice(position-1,0,key);
   await c.query('update app_market_catalog m set sort_order=x.rank,updated_at=now() from jsonb_to_recordset($1::jsonb) as x(key text,rank integer) where m.key=x.key',[JSON.stringify(ordered.map((key,i)=>({key,rank:i+1})))]);
   affected=[key];
  }else{
   if(category!=null){
    const categories=category==='all'?MARKET_CATEGORY_IDS:[category];
    await c.query(`insert into app_market_category_policy(category,enabled) select category,$2 from unnest($1::text[]) as x(category) on conflict(category) do update set enabled=excluded.enabled,updated_at=now()`,[categories,enabled]);
    affected=all.filter(r=>marketCategories(r.name).some(c=>categories.includes(c))).map(r=>r.key);
   }else{
    affected=[...new Set(keys??[key])];
    const known=new Set(all.map(r=>r.key));
    if(affected.some(k=>!known.has(k)))throw invalid('Një treg nuk u gjet. Rifresko listën dhe provo përsëri.',404);
   }
   if(affected.length)await c.query('update app_market_catalog set enabled=$2,updated_at=now() where key=any($1::text[])',[affected,enabled]);
  }
  await c.query(`insert into app_admin_audit(actor_id,actor_name,actor_role,action,target_type,target_id,details) values($1,$2,'ADMIN','UPDATE MARKET_POLICY','market',$3,$4::jsonb)`,[actor.id,actor.username,category?`category:${category}`:key??'bulk',JSON.stringify({enabled,position,category,keys:affected})]);
  const snapshot=await c.query('select key,name,enabled,sort_order from app_market_catalog');
  const policies=await c.query('select category,enabled from app_market_category_policy');
  await c.query('commit');setCatalogRows(snapshot.rows);setCategoryPolicies(policies.rows);changed();return catalogRows();
 }catch(e){if(c)await c.query('rollback').catch(()=>{});throw e;}finally{c?.release();saving--;}
}
export const saveMarketEnabled=(key,enabled,actor,{database=pool,position}={})=>saveMarketPolicy({key,enabled,position},actor,{database});

export async function saveScopePolicy(scopes,actor,{database=pool}={}){
 const rows=Array.isArray(scopes)?scopes:[];
 const clean=rows.map(r=>({country:String(r?.country??'').trim().slice(0,80),league:String(r?.league??'').trim().slice(0,120),categories:(Array.isArray(r?.categories)?r.categories:[]).map(String).slice(0,40),families:(Array.isArray(r?.families)?r.families:[]).map(String).slice(0,200)})).filter(r=>r.country||r.league);
 saving++;let c;
 try{
  await flight;c=await database.connect();await c.query('begin');
  const user=(await c.query('select role,status,deleted_at from app_user where id=$1 for share',[actor.id])).rows[0];
  if(user?.role!=='ADMIN'||user.status!=='ACTIVE'||user.deleted_at)throw invalid('Vetëm administratori aktiv.',403);
  await c.query('select id from app_live_risk_settings where id=1 for update');
  await c.query('delete from app_market_scope_policy');
  for(const r of clean)await c.query('insert into app_market_scope_policy(country,league,categories,families) values($1,$2,$3,$4)',[r.country,r.league,r.categories,r.families]);
  await c.query(`insert into app_admin_audit(actor_id,actor_name,actor_role,action,target_type,target_id,details) values($1,$2,'ADMIN','UPDATE MARKET_SCOPE_POLICY','market','scopes',$3::jsonb)`,[actor.id,actor.username,JSON.stringify({scopes:clean})]);
  await c.query('commit');setScopeBlocks(clean);changed();return scopeBlockRows();
 }catch(error){if(c)await c.query('rollback').catch(()=>{});throw error;}
 finally{c?.release();saving--;}
}
