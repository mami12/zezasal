import {TEAM_STAT_FIELDS,normalizeTeamStatistics,statisticNumber} from '../match-statistics.mjs';

const STAT_ALIASES={
 'shots on target':'shotsOnTarget','shots on goal':'shotsOnTarget','on target':'shotsOnTarget','shotsontarget':'shotsOnTarget',
 'fouls':'fouls','fouls committed':'fouls','fouls conceded':'fouls','total fouls':'fouls',
 'shots':'shots','total shots':'shots','corners':'corners','corner kicks':'corners',
 'possession':'possession','ball possession':'possession',
 'yellow cards':'yellow','red cards':'red',
};
const statKey=value=>STAT_ALIASES[String(value??'').trim().toLowerCase()]??null;
const pairFromRows=(rows,side)=>{
 const values=(rows??[]).filter(row=>statKey(row.type??row.name)===side)
  .map(row=>{const value=row.value??row.displayValue;return statisticNumber(typeof value==='string'&&side==='possession'?value.replace(/%$/,''):value,{percentage:side==='possession'});}).filter(value=>value!==null);
 return values.length&&new Set(values).size===1?values[0]:null;
};
const rowsPair=(rows,homeId,awayId)=>{
 const home=(rows??[]).find(team=>String(team.team?.id??team.team?.name)===String(homeId)) ?? rows?.[0];
 const away=(rows??[]).find(team=>String(team.team?.id??team.team?.name)===String(awayId)) ?? rows?.[1];
 return Object.fromEntries(TEAM_STAT_FIELDS.map(field=>[field,{
  home:pairFromRows(home?.statistics,field),away:pairFromRows(away?.statistics,field),
 }]));
};
const explicitPair=(home,away)=>{
 const h=normalizeTeamStatistics(home),a=normalizeTeamStatistics(away);
 return Object.fromEntries(TEAM_STAT_FIELDS.map(field=>[field,{home:h[field]??null,away:a[field]??null}]));
};

/** Accept explicit team totals only; player sums and related stats are not substitutes. */
export function displayTeamStatistics(provider,payload,fixture){
 let pairs={};
 if(provider==='bsd')pairs=explicitPair(payload.stats?.home,payload.stats?.away);
 if(provider==='sportapi')pairs=explicitPair(payload.data?.home,payload.data?.away);
 if(provider==='apifootball')pairs=rowsPair(payload.response,fixture.raw?.teams?.home?.id,fixture.raw?.teams?.away?.id);
 if(provider==='goalapi'){
  const rows=payload.data?.match?.fullTime??[];
  pairs=Object.fromEntries(TEAM_STAT_FIELDS.map(field=>[field,{
   home:pairFromRows(rows.map(row=>({...row,value:row.home})),field),
   away:pairFromRows(rows.map(row=>({...row,value:row.away})),field),
  }]));
 }
 if(provider==='worldcup26'){
  const match=payload.events?.find(event=>String(event.id)===String(fixture.id));
  const teams=match?.competitions?.[0]?.competitors??[];
  const home=teams.find(team=>team.homeAway==='home'),away=teams.find(team=>team.homeAway==='away');
  pairs=Object.fromEntries(TEAM_STAT_FIELDS.map(field=>[field,{
   home:pairFromRows(home?.statistics,field),away:pairFromRows(away?.statistics,field),
  }]));
 }
 return pairs;
}

const minuteOf=value=>{
 const match=String(value??'').match(/^\s*(\d{1,3})(?:\s*\+\s*(\d{1,2}))?\s*$/);
 if(!match)return null;
 const minute=Number(match[1]),added=Number(match[2]??0);
 return minute>0&&minute<=120?{minute,added}:null;
};
const intervalIndex=minute=>minute<=15?0:minute<=30?1:minute<=45?2:minute<=60?3:minute<=75?4:minute<=90?5:-1;
const intervals=[
 {label:'1–15',from:1,to:15},{label:'16–30',from:16,to:30},{label:'31–45+',from:31,to:45},
 {label:'46–60',from:46,to:60},{label:'61–75',from:61,to:75},{label:'76–90+',from:76,to:90},
];
/** A missing/ambiguous goal event invalidates the interval view instead of inventing a count. */
export function groupGoalsIntoIntervals(events){
 if(!Array.isArray(events))return null;
 const seen=new Set(),counts=intervals.map(interval=>({...interval,home:0,away:0}));
 for(const event of events){
  if(event?.type!=='goal')continue;
  const id=String(event.id??'');
  if(!id||seen.has(id)||!['home','away'].includes(event.team))return null;
  seen.add(id);
  const minute=minuteOf(event.minute);
  if(!minute)return null;
  const phase=String(event.phase??'').toLowerCase();
  if(event.shootout||/extra|shoot|penalt.*shoot/i.test(phase)||minute.minute>90)continue;
  const index=intervalIndex(minute.minute);
  if(index>=0)counts[index][event.team]++;
 }
 return counts;
}

const isExtra=event=>event?.shootout||/extra|shoot|penalt.*shoot/i.test(String(event?.phase??''))||Number(minuteOf(event?.minute)?.minute)>90;
const rowsOf=(provider,payload,fixture)=>{
 if(provider==='bsd')return {rows:payload.incidents,read:event=>({
  id:event.id,type:event.cancelled||event.disabled||event.type!=='goal'?'other':'goal',team:event.is_home===true?'home':event.is_home===false?'away':null,
  minute:event.minute,phase:event.phase??(Number(event.minute)>45?'H2':'H1'),shootout:event.shootout===true||event.sit==='shootout',
 })};
 if(provider==='goalapi')return {rows:payload.data,read:event=>({
  id:event.id,type:String(event.type??'').toUpperCase()==='GOAL'?'goal':String(event.type??'').toLowerCase(),
  team:event.homeScorer&&!event.awayScorer?'home':event.awayScorer&&!event.homeScorer?'away':null,
  minute:event.time,phase:event.scoreInfoTime??'',shootout:/shootout|penalty shoot/i.test(String(event.scoreInfoTime??'')),
 })};
 if(provider==='sportapi')return {rows:payload.data,read:event=>({
  id:event.id,type:/^(goal|own_goal|penalty_goal)$/i.test(String(event.event_type))?'goal':String(event.event_type??'').toLowerCase(),
  team:event.team_side,minute:String(event.minute??'').replace(/[’'"\s]/g,''),phase:event.phase??'',shootout:/shootout|penalty shoot/i.test(String(event.phase??'')),
 })};
 if(provider==='apifootball')return {rows:payload.response,read:(event,index)=>({
  id:event.id??`${event.time?.elapsed}:${event.time?.extra??0}:${event.team?.id}:${event.player?.id}:${index}`,
  type:String(event.type??'').toLowerCase()==='goal'?'goal':String(event.type??'').toLowerCase(),
  team:String(event.team?.id)===String(fixture.raw?.teams?.home?.id)?'home':
   String(event.team?.id)===String(fixture.raw?.teams?.away?.id)?'away':null,
  minute:event.time?.elapsed,phase:event.time?.elapsed>90?'extra':'',
 })};
 if(provider==='worldcup26'){
  const match=payload.events?.find(event=>String(event.id)===String(fixture.id));
  const teams=match?.competitions?.[0]?.competitors??[];
  return {rows:payload.items,read:event=>({
   id:event.id,type:event.scoringPlay&&event.valid!==false?'goal':'other',
   team:teams.find(team=>String(team.id)===String(event.team?.source_id??event.team?.id))?.homeAway??null,
   minute:String(event.clock?.displayValue??'').replace(/[’'"\s]/g,''),phase:Number(event.period?.number)>2?'extra':'',
   shootout:event.shootout===true,
  })};
 }
 return {rows:null,read:()=>null};
};
/** Convert one provider's complete event response to the display-only goal timeline. */
export function displayGoalIntervals(provider,payload,fixture){
 const {rows,read}=rowsOf(provider,payload,fixture);
 if(!Array.isArray(rows))return null;
 const goals=[];
 for(let index=0;index<rows.length;index++){
  const event=read(rows[index],index);
  if(event?.type!=='goal')continue;
  if(isExtra(event))continue;
  goals.push(event);
 }
 return groupGoalsIntoIntervals(goals);
}
