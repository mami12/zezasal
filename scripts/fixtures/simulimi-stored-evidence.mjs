/**
 * SQL-shaped evidence for the REAL persisted-event grader, without a database.
 * This adapter supplies synthetic event-fact rows. It does NOT decide a wager;
 * gradeStoredEventContract in the production ledger remains the only grader.
 */
import {gradeStoredEventContract} from '../../server/ledger/match-event-facts.mjs';

const stamp='2026-11-09T12:00:00.000Z';
const num=x=>x==null||x===''||!Number.isFinite(Number(x))?null:Number(x);
const withTeam=(events,side)=>side?events.filter(e=>e.team===side):events;
const ordered=rows=>[...rows].sort((a,b)=>(a.seconds??a.minute*60)-(b.seconds??b.minute*60)||String(a.id).localeCompare(String(b.id)));
const person=x=>String(x??'').trim().toLowerCase();

export function syntheticEventQuery(fixture) {
 const facts=ordered(fixture.final.events).map(e=>({
  id:e.id,provider_event_id:e.id,kind:e.type,type:e.type,
  team:e.team,minute:e.minute,seconds:e.seconds??null,
  player_id:e.playerId??null,player_name:e.player??null,
  aiscore_player_id:null,aiscore_player_name:null,aiscore_verified:false,
  own_goal:e.ownGoal??false,phase:e.phase??(e.minute<45?'H1':'H2'),
  card_color:e.cardColor??null,
 }));
 const count=(events,side)=>events.filter(e=>!side||e.team===side).length;
 const milestones=(events,target,side)=>{
  let count=0;
  for(const e of events)if(e.team===side&&++count===target)return Number(e.seconds??e.minute*60);
  return null;
 };
 const matchSlice=(kind)=>facts.filter(e=>e.kind===kind);
 const windowIn=(item,start,end,rolling,intervalSeconds,intervalMinutes)=>{
  if(intervalSeconds)return Number(item.seconds??item.minute*60)>=start&&
   Number(item.seconds??item.minute*60)<end;
  if(rolling)return Number(item.seconds??item.minute*60)>start&&
   Number(item.seconds??item.minute*60)<=end;
  if(intervalMinutes)return (start===null||item.minute>=start)&&(end===null||item.minute<=end);
  return (start===null||item.minute>=start)&&(end===null||item.minute<=end);
 };
 return async (sql,args=[])=>{
  if(sql.startsWith('with covered as')){
   const kind=args[1],events=matchSlice(kind);
   const home=count(events,'home'),away=count(events,'away');
   const from=num(args[2]),to=num(args[3]),side=args[4]??null;
   const playerId=args[5]??null,playerName=person(args[6]);
   const target=num(args[7])??1;
   const rolling=args[9]===true;
   const begin=num(args[10]),end=num(args[11]);
   const secInterval=args[12]===true,minInterval=args[13]===true;
   const color=args[14]??null;
   const inWindow=events.filter(e=>windowIn(e,secInterval||rolling?begin:from,
     secInterval||rolling?end:to,rolling,secInterval,minInterval));
   const selected=withTeam(inWindow,side);
   const nth=events[target-1]??null;
   const last=events.at(-1)??null;
   const firstOfSameSecond=event=>event?
     events.filter(e=>(e.seconds??e.minute*60)===(event.seconds??event.minute*60)).length:0;
   return {rows:[{
    through_minute:96,complete:true,observed_at:stamp,confirmed_at:stamp,
    second_poll_at:stamp,open_recovery_gap:false,card_colors_verified:true,
    total:events.length,home,away,count_home:home,count_away:away,
    window_count:selected.length,
    color_window_count:selected.filter(e=>e.card_color===color).length,
    window_home:count(inWindow,'home'),window_away:count(inWindow,'away'),
    color_total:events.filter(e=>e.card_color===color).length,
    color_home:events.filter(e=>e.card_color===color&&e.team==='home').length,
    color_away:events.filter(e=>e.card_color===color&&e.team==='away').length,
    rolling_boundary_uncertain:false,
    player_goals:events.filter(e=>e.kind==='goal'&&e.own_goal!==true&&(
     playerId!=null?e.player_id!=null&&String(e.player_id)===String(playerId):
      !!playerName&&person(e.player_name)===playerName)).length,
    nth_team:nth?.team??null,nth_minute:nth?.minute??null,
    nth_same_time:firstOfSameSecond(nth),
    last_team:last?.team??null,last_same_time:firstOfSameSecond(last),
    race_home_time:milestones(events,target,'home'),
    race_away_time:milestones(events,target,'away'),
   }]};
  }
  if(/from app_match_event_fact/.test(sql)) {
   // The stored grader asks for the raw fact chronology only after it has
   // checked complete coverage and reconciled the team's final event counts.
   const kind=args[2]??sql.match(/\bkind='(goal|corner|card)'/)?.[1]??null;
   return {rows:kind?facts.filter(e=>e.kind===kind):facts};
  }
  if(/select 1 from app_match_event_coverage/.test(sql))return {rows:[{ok:1}]};
  if(/select provider from app_match_event_coverage/.test(sql))return {rows:[]};
  throw Error('Unexpected synthetic event SQL: '+sql.slice(0,110));
 };
}

export async function gradeWithSyntheticStoredFacts(contract,fixture) {
 if(!contract?.event||!['goal','corner','card'].includes(contract.event))return null;
 const line={
  id:'00000000-0000-4000-8000-000000000001',
  match_id:300000001,live_contract:contract,
 };
 return gradeStoredEventContract(line,fixture.score,{execute:syntheticEventQuery(fixture)});
}
