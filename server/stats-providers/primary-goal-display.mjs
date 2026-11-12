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
  // Zizobet stores 45+2 as minute=47 with explicit H1, and 90+3 as
  // minute=93 with explicit H2. Display those in the 31-45+ / 76-90+
  // buckets, not the following half or as overtime.
  const phase=String(fact.phase??'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const first=['h1','1sthalf','firsthalf','1h','1'].includes(phase);
  const second=['h2','2ndhalf','secondhalf','2h','2'].includes(phase);
  const displayMinute=first&&minute>45&&minute<=75?45:
    second&&minute>90&&minute<=120?90:minute;
  events.push({id,type:'goal',team:fact.team,minute:displayMinute,phase:fact.phase??null});
  const player=typeof fact.player_name==='string'&&fact.player_name.trim()?
   fact.player_name.trim():
   fact.aiscore_verified===true&&typeof fact.aiscore_player_name==='string'&&
    fact.aiscore_player_name.trim()?fact.aiscore_player_name.trim():
   fact.own_goal===false&&fact.fotmob_verified===true&&
    typeof fact.fotmob_player_name==='string'&&fact.fotmob_player_name.trim()?
    fact.fotmob_player_name.trim():
   fact.own_goal===false&&fact.supplemental_verified===true&&
    typeof fact.supplemental_player_name==='string'&&fact.supplemental_player_name.trim()?
    fact.supplemental_player_name.trim():null;
  if(player)scorers.push({minute,team:fact.team,player});
 }
 if(events.filter(x=>x.team==='home').length!==home||
    events.filter(x=>x.team==='away').length!==away)return null;
 const intervals=groupGoalsIntoIntervals(events);
 if(!intervals)return null;
 scorers.sort((a,b)=>a.minute-b.minute||a.team.localeCompare(b.team));
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

/** FotMob is supplementary identity information, never the source of a new
 * Zizobet goal or a betting decision. Use a nominated scorer on the UI only
 * when BOTH scoreboards and each team's exact goal incident counts agree,
 * and the provider minute/team pair identifies one primary incident.
 */
export function displayOnlyFotMobScorers(row,fotmob){
 const home=validCount(row?.home_score),away=validCount(row?.away_score);
 if(home===null||away===null||home!==validCount(fotmob?.homeScore)||
    away!==validCount(fotmob?.awayScore))return [];
 const existing=row?.raw?.eventTimeline;
 const secondary=fotmob?.goalEvents;
 if(!Array.isArray(existing)||!Array.isArray(secondary))return [];
 const goals=existing.filter(e=>e?.type==='goal');
 const otherGoals=secondary.filter(e=>e?.type==='goal');
 if(![goals,otherGoals].every(list=>
    list.filter(e=>e?.team==='home').length===home&&
    list.filter(e=>e?.team==='away').length===away))return [];
 if(goals.some(e=>!Number.isInteger(Number(e.minute))||
    !Number.isFinite(Number(e.minute))))return [];
 // Never turn an independently reported goal into a new primary event.
 // Matched source names are advisory labels only, never financial facts.
 return matchedSupplementalScorers(goals,otherGoals)
   .map(s=>({...s,source:'fotmob'}));
}
