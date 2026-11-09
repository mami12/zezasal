/**
 * One-shot provider reachability probe, strictly opt-in:
 *   node scripts/probe-market-information-apis.mjs --network
 *   node scripts/probe-market-information-apis.mjs --network --aiscore-id=XXXXXXXXXXXX
 *
 * Performs at most ONE HTTP GET per listed public endpoint. It never sends
 * third-party API keys, signs in, posts data or settles bets. No payload body,
 * match names, odds or user data are logged. 200/JSON is reachability ONLY.
 */
const MAX_BYTES=5*1024*1024;
export const PUBLIC_PROBES=[
 {name:'zizobet:live',url:'https://wss-eu-uk1.ws-amazon.com/api/cache/get?key=live%2Fgames'},
 {name:'zizobet:prematch',url:'https://wss-eu-uk1.ws-amazon.com/api/cache/get?key=prematch%2Fgames'}
];
const allow=u=>u.protocol==='https:'&&(
 u.hostname==='wss-eu-uk1.ws-amazon.com'&&u.pathname==='/api/cache/get'&&
 ['live/games','prematch/games'].includes(u.searchParams.get('key'))||
 u.hostname==='api.aiscore.com'&&u.pathname==='/v1/web/api/match/s'&&
 /^[a-z0-9]{10,24}$/i.test(u.searchParams.get('match_id')??'')
);
async function probeOne(spec,{request,timeoutMs,maxBytes}){
 const u=new URL(spec.url);
 if(!allow(u))throw Error('UNAPPROVED_PROVIDER_URL');
 const controller=new AbortController();
 const limit=AbortSignal.timeout(timeoutMs);
 const signal=AbortSignal.any([controller.signal,limit]);
 try{
  const res=await request(u.href,{method:'GET',signal,headers:{accept:'application/json'}});
  const status=Number(res.status);
  if(!res.ok){await res.body?.cancel?.().catch?.(()=>{});return {name:spec.name,ok:false,httpStatus:status,reason:'HTTP_ERROR'};}
  const reader=res.body?.getReader?.();
  if(!reader)return {name:spec.name,ok:false,httpStatus:status,reason:'NO_BODY'};
  const parts=[];let bytes=0;
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   bytes+=value.byteLength;
   if(bytes>maxBytes){await reader.cancel().catch(()=>{});return {name:spec.name,ok:false,httpStatus:status,reason:'RESPONSE_TOO_LARGE'};}
   parts.push(value);
  }
  const json=JSON.parse(Buffer.concat(parts).toString('utf8'));
  const data=json?.data??json?.result??json;
  return {name:spec.name,ok:true,httpStatus:status,bytes,
   shape:Array.isArray(data)?'array':data===null?'null':typeof data,
   count:Array.isArray(data)?data.length:null,
   topKeys:data&&typeof data==='object'&&!Array.isArray(data)?
    Object.keys(data).slice(0,12):[],
   settlementProof:false};
 }catch(error){
  return {name:spec.name,ok:false,reason:error?.name==='TimeoutError'?'TIMEOUT':
    error instanceof SyntaxError?'NOT_JSON':'NETWORK_ERROR'};
 }finally{controller.abort();}
}
export async function probePublicProviders({request=fetch,aiscoreId=null,timeoutMs=8000,maxBytes=MAX_BYTES}={}){
 if(typeof request!=='function')throw Error('fetch implementation required');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)throw Error('Invalid timeout');
 if(!Number.isInteger(maxBytes)||maxBytes<1000||maxBytes>MAX_BYTES)throw Error('Invalid size cap');
 const calls=[...PUBLIC_PROBES];
 if(aiscoreId!==null){
  if(!/^[a-z0-9]{10,24}$/i.test(String(aiscoreId)))throw Error('Invalid AiScore fixture ID');
  calls.push({name:'aiscore:confirmed-fixture',
   url:'https://api.aiscore.com/v1/web/api/match/s?match_id='+encodeURIComponent(aiscoreId)});
 }
 const results=[];
 for(const spec of calls)results.push(await probeOne(spec,{request,timeoutMs,maxBytes}));
 return {readOnly:true,totalCalls:results.length,results,
  caveat:'Network JSON availability is NOT event correctness or permission to settle tickets.'};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1].replace(/\\/g,'/')).href){
 if(!process.argv.includes('--network')){
  console.log('Usage: node scripts/probe-market-information-apis.mjs --network [--aiscore-id=CONFIRMED_ID]');
 }else{
  const id=process.argv.find(x=>x.startsWith('--aiscore-id='))?.slice('--aiscore-id='.length)??null;
  probePublicProviders({aiscoreId:id}).then(r=>{
   console.log(JSON.stringify(r,null,2));
   if(r.results.some(x=>!x.ok))process.exitCode=2;
  }).catch(e=>{console.error(e.message);process.exitCode=1;});
 }
}
