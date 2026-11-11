/**
 * Source-labelled event archive for opened/watched fixtures. Never use these
 * partial secondary timelines as automatic settlement evidence.
 * Primary Zizobet goals/corners/cards/fouls remain in app_match_event_fact.
 */
import {createHash} from 'node:crypto';

export const SUPPLEMENTAL_INCIDENT_SQL=String.raw`
create table if not exists app_supplemental_match_incident (
 match_id bigint not null,
 provider text not null,
 provider_fixture_id text not null,
 provider_event_id text not null,
 kind text not null check(kind in ('goal','corner','card','foul','shot')),
 team text check(team in ('home','away')),
 minute integer check(minute between 0 and 130),
 added_minute integer check(added_minute between 0 and 30),
 seconds numeric(12,3),
 source_order integer,
 player_id text,
 player_name text,
 card_color text,
 on_target boolean,
 raw jsonb not null,
 observed_at timestamptz not null default now(),
 primary key(match_id,provider,provider_event_id,kind)
);
create index if not exists app_supplemental_match_incident_lookup
 on app_supplemental_match_incident(match_id,kind,minute,added_minute);
create table if not exists app_supplemental_match_snapshot (
 match_id bigint not null,
 provider text not null,
 provider_fixture_id text not null,
 payload_hash text not null,
 payload jsonb not null,
 observed_at timestamptz not null default now(),
 primary key(match_id,provider,payload_hash)
);
`;
const kinds=new Set(['goal','corner','card','foul','shot']);
const providers=new Set(['fotmob','aiscore','apifootball','sportapi','goalapi','bsd','worldcup26']);
const count=v=>v!==null&&v!==undefined&&v!==''&&Number.isSafeInteger(Number(v))&&Number(v)>=0?Number(v):null;
const nameOf=v=>typeof v==='string'&&v.trim()?v.trim().slice(0,200):null;
const minutes=value=>{
 const match=String(value??'').trim().match(/^(\d{1,3})(?:\s*\+\s*(\d{1,2}))?(?:['’])?$/);
 if(!match)return {minute:null,addedMinute:null};
 const minute=Number(match[1]),addedMinute=Number(match[2]??0);
 return minute<=130&&addedMinute<=30?{minute,addedMinute}:{minute:null,addedMinute:null};
};
const eventId=(provider,kind,source,raw)=>{
 const id=raw?.eventId??raw?.event_id??raw?.id??null;
 return id!=null&&String(id).trim()?String(id).slice(0,180):
  'hash:'+createHash('sha256').update(JSON.stringify({provider,kind,source,raw})).digest('hex');
};
const identity=raw=>({
 playerId:raw?.player?.id??raw?.playerId??raw?.player_id??null,
 playerName:nameOf(raw?.player?.name??raw?.playerName??raw?.player_name??
   raw?.playerName??raw?.fullName??raw?.nameStr??raw?.player_name)
});
export function fotMobIncidents(details){
 const eventRows=details?.content?.matchFacts?.events?.events;
 const shots=details?.content?.shotmap?.shots;
 const result=[];
 const knownTeams=details?.header?.teams??[];
 const homeId=details?.general?.homeTeam?.id??knownTeams?.[0]?.id??null;
 const awayId=details?.general?.awayTeam?.id??knownTeams?.[1]?.id??null;
 const teamOf=e=>{
  if(e?.isHome===true)return 'home';if(e?.isHome===false)return 'away';
  const id=e?.teamId??e?.team_id;
  return id!=null&&homeId!=null&&String(id)===String(homeId)?'home':
   id!=null&&awayId!=null&&String(id)===String(awayId)?'away':null;
 };
 if(Array.isArray(eventRows)){
  for(const [i,e] of eventRows.entries()){
   if(e?.cancelled===true||e?.canceled===true||e?.disabled===true||
      e?.isDisallowed===true||e?.isPenaltyShootoutEvent===true)continue;
   const label=String(e?.type??'').trim().toLowerCase();
   const kind=label==='goal'?'goal':label==='card'?'card':
    /^(?:corner|cornerkick|corner kick)$/.test(label)?'corner':
    /^(?:foul|foul committed)$/.test(label)?'foul':null;
   if(!kind)continue;
   const clock=minutes(e.time??e.timeStr??e.minute);
   const actor=identity(e);
   result.push({kind,team:teamOf(e),...clock,...actor,
    providerEventId:eventId('fotmob',kind,i,e),
    ownGoal:kind==='goal'?(e.ownGoal===true||e.shotmapEvent?.isOwnGoal===true):null,
    cardColor:kind==='card'?/red/i.test(String(e.card??e.cardType??''))?'red':
     /yellow/i.test(String(e.card??e.cardType??''))?'yellow':null:null,
    onTarget:null,sourceOrder:i,raw:e});
  }
 }
 if(Array.isArray(shots)){
  for(const [i,s] of shots.entries()){
   const base=count(s.min),injury=count(s.minAdded??0);
   const clock=base!==null&&base<=130&&injury!==null&&injury<=30?
    {minute:base,addedMinute:injury}:{minute:null,addedMinute:null};
   result.push({kind:'shot',team:teamOf(s),...clock,
    playerId:s.playerId??null,playerName:nameOf(s.playerName??s.fullName),
    providerEventId:eventId('fotmob','shot',i,s),
    cardColor:null,onTarget:typeof s.isOnTarget==='boolean'?s.isOnTarget:null,
    sourceOrder:i,raw:s});
  }
 }
 return result;
}
/** Normalize an independently fixture-matched backup. No invented minutes,
 * actor IDs, foul incidents, or shot-on-target indicators from totals.
 */
/** Only explicitly timed FOUL/SHOT native incidents. Never manufacture an
 * event minute or player name from aggregate team statistics.
 */
export function rawProviderIncidents(provider,raw=[]){
 if(!Array.isArray(raw))return [];
 const source=String(provider).toLowerCase();
 return raw.flatMap((e,i)=>{
  const label=String(e?.kind_name??e?.event_type??e?.type??e?.kind??'')
   .trim().toLowerCase().replace(/[_-]+/g,' ');
  const kind=/^(?:foul|foul committed)$/.test(label)?'foul':
    /^(?:shot|shot on target|shot on goal|shot off target|attempt saved)$/.test(label)?'shot':null;
  if(!kind||e?.cancelled===true||e?.disabled===true)return [];
  const team=e?.side==='home'||e?.side==='away'?e.side:
   e?.team_side==='home'||e?.team_side==='away'?e.team_side:
   e?.is_home===true||e?.isHome===true?'home':
   e?.is_home===false||e?.isHome===false?'away':null;
  const clock=minutes(e.minute??e.time?.elapsed??e.time??e.min);
  const injury=count(e.injury_time??e.added_time??e.minAdded??e.time?.extra);
  const onTarget=kind==='shot'?typeof e.isOnTarget==='boolean'?e.isOnTarget:
   typeof e.on_target==='boolean'?e.on_target:/on (?:target|goal)|attempt saved/.test(label)?true:
   /off target/.test(label)?false:null:null;
  return [{kind,team,minute:clock.minute,
   addedMinute:injury!==null&&injury<=30?injury:clock.addedMinute,
   ...identity(e),providerEventId:eventId(source,kind,i,e),
   sourceOrder:Number.isSafeInteger(Number(e.seq))?Number(e.seq):i,
   cardColor:null,onTarget,raw:e}];
 });
}
export function backupIncidents(evidence={}){
 const rows=[...(evidence.events??[]),...(evidence.cornerEvents??[]),
  ...(evidence.cardEvents??[]),...(evidence.foulEvents??[]),
  ...(evidence.shotEvents??[]),...(evidence.otherIncidents??[])];
 return rows.flatMap((e,i)=>{
  const type=String(e?.type??'').toLowerCase();
  const kind=type==='goal'?'goal':type==='corner'?'corner':
   type==='card'?'card':type==='foul'?'foul':
   type==='shot'||type==='shot_on_target'?'shot':null;
  if(!kind||e?.disabled===true||e?.cancelled===true||
     e?.shootout===true||e?.team!=='home'&&e?.team!=='away')return [];
  const minute=count(e.minute),injury=count(e.injury??0);
  return [{
   kind,team:e.team,minute:minute!==null&&minute<=130?minute:null,
   addedMinute:injury!==null&&injury<=30?injury:null,
   ownGoal:kind==='goal'?(e.own===true||e.ownGoal===true):null,
   playerId:e.playerId??e.player_id??null,
   playerName:nameOf(e.player??e.playerName),
   providerEventId:eventId('backup',kind,i,e),cardColor:e.cardColor??null,
   onTarget:typeof e.onTarget==='boolean'?e.onTarget:null,
   seconds:e.seconds!=null&&Number.isFinite(Number(e.seconds))?Number(e.seconds):null,
   sourceOrder:Number.isSafeInteger(Number(e.sourceOrder))?Number(e.sourceOrder):i,raw:e
  }];
 });
}
export async function storeSupplementalIncidents(matchId,provider,fixtureId,rows,{execute,payload=null}={}){
 const id=Number(matchId),source=String(provider).toLowerCase();
 if(!Number.isSafeInteger(id)||id<=0||!providers.has(source)||
  fixtureId==null||!String(fixtureId).trim()||typeof execute!=='function'||!Array.isArray(rows))
  return {stored:0,reason:'SOURCE_FIXTURE_UNVERIFIED'};
 const valid=rows.filter(row=>kinds.has(row?.kind)&&
  (row.team==null||['home','away'].includes(row.team))&&
  (row.minute==null||Number.isSafeInteger(row.minute)&&row.minute>=0&&row.minute<=130)&&
  (row.addedMinute==null||Number.isSafeInteger(row.addedMinute)&&row.addedMinute>=0&&row.addedMinute<=30))
  .slice(0,1500).map(row=>({
   provider_event_id:String(row.providerEventId).slice(0,180),
   kind:row.kind,team:row.team??null,minute:row.minute??null,
   added_minute:row.addedMinute??null,seconds:row.seconds??null,
   source_order:row.sourceOrder??null,
   player_id:row.playerId==null?null:String(row.playerId).slice(0,200),
   player_name:nameOf(row.playerName),
   card_color:row.cardColor??null,on_target:row.onTarget??null,
   raw:row.raw??{}
  }));
 if(valid.length){
  await execute(`insert into app_supplemental_match_incident
    (match_id,provider,provider_fixture_id,provider_event_id,kind,team,minute,
      added_minute,seconds,source_order,player_id,player_name,card_color,on_target,raw)
    select $1,$2,$3,x.provider_event_id,x.kind,x.team,x.minute,x.added_minute,
      x.seconds,x.source_order,x.player_id,x.player_name,x.card_color,x.on_target,x.raw
    from jsonb_to_recordset($4::jsonb) as x(
      provider_event_id text,kind text,team text,minute integer,added_minute integer,
      seconds numeric,source_order integer,player_id text,player_name text,
      card_color text,on_target boolean,raw jsonb)
    on conflict(match_id,provider,provider_event_id,kind) do update set
     team=excluded.team,minute=excluded.minute,
     added_minute=excluded.added_minute,seconds=excluded.seconds,
     source_order=excluded.source_order,player_id=excluded.player_id,
     player_name=excluded.player_name,card_color=excluded.card_color,
     on_target=excluded.on_target,raw=excluded.raw,observed_at=now()`,
   [id,source,String(fixtureId),JSON.stringify(valid)]);
 }
 if(payload!=null){
  const json=JSON.stringify(payload);
  const hash=createHash('sha256').update(json).digest('hex');
  await execute(`insert into app_supplemental_match_snapshot
    (match_id,provider,provider_fixture_id,payload_hash,payload)
    values($1,$2,$3,$4,$5::jsonb)
    on conflict(match_id,provider,payload_hash) do nothing`,
   [id,source,String(fixtureId),hash,json]);
 }
 return {stored:valid.length};
}
