/**
 * Detail requests must read the latest local snapshot immediately. Fetching
 * all remote markets and persisting their timeline can take seconds, so this
 * schedules the upstream focus independently of the HTTP response.
 */
export function createMatchDetailRefresh({
  boost=()=>{},focus=()=>{},subscribe=()=>{},provider=()=>'',now=Date.now,
  cooldownMs=10000,onError=()=>{}
}={}){
  const pending=new Map(),lastStarted=new Map();
  return function requestMatchRefresh(matchId){
    const id=Number(matchId);
    if(!Number.isSafeInteger(id)||id<=0)return;
    boost(id);
    if(!['ybets','zizobet'].includes(String(provider()).toLowerCase())){
      subscribe(id);
      return;
    }
    const current=now();
    if(pending.has(id)||current-(lastStarted.get(id)??-Infinity)<cooldownMs)return;
    lastStarted.delete(id);
    lastStarted.set(id,current);
    if(lastStarted.size>512)lastStarted.delete(lastStarted.keys().next().value);
    const task=Promise.resolve().then(()=>focus(id))
      .catch(error=>{try{onError(error,id);}catch{}})
      .finally(()=>pending.delete(id));
    pending.set(id,task);
    // Do not return the upstream promise. HTTP callers must never await it.
  };
}
