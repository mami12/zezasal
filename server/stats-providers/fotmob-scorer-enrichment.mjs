/** Supplementary FotMob scorer identities, anchored to PRIMARY Zizobet facts.
 * FotMob never supplies a goal, score, clock, market or settlement outcome.
 * Unknown own-goal status is NOT proof that the player scored.
 */
import {matchedSupplementalScorers} from './primary-goal-display.mjs';
const fold=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/\s+/g,' ').trim();

export async function enrichFotMobScorerNames(matchId,primaryFacts,goalEvents,{execute}={}){
 const id=Number(matchId);
 if(!Number.isSafeInteger(id)||id<=0||!Array.isArray(primaryFacts)||
    !Array.isArray(goalEvents)||typeof execute!=='function')
  return {updated:0,reason:'MISSING_PRIMARY_MATCH_OR_DATABASE'};
 // The caller must first verify the FotMob fixture (teams and kickoff)
 // and the PRIMARY provider's confirmed, counter-reconciled goal timeline.
 const candidates=goalEvents.filter(e=>e?.type==='goal'&&e?.own!==true)
  .map(e=>({team:e.team,minute:Number(e.minute)+Number(e.injury??0),
    player:e.player,own:e.own}));
 const matches=matchedSupplementalScorers(primaryFacts,candidates);
 const bySlot=new Map();
 for(const fact of primaryFacts){
  const key=fact?.team+'|'+Number(fact?.minute);
  if(bySlot.has(key))bySlot.set(key,null);
  else bySlot.set(key,fact);
 }
 let updated=0;
 for(const item of matches){
  const fact=bySlot.get(item.team+'|'+item.minute);
  if(!fact||!fact.provider_event_id||fact.own_goal!==false)continue;
  const player=String(item.player??'').trim();
  if(!player||player.length>200)continue;
  // Never overwrite a conflicting Zizobet or already verified AiScore actor.
  if(fact.player_name&&fold(fact.player_name)!==fold(player))continue;
  if(fact.aiscore_verified===true&&fact.aiscore_player_name&&
     fold(fact.aiscore_player_name)!==fold(player))continue;
  const changed=await execute(
   'update app_match_event_fact set fotmob_player_name=$4,fotmob_verified=true '+
   "where match_id=$1 and provider='zizobet' and kind='goal' and active=true "+
   'and provider_event_id=$2 and team=$3 and minute=$5 and own_goal=false '+
   'and (player_name is null or lower(player_name)=lower($4)) '+
   'and (aiscore_verified=false or aiscore_player_name is null or lower(aiscore_player_name)=lower($4)) '+
   'and (fotmob_verified=false or fotmob_player_name is null or lower(fotmob_player_name)=lower($4)) ',
   [id,String(fact.provider_event_id),item.team,player,item.minute]);
  updated+=Number(changed?.rowCount??0);
 }
 return {updated,matched:matches.length};
}
