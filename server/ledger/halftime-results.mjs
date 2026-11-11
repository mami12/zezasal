/**
 * Durable half-time score evidence. NEVER store half-time values in
 * app_match_result, whose scores mean the 90-minute final result.
 * Two independent primary observations >=5s apart must agree.
 */
import {getMatches,getMatchById} from '../matches.mjs';
import {matchSnapshots} from './match-snapshots.mjs';
import {query} from '../db.mjs';

export const HALFTIME_RESULT_SQL=[
 'create table if not exists app_match_half_result (match_id bigint primary key, home_team text not null, away_team text not null, half_home_score integer not null check(half_home_score between 0 and 200), half_away_score integer not null check(half_away_score between 0 and 200), signature text not null, first_seen_at timestamptz not null default now(), observed_at timestamptz not null default now(), confirmed_at timestamptz, correction_count integer not null default 0, source text not null default ' + "'ZIZOBET');",
 'create index if not exists app_match_half_confirmed_idx on app_match_half_result(match_id) where confirmed_at is not null;'
].join('\n');

const score=v=>v!=null&&v!==''&&/^\d+$/.test(String(v))&&
 Number.isSafeInteger(Number(v))&&Number(v)<=200?Number(v):null;
const milliseconds=v=>v==null?NaN:new Date(v).getTime();
const phaseOf=v=>{
 const s=String(v??'').trim().toLowerCase();
 if(/^(?:ht|half.?time|half time|break time|interval|break)$/.test(s))return 'HT';
 if(/^(?:2h|h2|second half|2nd half|2nd|second period)$/.test(s))return '2H';
 if(/^(?:ft|full.?time|finished|ended)$/.test(s))return 'FT';
 return null;
};
export function extractConfirmedHalfTimeCandidate(row){
 if(!row||!Number.isSafeInteger(Number(row.match_id))||Number(row.match_id)<=0)return null;
 const phase=phaseOf(row.feed_status);
 if(!phase||row.raw?.provider==='YBETS')return null;
 let periods=row.periods_score;
 if(typeof periods==='string'){try{periods=JSON.parse(periods);}catch{return null;}}
 if(!Array.isArray(periods)||periods.length===0)return null;
 const first=periods[0],home=score(first?.t1),away=score(first?.t2);
 if(home==null||away==null)return null;
 const fullHome=score(row.home_score),fullAway=score(row.away_score);
 if(fullHome==null||fullAway==null||home>fullHome||away>fullAway)return null;
 if(phase==='HT'&&(home!==fullHome||away!==fullAway))return null;
 const scoreAt=milliseconds(row.score_at),phaseAt=milliseconds(row.feed_status_at);
 if(!Number.isFinite(scoreAt)||!Number.isFinite(phaseAt)||
    Math.abs(scoreAt-phaseAt)>120000)return null;
 const at=Math.max(scoreAt,phaseAt);
 const primaryHome=String(row.home??'').trim(),primaryAway=String(row.away??'').trim();
 if(!primaryHome||!primaryAway||primaryHome===primaryAway)return null;
 return {matchId:Number(row.match_id),homeTeam:primaryHome,awayTeam:primaryAway,
  home,away,observedAt:new Date(at).toISOString(),
  signature:JSON.stringify([primaryHome,primaryAway,home,away])};
}
export async function persistHalfTimeCandidate(candidate,{execute=query}={}){
 if(!candidate)return {stored:false,confirmed:false};
 const statement=[
 'insert into app_match_half_result (match_id,home_team,away_team,half_home_score,half_away_score,signature,observed_at)',
 'values ($1,$2,$3,$4,$5,$6,$7::timestamptz)',
 'on conflict(match_id) do update set',
 'home_team=excluded.home_team, away_team=excluded.away_team,',
 'half_home_score=excluded.half_home_score,half_away_score=excluded.half_away_score,',
 'signature=excluded.signature,',
 'correction_count=app_match_half_result.correction_count+case when app_match_half_result.signature<>excluded.signature then 1 else 0 end,',
 'first_seen_at=case when app_match_half_result.signature=excluded.signature then app_match_half_result.first_seen_at else now() end,',
 'confirmed_at=case',
 "when app_match_half_result.signature=excluded.signature and excluded.observed_at>app_match_half_result.observed_at and now()-app_match_half_result.first_seen_at>=interval '5 seconds'",
 'then coalesce(app_match_half_result.confirmed_at,now())',
 'when app_match_half_result.signature<>excluded.signature then null',
 'else app_match_half_result.confirmed_at end,',
 'observed_at=excluded.observed_at',
 'where excluded.observed_at>app_match_half_result.observed_at',
 'returning confirmed_at,correction_count'
 ].join(' ');
 const r=await execute(statement,[candidate.matchId,candidate.homeTeam,candidate.awayTeam,
    candidate.home,candidate.away,candidate.signature,candidate.observedAt]);
 return {stored:r.rowCount>0,confirmed:r.rows[0]?.confirmed_at!=null,
   corrections:Number(r.rows[0]?.correction_count??0)};
}
export async function captureHalfTimeResults({
 runQuery=query,loadMatches=getMatches,loadMatch=getMatchById,
 loadSnapshots=ids=>matchSnapshots.load(ids)
}={}){
 const pend=(await runQuery([
  'select distinct l.match_id from app_ticket_line l',
  'join app_ticket t on t.id=l.ticket_id',
  "where l.status='PENDING' and t.status='PENDING'",
  'order by l.match_id limit 4000'
 ].join(' '))).rows.map(v=>Number(v.match_id));
 if(!pend.length)return {examined:0,recorded:0,confirmed:0};
 const relevant=new Set(pend),candidates=new Map();
 for(const row of await loadMatches({includeEnded:true,limit:4000})){
  if(relevant.has(Number(row.match_id)))candidates.set(Number(row.match_id),row);
 }
 for(const snapshot of await loadSnapshots(pend)){
  const id=Number(snapshot.match_id);
  if(!candidates.has(id))candidates.set(id,snapshot);
 }
 for(const id of pend)if(!candidates.has(id)){
  const match=await loadMatch(id);
  if(match)candidates.set(id,match);
 }
 let recorded=0,confirmed=0;
 for(const row of candidates.values()){
  const candidate=extractConfirmedHalfTimeCandidate(row);
  if(!candidate)continue;
  try{
   const r=await persistHalfTimeCandidate(candidate,{execute:runQuery});
   if(r.stored)recorded++;
   if(r.confirmed)confirmed++;
  }catch(error){console.warn('[settle] halftime candidate capture failed',candidate.matchId,error?.message);}
 }
 return {examined:pend.length,recorded,confirmed};
}
