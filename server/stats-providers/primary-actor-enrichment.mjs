/** Match actor identities from a separately verified football fixture.
 * This enriches existing PRIMARY incident rows. It never creates a new goal,
 * card, foul, price or settlement result. Ambiguous same-minute events fail closed.
 */
const actorName=v=>typeof v==='string'&&v.trim()?v.trim().slice(0,200):null;
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const kinds=new Set(['goal','card','corner','foul']);
const key=e=>[e.kind??e.type,e.team,Number(e.minute)].join('|');
const missingActor=f=>!actorName(f.player_name)&&
 !(f.aiscore_verified===true&&actorName(f.aiscore_player_name))&&
 !(f.fotmob_verified===true&&actorName(f.fotmob_player_name))&&
 !(f.supplemental_verified===true&&actorName(f.supplemental_player_name));

export async function enrichPrimaryActors(matchId,source,primaryFacts,events,{execute}={}){
 const id=Number(matchId);
 if(!Number.isSafeInteger(id)||id<=0||!['fotmob','apifootball','bsd','goalapi','sportapi','worldcup26'].includes(source)||
    typeof execute!=='function'||!Array.isArray(primaryFacts)||!Array.isArray(events))
  return {updated:0,reason:'UNVERIFIED_FIXTURE_OR_EVIDENCE'};
 const primary=new Map(),candidate=new Map();
 for(const f of primaryFacts){
  if(!kinds.has(f?.kind)||!['home','away'].includes(f.team)||
     !Number.isInteger(Number(f.minute))||!f.provider_event_id)continue;
  const slot=key(f);
  if(primary.has(slot))primary.set(slot,null);
  else primary.set(slot,f);
 }
 for(const e of events){
  if(!kinds.has(e?.kind??e?.type)||!['home','away'].includes(e.team)||
     !Number.isInteger(Number(e.minute))||!actorName(e.playerName??e.player))continue;
  const slot=key(e);
  if(!candidate.has(slot))candidate.set(slot,e);
  else candidate.set(slot,null); // no unique actor for this minute/team/kind
 }
 let updated=0;
 for(const [slot,event] of candidate){
  const f=primary.get(slot);
  if(!f||!event||!missingActor(f)||f.kind==='goal'&&f.own_goal!==false)continue;
  if(f.kind==='card'&&f.card_color&&event.cardColor&&f.card_color!==event.cardColor)continue;
  const player=actorName(event.playerName??event.player);
  if(!player)continue;
  const result=await execute(
   "update app_match_event_fact set supplemental_player_name=$4,"+
   "supplemental_actor_provider=$5,supplemental_verified=true "+
   "where match_id=$1 and provider='zizobet' and provider_event_id=$2 "+
   "and kind=$3 and active=true and team=$6 and minute=$7 "+
   "and (kind<>'goal' or own_goal=false) "+
   "and (player_name is null or lower(player_name)=lower($4)) "+
   "and (aiscore_verified=false or aiscore_player_name is null or lower(aiscore_player_name)=lower($4)) "+
   "and (fotmob_verified=false or fotmob_player_name is null or lower(fotmob_player_name)=lower($4)) "+
   "and (supplemental_verified=false or supplemental_player_name is null or lower(supplemental_player_name)=lower($4)) ",
   [id,String(f.provider_event_id),f.kind,player,source,f.team,Number(f.minute)]);
  updated+=Number(result?.rowCount??0);
 }
 return {updated};
}
