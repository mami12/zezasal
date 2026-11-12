import {createHash} from 'node:crypto';
import {pool} from '../db.mjs';
import {normalizeLiveFrame} from './live-observation-store.mjs';

/** Independent sporting archive. It never contains prices and never pays bets. */
export const ZIZOBET_MATCH_HISTORY_SQL = [
 "create table if not exists app_zizobet_match_history (match_id bigint primary key, details jsonb not null, timeline_signature text, observed_at timestamptz not null default now());",
 "create table if not exists app_zizobet_match_incident (match_id bigint not null, kind text not null check(kind in ('goal','corner','card','foul')), provider_event_id text not null, team text not null check(team in ('home','away')), minute integer not null check(minute between 0 and 130), detail jsonb not null, active boolean not null default true, first_observed_at timestamptz not null default now(), observed_at timestamptz not null default now(), primary key(match_id,kind,provider_event_id));",
 "create index if not exists app_zizobet_match_incident_lookup on app_zizobet_match_incident(match_id,kind,active,minute);"
].join('\n');

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const whole=value=>value!=null&&String(value).trim()!==''&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
const pair=(game,name)=>{const home=whole(game[name+'Team1']),away=whole(game[name+'Team2']);
 return home===null||away===null?null:{home,away};};
const clockOf=game=>{
 const m=String(game.MatchTimeExtended??'').match(/^(\d{1,3}):([0-5]\d)$/);
 if(m)return Number(m[1])+Number(m[2])/60;
 const n=Number(game.MatchTime);
 return game.MatchTime!=null&&Number.isFinite(n)&&n>=0&&n<=130?n:null;
};
export function projectZizobetHistory(matchId,data,row={}){
 const id=Number(matchId),game=data?.Match;
 if(!Number.isSafeInteger(id)||id<1||!game||typeof game!=='object')return null;
 const frame=normalizeLiveFrame(data);
 const score=String(game.Score??'').match(/^(\d+):(\d+)$/);
 const rawPeriods=game.SetScores;
 let periods=null;
 try{
  const values=typeof rawPeriods==='string'?JSON.parse(rawPeriods):rawPeriods;
  if(Array.isArray(values)){
   const parsed=values.map(value=>{
    const m=String(value).match(/^(\\d+):(\\d+)$/);
    if(m)return {home:Number(m[1]),away:Number(m[2])};
    const home=whole(value?.t1),away=whole(value?.t2);
    return home===null||away===null?null:{home,away};
   });
   if(parsed.length&&parsed.every(Boolean))periods=parsed.slice(0,4);
  }
 }catch{}
 const details={
  provider:'zizobet', matchId:id, home:row.home??null, away:row.away??null,
  kickoffAt:row.start_at??null,
  phase:game.EventStatus??game.MatchStatusID??null,
  clockMinute:clockOf(game),periodScores:periods,
  goals:score?{home:Number(score[1]),away:Number(score[2])}:null,
  corners:pair(game,'Corners'), yellowCards:pair(game,'YellowCards'),
  redCards:pair(game,'RedCards'), fouls:pair(game,'Fouls'), shots:pair(game,'Shots')
 };
 // A missing field is unknown, never a fabricated zero or stale overwrite.
 const clean=Object.fromEntries(Object.entries(details).filter(([,v])=>v!==null));
 const events=frame.eventListAvailable?frame.events.filter(e=>
  ['goal','corner','card','foul'].includes(e.type)&&['home','away'].includes(e.team)&&
  Number.isInteger(e.minute)&&e.minute>=0&&e.minute<=130&&e.id!=null&&String(e.id)
 ).map(e=>({
  id:String(e.id),kind:e.type,team:e.team,minute:e.minute,
  minuteLabel:e.minuteLabel??null,seconds:e.seconds??null,phase:e.phase??null,
  playerName:e.player??null,playerId:e.playerId??null,
  cardColor:e.cardColor??null,ownGoal:e.ownGoal??null
 })):[];
 const verifiedKinds=frame.eventListAvailable&&!frame.rawTimelineTruncated?
  ['goal','corner','card'].filter(k=>frame.coverage?.[k+'Through']!=null):[];
 const fingerprint=frame.eventListAvailable?hash([events,verifiedKinds]):null;
 return {id,details:clean,events,verifiedKinds,
  timelineAvailable:frame.eventListAvailable, timelineSignature:fingerprint,
  summarySignature:hash(clean)};
}

/** One latest match row plus independently keyed events, not a frame per second. */
export function createZizobetHistoryArchive({database=pool,now=()=>new Date()}={}){
 const seen=new Map();
 return async function archive(matchId,data,row={}){
  const state=projectZizobetHistory(matchId,data,row);
  if(!state)return {stored:false,reason:'INVALID_MATCH'};
  const {id,details,events,verifiedKinds,timelineAvailable,timelineSignature,summarySignature}=state;
  const prior=seen.get(id);
  if(prior?.summary===summarySignature&&
    (!timelineAvailable||prior.timeline===timelineSignature))return {stored:false,reason:'UNCHANGED'};
  const observed=new Date(now());
  if(!Number.isFinite(observed.getTime()))throw Error('Invalid Zizobet observation time');
  const client=await database.connect();
  try{
   await client.query('begin');
   await client.query(
    "insert into app_zizobet_match_history(match_id,details,timeline_signature,observed_at) "+
    "values($1,$2::jsonb,$3,$4::timestamptz) on conflict(match_id) do update set "+
    "details=app_zizobet_match_history.details || excluded.details, "+
    "timeline_signature=coalesce(excluded.timeline_signature,app_zizobet_match_history.timeline_signature), "+
    "observed_at=excluded.observed_at",
    [id,JSON.stringify(details),timelineSignature,observed]);
   if(timelineAvailable&&prior?.timeline!==timelineSignature){
    if(events.length){
     await client.query(
      "insert into app_zizobet_match_incident(match_id,kind,provider_event_id,team,minute,detail,active,observed_at) "+
      "select $1,e.kind,e.id,e.team,e.minute,e.detail,true,$3::timestamptz "+
      "from jsonb_to_recordset($2::jsonb) as e(kind text,id text,team text,minute integer,detail jsonb) "+
      "on conflict(match_id,kind,provider_event_id) do update set "+
      "team=excluded.team,minute=excluded.minute, "+
      "detail=case when app_zizobet_match_incident.team=excluded.team and "+
      "app_zizobet_match_incident.minute=excluded.minute then "+
      "app_zizobet_match_incident.detail || excluded.detail else excluded.detail end, "+
      "active=true,observed_at=excluded.observed_at",
      [id,JSON.stringify(events.map(e=>({kind:e.kind,id:e.id,team:e.team,minute:e.minute,
       detail:Object.fromEntries(Object.entries(e).filter(([,v])=>v!==null))}))),observed]);
    }
    // Only reconciled full timelines can retire corrected/deleted provider events.
    for(const kind of verifiedKinds){
     const ids=events.filter(e=>e.kind===kind).map(e=>e.id);
     await client.query(
      "update app_zizobet_match_incident set active=false,observed_at=$3::timestamptz "+
      "where match_id=$1 and kind=$2 and active and not(provider_event_id=any($4::text[]))",
      [id,kind,observed,ids]);
    }
   }
   await client.query('commit');
   seen.set(id,{summary:summarySignature,timeline:timelineSignature??prior?.timeline??null});
   if(seen.size>10000)seen.delete(seen.keys().next().value);
   return {stored:true,eventCount:events.length,verifiedKinds};
  }catch(error){await client.query('rollback').catch(()=>{});throw error;}
  finally{client.release();}
 };
}
export const archiveZizobetMatchHistory=createZizobetHistoryArchive();
