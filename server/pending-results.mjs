import {mergeTeamStats} from './match-statistics.mjs';
/** Track final provider snapshots for tickets, independently of board limits/visitors. */
export function createPendingResultTracker({query,archive,isFinished,onArchived=()=>{},saveSnapshot=null,loadSnapshots=null}) {
  let watched=new Set(),refreshedAt=null;
  const snapshots=new Map(),saved=new Map();
  return {
    ids:()=>[...watched],
    stats:()=>({pendingMatches:watched.size,refreshedAt}),
    async refresh() {
      const {rows}=await query(`select distinct l.match_id from app_ticket_line l join app_ticket t on t.id=l.ticket_id
        where l.status='PENDING' and t.status='PENDING' order by l.match_id`);
      watched=new Set(rows.map(row=>Number(row.match_id)).filter(id=>Number.isSafeInteger(id)&&id>0));
      if(loadSnapshots){for(const row of await loadSnapshots([...watched]))if(!snapshots.has(Number(row.match_id)))snapshots.set(Number(row.match_id),row);}
      for(const key of snapshots.keys())if(!watched.has(key)){snapshots.delete(key);saved.delete(key);}
      refreshedAt=new Date().toISOString();return watched.size;
    },
    async observe(info,known=null,at=Date.now()) {
      const id=Number(info.matchId);if(!watched.has(id))return false;
      let row=known;
      if(row)snapshots.set(id,structuredClone(row));
      if(!row) {
        row={...(snapshots.get(id)||{match_id:id,service:'LIVE',home_score:null,away_score:null,score_at:null,feed_status:null})};
        if(typeof info.feedStatus==='string' && info.feedStatus.trim()){row.feed_status=info.feedStatus;row.feed_status_at=new Date(at);}
        const scores=[info.homeScore,info.awayScore];
        if(scores.every(value=>value!=null&&Number.isInteger(Number(value))&&Number(value)>=0)){
          row.home_score=Number(scores[0]);row.away_score=Number(scores[1]);row.score_at=new Date(at);
        }
        if(Array.isArray(info.periodsScore)&&info.periodsScore.length)row.periods_score=info.periodsScore;
        if(info.stats)row.stats=mergeTeamStats(row.stats,info.stats,{observedAt:at});
        snapshots.set(id,row);
        if(saveSnapshot)await saveSnapshot(row);
        // A years-old partial score followed only by a phase flag is not final-score evidence.
        if(!row.score_at||!row.feed_status_at||Math.abs(new Date(row.score_at)-new Date(row.feed_status_at))>120000)return false;
      }
      if(!isFinished(row))return false;
      const fingerprint=JSON.stringify([row.home_score,row.away_score,row.periods_score,row.stats]);
      if(saved.get(id)===fingerprint)return false;
      const result=await archive(row);
      saved.set(id,fingerprint);
      if(result.recorded)await onArchived(id);
      return result.recorded===true;
    },
  };
}
