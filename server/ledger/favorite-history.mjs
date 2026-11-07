import {query} from '../db.mjs';
import {teamStatisticsFromRow,statisticNumber} from '../match-statistics.mjs';

export const FINISHED_FAVORITE_RETENTION_MS=48*60*60*1000;

/** Read-only final match summaries, indexed by requested favorite IDs.
 * No odds, no wallet operations and no archived match is ever bettable.
 */
export function favoriteIds(value){
 const raw=Array.isArray(value)?value:String(value??'').split(',');
 return [...new Set(raw.map(v=>String(v).trim()).filter(v=>/^\d{1,16}$/.test(v)&&Number(v)>0&&Number.isSafeInteger(Number(v))))].slice(0,100);
}
const pair=(home,away)=>{
 const h=statisticNumber(home),a=statisticNumber(away);
 return h!==null&&a!==null?{home:h,away:a}:null;
};
const iso=value=>{
 const at=new Date(value??'').getTime();
 return Number.isFinite(at)?new Date(at).toISOString():null;
};
const parse=value=>{if(typeof value!=='string')return value;try{return JSON.parse(value);}catch{return null;}};
export function archivedFavorite(row,now=Date.now()){
 const end=iso(row.finished_at),at=end?Date.parse(end):NaN;
 if(!Number.isFinite(at)||at>now+60000||now-at>=FINISHED_FAVORITE_RETENTION_MS)return null;
 const snapshot=parse(row.snapshot)??{},raw=snapshot.raw??{};
 const score=pair(row.home_score,row.away_score);
 if(!score)return null;
 const fromFeed=teamStatisticsFromRow(snapshot);
 const finalStats=parse(row.statistics)??{},review=parse(row.statistics_review);
 const stats=name=>{
   if(review?.conflicts?.[name])return null;
   const consensus=review?.complete?review.consensus?.[name]:null;
   return pair(consensus?.home??finalStats?.[name]?.home??fromFeed.home?.[name],
     consensus?.away??finalStats?.[name]?.away??fromFeed.away?.[name]);
 };
 const cornerConsensus=review?.complete&&!review.conflicts?.corners?review.consensus?.corners:null;
 const corners=review?.conflicts?.corners?null:pair(
   cornerConsensus?.home??row.corners_home??fromFeed.home?.corners,
   cornerConsensus?.away??row.corners_away??fromFeed.away?.corners);
 const cards=review?.conflicts?.cards?null:pair(row.cards_home,row.cards_away);
 const events=Array.isArray(raw.eventTimeline)?raw.eventTimeline.filter(event=>
   event&&['home','away'].includes(event.team)&&Number.isInteger(Number(event.minute))&&
   Number(event.minute)>=0&&Number(event.minute)<=130&&
   ['goal','corner','yellow_card','red_card'].includes(event.type)).slice(0,300):[];
 const startTime=iso(snapshot.start_at)??end;
 return {
   id:String(row.match_id),
   homeTeam:snapshot.home??row.home_team??'',
   awayTeam:snapshot.away??row.away_team??'',
   startTime,finishedAt:end,
   tournamentId:String(snapshot.tournament_id??''),
   tournament:{id:String(snapshot.tournament_id??''),name:snapshot.tournament_name??'',
     category:{id:String(snapshot.category_id??''),name:snapshot.category_name??''}},
   status:'ENDED',period:'FT',homeScore:score.home,awayScore:score.away,
   scoreAt:iso(snapshot.score_at)??end,phaseAt:end,updatedAt:end,snapshotAt:end,
   isSuspended:true,marketCount:0,markets:[],
   corners,cards,shots:stats('shots'),shotsOnTarget:stats('shotsOnTarget'),fouls:stats('fouls'),
   events,listingStale:false,
 };
}
export async function recentFinishedFavorites(ids,{runQuery=query,now=Date.now()}={}){
 const unique=favoriteIds(ids);
 if(!unique.length)return [];
 const result=await runQuery(`select r.match_id,r.home_team,r.away_team,r.home_score,r.away_score,
   r.corners_home,r.corners_away,r.cards_home,r.cards_away,r.statistics,r.finished_at,
   s.snapshot,sr.payload as statistics_review
   from app_match_result r
   left join app_match_snapshot s on s.match_id=r.match_id
   left join app_stat_review sr on sr.match_id=r.match_id
   where r.match_id=any($1::bigint[])
     and r.finished_at >= now()-interval '48 hours'
   order by r.finished_at desc`,[unique.map(Number)]);
 return result.rows.map(row=>archivedFavorite(row,now)).filter(Boolean);
}
