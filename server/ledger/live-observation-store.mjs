import crypto from 'node:crypto';
import {pool} from '../db.mjs';
import {normalizeEvents} from './event-evidence.mjs';
import {persistVerifiedEventFacts} from './match-event-facts.mjs';
const whole=v=>v==null||v===''||!Number.isInteger(Number(v))||Number(v)<0?null:Number(v);
const count=(a,b)=>a==null||b==null?null:a+b;
const asClock=game=>{
 const raw=String(game.MatchTimeExtended??''),m=raw.match(/^(\d{1,3}):([0-5]\d)$/);
 if(m)return Number(m[1])+Number(m[2])/60;
 const c=Number(game.MatchTime);
 return game.MatchTime!=null&&String(game.MatchTime).trim()!==''&&Number.isFinite(c)&&c>=0&&c<=130?c:null;
};
const score=game=>{
 const m=String(game.Score??'').match(/^(\d+):(\d+)$/);
 return m?{home:Number(m[1]),away:Number(m[2])}:null;
};
/** Original provider facts, not presentation/translation or browser input. */
export function normalizeLiveFrame(data){
 const game=data?.Match??{};
 const clock=asClock(game),goals=score(game);
 const corners={home:whole(game.CornersTeam1),away:whole(game.CornersTeam2)};
 const fouls={home:whole(game.FoulsTeam1),away:whole(game.FoulsTeam2)};
 const yellows={home:whole(game.YellowCardsTeam1),away:whole(game.YellowCardsTeam2)};
 const reds={home:whole(game.RedCardsTeam1),away:whole(game.RedCardsTeam2)};
 const cards=yellows.home==null||yellows.away==null||reds.home==null||reds.away==null?null:
   {home:yellows.home+reds.home,away:yellows.away+reds.away};
 const events=Array.isArray(data?.TimeLines)?
  normalizeEvents(data,'zizobet').events.filter(e=>['goal','corner','card','foul'].includes(e.type))
    .map(e=>({id:String(e.id),type:e.type,team:e.team,minute:e.minute,seconds:e.seconds??null,
      player:e.player??null,playerId:e.playerId??null,minuteLabel:e.minuteLabel??null,ownGoal:e.ownGoal??null,
      cardColor:e.cardColor??null,phase:e.phase??null})):null;
 // Keep the exact native actor/time/event payload for later replay and
 // manual adjudication, without fetching additional upstream APIs.
 const rawTimeline=Array.isArray(data?.TimeLines)?data.TimeLines.slice(0,2000):null;
 const rawTimelineTruncated=Array.isArray(data?.TimeLines)&&data.TimeLines.length>2000;
 const coverage={};
 const verify=(kind,counters)=>{
  if(!events||!counters||clock===null||counters.home==null||counters.away==null)return;
  const filtered=events.filter(e=>e.type===kind);
  if(filtered.some(e=>!Number.isFinite(e.minute)||e.minute<0||(Number.isFinite(e.seconds)?e.seconds/60:e.minute)>clock||!['home','away'].includes(e.team)))return;
  if(filtered.filter(e=>e.team==='home').length!==counters.home||
     filtered.filter(e=>e.team==='away').length!==counters.away)return;
  coverage[kind+'Through']=clock;
 };
 verify('goal',goals);verify('corner',corners);verify('card',cards);verify('foul',fouls);
 // A generic `card` marker is not proof of its colour. Reconcile the
 // separately reported provider totals with every explicitly coloured event.
 const cardEvents=events?.filter(e=>e.type==='card')??[];
 const cardColorsVerified=!!events&&!!coverage.cardThrough&&
   [yellows.home,yellows.away,reds.home,reds.away].every(Number.isSafeInteger)&&
   cardEvents.every(e=>['yellow','red'].includes(e.cardColor))&&
   ['home','away'].every(side=>
     cardEvents.filter(e=>e.team===side&&e.cardColor==='yellow').length===yellows[side]&&
     cardEvents.filter(e=>e.team===side&&e.cardColor==='red').length===reds[side]);
 return {source:'zizobet',clock,counts:{
   goal:goals?goals.home+goals.away:null,
   corner:count(corners.home,corners.away),
   card:cards?cards.home+cards.away:null,
   foul:count(fouls.home,fouls.away)
  },teams:{goal:goals,corner:corners,card:cards,foul:fouls,
    yellowCard:yellows,redCard:reds},cardColorsVerified,events:events??[],
  coverage,ended:Number(game.EventStatus??game.MatchStatusID)===40,
  eventListAvailable:!!events,rawTimeline,rawTimelineTruncated};
}
export const WATCHED_LIVE_LINES_SQL=
 'select l.id,l.live_contract,t.placed_at,false as is_lab from app_ticket_line l '+
 'join app_ticket t on t.id=l.ticket_id '+
 "where l.match_id=$1 and l.status='PENDING' and t.status='PENDING' "+
 '';
export const LIVE_OBSERVATION_SQL=[
 'create table if not exists app_live_event_frame (id bigserial primary key,match_id bigint not null,fingerprint text not null,payload jsonb not null,observed_at timestamptz not null default now());',
 'alter table app_live_event_frame drop constraint if exists app_live_event_frame_match_id_fingerprint_key;',
 'create index if not exists app_live_event_frame_latest_idx on app_live_event_frame(match_id,observed_at desc);',
 'create table if not exists app_live_event_cursor (match_id bigint primary key,last_seen_at timestamptz not null);',
 "create table if not exists app_live_event_recovery (id bigserial primary key,match_id bigint not null,gap_from timestamptz not null,gap_to timestamptz not null,line_ids uuid[] not null,event_types text[] not null,status text not null default 'AWAITING_BACKUP_API',created_at timestamptz not null default now(),resolved_at timestamptz,unique(match_id,gap_from,gap_to));",
 'create index if not exists app_live_event_recovery_pending_idx on app_live_event_recovery(status,created_at desc);',
 "create table if not exists app_live_settlement_preview (line_id uuid primary key references app_ticket_line(id) on delete cascade,match_id bigint not null,proposed_status text not null check(proposed_status in ('WON','LOST','VOID')),payload jsonb not null,updated_at timestamptz not null default now());"
].join('\n');
/** Only accepted pending matching bets trigger writes or recovery requests.
 * There is deliberately NO outgoing backup API call until a provider is added.
 */
export async function recordWatchedLiveFrame(matchId,data,{database=pool,now=Date.now,thresholdMs=90000,skipVerifiedFacts=false}={}){
 if(!Number.isSafeInteger(Number(matchId))||Number(matchId)<1)return {stored:false,reason:'INVALID_MATCH'};
 const frame=normalizeLiveFrame(data);
 const at=new Date(now()),seenAt=at.getTime();
 if(!Number.isFinite(seenAt))return {stored:false,reason:'INVALID_TIME'};
 const client=await database.connect();
 try{
  await client.query('begin');
  const watching=(await client.query(WATCHED_LIVE_LINES_SQL,[matchId])).rows;
  if(!watching.length){await client.query('commit');return {stored:false,reason:'NO_RELEVANT_TICKETS'};}
  const earliestOpenBet=Math.min(...watching.map(item=>new Date(item.placed_at).getTime()).filter(Number.isFinite));
  // Ensure every writer locks the same cursor, including the first observation.
  await client.query('insert into app_live_event_cursor(match_id,last_seen_at) values($1,$2) on conflict(match_id) do nothing',
    [matchId,new Date(Number.isFinite(earliestOpenBet)?earliestOpenBet:seenAt)]);
  const previous=(await client.query('select last_seen_at from app_live_event_cursor where match_id=$1 for update',[matchId])).rows[0];
  const start=previous?Math.max(new Date(previous.last_seen_at).getTime(),earliestOpenBet):earliestOpenBet;
  let recovery=false;
  if(Number.isFinite(start)&&seenAt-start>Math.max(60000,thresholdMs)){
   // Never add virtual ticket IDs to real-money recovery jobs.
   const realWatching=watching.filter(x=>x.is_lab!==true);
   const eventTypes=[...new Set(realWatching.map(x=>x.live_contract?.event).filter(Boolean))];
   const ids=realWatching.map(x=>x.id);
   if(ids.length&&eventTypes.length){
    await client.query(
      "insert into app_live_event_recovery (match_id,gap_from,gap_to,line_ids,event_types,status) "+
      "values($1,$2,$3,$4::uuid[],$5::text[],'AWAITING_BACKUP_API') "+
      'on conflict(match_id,gap_from,gap_to) do update set line_ids=excluded.line_ids,event_types=excluded.event_types',
      [matchId,new Date(start),at,ids,eventTypes]);
    recovery=true;
   }
  }
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(frame)).digest('hex');
  const saved=await client.query(
    'insert into app_live_event_frame(match_id,fingerprint,payload,observed_at) '+
    'select $1::bigint,$2::text,$3::jsonb,$4::timestamptz where $2 is distinct from ('+
    'select fingerprint from app_live_event_frame where match_id=$1 order by observed_at desc,id desc limit 1)',
    [matchId,fingerprint,JSON.stringify(frame),at]);
  await client.query(
    'insert into app_live_event_cursor(match_id,last_seen_at) values($1,$2) '+
    'on conflict(match_id) do update set last_seen_at=excluded.last_seen_at '+
    'where app_live_event_cursor.last_seen_at<excluded.last_seen_at',
    [matchId,at]);
  // Recheck every valid full sample, including identical frames deduplicated
  // in the raw archive. A second matching poll confirms the DB incident set.
  if(!skipVerifiedFacts)
   await persistVerifiedEventFacts(matchId,frame,client.query.bind(client),at);
  // A complete PRIMARY timeline reconciled with the same feed counters
  // recovers missing polls without using fabricated "zero event" intervals.
  const confirmed=await client.query(`select kind from app_match_event_coverage
    where match_id=$1 and provider='zizobet' and confirmed_at is not null
      and observed_at=$2::timestamptz`,[matchId,at]);
  const verifiedKinds=confirmed.rows.map(row=>row.kind);
  if(verifiedKinds.length)await client.query(`update app_live_event_recovery
    set status='RESOLVED_PRIMARY_RECONCILED',resolved_at=now()
    where match_id=$1 and status='AWAITING_BACKUP_API'
      and event_types <@ $2::text[]`,[matchId,verifiedKinds]);

  await client.query('commit');
  return {stored:saved.rowCount>0,recovery,watching:watching.length};
 }catch(error){await client.query('rollback').catch(()=>{});throw error;}
 finally{client.release();}
}
/** Future backup adapter fetches ONLY these ticket-scoped gaps. */
export const RECOVERY_TICKETS_SQL=
 'select q.id,q.match_id,q.gap_from,q.gap_to,q.line_ids,q.event_types from app_live_event_recovery q '+
 "where q.status='AWAITING_BACKUP_API' and exists("+
 'select 1 from app_ticket_line l join app_ticket t on t.id=l.ticket_id '+
 "where l.match_id=q.match_id and l.id=any(q.line_ids) and l.status='PENDING' and t.status='PENDING') "+
 'order by q.created_at asc limit $1';
