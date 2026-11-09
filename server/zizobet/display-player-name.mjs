/**
 * Display-only player name extraction from Zizobet's existing incident frame.
 * Names must come from the event itself. A numeric player ID, an anonymous
 * jersey number, or team/score text must never be presented as a player.
 * Supplementary AiScore identity uses its separately verified path.
 */
const valid=value=>{
 if(typeof value!=='string')return null;
 const name=value.replace(/\s+/g,' ').trim();
 if(name.length<2||name.length>180||!/\p{L}/u.test(name)||
    /^(?:home|away|home team|away team|goal|corner|card|yellow card|red card|unknown|n\/a|none)$/i.test(name)||
    /^\d+(?:[./-]\d+)*$/.test(name))return null;
 return name;
};
const actor=value=>{
 const direct=valid(value);
 if(direct)return direct;
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 for(const key of ['full_name','fullName','player_name','playerName',
    'display_name','displayName','name','Name','nm']){
  const candidate=valid(value[key]);
  if(candidate)return candidate;
 }
 return null;
};
export function zizoEventPlayerName(event){
 if(!event||typeof event!=='object')return null;
 for(const field of ['pl','player','player_name','playerName','PlayerName','scorer','actor']){
  const found=actor(event[field]);
  if(found)return found;
 }
 return null;
}
