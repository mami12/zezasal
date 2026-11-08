import {createHash} from 'node:crypto';
import {pool} from '../db.mjs';

/**
 * Completed historical goal timelines are distinct from Zizobet's primary
 * incidents. They may grade frozen goal contracts ONLY after matching the
 * durable final score, a complete provider event list, and unique event IDs.
 *
 * Corner, card, foul and player-identity contracts are NOT reconstructed from
 * aggregate counts or from an API's unrelated player IDs.
 */
export const HISTORICAL_GOAL_PROVIDERS=new Set([
 'fotmob','apifootball','sportapi','goalapi','bsd','worldcup26'
]);

export function validateHistoricalGoals(payload){
 const provider=String(payload?.source??'').toLowerCase();
 if(!HISTORICAL_GOAL_PROVIDERS.has(provider)||
    payload?.complete!==true||payload?.final!==true||
    payload?.goalsAvailable!==true||!Array.isArray(payload.events))return null;
 const score=value=>value!=null&&value!==''&&Number.isSafeInteger(Number(value))&&
    Number(value)>=0&&Number(value)<=99?Number(value):null;
 const home=score(payload.homeScore),away=score(payload.awayScore);
 if(home===null||away===null||payload.events.length>200)return null;
 const events=[],ids=new Set();
 for(const event of payload.events){
  if(event?.type!=='goal'||event.disabled||event.cancelled||event.shootout||
     /extra|shoot/i.test(String(event.phase??'')))return null;
  // Provider own-goal attribution varies. Without scoring-side certainty,
  // the complete chronology is not authorized to move money.
  if(event.own===true||event.ownGoal===true)return null;
  const id=String(event.id??'').trim(),minute=Number(event.minute);
  const phase=String(event.phase??'').toLowerCase();
  if(!id||ids.has(id)||!['home','away'].includes(event.team)||
     !Number.isInteger(minute)||minute<0||minute>90||
     (/^(?:2$|h2|2nd|second)/.test(phase)&&minute<45)||
     (/^(?:1$|h1|1st|first)/.test(phase)&&minute>45))return null;
  const injury=event.injury==null?0:Number(event.injury);
  if(!Number.isSafeInteger(injury)||injury<0||injury>30)return null;
  // Stoppage-time labels (45+2 / 90+2) cannot be treated as the
  // ordinary minute 45/90 for money grading without provider-specific
  // absolute-clock semantics. Keep them display-only until verified.
  if(injury!==0)return null;
  const rawSeconds=event.seconds==null?null:Number(event.seconds);
  const second=rawSeconds!==null&&Number.isFinite(rawSeconds)&&
    rawSeconds>=minute*60&&rawSeconds<(minute+1)*60?rawSeconds:null;
  ids.add(id);
  events.push({
   id,team:event.team,minute,seconds:second,
   playerId:event.playerId==null?null:String(event.playerId),
   playerName:typeof event.player==='string'?event.player.trim()||null:null,
   ownGoal:typeof event.own==='boolean'?event.own:
    typeof event.ownGoal==='boolean'?event.ownGoal:null,
   phase:typeof event.phase==='string'?event.phase:null
  });
 }
 if(events.filter(x=>x.team==='home').length!==home||
    events.filter(x=>x.team==='away').length!==away)return null;
 // Identical provider minutes do not establish order. The existing ordinal
 // grader holds tied Next Goal / Race to X contracts for manual review.
 const signature=createHash('sha256').update(JSON.stringify({home,away,events})).digest('hex');
 return {provider,home,away,events,signature};
}

/** All-or-nothing write. An earlier confirmed history cannot be rewritten. */
export async function persistHistoricalGoalFacts(matchId,payload,{database=pool}={}){
 const id=Number(matchId),verified=validateHistoricalGoals(payload);
 if(!Number.isSafeInteger(id)||id<=0||!verified)return {stored:false,reason:'INCOMPLETE_OR_AMBIGUOUS_HISTORY'};
 const client=await database.connect();
 try{
  await client.query('begin');
  const stored=(await client.query(
   'select home_score,away_score from app_match_result where match_id=$1 for update',[id]
  )).rows[0];
  if(!stored||Number(stored.home_score)!==verified.home||
     Number(stored.away_score)!==verified.away){
   await client.query('rollback');
   return {stored:false,reason:'HISTORY_SCORE_CONFLICT'};
  }
  const prior=(await client.query(
   "select sample_signature from app_match_event_coverage where match_id=$1 and provider=$2 and kind='goal' for update",
   [id,verified.provider]
  )).rows[0];
  if(prior){
   await client.query('rollback');
   return {stored:false,reason:prior.sample_signature===verified.signature?'ALREADY_VERIFIED':'HISTORY_CHANGED'};
  }
  for(const event of verified.events){
   await client.query(`insert into app_match_event_fact
     (match_id,provider,provider_event_id,kind,team,minute,seconds,
      player_id,player_name,own_goal,phase,active)
     values($1,$2,$3,'goal',$4,$5,$6,$7,$8,$9,$10,true)
     on conflict(match_id,provider,provider_event_id,kind) do nothing`,
    [id,verified.provider,event.id,event.team,event.minute,event.seconds,
     event.playerId,event.playerName,event.ownGoal,event.phase]);
  }
  const at=new Date();
  const inserted=await client.query(`insert into app_match_event_coverage
    (match_id,provider,kind,through_minute,count_home,count_away,
     complete,observed_at,confirmed_at,sample_signature,sample_first_seen_at)
    values($1,$2,'goal',91,$3,$4,true,$5,$5,$6,$5)
    on conflict(match_id,provider,kind) do nothing`,
   [id,verified.provider,verified.home,verified.away,at,verified.signature]);
  if(inserted.rowCount!==1){
   await client.query('rollback');
   return {stored:false,reason:'CONCURRENT_HISTORY_UPDATE'};
  }
  // Complete corroborated FT goal history covers any earlier live polling gap
  // for GOALS. Corner/card gaps remain AWAITING_BACKUP_API.
  await client.query(`update app_live_event_recovery
    set status='RESOLVED_HISTORICAL_RECONCILED',resolved_at=now()
    where match_id=$1 and status='AWAITING_BACKUP_API'
      and event_types <@ ARRAY['goal']::text[]`,[id]);
  await client.query('commit');
  return {stored:true,provider:verified.provider,goals:verified.events.length};
 }catch(error){
  await client.query('rollback').catch(()=>{});
  throw error;
 }finally{client.release();}
}
