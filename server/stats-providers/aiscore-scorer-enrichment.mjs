/**
 * AiScore is supplementary PLAYER NAME evidence only. Goals, corners, clocks,
 * match status and financial decisions remain owned by the primary provider.
 * Never guess the scorer from a lineup or from an unverified fixture mapping.
 */
export function parseAiScoreScorers(payload){
 const roots=[payload?.data?.incidents,payload?.data?.events,payload?.data?.timeline,
  payload?.data?.match?.events,payload?.incidents,payload?.events].filter(Array.isArray);
 const parsed=[];
 for(const events of roots){
  if(events.length>1000)continue;
  for(const event of events){
   if(!event||typeof event!=='object')continue;
   const kind=String(event.event_type??event.eventType??event.incidentType??event.type??'').toLowerCase();
   if(!['goal','score_change','penalty_goal'].includes(kind)||event.cancelled||event.reversed||event.own_goal===true||event.ownGoal===true||event.isOwnGoal===true)continue;
   const team=event.team==='home'||event.isHome===true||event.home_event===1?'home':
    event.team==='away'||event.isHome===false||event.home_event===0?'away':null;
   const rawMinute=event.minute??event.time??event.gt;
   const match=String(rawMinute??'').match(/^(\d{1,3})(?:\s*\+\s*(\d{1,2}))?$/);
   const minute=match?Number(match[1])+Number(match[2]??0):null;
   const player=event.scorer??event.player??event.detail?.player;
   const playerName=typeof player==='string'?player:
     player&&typeof player.name==='string'?player.name:
     typeof event.player_name==='string'?event.player_name:
     typeof event.playerName==='string'?event.playerName:null;
   const playerId=typeof player==='object'&&player!==null?
     String(player.id??player.player_id??'').trim():String(event.player_id??'').trim();
   if(!team||minute===null||minute<0||minute>130||!playerName?.trim())continue;
   parsed.push({team,minute,playerName:playerName.trim(),playerId:playerId||null});
  }
 }
 // The same unique (team,minute) from one feed may be represented more than
 // once across endpoint lists. Any contradictory name becomes NOT VERIFIED.
 const bySlot=new Map();
 for(const row of parsed){
  const slot=row.team+'|'+row.minute;
  const old=bySlot.get(slot);
  if(old&&old.playerName!==row.playerName)bySlot.set(slot,{ambiguous:true});
  else if(!old)bySlot.set(slot,row);
 }
 return [...bySlot.values()].filter(row=>!row.ambiguous);
}
/**
 * Only a CONFIRMED same-fixture mapping and a UNIQUE original provider goal
 * at that team's exact minute may receive the supplementary scorer identity.
 */
export async function enrichPrimaryScorerNames(matchId,payload,{execute}={}){
 if(typeof execute!=='function')return {updated:0,reason:'NO_DATABASE'};
 const mapped=(await execute(
  "select mapping_status from app_football_information_map where match_id=$1 and aiscore_id is not null",
  [matchId])).rows[0];
 if(mapped?.mapping_status!=='CONFIRMED')return {updated:0,reason:'UNVERIFIED_FIXTURE_MAPPING'};
 const scorers=parseAiScoreScorers(payload);let updated=0;
 for(const item of scorers){
  const {rows}=await execute(
   "select provider_event_id from app_match_event_fact where match_id=$1 and provider='zizobet' and kind='goal' and active=true and team=$2 and minute=$3",
   [matchId,item.team,item.minute]);
  if(rows.length!==1)continue;
  const found=await execute(`update app_match_event_fact
   set aiscore_player_name=$4,aiscore_player_id=$5,aiscore_verified=true
   where match_id=$1 and provider='zizobet' and kind='goal' and active=true
     and provider_event_id=$2 and team=$3 and
       (aiscore_player_name is null or aiscore_player_name=$4)
   returning provider_event_id`,
    [matchId,rows[0].provider_event_id,item.team,item.playerName,item.playerId]);
  if(found.rowCount===1)updated++;
 }
 return {updated,scorers:scorers.length};
}
