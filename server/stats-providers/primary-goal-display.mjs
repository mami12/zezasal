import {groupGoalsIntoIntervals} from './display-stats.mjs';

/**
 * Display-only reconciliation. The primary Zizobet clock, scores, and incident
 * chronology own the goals/intervals. Auxiliary providers supply names only.
 * This never writes a bet verdict or introduces a synthetic event.
 */
const validCount=value=>value!==null&&value!==undefined&&value!==''&&
 Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;

export function primaryGoalDisplay(coverage,facts,row){
 if(!coverage||!Array.isArray(facts)||!row||coverage.confirmed_at==null)return null;
 const home=validCount(coverage.count_home),away=validCount(coverage.count_away);
 if(home===null||away===null||facts.length!==home+away)return null;
 const scoreHome=validCount(row.home_score),scoreAway=validCount(row.away_score);
 if(scoreHome!==null&&scoreHome!==home||scoreAway!==null&&scoreAway!==away)return null;
 const through=Number(coverage.through_minute);
 const current=row.match_time_ms!=null?Number(row.match_time_ms)/60000:null;
 if(!Number.isFinite(through)||through<0||through>130||
    current!==null&&Number.isFinite(current)&&through+0.001<Math.floor(current))return null;
 const used=new Set(),events=[],scorers=[];
 for(const fact of facts){
  const id=String(fact.provider_event_id??'');
  const minute=Number(fact.minute);
  if(!id||used.has(id)||!Number.isSafeInteger(minute)||minute<0||minute>130||
     !['home','away'].includes(fact.team))return null;
  used.add(id);
  events.push({id,type:'goal',team:fact.team,minute,phase:fact.phase??null});
  const player=typeof fact.player_name==='string'&&fact.player_name.trim()?
   fact.player_name.trim():
   fact.aiscore_verified===true&&typeof fact.aiscore_player_name==='string'&&
    fact.aiscore_player_name.trim()?fact.aiscore_player_name.trim():null;
  if(player)scorers.push({minute,team:fact.team,player});
 }
 if(events.filter(x=>x.team==='home').length!==home||
    events.filter(x=>x.team==='away').length!==away)return null;
 const intervals=groupGoalsIntoIntervals(events);
 if(!intervals)return null;
 return {goalIntervals:intervals,scorers,
   missingScorers:scorers.length<events.length,
   hasGoals:events.length>0,source:'zizobet'};
}

/** Auxiliary scorer labels may fill only a UNIQUE identical primary goal slot.
 * A source's extra/missing goals are not introduced into the primary timeline.
 */
export function matchedSupplementalScorers(primaryFacts,candidates){
 if(!Array.isArray(primaryFacts)||!Array.isArray(candidates))return [];
 const slots=new Map();
 for(const item of primaryFacts){
  const minute=Number(item.minute),team=item.team;
  if(!Number.isSafeInteger(minute)||!['home','away'].includes(team))continue;
  const slot=team+'|'+minute;
  slots.set(slot,slots.has(slot)?null:item);
 }
 const proposed=new Map();
 for(const item of candidates){
  const minute=Number(item.minute),team=item.team;
  const player=String(item.player??'').trim();
  if(!Number.isSafeInteger(minute)||!['home','away'].includes(team)||
     !player||player.length>200||item.own===true)continue;
  const slot=team+'|'+minute;
  if(!slots.get(slot))continue;
  if(!proposed.has(slot))proposed.set(slot,{minute,team,player});
  else if(proposed.get(slot)?.player!==player)proposed.set(slot,null);
 }
 return [...proposed.values()].filter(Boolean);
}
