import {query} from '../db.mjs';
const fields=['match_id','home','away','home_score','away_score','score_at','feed_status','feed_status_at','periods_score','stats','raw','service','start_at','tournament_id','tournament_name','category_id','category_name','category_slug'];
/** A compact latest provider snapshot; never manufacture zeroes for absent facts. */
export function snapshotRow(row){if(!row||!Number.isSafeInteger(Number(row.match_id))||Number(row.match_id)<=0)return null;return Object.fromEntries(fields.filter(key=>row[key]!=null).map(key=>[key,key==='raw'?{homeTeam:row.raw?.homeTeam,awayTeam:row.raw?.awayTeam,competitors:row.raw?.competitors,...(Array.isArray(row.raw?.eventTimeline)?{eventTimeline:row.raw.eventTimeline.slice(0,300)}:{}),...(row.raw?.provider==='YBETS'?{provider:'YBETS',nativeMatchId:row.raw.nativeMatchId,ybetsFinalScoreVerified:row.raw.ybetsFinalScoreVerified===true}:{})}:row[key]]));}
export function createMatchSnapshotStore(runQuery=query){
  const fingerprints=new Map();
  return {async save(row){const snapshot=snapshotRow(row);if(!snapshot)return false;
    const fingerprint=JSON.stringify([snapshot.home_score,snapshot.away_score,snapshot.feed_status,snapshot.periods_score,snapshot.stats,snapshot.raw]);
    if(fingerprints.get(Number(row.match_id))===fingerprint)return false;
    await runQuery(`insert into app_match_snapshot(match_id,snapshot) values($1,$2::jsonb) on conflict(match_id) do update set snapshot=excluded.snapshot,observed_at=now()`,[snapshot.match_id,JSON.stringify(snapshot)]);
    fingerprints.set(Number(row.match_id),fingerprint);if(fingerprints.size>10000)fingerprints.delete(fingerprints.keys().next().value);return true;
  },async load(ids){if(!ids.length)return [];const result=await runQuery('select snapshot from app_match_snapshot where match_id=any($1::bigint[])',[ids]);return result.rows.map(row=>row.snapshot);}};
}
export const matchSnapshots=createMatchSnapshotStore();
