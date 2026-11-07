import WebSocket from 'ws';
import {YbetsHttpClient,YbetsSocket} from './ybets/client.mjs';
import {YbetsCache} from './ybets/cache.mjs';
import {normalizeMatch,normalizeInfo,normalizeMarkets,internalMatchId,nativeMatchId,isYbetsMatchId,isYbetsFootball} from './ybets-normalize.mjs';
import {competitionDecision} from './football-competitions.mjs';

export function isAllowedYbetsMatch(m){
 if(!isYbetsFootball(m))return false;
 if([1,2,3,4,5].includes(Number(m.status))){
   const text=[m.tournament?.name,m.tournament?.category?.slug,m.competitors?.home?.name,m.competitors?.away?.name].join(' ');
   return !/\b(?:virtual|cyber|esports?|esportsbattle|simulated|simulation|replays?|ehighlights|short[- ]football|fantasy|volta|penalty shootout)\b|\(2x\d+ min\)/i.test(text);
 }
 const r=normalizeMatch(m);return !!r&&competitionDecision({name:r.tournament_name},{slug:r.category_slug}).allowed;
}
/** Public football only. The HTTP catalogue discovers fixtures; the socket
 * changes prices/statuses. Full snapshots repair omissions and reconnect gaps. */
export function startYbetsFeed({onMatch,onOdds,onInfo,onStatus,onCycle,getWatchedIds=async()=>[],
  http=new YbetsHttpClient(),Socket=YbetsSocket,pollMs=20000,fullMs=30000,selectRows=rows=>rows,
  setTimer=setInterval,clearTimer=clearInterval}={}) {
 const cache=new YbetsCache(),fullAt=new Map(),focused=new Map(),inflight=new Map();
 const state={provider:'YBETS',syncedAt:null,lastError:null,received:0,kept:0,skipped:0,cycles:0,running:false,paused:false,pauses:0,resumes:0,catalogComplete:false};
 let stopped=false,work=Promise.resolve(),timer,fullTimer,socket,repairing=false,catalogIds=new Set();
 const enqueue=fn=>{const p=work.then(()=>stopped?undefined:fn());work=p.catch(error=>{state.lastError=error.message;});return p;};
 const allowed=isAllowedYbetsMatch;
 async function publishMatch(m,{facts=m}={}) {
   const row=normalizeMatch(m);if(!row)return;
   if(!allowed(m)&&!focused.has(m.id)&&!(await getWatchedIds()).some(id=>Number(id)===row.match_id))return;
   const info=normalizeInfo(m),explicit=normalizeInfo(facts);
   row.raw.ybetsFinalScoreVerified=explicit.feedStatus==='Finished'&&explicit.homeScore!=null&&explicit.awayScore!=null;
   if(facts!==m){
     if(explicit.homeScore==null){delete info.homeScore;delete info.awayScore;}
     if(explicit.matchTimeMs==null)delete info.matchTimeMs;
     if(!explicit.periodsScore)delete info.periodsScore;
   }
   if(info.feedStatus==='Finished'&&!row.raw.ybetsFinalScoreVerified)info.feedStatus='Result Pending';
   await onMatch?.(row);
   await onInfo?.(info);
 }
 async function publishMarkets(id,markets){const m=cache.matches.get(id);if(m&&markets.length)await onOdds?.(normalizeMarkets(m,markets));}
 async function refreshMatch(internalId,{full=true}={}){
   if(!isYbetsMatchId(internalId)||stopped)return;
   const id=nativeMatchId(internalId),key=`${id}:${full}`;
   if(inflight.has(key))return inflight.get(key);
   const request=(async()=>{
     const rev=cache.begin();
     const [detail,marketResult]=await Promise.allSettled([http.getMatch(id),full?http.getMarkets(id):Promise.resolve(null)]);
     await enqueue(async()=>{
       // Pending-ticket IDs may be outside today's board. Preserve their
       // authoritative evidence even when no longer listed as bettable.
       if(detail.status==='fulfilled'&&cache.putMatch(detail.value,rev))await publishMatch(detail.value);
       if(marketResult.status==='fulfilled'&&marketResult.value){await publishMarkets(id,cache.putMarkets(id,marketResult.value,{startedAt:rev,complete:true}));fullAt.set(id,Date.now());}
     });
     if(detail.status==='rejected')throw detail.reason;
     if(marketResult.status==='rejected')throw marketResult.reason;
   })().finally(()=>inflight.delete(key));
   inflight.set(key,request);return request;
 }
 async function targets(){
   const now=Date.now();for(const[id,until]of focused)if(until<now)focused.delete(id);
   const rows=selectRows([...cache.matches.values()].filter(m=>catalogIds.has(m.id)&&[0,1].includes(m.status)&&allowed(m)).map(normalizeMatch));
   const native=rows.map(r=>nativeMatchId(r.match_id));
   const watched=(await getWatchedIds()).filter(isYbetsMatchId).map(nativeMatchId);
   return [...new Set([...focused.keys(),...watched,...native])];
 }
 async function repair(){
   if(stopped||state.paused||repairing)return;repairing=true;
   try {
   const ids=await targets();socket.setMatchIds(ids);
   // Work is bounded; catalogue prices cover the whole visible board. Full
   // markets are fetched for opened matches, live matches and pending tickets.
   const watched=new Set((await getWatchedIds()).filter(isYbetsMatchId).map(nativeMatchId));
   const due=ids.filter(id=>focused.has(id)||watched.has(id)||cache.matches.get(id)?.status===1)
     .filter(id=>Date.now()-(fullAt.get(id)??0)>fullMs);
   for(let i=0;i<due.length;i+=4){if(stopped)break;await Promise.allSettled(due.slice(i,i+4).map(id=>refreshMatch(internalMatchId(id))));}
   } finally {repairing=false;}
 }
 async function tick(){
   if(stopped||state.paused||state.running)return;state.running=true;
   try{
     const rev=cache.begin(),prematchRequest=http.listMatches({status:0}).then(value=>({value}),error=>({error}));
     const live=await http.listMatches({status:1});
     await enqueue(async()=>{for(const m of live.filter(allowed)){catalogIds.add(m.id);if(cache.putMatch(m,rev))await publishMatch(m);await publishMarkets(m.id,cache.putMarkets(m.id,[m.main_market,m.secondary_market].filter(Boolean),{startedAt:rev}));}await onCycle?.(state);});
     const pre=await prematchRequest;if(pre.error)throw pre.error;const prematch=pre.value;
     const matches=[...live,...prematch],kept=matches.filter(allowed);
     state.liveCatalog={received:live.length,kept:live.filter(allowed).length,excluded:live.filter(m=>!allowed(m)).map(m=>({id:m.id,country:m.tournament?.category?.name,competition:m.tournament?.name,reason:competitionDecision(m.tournament??{},m.tournament?.category??{}).reason}))};
     await enqueue(async()=>{
       catalogIds=new Set(kept.map(m=>m.id));
       for(const m of kept){
         if(cache.putMatch(m,rev))await publishMatch(m);
         const top=[m.main_market,m.secondary_market].filter(Boolean);
         await publishMarkets(m.id,cache.putMarkets(m.id,top,{startedAt:rev}));
       }
       Object.assign(state,{syncedAt:new Date().toISOString(),lastError:null,received:matches.length,kept:kept.length,skipped:matches.length-kept.length,catalogComplete:true,cycles:state.cycles+1});
       await onCycle?.(state);
     });
     void repair().catch(error=>{state.lastError=error.message;});
     cache.prune({keepIds:[...catalogIds,...focused.keys(),...(await getWatchedIds()).filter(isYbetsMatchId).map(nativeMatchId)]});
   }catch(error){state.lastError=error.message;state.catalogComplete=false;onStatus?.({error:error.message});}
   finally{state.running=false;}
 }
 socket=new Socket({http,WebSocketImpl:WebSocket,
   onStatus:s=>{Object.assign(state,{socket:s});onStatus?.(s);},
   onResync:()=>{fullAt.clear();void tick();void repair();},
   onEvent:event=>{void enqueue(async()=>{
     const raw=event.message?.match;
     if(raw&&!cache.matches.has(raw.id)&&!allowed(raw))return;
     const update=cache.event(event);if(!update)return;
     if(update.match){await publishMatch(update.match,{facts:raw??update.match});const m=update.match;
       if(m.status!==0&&m.status!==1){await publishMarkets(m.id,cache.putMarkets(m.id,[],{complete:true}));}
       if(Number(m.status)===4&&raw?.statistics?.total_score==null)void refreshMatch(internalMatchId(m.id),{full:false}).catch(()=>{});
     }
     if(update.markets)await publishMarkets(update.id,update.markets);
   }).catch(()=>{});}
 });
 socket.start();timer=setTimer(()=>void tick(),Math.max(10000,pollMs));fullTimer=setTimer(()=>void repair(),5000);void tick();
 return {state,cache,tick,refreshMatch,async focus(id){if(!isYbetsMatchId(id))return;const native=nativeMatchId(id);focused.set(native,Date.now()+300000);socket.setMatchIds(await targets());if(Date.now()-(fullAt.get(native)??0)<15000)return;if(fullAt.has(native)){void refreshMatch(Number(id)).catch(error=>{state.lastError=error.message;});return;}return refreshMatch(Number(id));},
   stop(){stopped=true;state.paused=true;clearTimer(timer);clearTimer(fullTimer);socket.stop();},
   pause(){if(state.paused)return false;state.paused=true;state.pauses++;socket.stop();return true;},
   resume(){if(!state.paused)return false;state.paused=false;state.resumes++;socket.start();void tick();return true;},
   isPaused:()=>state.paused,drain:async()=>{await Promise.allSettled([...inflight.values()]);await work;}
 };
}
