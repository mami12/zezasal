import {isBoardOddsRow} from './ledger/board-projection.mjs';
import {CACHE,META,get,decode,startMqtt} from './zizobet/transport.mjs';
import {rowOf,infoOf,oddsOf,isZizoId,OFFSET} from './zizobet/normalize.mjs';
import {collectEventEvidence} from './zizobet/event-collector.mjs';
import {archiveZizobetMatchHistory} from './ledger/zizobet-match-history.mjs';
import {providerTimeline,inheritEventPlayers} from './live-event-timeline.mjs';
export {isZizoId};
export function startZizoFeed({onMatch,onInfo,onOdds,onStatus,onCycle,onMarketDefinitions=()=>{},onFixtureDiscovered=()=>{},selectRows=r=>r,getWatchedIds=()=>[],request=get,connectMqtt=startMqtt,autoStart=true,now=()=>Date.now(),transitionGraceMs=120000,retentionMs=21600000,historyEnabled=autoStart,archiveHistory=archiveZizobetMatchHistory}={}){
 const meta={teams:new Map(),regions:new Map(),champs:new Map(),liveMarkets:new Map(),preMarkets:new Map(),positions:new Map(),statuses:new Map()};
 const state={provider:'ZIZOBET',transport:'MQTT cache invalidations + HTTP snapshots',running:false,cycles:0,syncedAt:null,lastError:null,received:0,kept:0,paused:false,pauses:0,resumes:0};
 const games=new Map(),quotes=new Map(),focused=new Map(),inflight=new Map(),dirty=new Set(),versions=new Map(),fullObserved=new Map(),watchedSnapshotAt=new Map(),transitions=new Map(),historyPollAt=new Map(),historyFinalized=new Set(),historyFtAttempts=new Map();let stopped=false,work=Promise.resolve(),mqtt,catalogAt=0,revision=0;
 const queue=fn=>{const p=work.then(()=>stopped||state.paused?undefined:fn());work=p.catch(e=>{state.lastError=e.message;});return p;};
 const mainQuotes=(quotes,live)=>(quotes??[]).filter(q=>{const id=Number(q.mid),def=(live?meta.liveMarkets:meta.preMarkets).get(id);const name=(live&&id===602)||(!live&&id===448)?'Full Time Result':(live&&id===603)||(!live&&id===537)?'Total Goals':def?.Name??def?.name??'';return isBoardOddsRow({market_name:name,period:/\b(?:half|period)\b/i.test(name)?1:0});});
 async function publish(row,game,rows,{complete=false,startedAt=++revision}={}){
  if(startedAt<(versions.get(row.match_id)??0))return;versions.set(row.match_id,startedAt);
  const entry=games.get(Number(row.raw?.nativeId));
  const received=providerTimeline(row.match_id,game.TimeLines);
  // Lightweight provider updates can omit an actor, even for the same ID.
  // Keep the previously confirmed label without reintroducing deleted events.
  const timeline=received?inheritEventPlayers(received,entry?.row?.raw?.eventTimeline):received;
  if(timeline)row={...row,raw:{...row.raw,eventTimeline:timeline}};
  // Keep the last complete provider timeline across the lightweight headers.
  // A header carries no incidents and must not erase an observed event minute.
  if(!timeline&&Array.isArray(entry?.row?.raw?.eventTimeline))row={...row,raw:{...row.raw,eventTimeline:entry.row.raw.eventTimeline}};
  if(entry)entry.row=row;
  await onMatch(row);const info=infoOf(row,game,meta);if(Array.isArray(row.raw?.eventTimeline))info.events=row.raw.eventTimeline;await onInfo(info);
  if(entry&&info.hasOpenOdds!==undefined)entry.pricesSuspended=info.hasOpenOdds===false;
  const old=quotes.get(row.match_id)??new Map(),key=r=>r.marketKey+'|'+r.line+'|'+r.outcomeKey,present=new Set(rows.map(key));
  if(complete)for(const[k,r]of old)if((complete===true||isBoardOddsRow({market_name:r.marketName,period:r.period}))&&!present.has(k))rows.push({...r,price:null,suspended:true});
  for(const r of rows)old.set(key(r),r);quotes.set(row.match_id,old);if(rows.length)await onOdds(rows);
  return row;
 }
 async function suspend(entry){
  if(entry.pricesSuspended===true)return;entry.pricesSuspended=true;
  await onInfo({matchId:entry.row.match_id,hasOpenOdds:false});
  const old=quotes.get(entry.row.match_id),rows=[...(old?.values()??[])].map(r=>({...r,suspended:true}));
  for(const r of rows)old.set(r.marketKey+'|'+r.line+'|'+r.outcomeKey,r);
  if(rows.length)await onOdds(rows);
 }
 function transition(id,entry){
  if(!transitions.has(id))transitions.set(id,{at:now(),next:0,failures:0});
  entry.transitionAt??=now();
 }
 const liveIds=()=>[...games.entries()].filter(([,e])=>e.live&&e.row.status!=='ended'&&now()-Math.max(e.seenAt??0,e.verifiedAt??0)<retentionMs).map(([id])=>id);
 async function metadata(){
  if(stopped||state.paused)return;
  const [teams,live,pre]=await Promise.all([request(META+'sport/getheader/teams/en'),request(META+'sport/getlivemarkets/en'),request(META+'prematch/getprematchmarketsbysport/en/,1,')]);
  if(stopped||state.paused)return;
  for(const t of teams??[])if(Number(t.Sport)===1)meta.teams.set(Number(t.ID),t);
  for(const s of live.StatusNames??[])meta.statuses.set(s.it,s.nm);for(const s of live.PositionNames??[])meta.positions.set(s.it,s.nm);
  // The full-game definition is richer than the global names dictionary.
  // A periodic metadata refresh must not replace its contract qualifiers.
  for(const m of live.MarketNames??[])if(!meta.liveMarkets.has(Number(m.it)))meta.liveMarkets.set(Number(m.it),{ID:Number(m.it),Name:m.nm});
  const definitions=Array.isArray(pre)?pre[0]:pre?.['1'];if(!definitions||Object.keys(definitions).length<10)throw Error('Full Zizobet market dictionary unavailable');
  for(const[id,m]of Object.entries(definitions))meta.preMarkets.set(Number(id),m);
  catalogAt=now();
  // These dictionaries are ALREADY fetched for odds parsing. Persist their
  // native titles and rule metadata without any additional HTTP API calls.
  const archivalDefinitions=[
   ...[...meta.liveMarkets].map(([id,definition])=>({
    provider:'ZIZOBET',scope:'LIVE',id,name:definition.Name??definition.nm,
    definition
   })),
   ...[...meta.preMarkets].map(([id,definition])=>({
    provider:'ZIZOBET',scope:'PREMATCH',id,
    name:definition.Name??definition.name,definition
   }))
  ];
  void Promise.resolve().then(()=>onMarketDefinitions(archivalDefinitions))
   .catch(e=>console.warn('[zizobet] native market catalog archive:',e.message));
 }
 async function liveList(){
  if(stopped||state.paused)return;
  const startedAt=++revision,data=await request(CACHE+'live/headerformobilenew/en');if(!Array.isArray(data?.Games))throw Error('Invalid Zizobet live header');
  if(stopped||state.paused)return;
  for(const t of data.Teams??[])meta.teams.set(Number(t.ID),t);for(const r of data.Regions??[])meta.regions.set(Number(r.ID),r);for(const c of data.Championats??[])meta.champs.set(Number(c.ID),c);for(const m of data.mk??[])meta.liveMarkets.set(Number(m.ID),m);
  const rows=[];await queue(async()=>{for(const g of data.Games){if(Number(g.Sport)!==1)continue;const r=rowOf(g,meta,true);if(!r)continue;const id=Number(g.ID),previous=games.get(id);r.status=Number(g.MatchStatusID)===40?'ended':'live';rows.push(r);
   // A delayed catalogue cannot roll back a newer detail or resurrect FT.
   if(previous?.live&&(previous.row.status==='ended'||startedAt<(versions.get(r.match_id)??0)))continue;
   if(Array.isArray(previous?.row?.raw?.eventTimeline))r.raw={...r.raw,eventTimeline:previous.row.raw.eventTimeline};
   const hadLive=previous?.live,entry=previous??{};entry.row=r;entry.raw={...entry.raw,...g};entry.live=true;entry.seenAt=now();delete entry.transitionAt;transitions.delete(id);games.set(id,entry);
   // Header prices remain live after a detail viewer leaves. Preserve a full
   // snapshot's suspension until a new full snapshot confirms reopening.
   if(hadLive&&fullObserved.has(id)&&r.status!=='ended'){
    const open=entry.pricesSuspended!==true&&g.LiveBetStatus!==false;
    await publish(r,open?g:{...g,LiveBetStatus:false},oddsOf(r,mainQuotes(g.hprs,true),meta,true,open),{complete:'board',startedAt});
    continue;
   }
   // LIVE phase evidence outranks an overlapping newer PREMATCH request.
    await publish(r,g,oddsOf(r,g.hprs,meta,true,g.LiveBetStatus!==false&&r.status!=='ended'),{complete:!hadLive,startedAt:hadLive?startedAt:++revision});}
   const present=new Set(rows.map(r=>Number(r.raw.nativeId)));for(const[id,e]of games)if(e.live&&!present.has(id)&&e.row.status!=='ended'){
    // A missing page is not FT. Retain the subscription and verify directly;
    // only close prices once their authoritative snapshot is no longer fresh.
    if(now()-Math.max(e.seenAt??0,e.verifiedAt??0)>=retentionMs)continue;
    if(now()-(fullObserved.get(id)??-Infinity)>30000)await suspend(e);
    dirty.add('live/gamenew/'+id);
   }
   state.live=liveIds().length;await onCycle?.(state);
  });
  mqtt?.setLiveIds(liveIds());
  // Full live snapshots carry verified corners/cards and the event timeline.
    const liveRefreshMs=Math.max(30000,Number(process.env.ZIZO_LIVE_REFRESH_MS)||60000);
    for(const r of rows)if(focused.get(Number(r.raw.nativeId))>now()&&now()-(fullObserved.get(Number(r.raw.nativeId))??0)>=liveRefreshMs)dirty.add('live/gamenew/'+r.raw.nativeId);
 }
 let pendingPre=[];
 async function prematchList(){
  if(stopped||state.paused)return;
  const data=await request(META+'sport/getheader/en');const sport=data?.EN?.Sports?.['1'];if(!sport)throw Error('Invalid Zizobet prematch header');
  if(stopped||state.paused)return;
  const raw=[];
  for(const region of Object.values(sport.Regions??{})){meta.regions.set(Number(region.ID),region);for(const champ of Object.values(region.Champs??{})){meta.champs.set(Number(champ.ID),champ);for(const g of Object.values(champ.GameSmallItems??{})){if(Number(g.ID)<=0)continue;raw.push({...g,Region:g.Region??g.region??region.ID,Champ:g.Champ??g.ch??champ.ID,Team1:g.t1,Team2:g.t2});}}}
  const present=new Set(raw.map(g=>Number(g.ID))),prepared=raw.map(g=>({g,row:rowOf(g,meta,false)})).filter(x=>x.row&&!games.get(Number(x.g.ID))?.live);
  // Preflight information from the provider's FULL PREMATCH catalog, not just
  // the fixtures published on the betting board. This callback is lightweight
  // and cannot write odds or cause synchronous external API requests.
  for(const item of prepared)try{onFixtureDiscovered(item.row);}catch(error){
   console.warn('[zizobet] prematch information watch:',error?.message);
  }
  const selected=new Set(selectRows(prepared.map(x=>x.row)).map(r=>r.match_id));
  await queue(async()=>{for(const {g,row}of prepared){if(!selected.has(row.match_id)||games.get(Number(g.ID))?.live)continue;transitions.delete(Number(g.ID));games.set(Number(g.ID),{row,raw:g,live:false});await onMatch(row);}
   for(const[id,e]of games)if(!e.live&&!selected.has(e.row.match_id)){
    // Actual removal may be the small gap between the two provider catalogs.
    // An admin-filtered fixture still present in prematch is closed normally.
    const start=Date.parse(e.row.start_at),nearKickoff=Number.isFinite(start)&&now()>=start-120000&&now()-start<retentionMs;
    if(!present.has(id)&&(nearKickoff||transitions.has(id))){transition(id,e);if(now()-e.transitionAt<transitionGraceMs){await suspend(e);continue;}}
    if(e.row.status!=='closed'){e.row={...e.row,status:'closed'};await publish(e.row,{...e.raw,s:1},[],{complete:true});}
   }
   state.received=raw.length;state.kept=selected.size+(state.live??0);state.cycles++;state.syncedAt=new Date(now()).toISOString();await onCycle?.(state);});
  pendingPre=[...selected].filter(id=>!quotes.has(id)).map(id=>id-OFFSET);
 }
 async function refreshPrematchBoard(ids){
  ids=[...new Set(ids.map(Number))].filter(id=>games.has(id)&&!games.get(id).live);
  if(!ids.length)return;
  const startedAt=++revision,result=await request(META+'prematch/getprematchgameall/en/319/?games=,'+ids.join(',')),list=decode(result?.game);
  if(!Array.isArray(list))throw Error('Invalid prematch board response');
  const wanted=new Set(ids);
  await queue(async()=>{for(const game of list){const id=Number(game.id),entry=games.get(id);if(!wanted.has(id)||!entry||entry.live)continue;
   const quotes=[];for(const[mid,values]of Object.entries(game.ev??{}))for(const[key,value]of Object.entries(values??{}))quotes.push({...value,id:key,mid});
   await publish(entry.row,game,oddsOf(entry.row,mainQuotes(quotes,false),meta,false,game.s===0),{complete:'board',startedAt});
  }});
 }
 async function refresh(id,{probeLive=false,full=false,historyOnly=false}={}){
  if(stopped||state.paused)return;
  if(inflight.has(Number(id))){await inflight.get(Number(id));if(full&&now()-(fullObserved.get(Number(id))??-Infinity)>=3000)return refresh(id,{probeLive,full});return;}
  const task=(async()=>{
   const startedAt=++revision;
   // Pending tickets need the complete incident snapshot, not every quote.
   const needsTicketEvidence=[...await getWatchedIds()].some(value=>Number(value)-OFFSET===Number(id));
   full=full||focused.get(Number(id))>now();
   let entry=games.get(Number(id)),recovered;
   if(!entry){recovered=await request(CACHE+'live/gamenew/'+Number(id));if(Number(recovered?.Match?.GameID)!==Number(id))throw Error('Pending result snapshot unavailable');const row=rowOf(recovered.Match,meta,true);if(!row)throw Error('Pending match metadata unavailable');entry=games.get(Number(id))??{row,raw:recovered.Match,live:true};games.set(Number(id),entry);}
   if(entry&&!entry.live&&!probeLive&&!full)return refreshPrematchBoard([Number(id)]);
   if(!entry.live&&probeLive){
    const candidate=await request(CACHE+'live/gamenew/'+Number(id));
    if(Number(candidate?.Match?.GameID)!==Number(id)||!Array.isArray(candidate?.gmk)||!Number.isFinite(Number(candidate.Match.EventStatus))||Number(candidate.Match.EventStatus)<=0)throw Error('Live transition not confirmed');
    recovered=candidate;
   }
   if(entry.live||recovered){const data=recovered??await request(CACHE+'live/gamenew/'+Number(id));if(!data?.Match)throw Error('Missing live game snapshot');
    // Ended/suspended fixtures may have no market grid yet still provide goals,
    // corners and cards. Record that history without touching existing odds.
    if(!Array.isArray(data.gmk))historyOnly=true;if(Number(data.Match.GameID)!==Number(id))throw Error('Zizobet live identity mismatch');for(const m of data.mk??[])meta.liveMarkets.set(Number(m.ID),m);
    if(entry.row.status==='ended'&&Number(data.Match.EventStatus)!==40)return;
    const game={...entry.raw,...data.Match,...(Array.isArray(data.TimeLines)?{TimeLines:data.TimeLines}:{})},row={...entry.row,service:'LIVE',status:entry.row.status==='ended'||Number(game.EventStatus)===40?'ended':'live'};
    // One upstream response has one observation time, even when it feeds
    // both the all-match archive and the ticket recovery reader.
    const sampledAt=new Date();
    let archiveFactsPersisted=false;
    // The independently retained sports archive covers EVERY live fixture,
    // not only fixtures with accepted bets. Never persist gmk/odds.
    if(historyEnabled){
     try{
      const recorded=await archiveHistory(row.match_id,{Match:data.Match,
       ...(Array.isArray(data.TimeLines)?{TimeLines:data.TimeLines}:{})},row,
       {observedAt:sampledAt});
      archiveFactsPersisted=Array.isArray(recorded?.verifiedKinds)&&
       recorded.verifiedKinds.length>0;
      const interval=Math.max(30000,Number(process.env.ZIZO_HISTORY_REFRESH_MS)||60000);
      const ended=Number(data.Match.EventStatus??data.Match.MatchStatusID)===40;
      // At FT retry incomplete provider timelines at a slower pace rather
      // than declaring that all missing incidents were archived.
      // Recheck the first FT snapshot quickly to establish two independent
      // observations, then slow down if native data remains incomplete.
      const finishedAttempts=(historyFtAttempts.get(Number(id))??0)+(ended?1:0);
      if(ended)historyFtAttempts.set(Number(id),finishedAttempts);
      historyPollAt.set(Number(id),now()+(ended?
        (finishedAttempts<=3?Math.max(30000,interval):Math.max(300000,interval*5)):interval));
      // FT is finalized only when a second matching provider observation
      // confirms its canonical event facts. A single complete-looking frame
      // must not authorize a payout or stop the next verification poll.
      if(ended&&Array.isArray(data.TimeLines)&&
         ['goal','corner','card'].every(kind=>recorded?.confirmedKinds?.includes(kind)))
       historyFinalized.add(Number(id));
     }catch(error){console.warn('[zizobet] match history',row.match_id,error?.message);}
    }
    if(autoStart&&(full||needsTicketEvidence))
     void collectEventEvidence(row,{...data,Match:game},{
       observedAt:sampledAt,factsPersisted:archiveFactsPersisted
     }).catch(()=>{});
    await queue(async()=>{const published=await publish(row,game,historyOnly?[]:oddsOf(row,full?data.gmk:mainQuotes(data.gmk,true),meta,true,game.LiveBetStatus!==false&&row.status!=='ended'),{complete:historyOnly?false:full,startedAt});if(startedAt>=(versions.get(row.match_id)??0)){const promoted=!entry.live;entry.live=true;entry.row=published??row;entry.raw=game;entry.verifiedAt=now();transitions.delete(Number(id));delete entry.transitionAt;if(full)fullObserved.set(Number(id),now());if(promoted){const ids=liveIds();state.live=ids.length;mqtt?.setLiveIds(ids);await onCycle?.(state);}}});
   }else{const result=await request(META+'prematch/getprematchgamefull/319/'+Number(id));const g=decode(result?.game);if(Number(g?.id)!==Number(id))throw Error('Zizobet prematch identity mismatch');
    const quotes=[];for(const[mid,list]of Object.entries(g.ev??{}))for(const[id,q]of Object.entries(list??{}))quotes.push({...q,id,mid});const disabled=new Set((Array.isArray(result.disableMarkets)?result.disableMarkets:[]).map(Number));
    await queue(async()=>{const current=games.get(Number(id));if(current?.live||transitions.has(Number(id)))return;await publish(current?.row??entry.row,g,oddsOf(current?.row??entry.row,(full?quotes:mainQuotes(quotes,false)).filter(q=>!disabled.has(Number(q.mid))),meta,false,g.s===0),{complete:full,startedAt});if(full)fullObserved.set(Number(id),now());});
   }
  })().finally(()=>inflight.delete(Number(id)));inflight.set(Number(id),task);return task;
 }
 let flushing=false;
 async function flush(){if(stopped||state.paused||flushing)return;flushing=true;try{
  const topics=[...dirty];dirty.clear();
  for(const[topic,run]of[['live/headerformobilenew/en',liveList],['prematch/markets',metadata],['prematch/header',prematchList]])if(topics.includes(topic))try{await run();}catch(e){state.lastError=e.message;dirty.add(topic);}
  if(topics.includes('prematch/games'))try{const data=await request(CACHE+'prematch/games');for(const r of data?.UpdateList??[])if(games.has(Number(r.GameId))&&!games.get(Number(r.GameId)).live)pendingPre.push(Number(r.GameId));for(const value of data?.DeleteList??[]){const id=Number(value?.GameId??value),e=games.get(id);if(e&&!e.live){transition(id,e);await queue(()=>suspend(e));dirty.add('live/headerformobilenew/en');}}}catch(e){state.lastError=e.message;dirty.add('prematch/games');}
  const ids=new Set(topics.filter(t=>/^live\/gamenew\/\d+$/.test(t)).map(t=>Number(t.split('/').at(-1))));
  for(const[id,until]of focused){if(until<now())focused.delete(id);else if(now()-(fullObserved.get(id)??-Infinity)>=Math.max(15000,Number(process.env.ZIZO_FOCUSED_REFRESH_MS)||30000))ids.add(id);}
  const watched=new Set();for(const id of await getWatchedIds())if(isZizoId(id)){
    const native=Number(id)-OFFSET;watched.add(native);
    // One pending ticket must not cause full odds/timeline downloads every 3s.
    if(now()-(watchedSnapshotAt.get(native)??-Infinity)>=15000){ids.add(native);watchedSnapshotAt.set(native,now());}
  }
  for(const native of watchedSnapshotAt.keys())if(!watched.has(native))watchedSnapshotAt.delete(native);
  // Bounded round-robin history polls: every active fixture eventually gets
  // its own Zizobet TimeLines detail, even when nobody opens it or bets on it.
  // An archive-only request never fetches/parses the full market grid for storage.
  const historyOnlyIds=new Set();
  if(historyEnabled){
   const interval=Math.max(30000,Number(process.env.ZIZO_HISTORY_REFRESH_MS)||60000);
   const batch=Math.max(1,Math.min(8,Number(process.env.ZIZO_HISTORY_PER_FLUSH)||4));
   const due=[...games.entries()].filter(([id,e])=>e.live&&
    (e.row.status!=='ended'||!historyFinalized.has(id))&&
    now()-Math.max(e.seenAt??0,e.verifiedAt??0)<retentionMs&&
    now()>=(historyPollAt.get(id)??0))
    .sort((a,b)=>(historyPollAt.get(a[0])??0)-(historyPollAt.get(b[0])??0));
   for(const [id] of due.slice(0,batch)){
    historyPollAt.set(id,now()+interval);
    if(!ids.has(id)){ids.add(id);historyOnlyIds.add(id);}
   }
   if(historyPollAt.size>10000)for(const id of historyPollAt.keys())if(!games.has(id))historyPollAt.delete(id);
  }
  for(const[id,t]of transitions){if(now()-t.at>=retentionMs){transitions.delete(id);continue;}if(t.next<=now())ids.add(id);}
  const pending=[...new Set(pendingPre.splice(0,160))],board=[];
  for(const id of pending){if(focused.get(id)>now()||watched.has(id))ids.add(id);else if(games.has(id)&&!games.get(id).live)board.push(id);}
  const batches=[];for(let i=0;i<board.length;i+=80)batches.push(board.slice(i,i+80));
  const loaded=await Promise.allSettled(batches.map(refreshPrematchBoard));for(let i=0;i<loaded.length;i++)if(loaded[i].status==='rejected'){pendingPre.push(...batches[i]);state.lastError=loaded[i].reason?.message??'Prematch board refresh failed';}

    const batchSize=Math.min(20,Math.max(1,Number(process.env.ZIZO_SNAPSHOT_CONCURRENCY)||8)),all=[...ids];for(let i=0;i<all.length;i+=batchSize){if(stopped||state.paused)break;const batch=all.slice(i,i+batchSize),results=await Promise.allSettled(batch.map(id=>refresh(id,{probeLive:transitions.has(id)||watched.has(id),historyOnly:historyOnlyIds.has(id)})));for(let j=0;j<results.length;j++)if(results[j].status==='rejected'){state.lastError=results[j].reason?.message??'Snapshot refresh failed';const t=transitions.get(batch[j]);if(t){t.failures++;t.next=now()+Math.min(300000,15000*2**Math.min(t.failures-1,5));}}}
 }catch(e){state.lastError=e.message;}finally{flushing=false;}}
 async function tick(){if(stopped||state.paused||state.running)return;state.running=true;state.lastError=null;try{if(!catalogAt||now()-catalogAt>600000)try{await metadata();}catch(e){state.lastError=e.message;}for(const run of[liveList,prematchList]){if(stopped||state.paused)break;try{await run();}catch(e){state.lastError=e.message;}}if(!stopped&&!state.paused)await flush();}catch(e){state.lastError=e.message;}finally{state.running=false;}}
 mqtt=connectMqtt({onInvalidate:topic=>dirty.add(topic),onStatus:s=>{state.socket=s;onStatus?.({...s,provider:'ZIZOBET'});}});
 let timers=[];
 const armTimers=()=>{if(autoStart&&!timers.length)timers=[setInterval(()=>void flush(),3000),setInterval(()=>void tick(),60000),setInterval(()=>{dirty.add('live/headerformobilenew/en');},15000)];};
 const stopTimers=()=>{timers.forEach(clearInterval);timers=[];};
 armTimers();if(autoStart)void tick();
 return{state,tick,fullMarketsReady(id){const native=Number(id)-OFFSET;return isZizoId(id)&&fullObserved.has(native);},async focus(id){if(!isZizoId(id))return;const native=Number(id)-OFFSET;focused.set(native,now()+300000);if(now()-(fullObserved.get(native)??0)<3000)return;return refresh(native,{probeLive:transitions.has(native),full:true});},pause(){if(state.paused)return false;state.paused=true;state.pauses++;stopTimers();mqtt.pause();return true;},resume(){if(!state.paused)return false;state.paused=false;state.resumes++;armTimers();mqtt.resume();dirty.add('live/headerformobilenew/en');void tick();return true;},stop(){stopped=true;state.paused=true;stopTimers();mqtt.stop();},isPaused:()=>state.paused,async drain(){await Promise.allSettled([...inflight.values()]);await work;}};
}
