/** Provider-specific event projection. Never infer a corner/card minute from
 * a final team total or an unrelated soccer scoreboard.
 *
 * The returned raw incident timelines are candidates only: historical-timed-
 * events.mjs reconciles their ENTIRE list against the same provider's FT counts.
 */
const teamOf=(raw,home,away)=>{
 const actual=raw?.team?.id??raw?.teamId??raw?.team_id;
 if(actual==null||home==null||away==null)return null;
 return String(actual)===String(home)?'home':String(actual)===String(away)?'away':null;
};
const minuteOf=raw=>{
 if(raw==null||raw==='')return NaN;
 const match=String(raw).match(/^(\d{1,3})(?:\s*\+\s*(\d{1,2}))?$/);
 return match?Number(match[1]):NaN;
};
const addedOf=raw=>{
 const match=String(raw??'').match(/\+\s*(\d{1,2})/);
 return match?Number(match[1]):0;
};
const colorOf=raw=>{
 const s=String(raw??'').trim().toLowerCase();
 if(/second|yellow.?red|yellow.?yellow|2nd/.test(s))return null;
 if(/^(yellow|yellow card|booking)$/.test(s))return 'yellow';
 if(/^(red|red card|straight red)$/.test(s))return 'red';
 return null;
};
const idOf=(event,type,team,minute,color,index,injury=0)=>{
 const explicit=event?.eventId??event?.event_id??event?.id;
 if(explicit!=null&&String(explicit).trim())return String(explicit);
 // Content-derived identity (not array index) permits identical snapshots
 // while refusing indistinguishable duplicate same-minute incidents.
 const actor=event?.player?.id??event?.playerId??event?.player_id??
   event?.player?.name??event?.player_name??event?.nameStr??'';
 return ['unkeyed',type,team??'',minute,injury,actor,color??'',event?.detail??''].join('|');
};
const map=(entries,adapt)=>{
 const corner=[],card=[];
 for(let i=0;i<entries.length;i++){
  const row=adapt(entries[i],i);
  if(!row)continue;
  if(row.type==='corner')corner.push(row);
  if(row.type==='card')card.push(row);
 }
 return {cornerEvents:corner,cardEvents:card,
  cornerTimelineAvailable:corner.length>0,cardTimelineAvailable:card.length>0};
};
/** Optional actor identity is provenance, not proof of participation or
 * culpability. Never replace a missing player with the team or an assist.
 */
const playerOf=e=>{
 const raw=e?.player??e?.athlete??e?.actor??null;
 const id=raw?.id??e?.playerId??e?.player_id??null;
 const name=typeof raw==='string'?raw:
  raw?.name??raw?.displayName??e?.player_name??e?.playerName??e?.nameStr??null;
 return {
  playerId:id==null||String(id).trim()===''?null:String(id).slice(0,150),
  playerName:typeof name==='string'&&name.trim()?name.trim().slice(0,200):null
 };
};
const make=(event,index,type,team,minute,injury,color=null,detail='')=>({
 id:idOf(event,type,team,minute,color,index,injury),
 type,team,minute,injury,cardColor:color,detail:String(detail??''),...playerOf(event),
 disabled:event?.disabled===true||event?.cancelled===true||event?.canceled===true,
 shootout:event?.shootout===true,
 phase:event?.phase??event?.scoreInfoTime??event?.period??null
});

export function fotMobTimedIncidents(rawEvents){
 if(!Array.isArray(rawEvents))return {cornerEvents:[],cardEvents:[],cornerTimelineAvailable:false,cardTimelineAvailable:false};
 return map(rawEvents,(e,index)=>{
  const label=String(e?.type??'').toLowerCase();
  const type=label==='corner'||label==='cornerkick'||label==='corner kick'?'corner':
   label==='card'?'card':null;
  if(!type)return null;
  const team=e.isHome===true?'home':e.isHome===false?'away':null;
  const minute=minuteOf(e.time),injury=addedOf(e.time);
  const detail=e.card??e.cardType??e.detail??'';
  return make(e,index,type,team,minute,injury,type==='card'?colorOf(detail):null,detail);
 });
}

/** API-Football fixture event rows; corners are not assumed to be supplied. */
export function apiFootballTimedIncidents(rawEvents,fixture){
 if(!Array.isArray(rawEvents))return {cornerEvents:[],cardEvents:[],cornerTimelineAvailable:false,cardTimelineAvailable:false};
 const home=fixture?.teams?.home?.id,away=fixture?.teams?.away?.id;
 return map(rawEvents,(e,index)=>{
  const label=String(e?.type??'').toLowerCase();
  const type=label==='corner'||label==='corner kick'?'corner':label==='card'?'card':null;
  if(!type)return null;
  const side=teamOf(e,home,away),minute=minuteOf(e.time?.elapsed);
  const injury=Number(e.time?.extra??0);
  return make(e,index,type,side,minute,injury,type==='card'?colorOf(e.detail):null,e.detail);
 });
}
export function bsdTimedIncidents(rawIncidents){
 if(!Array.isArray(rawIncidents))return {cornerEvents:[],cardEvents:[],cornerTimelineAvailable:false,cardTimelineAvailable:false};
 return map(rawIncidents,(e,index)=>{
  const label=String(e?.type??'').toLowerCase();
  const type=['corner','corner_kick'].includes(label)?'corner':
   ['card','yellow_card','red_card','booking'].includes(label)?'card':null;
  if(!type)return null;
  const team=e.is_home===true?'home':e.is_home===false?'away':null;
  const minute=minuteOf(e.minute),injury=Number(e.added_time??0);
  const color=label==='yellow_card'?'yellow':label==='red_card'?'red':
   colorOf(e.card_type??e.card_color??e.color);
  return make(e,index,type,team,minute,injury,color,e.card_type??e.card_color??'');
 });
}
export function sportApiTimedIncidents(rawEvents){
 if(!Array.isArray(rawEvents))return {cornerEvents:[],cardEvents:[],cornerTimelineAvailable:false,cardTimelineAvailable:false};
 return map(rawEvents,(e,index)=>{
  const label=String(e?.event_type??'').toLowerCase();
  const type=['corner','corner_kick'].includes(label)?'corner':
   ['card','yellow_card','red_card'].includes(label)?'card':null;
  if(!type)return null;
  const team=e.team_side==='home'||e.team_side==='away'?e.team_side:null;
  const minute=minuteOf(e.minute),injury=addedOf(e.minute);
  const color=label==='yellow_card'?'yellow':label==='red_card'?'red':
   colorOf(e.card_type??e.card_color??e.extra_info);
  return make(e,index,type,team,minute,injury,color,e.extra_info??'');
 });
}
export function goalApiTimedIncidents(rawEvents){
 if(!Array.isArray(rawEvents))return {cornerEvents:[],cardEvents:[],cornerTimelineAvailable:false,cardTimelineAvailable:false};
 return map(rawEvents,(e,index)=>{
  const label=String(e?.type??'').toLowerCase();
  const type=['corner','corner_kick'].includes(label)?'corner':
   ['card','yellow_card','red_card'].includes(label)?'card':null;
  if(!type)return null;
  const team=e.team_side==='home'||e.team_side==='away'?e.team_side:
   e.isHome===true?'home':e.isHome===false?'away':null;
  const minute=minuteOf(e.time),injury=addedOf(e.time);
  const color=label==='yellow_card'?'yellow':label==='red_card'?'red':
   colorOf(e.info??e.cardType);
  return make(e,index,type,team,minute,injury,color,e.info??'');
 });
}
