/**
 * ONE prematch + ONE live fixture; one independent 100 ALL ticket per
 * offered outcome, never a parlay. Dry run unless --execute is specified.
 *
 * node scripts/bulk-market-bet-test.mjs --prematch=123 --live=456
 * node scripts/bulk-market-bet-test.mjs --prematch=123 --live=456 --execute
 * node scripts/bulk-market-bet-test.mjs --recheck=bulk-test-state.json
 *
 * Credentials: BET_TEST_TOKEN or BET_TEST_USERNAME/BET_TEST_PASSWORD.
 * --db-native additionally reads every currently archived real provider quote
 * from the SAME running server's PostgreSQL database. NEVER open live PGlite.
 */
import {randomUUID} from 'node:crypto';
import {appendFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

export const TEST_STAKE_LEK=100;
const numeric=value=>Number.isFinite(Number(value))?Number(value):null;
const text=value=>String(value??'').replace(/[\r\n\t|]+/g,' ').replace(/\s+/g,' ').trim();
const idOf=(matchId,key,line,outcome)=>String(matchId)+'|'+String(key)+'|'+String(line??'')+'|'+String(outcome);
const keyOf=record=>String(record.outcomeId);
const errorText=error=>text(error?.serverMessage??error?.message??error?.code??'UNKNOWN_FAILURE').slice(0,360);
const viable=record=>record.price!==null&&Number.isFinite(record.price)&&record.price>1&&!record.suspended;
const quoted=record=>({matchId:record.matchId,market:record.market,marketKey:record.marketKey,
  line:record.line,period:record.period,selection:record.selection,
  outcomeKey:record.outcomeKey,price:record.price,outcomeId:record.outcomeId,
  suspended:record.suspended,source:record.source});
const tokenFromResponse=payload=>typeof payload?.token==='string'?payload.token:null;

/** All outcomes, including suspended/unavailable ones, are tracked. */
export function detailOffers(match){
 if(!match||!Array.isArray(match.markets))throw Error('MATCH_DETAIL_WITH_MARKETS_REQUIRED');
 const result=[],matchId=String(match.id);
 for(const market of match.markets){
  if(!Array.isArray(market?.outcomes))continue;
  for(const outcome of market.outcomes){
   if(!outcome?.id)continue;
   const p=numeric(outcome.odds);
   result.push({
    matchId,market:text(market.name),marketKey:text(market.extId??market.id),
    line:text(market.line??market.specifier),period:numeric(market.period)??0,
    selection:text(outcome.name),outcomeKey:text(outcome.code??outcome.id),
    outcomeId:String(outcome.id),price:p,source:'detail',
    suspended:market.status!=='ACTIVE'||outcome.status!=='ACTIVE'||
      outcome.quoteSuspended===true||outcome.feedSuspended===true||
      outcome.riskSuspended===true||outcome.decided===true
   });
  }
 }
 return result;
}

/** Add quotes hidden by the frontend or policy, without bypassing API validation. */
export function nativeOffers(matchId,rows){
 if(!Array.isArray(rows))throw Error('Native quote database rows missing');
 return rows.map(row=>({
  matchId:String(matchId),market:text(row.market_name),marketKey:text(row.market_key),
  line:text(row.line),period:numeric(row.period)??0,
  selection:text(row.outcome_name),outcomeKey:text(row.outcome_key),
  outcomeId:idOf(matchId,row.market_key,row.line,row.outcome_key),
  price:row.price==null?null:numeric(row.price),source:'db',
  suspended:row.suspended===true
 }));
}

export function collectOfferUniverse(detail,native=[]){
 const universe=new Map();
 for(const item of native)universe.set(keyOf(item),{...item});
 for(const item of detail){
  const previous=universe.get(keyOf(item));
  universe.set(keyOf(item),{
   ...item,source:previous?'detail+db':'detail',
   // Never treat a stale native archive flag as fresher than the HTTP quote.
   // API is still authoritative; actual placement independently revalidates it.
  });
 }
 return [...universe.values()].sort((a,b)=>
   a.market.localeCompare(b.market)||a.line.localeCompare(b.line)||
   a.selection.localeCompare(b.selection)||a.outcomeId.localeCompare(b.outcomeId));
}

export function categorizeAttempt(offer,{execute=false}={}){
 if(!viable(offer))return {status:'UNAVAILABLE',reason:
  offer.suspended?'PROVIDER_OR_POLICY_SUSPENDED':'PRICE_UNAVAILABLE'};
 return execute?{status:'READY_TO_PLACE'}:{status:'DRY_RUN',reason:'NO_REAL_BET_SENT'};
}

/**
 * Dependencies supplied explicitly so CI never connects to a real bookmaker.
 * Financial execution is impossible when execute=false, even with a place
 * callback. 4xx are actual refusal; network/5xx may be debited already and
 * immediately stop the batch rather than retrying with a new UUID.
 */
export async function exerciseFixture({
 type,matchId,fetchDetail,loadNative=async()=>[],place=async()=>{throw Error('NO_WRITER');},
 execute=false,onAttempt=async()=>{},uuid=randomUUID
}={}){
 if(!['live','prematch'].includes(type)||!Number.isSafeInteger(Number(matchId))||
    Number(matchId)<=0)throw Error('One valid live/prematch match ID is required');
 const match=await fetchDetail(matchId);
 const actual=String(match?.status??'').toUpperCase();
 if(actual!==type.toUpperCase())
  throw Error('MATCH_STATUS_MISMATCH: '+type+' match '+matchId+' is '+actual);
 const native=await loadNative(matchId);
 const offers=collectOfferUniverse(detailOffers(match),native);
 const results=[];
 let fatal=null;
 for(const offer of offers){
  const base={...quoted(offer),fixtureType:type,stake:TEST_STAKE_LEK};
  const decision=categorizeAttempt(offer,{execute});
  let outcome;
  if(fatal)outcome={...base,status:'NOT_TESTED',reason:fatal};
  else if(decision.status!=='READY_TO_PLACE')outcome={...base,...decision};
  else{
   const requestId=uuid();
   // Persist before the POST: if TCP dies mid-response, NEVER assume no debit.
   await onAttempt({...base,status:'SENDING',clientRequestId:requestId},results);
   try{
    const ticket=await place({
     ticketType:'SINGLE',type:'SINGLE',stake:TEST_STAKE_LEK,
     selections:[{outcomeId:offer.outcomeId,
      oddsAtPlacement:offer.price,odds:offer.price}],
     clientRequestId:requestId
    });
    const ticketId=ticket?.id??ticket?.ticket?.id??null;
    if(!ticketId)throw Object.assign(new Error('SERVER_RECEIPT_MISSING'),{uncertain:true});
    outcome={...base,status:'ACCEPTED',clientRequestId:requestId,
     ticketId:String(ticketId),bookingCode:ticket.bookingCode??ticket.ticket?.bookingCode??null,
     quotedOdds:offer.price,placedOdds:numeric(ticket.totalOdds??ticket.ticket?.totalOdds)};
   }catch(error){
    const httpStatus=numeric(error?.httpStatus),message=errorText(error);
    const uncertain=error?.uncertain===true||httpStatus===null||httpStatus>=500;
    outcome={...base,status:uncertain?'UNCERTAIN':'REJECTED',
     reason:message,httpStatus,clientRequestId:requestId};
    if(uncertain)fatal='STOPPED_AFTER_UNCERTAIN_NETWORK_OR_SERVER_RESULT';
    else if(/bilanci.*mjaft|insufficient.*balanc|insufficient.*fund/i.test(message))
     fatal='NOT_TESTED_INSUFFICIENT_PLAYER_BALANCE';
    else if(httpStatus===401||httpStatus===403&&/session|token|identifik|autoriz/i.test(message))
     fatal='NOT_TESTED_AUTHENTICATION_EXPIRED';
   }
  }
  results.push(outcome);
  await onAttempt(outcome,results);
 }
 return {type,matchId:String(matchId),matchName:text(match.homeTeam)+' vs '+text(match.awayTeam),
  captured:offers.length,eligible:offers.filter(viable).length,
  expectedTotalStake:offers.filter(viable).length*TEST_STAKE_LEK,
  counts:results.reduce((obj,row)=>(obj[row.status]=(obj[row.status]??0)+1,obj),{}),
  results};
}

export async function createClient({baseUrl,token,username,password,request=fetch}={}){
 if(typeof request!=='function')throw Error('HTTP client required');
 const base=new URL(baseUrl??'http://127.0.0.1:3000');
 const loopback=['localhost','127.0.0.1','::1','[::1]'].includes(base.hostname);
 if(base.protocol!=='https:'&&!(base.protocol==='http:'&&loopback))
  throw Error('Require HTTPS for a remote server so player credentials and tickets stay private');
 if(base.search||base.hash||base.username||base.password)throw Error('Plain base URL required');
 const api=new URL('/app/api/',base);
 let jwt=token??null;
 const call=async(method,path,body=null)=>{
  const res=await request(new URL(path,api),{
   method,headers:{accept:'application/json',...(jwt?{authorization:'Bearer '+jwt}:{}),
    ...(body?{'content-type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000),
   redirect:'error'
  });
  const data=await res.json().catch(()=>null);
  if(!res.ok){
   const err=new Error(text(data?.message??data?.error??'HTTP '+res.status));
   err.serverMessage=err.message;err.httpStatus=res.status;
   err.code=data?.code??null;err.newOdds=data?.newOdds??null;
   throw err;
  }
  return data;
 };
 if(!jwt&&username&&password){
  const login=await call('POST','auth/login',{username,password});
  jwt=tokenFromResponse(login);
  if(!jwt)throw Error('LOGIN_TOKEN_MISSING');
 }
 return {
  fetchDetail:id=>call('GET','matches/'+encodeURIComponent(id)+'?category=all'),
  place:async payload=>{
   if(!jwt)throw Error('A funded test PLAYER login/token is required for real wagers');
   return call('POST','bets/place',payload);
  },
  getTicket:id=>call('GET','tickets/search?q='+encodeURIComponent(String(id))),
  loggedIn:!!jwt
 };
}

const argsFrom=argv=>{
 const flags={};for(const arg of argv){
  if(!arg.startsWith('--'))throw Error('Use --key=value or --execute');
  const [name,...pieces]=arg.slice(2).split('=');
  if(!name||Object.hasOwn(flags,name))throw Error('Duplicate/empty flag '+name);
  flags[name]=pieces.length?pieces.join('='):true;
 }return flags;
};

async function getArchivedOffers(matchId){
 const [{config},{pool}]=await Promise.all([
  import('../server/config.mjs'),import('../server/db.mjs')
 ]);
 if(config.databaseDriver==='local')throw Error(
  'Live PGlite cannot be opened twice. Use HTTP-only mode, or a PostgreSQL deployment.');
 const client=await pool.connect();let begun=false;
 try{
  await client.query('begin isolation level repeatable read read only');begun=true;
  const r=await client.query(
   'select market_key,line,outcome_key,market_name,outcome_name,period,price,suspended '+
   'from app_provider_offer_current where match_id=$1 '+
   'order by market_key,line,outcome_key',[matchId]);
  return nativeOffers(matchId,r.rows);
 }finally{if(begun)await client.query('rollback').catch(()=>{});client.release();}
}

const rowText=r=>
 'Tregu: '+text(r.market)+' | Zgjedhja: '+text(r.selection)+
 ' | Linja: '+text(r.line)+' | Kuota: '+String(r.price??'MUNGON')+
 ' | Burimi: '+r.source+' | ID: '+text(r.outcomeId)+
 ' | Status: '+r.status+
 (r.reason?' | Arsyeja: '+text(r.reason):'')+
 (r.ticketId?' | Bileta: '+text(r.ticketId):'')+
 (r.bookingCode?' | Kodi: '+text(r.bookingCode):'')+'\n';

async function recheck({path,client}){
 const file=resolve(path),data=JSON.parse(await readFile(file,'utf8'));
 const folder=dirname(file);
 for(const type of ['prematch','live']){
  const run=data.fixtures?.[type];if(!run)continue;
  const lines=['REZULTATET E BILETAVE '+type.toUpperCase()+' | '+new Date().toISOString()];
  for(const item of run.results??[]){
   if(item.status!=='ACCEPTED'||!item.ticketId)continue;
   try{
    const ticket=await client.getTicket(item.ticketId);
    item.finalStatus=text(ticket?.status??'UNKNOWN');
    item.actualPayout=numeric(ticket?.actualPayout);
    item.lineStatus=text(ticket?.lines?.[0]?.status??'UNKNOWN');
    lines.push(rowText({...item,status:item.finalStatus,
      reason:'Linja: '+item.lineStatus+' / Paguar: '+String(item.actualPayout??'?')}));
   }catch(error){lines.push(rowText({...item,status:'RECHECK_ERROR',reason:errorText(error)}));}
  }
  await writeFile(join(folder,'rezultatet-'+type+'.txt'),lines.join('\n'),'utf8');
 }
 data.checkedAt=new Date().toISOString();
 await writeFile(file,JSON.stringify(data,null,2),'utf8');
 return data;
}

export async function main(argv=process.argv.slice(2),env=process.env){
 const flags=argsFrom(argv);
 const client=await createClient({
  baseUrl:flags.url??env.BET_TEST_BASE_URL??'http://127.0.0.1:3000',
  token:env.BET_TEST_TOKEN,username:env.BET_TEST_USERNAME,
  password:env.BET_TEST_PASSWORD
 });
 if(flags.recheck){
  const state=await recheck({path:String(flags.recheck),client});
  console.log('Recheck complete, accepted tickets: '+Object.values(state.fixtures??{}).reduce(
   (n,r)=>n+(r.results??[]).filter(x=>x.status==='ACCEPTED').length,0));
  return;
 }
 const prematch=Number(flags.prematch),live=Number(flags.live);
 if(!Number.isSafeInteger(prematch)||prematch<=0||
    !Number.isSafeInteger(live)||live<=0||prematch===live)
  throw Error('Provide two different fixture IDs: --prematch=123 --live=456');
 const execute=flags.execute===true;
 if(execute&&!client.loggedIn)throw Error('BET_TEST_TOKEN or BET_TEST_USERNAME/BET_TEST_PASSWORD needed');
 const out=resolve(String(flags.out??('bulk-market-test-'+new Date().toISOString().replace(/[:.]/g,'-'))));
 await mkdir(out,{recursive:true});
 const state={createdAt:new Date().toISOString(),execute,stakePerOutcome:TEST_STAKE_LEK,
  baseUrlHost:new URL(flags.url??env.BET_TEST_BASE_URL??'http://127.0.0.1:3000').host,
  fixtures:{},note:'All recorded outcomes, one SINGLE per quote. Funding is controlled by the administrator.'};
 const stateFile=join(out,'bulk-test-state.json');
 const save=()=>writeFile(stateFile,JSON.stringify(state,null,2),'utf8');
 await save();
 for(const [type,id] of [['prematch',prematch],['live',live]]){
  const refused=join(out,'refuzuar-'+type+'.txt');
  const accepted=join(out,'biletat-'+type+'.txt');
  await writeFile(refused,'NDESHJA '+type.toUpperCase()+' '+id+'\n','utf8');
  await writeFile(accepted,'NDESHJA '+type.toUpperCase()+' '+id+'\n','utf8');
  const journal=[];
  state.fixtures[type]={matchId:id,results:journal};
  const seen=new Set();
  const result=await exerciseFixture({
   type,matchId:id,fetchDetail:client.fetchDetail,place:client.place,execute,
   loadNative:flags['db-native']===true?getArchivedOffers:async()=>[],
   onAttempt:async(item,results)=>{
    if(item.status==='SENDING'){
     journal.push(item);await save();return;
    }
    const old=journal.findIndex(x=>x.status==='SENDING'&&
     x.clientRequestId===item.clientRequestId);
    if(old>=0)journal.splice(old,1);
    journal.push(item);
    if(!seen.has(item.outcomeId)){seen.add(item.outcomeId);}
    if(item.status==='ACCEPTED')await appendFile(accepted,rowText(item));
    else if(item.status!=='DRY_RUN')await appendFile(refused,rowText(item));
    await save();
   }
  });
  state.fixtures[type]={...result,results:journal};
  await save();
  console.log(type+': '+result.captured+' outcomes; '+result.eligible+
   ' eligible; '+result.expectedTotalStake+' LEK theoretical total; '+
   JSON.stringify(result.counts));
 }
 console.log('Reports written in '+out);
 console.log('Dry run by default. Real tickets only with --execute. No admin funding limit is applied by this script.');
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
 main().catch(error=>{console.error('Bulk test failed:',errorText(error));process.exitCode=1;});
