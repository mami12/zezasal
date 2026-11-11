import {acceptedBetWatchIds,saveEventEvidence,normalizeEvents} from '../ledger/event-evidence.mjs';
import {recordWatchedLiveFrame} from '../ledger/live-observation-store.mjs';

/** One PRIMARY Zizobet snapshot per watched fixture, no secondary API calls.
 * Feed corrections are reconciled in the transactional PostgreSQL fact store.
 */
export function createEventCollector({
 getWatchIds=acceptedBetWatchIds,save=saveEventEvidence,recordFrame=recordWatchedLiveFrame,
 now=Date.now,refreshMs=15000,maxActive=3
}={}){
 let active=0;
 const last=new Map(),inflight=new Set();
 return async function collectEventEvidence(row,data){
  const id=String(row.match_id);
  if(!(await getWatchIds()).has(id)||inflight.has(id)||active>=maxActive)return;
  if(now()-(last.get(id)??-Infinity)<refreshMs)return;
  inflight.add(id);active++;last.set(id,now());
  if(last.size>3000)last.delete(last.keys().next().value);
  try{
   const evidence=normalizeEvents(data,'zizobet');
   // Capture raw and structured incidents without depending on AiScore:
   // AiScore may later add a scorer name but never changes result/time/team.
   const settled=await Promise.allSettled([
    save(row.match_id,evidence),
    recordFrame(row.match_id,data)
   ]);
   for(const item of settled)if(item.status==='rejected')
    console.warn('[primary event capture]',String(row.match_id),String(item.reason?.message??item.reason));
  }finally{inflight.delete(id);active--;}
 };
}
export const collectEventEvidence=createEventCollector();
