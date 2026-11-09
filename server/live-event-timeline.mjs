/** Display only provider-timed incidents; reception time is never an event minute. */
export function providerTimeline(matchId,rows){
 if(!Array.isArray(rows))return undefined;
 const events=new Map();
 for(const row of rows){
  if(row.cancelled||row.canceled||row.disabled||row.isConfirmed===false||/cancelled|canceled|voided/i.test(String(row.status??''))){
   if(row.id!=null)events.delete(String(row.id));
   continue;
  }
  const clock=String(row.minute??row.gt??'').match(/^(\d{1,3})(?:\s*\+\s*(\d{1,2}))?$/);
  if(!clock)continue;
  const minute=Number(clock[1]),added=Number(clock[2]??row.injury??0);
  if(minute>120||!Number.isInteger(added)||added<0)continue;
  const team=/^(?:home|h|1)$/i.test(String(row.team))?'home':/^(?:away|a|2)$/i.test(String(row.team))?'away':null;
  if(!team)continue;
  const sourceType=String(row.type??'').toLowerCase();
  const type=sourceType==='score_change'||sourceType==='goal'?'goal':sourceType==='corner_kick'||sourceType==='corner'?'corner':/yellow/.test(sourceType)?'yellow_card':/red/.test(sourceType)?'red_card':/foul/.test(sourceType)?'foul':null;
  if(!type)continue;
  const text={goal:'Goal',corner:'Corner',yellow_card:'Yellow card',red_card:'Red card',foul:'Foul'}[type];
  // Zizobet incidents may carry a player as "pl", a structured "player",
  // or an explicit actor label. Preserve only a provider-supplied name:
  // never invent an actor from the team, jersey number or scoreboard.
  const playerName=value=>typeof value==='string'?value.trim():
    value&&typeof value==='object'?String(value.name??value.fullName??value.full_name??'').trim():'';
  const player=[row.pl,row.player,row.player_name,row.playerName,row.actor]
    .map(playerName).find(Boolean)??'';
  const id=String(row.id??[type,minute,added,team,row.pl??row.player??''].join('|'));
  events.set(id,{id,matchId:String(matchId),type,minute,addedMinute:added,minuteLabel:added?minute+'+'+added:String(minute),team,text,...(player?{player}:{})});
 }
 return [...events.values()].sort((a,b)=>a.minute-b.minute||a.addedMinute-b.addedMinute||a.id.localeCompare(b.id));
}
