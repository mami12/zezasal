import {createHash} from 'node:crypto';
import {pool} from '../db.mjs';
import {HISTORICAL_GOAL_PROVIDERS} from './historical-event-facts.mjs';

const validCount=n=>n!=null&&n!==''&&Number.isSafeInteger(Number(n))&&Number(n)>=0&&Number(n)<=999;
const eventKinds=new Set(['corner','card']);

/**
 * Only a provider's finished, complete minute chronology that reconciles
 * EXACTLY to its own explicit final counters is eligible for a ticket verdict.
 * A bare 8-5 scoreboard is not a list of corners; it never enters this writer.
 */
export function validateHistoricalTimedEvents(payload){
 const source=String(payload?.source??'').toLowerCase();
 const kind=payload?.kind;
 if(!HISTORICAL_GOAL_PROVIDERS.has(source)||!eventKinds.has(kind)||
   payload?.final!==true||payload?.complete!==true||payload?.timelineAvailable!==true||
   !Array.isArray(payload?.events)||payload.events.length>999)return null;
 if(!validCount(payload.homeCount)||!validCount(payload.awayCount))return null;
 const home=Number(payload.homeCount),away=Number(payload.awayCount);
 if(payload.events.length!==home+away)return null;
 const facts=[],unique=new Set();
 for(const event of payload.events){
  if(event?.type!==kind||!['home','away'].includes(event.team)||
      event.disabled===true||event.cancelled===true||event.canceled===true||
      event.id==null||!String(event.id).trim())return null;
  // Stoppage or extended-time event attribution is provider-specific.
  const time=Number(event.minute);
  const injury=Number(event.injury??0);
  if(!Number.isSafeInteger(time)||time<0||time>90||
      !Number.isSafeInteger(injury)||injury!==0||
      event.phase==='extra'||event.shootout===true)return null;
  const key=String(event.id);
  if(unique.has(key))return null;
  unique.add(key);
  const seconds=event.seconds==null?null:Number(event.seconds);
  if(seconds!==null&&(!Number.isFinite(seconds)||seconds<time*60||seconds>=(time+1)*60))
   return null;
  const color=kind==='card'?String(event.cardColor??'').toLowerCase():null;
  if(kind==='card'&&!['yellow','red'].includes(color))return null;
  // Distinct yellow-red second card and dismissal rules need separate
  // official coverage; do not assume a red count includes/excludes it.
  if(kind==='card'&&/second.?yellow|yellow.?red|two.?yellow/i.test(String(event.detail??'')))
   return null;
  facts.push({id:key,kind,team:event.team,minute:time,seconds,
   cardColor:color});
 }
 if(facts.filter(e=>e.team==='home').length!==home||
    facts.filter(e=>e.team==='away').length!==away)return null;
 const signature=createHash('sha256').update(JSON.stringify({source,kind,home,away,facts})).digest('hex');
 return {source,kind,home,away,facts,signature};
}

export async function persistHistoricalTimedEvents(matchId,payload,{database=pool}={}){
 const id=Number(matchId),data=validateHistoricalTimedEvents(payload);
 if(!Number.isSafeInteger(id)||id<=0||!data)
   return {stored:false,reason:'NO_VERIFIED_TIMED_EVENTS'};
 const client=await database.connect();
 try{
  await client.query('begin');
  const final=(await client.query(`select home_score,away_score,corners_home,corners_away,cards_home,cards_away
     from app_match_result where match_id=$1 for update`,[id])).rows[0];
  if(!final||final.home_score==null||final.away_score==null){
   await client.query('rollback');return {stored:false,reason:'FT_NOT_RECORDED'};
  }
  const field=data.kind==='corner'?'corners':'cards';
  if(!validCount(final[field+'_home'])||!validCount(final[field+'_away'])||
     data.home!==Number(final[field+'_home'])||data.away!==Number(final[field+'_away'])){
   await client.query('rollback');return {stored:false,reason:'TOTAL_CONFLICT'};
  }
  const previous=(await client.query(
   'select sample_signature from app_match_event_coverage where match_id=$1 and provider=$2 and kind=$3 for update',
   [id,data.source,data.kind])).rows[0];
  if(previous){
   await client.query('rollback');
   return {stored:false,reason:previous.sample_signature===data.signature?'ALREADY_VERIFIED':'TIMELINE_CHANGED'};
  }
  for(const f of data.facts)await client.query(`insert into app_match_event_fact
     (match_id,provider,provider_event_id,kind,team,minute,seconds,card_color,active)
     values($1,$2,$3,$4,$5,$6,$7,$8,true)
     on conflict(match_id,provider,provider_event_id,kind) do nothing`,
     [id,data.source,f.id,data.kind,f.team,f.minute,f.seconds,f.cardColor]);
  const now=new Date();
  const inserted=await client.query(`insert into app_match_event_coverage
     (match_id,provider,kind,through_minute,count_home,count_away,
      complete,observed_at,confirmed_at,card_colors_verified,sample_signature,sample_first_seen_at)
     values($1,$2,$3,91,$4,$5,true,$6,$6,$7,$8,$6)
     on conflict(match_id,provider,kind) do nothing`,
     [id,data.source,data.kind,data.home,data.away,now,data.kind==='card',data.signature]);
  if(inserted.rowCount!==1){
   await client.query('rollback');return {stored:false,reason:'CONCURRENT_UPDATE'};
  }
  // Clear only gaps consisting ENTIRELY of this verified event type.
  // A mixed goal+corner gap must not erase an unresolved card/corner type.
  await client.query(`update app_live_event_recovery
      set status='RESOLVED_HISTORICAL_RECONCILED',resolved_at=now()
      where match_id=$1 and status='AWAITING_BACKUP_API'
      and event_types <@ ARRAY[$2]::text[]`,[id,data.kind]);
  await client.query('commit');
  return {stored:true,source:data.source,kind:data.kind,events:data.facts.length};
 }catch(error){
  await client.query('rollback').catch(()=>{});
  throw error;
 }finally{client.release();}
}
