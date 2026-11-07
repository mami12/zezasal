// A REST request may finish after a newer socket publication. Never let it
// overwrite that publication, including removals from a complete snapshot.
export const marketIdentity = m => `${m.id}:${m.specifier ?? ''}`;
export class YbetsCache {
  revision = 0;
  matches = new Map();
  urnIds = new Map();
  markets = new Map();
  versions = new Map();
  matchVersions = new Map();
  touchedAt = new Map();
  begin() { return this.revision; }
  putMatch(match, startedAt = Infinity) {
    if (!Number.isSafeInteger(match?.id) || match.tournament?.sport?.key !== 'soccer' || match.tournament?.sport?.type !== 'regular') return false;
    if ((this.matchVersions.get(match.id) ?? 0) > startedAt) return false;
    this.matches.set(match.id, structuredClone(match));
    this.urnIds.set(match.urn_id, match.id);
    this.matchVersions.set(match.id, ++this.revision);
    this.touchedAt.set(match.id,Date.now());
    return true;
  }
  putMarkets(id, items, {startedAt = Infinity, complete = false} = {}) {
    let bucket = this.markets.get(id), versions = this.versions.get(id);
    if (!bucket) { bucket = new Map(); versions = new Map(); this.markets.set(id,bucket); this.versions.set(id,versions); }
    const present = new Set(items.map(marketIdentity)), changes = [];
    for (const m of items) {
      const key = marketIdentity(m);
      if ((versions.get(key) ?? 0) > startedAt) continue;
      const previous=bucket.get(key),outcomeId=o=>String(o.id??o.outcome_external_id??o.name);
      const outcomeIds=new Set((m.outcomes??[]).map(outcomeId));
      const removed=(previous?.outcomes??[]).filter(o=>!outcomeIds.has(outcomeId(o))).map(o=>({...o,active:false,odds:0}));
      const next={...m,outcomes:[...(m.outcomes??[]),...removed]};
      bucket.set(key,structuredClone(next)); versions.set(key,++this.revision); changes.push(next);
    }
    if (complete) for (const [key,m] of bucket) {
      if (present.has(key) || (versions.get(key) ?? 0) > startedAt) continue;
      // Keep a tombstone until the next successful snapshot. Old cached odds
      // must close immediately, rather than remaining playable after removal.
      const closed = {...m,status:0,outcomes:(m.outcomes??[]).map(o=>({...o,active:false,odds:0}))};
      bucket.set(key,closed); versions.set(key,++this.revision); changes.push(closed);
    }
    return changes;
  }
  prune({keepIds=[],maxAgeMs=21600000,maxMatches=5000,now=Date.now()}={}) {
    const keep=new Set(keepIds),ordered=[...this.matches.keys()].sort((a,b)=>(this.touchedAt.get(a)??0)-(this.touchedAt.get(b)??0));
    let removed=0;
    for(const id of ordered){
      if(keep.has(id))continue;
      if(this.matches.size<=maxMatches&&now-(this.touchedAt.get(id)??0)<maxAgeMs)continue;
      const m=this.matches.get(id);this.urnIds.delete(m?.urn_id);this.matches.delete(id);this.markets.delete(id);this.versions.delete(id);this.matchVersions.delete(id);this.touchedAt.delete(id);removed++;
    }
    return removed;
  }
  event({eventName,message}) {
    if (['match_changed','match_status_changed'].includes(eventName) && message?.match) {
      const m=message.match;
      // Status publications can be partial. They are usable only for a match
      // already identified from a public football snapshot.
      const old=this.matches.get(m.id), merged=old?{...old,...m,statistics:m.statistics?{...old.statistics,...m.statistics}:old.statistics}:m;
      return this.putMatch(merged)?{match:merged}:null;
    }
    if(eventName==='markets_changed') {
      const id=this.urnIds.get(message?.match_urn_id);
      return id && Array.isArray(message?.markets)?{id,markets:this.putMarkets(id,message.markets)}:null;
    }
    return null;
  }
}
