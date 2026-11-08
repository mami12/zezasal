/**
 * Durable, append-on-change audit for every normalized provider offer.
 * This NEVER supplies a settlement decision or moves player money.
 * The live odds board remains in RAM, independent of PostgreSQL speed.
 */
import {liveContract} from './live-contract-rules.mjs';
import {eventMarketRequirement} from './event-market-policy.mjs';

export const PROVIDER_OFFER_ARCHIVE_SQL = [
 'create table if not exists app_provider_offer_current (',
 ' match_id bigint not null, market_key text not null, line text not null default \'\',',
 ' outcome_key text not null, market_name text not null, outcome_name text not null,',
 ' provider_id text, native_market_id text, native_outcome_id text,',
 ' native_market_name text, native_outcome_name text, native_parameters jsonb,',
 ' native_quote jsonb, contract_hint jsonb, evidence_requirement text,',
 ' price numeric(18,8), suspended boolean not null default false,',
 ' period integer not null default 0,',
 ' first_seen_at timestamptz not null default now(),',
 ' last_changed_at timestamptz not null default now(),',
 ' primary key(match_id,market_key,line,outcome_key));',
 'create index if not exists app_provider_offer_current_match_idx on app_provider_offer_current(match_id,market_key);',
 'create table if not exists app_provider_offer_change (',
 ' id bigserial primary key, match_id bigint not null, market_key text not null,',
 ' line text not null, outcome_key text not null, market_name text not null,',
 ' outcome_name text not null, provider_id text, native_market_id text,',
 ' native_outcome_id text, native_market_name text, native_outcome_name text,',
 ' native_parameters jsonb, native_quote jsonb, contract_hint jsonb,',
 ' evidence_requirement text, price numeric(18,8), suspended boolean not null,',
 ' period integer not null, recorded_at timestamptz not null default now());',
 'create index if not exists app_provider_offer_change_match_idx on app_provider_offer_change(match_id,recorded_at desc);',
 'create table if not exists app_provider_market_definition (',
 ' provider_id text not null, scope text not null, native_market_id text not null,',
 ' native_market_name text not null, definition jsonb not null,',
 ' first_seen_at timestamptz not null default now(),',
 ' last_changed_at timestamptz not null default now(),',
 ' primary key(provider_id,scope,native_market_id));',
 'create index if not exists app_provider_market_definition_name_idx on app_provider_market_definition(provider_id,scope);'
].join('\n');

const decodeNativeParameters=key=>{
 const encoded=String(key).match(/^zz\d+@([A-Za-z0-9_-]{1,8192})$/)?.[1];
 if(!encoded)return null;
 try{
  const decoded=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));
  return decoded&&typeof decoded==='object'&&!Array.isArray(decoded)?decoded:null;
 }catch{return null;}
};
const safeText=v=>v==null?null:String(v).slice(0,8192);
const safePrice=v=>v==null||v===''||!Number.isFinite(Number(v))||Number(v)<0?null:Number(v);
const jsonValue=v=>{if(v==null)return null;try{return JSON.parse(JSON.stringify(v));}catch{return null;}};

/** Hints are for future rule development, NEVER an authorization to settle. */
export function normalizeProviderOffer(row){
 const matchId=Number(row?.matchId??row?.match_id);
 const marketKey=safeText(row?.marketKey??row?.market_key);
 const outcomeKey=safeText(row?.outcomeKey??row?.outcome_key);
 if(!Number.isSafeInteger(matchId)||matchId<=0||!marketKey||!outcomeKey)return null;
 const line=safeText(row?.line)??'';
 const marketName=safeText(row?.marketName??row?.market_name)??marketKey;
 const outcomeName=safeText(row?.outcomeName??row?.outcome_name)??outcomeKey;
 const providerId=safeText(row?.providerId??row?.provider_id);
 const candidate={market_key:marketKey,market_name:marketName,
  outcome_key:outcomeKey,outcome_name:outcomeName,line};
 const preNormalized=Object.prototype.hasOwnProperty.call(row,'contract_hint')&&
  Object.prototype.hasOwnProperty.call(row,'native_parameters');
 let contract=null,requirement=null;
 if(preNormalized){contract=row.contract_hint??null;requirement=row.evidence_requirement??null;}
 else{
  try{contract=liveContract(candidate,{counts:{},clock:null,teams:{}});}catch{}
  try{requirement=eventMarketRequirement(candidate)??null;}catch{requirement='RULE_REVIEW_REQUIRED';}
 }
 return {
  match_id:matchId,market_key:marketKey,line,outcome_key:outcomeKey,
  market_name:marketName,outcome_name:outcomeName,
  provider_id:providerId,native_market_id:safeText(row?.nativeMarketId??row?.native_market_id??marketKey.split('@')[0]),
  native_outcome_id:safeText(row?.nativeOutcomeId??row?.native_outcome_id??outcomeKey),
  native_market_name:safeText(row?.nativeMarketName??row?.native_market_name??marketName),
  native_outcome_name:safeText(row?.nativeOutcomeName??row?.native_outcome_name??outcomeName),
  native_parameters:jsonValue(row?.nativeParameters??row?.native_parameters??decodeNativeParameters(marketKey)),
  native_quote:jsonValue(row?.nativeQuote??row?.native_quote),
  contract_hint:jsonValue(contract),
  evidence_requirement:requirement??(contract?'INCIDENT_FACTS':'UNCLASSIFIED'),
  price:safePrice(row?.price),suspended:row?.suspended===true,
  period:Number.isSafeInteger(Number(row?.period))?Number(row.period):0
 };
}
const keys=['match_id','market_key','line','outcome_key','market_name','outcome_name',
 'provider_id','native_market_id','native_outcome_id','native_market_name',
 'native_outcome_name','native_parameters','native_quote','contract_hint',
 'evidence_requirement','price','suspended','period'];
const columnList=keys.join(',');
const fields='match_id bigint,market_key text,line text,outcome_key text,'+
 'market_name text,outcome_name text,provider_id text,native_market_id text,'+
 'native_outcome_id text,native_market_name text,native_outcome_name text,'+
 'native_parameters jsonb,native_quote jsonb,contract_hint jsonb,'+
 'evidence_requirement text,price numeric,suspended boolean,period integer';
// One atomic SQL statement; unchanged polls create neither updates nor history.
export const ARCHIVE_PROVIDER_OFFERS_SQL=
 'with revised as (insert into app_provider_offer_current as t ('+columnList+') '+
 'select '+keys.map(k=>'x.'+k).join(',')+
 ' from jsonb_to_recordset($1::jsonb) as x('+fields+') '+
 'on conflict(match_id,market_key,line,outcome_key) do update set '+
 keys.slice(4).map(k=>k+'=excluded.'+k).join(',')+',last_changed_at=now() '+
 'where ('+keys.slice(4).map(k=>'t.'+k).join(',')+') is distinct from ('+
 keys.slice(4).map(k=>'excluded.'+k).join(',')+') '+
 'returning '+columnList+') '+
 'insert into app_provider_offer_change ('+columnList+') '+
 'select '+columnList+' from revised returning id';

export async function persistProviderOffers(rows,{execute,chunkSize=250}={}){
 if(typeof execute!=='function')throw Error('PostgreSQL executor is required');
 const dedup=new Map();
 for(const raw of rows??[]){
  const offer=normalizeProviderOffer(raw);
  if(offer)dedup.set([offer.match_id,offer.market_key,offer.line,offer.outcome_key].join('|'),offer);
 }
 const offers=[...dedup.values()],step=Math.max(1,Math.min(500,Number(chunkSize)||250));
 let recorded=0;
 for(let i=0;i<offers.length;i+=step){
  const {rowCount}=await execute(ARCHIVE_PROVIDER_OFFERS_SQL,[JSON.stringify(offers.slice(i,i+step))]);
  recorded+=rowCount??0;
 }
 return {seen:offers.length,recorded};
}

/**
 * The upstream market dictionaries describe even markets for which no match
 * currently publishes a quote. Preserve all their definitions without an
 * extra provider request, so complex future rule work has original names/IDs.
 */
export async function persistProviderMarketDefinitions(rows,{execute,chunkSize=250}={}){
 if(typeof execute!=='function')throw Error('PostgreSQL executor is required');
 const definitions=new Map();
 for(const source of rows??[]){
  const definition=source.definition??source.raw??{};
  const provider_id=safeText(source.provider??'ZIZOBET');
  const scope=safeText(source.scope);
  const native_market_id=safeText(source.id??definition.ID??definition.it);
  const native_market_name=safeText(source.name??definition.Name??definition.nm);
  if(!provider_id||!['LIVE','PREMATCH'].includes(scope)||
     !native_market_id||!native_market_name)continue;
  const normalized={provider_id,scope,native_market_id,native_market_name,
   definition:jsonValue(definition)??{}};
  definitions.set([provider_id,scope,native_market_id].join('|'),normalized);
 }
 const records=[...definitions.values()],step=Math.max(1,Math.min(500,Number(chunkSize)||250));
 let stored=0;
 const sql='insert into app_provider_market_definition as t '+
  '(provider_id,scope,native_market_id,native_market_name,definition) '+
  'select x.provider_id,x.scope,x.native_market_id,x.native_market_name,x.definition '+
  'from jsonb_to_recordset($1::jsonb) as x('+
  'provider_id text,scope text,native_market_id text,native_market_name text,definition jsonb) '+
  'on conflict(provider_id,scope,native_market_id) do update set '+
  'native_market_name=excluded.native_market_name,definition=excluded.definition,last_changed_at=now() '+
  'where (t.native_market_name,t.definition) is distinct from '+
  '(excluded.native_market_name,excluded.definition) returning native_market_id';
 for(let i=0;i<records.length;i+=step){
  const result=await execute(sql,[JSON.stringify(records.slice(i,i+step))]);
  stored+=result.rowCount??0;
 }
 return {seen:records.length,stored};
}

/** A bounded, single-flight retry queue. No waiting on DB in the odds stream. */
export function createProviderOfferArchive({execute,ready=()=>true,maxTracked=60000,
 onError=e=>console.warn('[provider offer archive]',e.message)}={}){
 const written=new Map(),pending=new Map(),observed=new Map();
 let active=null,failed=0,lastError=null,lastSavedAt=null,recorded=0,skippedUnchanged=0;
 const cap=Math.max(1000,Number(maxTracked)||60000);
 const id=q=>[q.match_id,q.market_key,q.line,q.outcome_key].join('|');
 const sig=q=>JSON.stringify(q);
 // A simple raw snapshot fingerprint is cheaper than recomputing dozens of
 // market parsers on every identical provider odds poll. The append-on-change
 // archive intentionally ignores top-level source freshness timestamps.
 const rawKey=raw=>{
  const id=Number(raw?.matchId??raw?.match_id);
  const market=raw?.marketKey??raw?.market_key;
  const outcome=raw?.outcomeKey??raw?.outcome_key;
  if(!Number.isSafeInteger(id)||id<=0||!market||!outcome)return null;
  return [id,market,String(raw.line??''),outcome].join('|');
 };
 const rawSignature=raw=>{
  const {updatedAt:_at,updated_at:_at2,...stable}=raw;
  return JSON.stringify(stable);
 };
 async function flush(){
  if(active)return active;
  if(!ready()||!pending.size)return {pending:pending.size};
  const work=(async()=>{
   while(ready()&&pending.size){
    const entries=[...pending].slice(0,250);
    const result=await persistProviderOffers(entries.map(([,v])=>v.quote),{execute});
    recorded+=result.recorded;lastSavedAt=new Date().toISOString();lastError=null;
    for(const [key,value] of entries){
     written.delete(key);written.set(key,value.signature);
     if(pending.get(key)?.signature===value.signature)pending.delete(key);
    }
    while(written.size>cap)written.delete(written.keys().next().value);
   }
   return {pending:pending.size};
  })();
  // Every concurrent caller must receive the HANDLED promise, never the
  // rejecting raw database write. Otherwise one failed DB connection can
  // produce an unhandled rejection from a second flush() call.
  active=work.catch(e=>{
   failed++;lastError=e.message;onError(e);
   return {pending:pending.size,error:e.message};
  }).finally(()=>{active=null;});
  return active;
 }
 function observe(rows){
  if(!ready())return;
  for(const raw of rows??[]){
   if(!raw||typeof raw!=='object')continue;
   const candidate=rawKey(raw),fingerprint=candidate?rawSignature(raw):null;
   if(candidate&&observed.get(candidate)===fingerprint&&
      (written.has(candidate)||pending.has(candidate))){
    skippedUnchanged++;continue;
   }
   const quote=normalizeProviderOffer(raw);if(!quote)continue;
   const key=id(quote),signature=sig(quote);
   if(candidate){
    observed.delete(key);observed.set(key,fingerprint);
    while(observed.size>cap)observed.delete(observed.keys().next().value);
   }
   if(written.get(key)===signature){pending.delete(key);continue;}
   pending.delete(key);pending.set(key,{signature,quote});
   if(pending.size>cap)pending.delete(pending.keys().next().value);
  }
  if(pending.size&&!active)void flush();
 }
 const status=()=>({pending:pending.size,recorded,failed,lastError,lastSavedAt,skippedUnchanged});
 return {observe,flush,status};
}
