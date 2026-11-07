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
  const type=sourceType==='score_change'||sourceType==='goal'?'goal':sourceType==='corner_kick'||sourceType==='corner'?'corner':/yellow/.test(sourceType)?'yellow_card':/red/.test(sourceType)?'red_card':null;
  if(!type)continue;
  const text={goal:'Goal',corner:'Corner',yellow_card:'Yellow card',red_card:'Red card'}[type];
  const id=String(row.id??[type,minute,added,team,row.pl??row.player??''].join('|'));
  const rawPlayer=row.pl??row.player;
  const player=typeof rawPlayer==='string'?rawPlayer.trim():'';
  events.set(id,{id,matchId:String(matchId),type,minute,addedMinute:added,minuteLabel:added?minute+'+'+added:String(minute),team,text,...(player?{player}:{})});
 }
 return [...events.values()].sort((a,b)=>a.minute-b.minute||a.addedMinute-b.addedMinute||a.id.localeCompare(b.id));
}
