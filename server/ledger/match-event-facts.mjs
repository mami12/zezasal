import crypto from 'node:crypto';
/**
 * Persistent PRIMARY-feed football incidents. Provider IDs and player names are
 * preserved verbatim. Only an incident list reconciled with the same provider's
 * counters may replace the current active facts. Missing evidence never deletes
 * previously verified facts or grades a losing selection.
 */
export const MATCH_EVENT_FACT_SQL = String.raw`
create table if not exists app_match_event_fact (
 match_id bigint not null,
 provider text not null,
 provider_event_id text not null,
 kind text not null check (kind in ('goal','corner','card','foul')),
 team text not null check (team in ('home','away')),
 minute integer not null check (minute between 0 and 130),
 seconds numeric(12,3),
 player_id text,
 player_name text,
 card_color text check(card_color in ('yellow','red') or card_color is null),
 own_goal boolean,
 aiscore_player_id text,
 aiscore_player_name text,
 aiscore_verified boolean not null default false,
 phase text,
 active boolean not null default true,
 observed_at timestamptz not null default now(),
 primary key(match_id,provider,provider_event_id,kind)
);
alter table app_match_event_fact add column if not exists card_color text;
alter table app_match_event_fact add column if not exists own_goal boolean;
alter table app_match_event_fact add column if not exists aiscore_player_id text;
alter table app_match_event_fact add column if not exists aiscore_player_name text;
alter table app_match_event_fact add column if not exists aiscore_verified boolean not null default false;
create index if not exists app_match_event_fact_lookup
 on app_match_event_fact(match_id,provider,kind,active,minute,seconds);
create table if not exists app_match_event_coverage (
 match_id bigint not null,
 provider text not null,
 kind text not null,
 through_minute numeric(10,4) not null,
 count_home integer not null,
 count_away integer not null,
 complete boolean not null default false,
 observed_at timestamptz not null default now(),
 primary key(match_id,provider,kind)
);
alter table app_match_event_coverage add column if not exists card_colors_verified boolean not null default false;
alter table app_match_event_coverage add column if not exists sample_signature text;
alter table app_match_event_coverage add column if not exists sample_first_seen_at timestamptz;
alter table app_match_event_coverage add column if not exists confirmed_at timestamptz;
`;
const validKind = new Set(['goal','corner','card','foul']);
const validSide = new Set(['home','away']);
/** Called INSIDE the existing live-frame SQL transaction. */
export async function persistVerifiedEventFacts(matchId, frame, execute, observedAt=new Date()) {
 const observed=new Date(observedAt);
 if(!Number.isFinite(observed.getTime()))throw new Error('Invalid event observation timestamp');
 if(frame?.source!=='zizobet'||!Array.isArray(frame.events))return 0;
 let stored=0;
 for(const kind of validKind){
  const through=Number(frame.coverage?.[kind+'Through']);
  if(frame.coverage?.[kind+'Through']==null||!Number.isFinite(through)||through<0||through>130)continue;
  const counts=frame.teams?.[kind];
  if(!counts||!['home','away'].every(side=>Number.isSafeInteger(counts[side])&&counts[side]>=0))continue;
  const relevant=frame.events.filter(event=>event.type===kind);
  if(relevant.some(event=>!validSide.has(event.team)||!Number.isInteger(event.minute)||
      event.minute<0||event.minute>130||event.id==null||String(event.id)===''||
      (event.seconds!=null&&(!Number.isFinite(event.seconds)||event.seconds<0))))continue;
  // Only compare complete provider event lists with its own live counters.
  if(relevant.filter(e=>e.team==='home').length!==counts.home||
     relevant.filter(e=>e.team==='away').length!==counts.away)continue;
  // Drop out-of-order or stale samples; they cannot rewrite accepted facts.
  const earlier=await execute(`select through_minute,complete,sample_signature,sample_first_seen_at,confirmed_at
     from app_match_event_coverage where match_id=$1 and provider='zizobet' and kind=$2 for update`,
     [matchId,kind]);
  const previous=earlier.rows[0];
  if(previous&&(Number(previous.through_minute)>through||
    (previous.complete===true&&frame.ended!==true)))continue;
  const identifiers=relevant.map(e=>String(e.id));
  if(new Set(identifiers).size!==identifiers.length)continue;
  // An advancing clock is harmless; corrected incident identity/time is not.
  const signature=crypto.createHash('sha256').update(JSON.stringify({
   kind,home:counts.home,away:counts.away,ended:frame.ended===true,
   colorVerified:kind==='card'&&frame.cardColorsVerified===true,
   events:relevant.map(e=>[String(e.id),e.team,e.minute,e.seconds??null,e.cardColor??null,e.ownGoal??null,e.playerId??null,e.player??null])
     .sort((a,b)=>a[0].localeCompare(b[0]))
  })).digest('hex');
  const facts=relevant.map(e=>({id:String(e.id),team:e.team,minute:e.minute,seconds:e.seconds??null,
   playerId:e.playerId==null?null:String(e.playerId),
   playerName:typeof e.player==='string'?e.player:null,
   ownGoal:typeof e.ownGoal==='boolean'?e.ownGoal:null,
   cardColor:kind==='card'?e.cardColor??null:null,phase:e.phase??null}));
  // A correction may remove/replace a provider event, but the raw live-frame
  // archive remains intact. Changes are atomic with coverage and the new frame.
  await execute(`update app_match_event_fact set active=false,observed_at=now()
     where match_id=$1 and provider='zizobet' and kind=$2 and active=true
     and not(provider_event_id=any($3::text[]))`,[matchId,kind,identifiers]);
  if(facts.length)await execute(`insert into app_match_event_fact
    (match_id,provider,provider_event_id,kind,team,minute,seconds,player_id,
     player_name,card_color,own_goal,phase,active)
    select $1,'zizobet',f.id,$2,f.team,f.minute,f.seconds,f.player_id,
     f.player_name,f.card_color,f.own_goal,f.phase,true
    from jsonb_to_recordset($3::jsonb)
     as f(id text,team text,minute integer,seconds numeric,player_id text,
       player_name text,card_color text,own_goal boolean,phase text)
    on conflict(match_id,provider,provider_event_id,kind) do update
    set team=excluded.team,minute=excluded.minute,seconds=excluded.seconds,
        player_id=excluded.player_id,player_name=excluded.player_name,
        card_color=excluded.card_color,own_goal=excluded.own_goal,
        aiscore_verified=case when app_match_event_fact.team=excluded.team
          and app_match_event_fact.minute=excluded.minute
          and (excluded.player_name is null or app_match_event_fact.aiscore_player_name is null
               or lower(excluded.player_name)=lower(app_match_event_fact.aiscore_player_name))
          then app_match_event_fact.aiscore_verified else false end,
        aiscore_player_name=case when app_match_event_fact.team=excluded.team
          and app_match_event_fact.minute=excluded.minute
          and (excluded.player_name is null or app_match_event_fact.aiscore_player_name is null
               or lower(excluded.player_name)=lower(app_match_event_fact.aiscore_player_name))
          then app_match_event_fact.aiscore_player_name else null end,
        aiscore_player_id=case when app_match_event_fact.team=excluded.team
          and app_match_event_fact.minute=excluded.minute
          and (excluded.player_name is null or app_match_event_fact.aiscore_player_name is null
               or lower(excluded.player_name)=lower(app_match_event_fact.aiscore_player_name))
          then app_match_event_fact.aiscore_player_id else null end,
        phase=excluded.phase,active=true,observed_at=now()`,
   [matchId,kind,JSON.stringify(facts.map(f=>({
    id:f.id,team:f.team,minute:f.minute,seconds:f.seconds,player_id:f.playerId,
    player_name:f.playerName,card_color:f.cardColor,own_goal:f.ownGoal,phase:f.phase})))]);
  await execute(`insert into app_match_event_coverage
    (match_id,provider,kind,through_minute,count_home,count_away,complete,
     sample_signature,sample_first_seen_at,confirmed_at,observed_at,card_colors_verified)
    values ($1,'zizobet',$2,$3,$4,$5,$6,$7,$8::timestamptz,null,$8::timestamptz,$9::boolean)
    on conflict(match_id,provider,kind) do update
    set through_minute=excluded.through_minute,count_home=excluded.count_home,
        count_away=excluded.count_away,complete=excluded.complete,
        card_colors_verified=excluded.card_colors_verified,
        sample_signature=excluded.sample_signature,
        sample_first_seen_at=case
          when app_match_event_coverage.sample_signature=excluded.sample_signature
          then coalesce(app_match_event_coverage.sample_first_seen_at,excluded.sample_first_seen_at)
          else excluded.sample_first_seen_at end,
        confirmed_at=case
          when app_match_event_coverage.sample_signature=excluded.sample_signature
            and app_match_event_coverage.sample_first_seen_at is not null
            and (app_match_event_coverage.confirmed_at is not null or
              excluded.observed_at-app_match_event_coverage.sample_first_seen_at>=interval '5 seconds')
          then coalesce(app_match_event_coverage.confirmed_at,excluded.observed_at)
          else null end,
        observed_at=excluded.observed_at
    where excluded.through_minute>=app_match_event_coverage.through_minute
       or excluded.complete=true`,
   [matchId,kind,through,counts.home,counts.away,frame.ended===true,signature,observed,
    kind==='card'&&frame.cardColorsVerified===true]);
  stored+=facts.length;
 }
 return stored;
}
export const SUPPORTED_FACT_KINDS=new Set(['window','sequence','race','over','under','exact','atLeast','range','team-total-goals','interval-result','interval-leader','window-total','nth-time','player-goal']);
/**
 * PostgreSQL counts the accepted, verified incidents. Returns null when the
 * accepted structured contract, ordering or coverage cannot prove an answer.
 * Do not infer a loss from an absent row or an incomplete timeline.
 */
async function gradeSingleEventProvider(line,result,{execute,provider='zizobet'}={}){
 const c=line?.live_contract;
 if(!c||!SUPPORTED_FACT_KINDS.has(c.kind)||!validKind.has(c.event)||typeof execute!=='function')return null;
 const {rows}=await execute(`with covered as (
   select through_minute,count_home,count_away,complete,observed_at,confirmed_at,card_colors_verified from app_match_event_coverage
   where match_id=$1 and provider=$16::text and kind=$2
 ), ordered as (
   select f.*,row_number() over(order by coalesce(f.seconds,f.minute*60),f.minute,f.provider_event_id) as ordinal,
     count(*) over(partition by coalesce(f.seconds,f.minute*60)) as same_time
   from app_match_event_fact f
   where f.match_id=$1 and f.provider=$16::text and f.kind=$2 and f.active
 ), aggregate as (
   select count(*)::int as total,
    count(*) filter(where team='home')::int as home,
    count(*) filter(where team='away')::int as away,
    count(*) filter(where card_color=$15::text)::int as color_total,
    count(*) filter(where team='home' and card_color=$15::text)::int as color_home,
    count(*) filter(where team='away' and card_color=$15::text)::int as color_away,
    -- Fixed 10-20 minute markets use inclusive provider minutes.
    -- Rolling windows and clock-formatted score intervals instead use seconds.
    count(*) filter(where (
        ($10::boolean=true and coalesce(seconds,minute*60)>$11::numeric
         and coalesce(seconds,minute*60)<=$12::numeric)
        or ($10::boolean=false and ($3::numeric is null or minute >= $3)
         and ($4::numeric is null or minute <= $4)))
      and ($5::text is null or team=$5))::int as window_count,
    count(*) filter(where (
        ($10::boolean=true and coalesce(seconds,minute*60)>$11::numeric
         and coalesce(seconds,minute*60)<=$12::numeric)
        or ($10::boolean=false and ($3::numeric is null or minute >= $3)
         and ($4::numeric is null or minute <= $4)))
      and ($5::text is null or team=$5)
      and card_color=$15::text)::int as color_window_count,
    count(*) filter(where (
      ($13::boolean=true and coalesce(seconds,minute*60)>=$11::numeric
       and coalesce(seconds,minute*60)<$12::numeric)
      or ($14::boolean=true and minute>=$3::numeric and minute<=$4::numeric))
      and team='home')::int as window_home,
    count(*) filter(where (
      ($13::boolean=true and coalesce(seconds,minute*60)>=$11::numeric
       and coalesce(seconds,minute*60)<$12::numeric)
      or ($14::boolean=true and minute>=$3::numeric and minute<=$4::numeric))
      and team='away')::int as window_away,
    bool_or($10::boolean=true and seconds is null
      and (minute=floor($11::numeric/60) or minute=floor($12::numeric/60))) as rolling_boundary_uncertain,
    count(*) filter(where (own_goal=false or (own_goal is null and aiscore_verified=true))
     and (($6::text is not null and (
       (player_id is not null and player_id=$6) or
       (aiscore_verified=true and aiscore_player_id is not null and aiscore_player_id=$6)))
      or ($6::text is null and (
       (player_name is not null and lower(player_name)=lower($7)) or
       (aiscore_verified=true and aiscore_player_name is not null
         and lower(aiscore_player_name)=lower($7))))))::int as player_goals,
    bool_or(same_time>1) as ambiguous_order,
    bool_or(seconds is null) as minute_only
   from ordered
 )
 select a.*,c.through_minute,c.count_home,c.count_away,c.complete,c.observed_at,c.confirmed_at,c.card_colors_verified,
  (select last_seen_at from app_live_event_cursor where match_id=$1) as second_poll_at,
  exists(select 1 from app_live_event_recovery g
    where g.match_id=$1 and g.status='AWAITING_BACKUP_API' and $9::uuid=any(g.line_ids)
      and $16::text='zizobet') as open_recovery_gap,
   (select team from ordered where ordinal=$8) as nth_team,
   (select minute from ordered where ordinal=$8) as nth_minute,
   (select same_time from ordered where ordinal=$8) as nth_same_time,
   (select min(ordinal) from (
     select ordinal,team,count(*) over(partition by team order by ordinal) as team_number
     from ordered
   ) race where team_number=$8 and team='home') as race_home,
   (select min(ordinal) from (
     select ordinal,team,count(*) over(partition by team order by ordinal) as team_number
     from ordered
   ) race where team_number=$8 and team='away') as race_away,
   (select coalesce(seconds,minute*60) from ordered where ordinal=(
     select min(ordinal) from (
       select ordinal,team,count(*) over(partition by team order by ordinal) as team_number from ordered
     ) race where team_number=$8 and team='home'
   )) as race_home_time,
   (select coalesce(seconds,minute*60) from ordered where ordinal=(
     select min(ordinal) from (
       select ordinal,team,count(*) over(partition by team order by ordinal) as team_number from ordered
     ) race where team_number=$8 and team='away'
   )) as race_away_time
 from aggregate a left join covered c on true`,
 [line.match_id,c.event,
  c.kind==='interval-result'?c.fromSeconds/60:c.from??null,
  c.kind==='interval-result'?(c.toExclusiveSeconds-1)/60:c.to??null,
  c.side??null,c.playerId??null,c.playerName??null,c.target??1,line.id,
  c.kind==='window'&&c.startExclusive===true,
  c.kind==='interval-result'?c.fromSeconds:c.kind==='window'?c.from*60:null,
  c.kind==='interval-result'?c.toExclusiveSeconds:c.kind==='window'?c.to*60:null,
  c.kind==='interval-result',c.kind==='interval-leader',c.cardColor??null,provider]);
 const data=rows[0];
 if(!data||data.through_minute==null||data.open_recovery_gap===true)return null;
 // A partial/corrected frame must not silently reclassify a missing event.
 if(Number(data.home)!==Number(data.count_home)||
    Number(data.away)!==Number(data.count_away))return null;
 const totalFor=kind=>kind==='goal'?[result?.home_score,result?.away_score]:
   kind==='corner'?[result?.corners_home,result?.corners_away]:
   kind==='card'?[result?.cards_home,result?.cards_away]:[null,null];
 const expectedTotals=totalFor(c.event);
 const finalCounts=expectedTotals.every(x=>x!=null&&Number.isSafeInteger(Number(x))&&Number(x)>=0);
 const full=!!(result&&data.complete===true&&finalCounts&&
   Number(data.home)===Number(expectedTotals[0])&&Number(data.away)===Number(expectedTotals[1]));
 // Primary Zizobet facts need a later identical poll and a cursor update.
 // Historical facts instead need a complete FT score-matched timeline
 // persisted atomically under their real source. They never authorize
 // partial live grading or corner/card totals inferred from aggregate stats.
 if(data.confirmed_at==null||data.observed_at==null)return null;
 const confirmed=new Date(data.confirmed_at).getTime();
 const stored=new Date(data.observed_at).getTime();
 if(![confirmed,stored].every(Number.isFinite)||confirmed>stored)return null;
 if(provider==='zizobet'){
   if(data.second_poll_at==null)return null;
   const cursor=new Date(data.second_poll_at).getTime();
   if(!Number.isFinite(cursor)||stored!==cursor)return null;
 }else if(!['fotmob','apifootball','sportapi','goalapi','bsd','worldcup26'].includes(provider)||
   !['goal','corner','card'].includes(c.event)||!full||c.kind==='player-goal')return null;
 // No exact-second interval or rolling window may use a minute-only timestamp
 // as though it were a true second. Fixed inclusive minute bands remain valid.
 if(provider!=='zizobet'&&data.minute_only===true&&
   (c.kind==='interval-result'||(c.kind==='window'&&c.startExclusive===true)))return null;
 if(c.cardColor!=null&&
   (c.event!=='card'||!['yellow','red'].includes(c.cardColor)||
    data.card_colors_verified!==true))return null;
 const through=Number(data.through_minute);
 const scopeEnded=full||(Number.isFinite(c.to)&&through>Number(c.to));
 const count=Number(c.cardColor?(c.side==='home'?data.color_home:c.side==='away'?data.color_away:data.color_total):
   (c.side==='home'?data.home:c.side==='away'?data.away:data.total));
 const expected=Number(c.target??c.threshold);
 const decision=truth=>truth?'WON':'LOST';
 if(c.kind==='window'){
  // Provider minute ranges are inclusive: 10-20 covers ALL of minute 20.
  // Only a rolling elapsed-seconds window closes at its exact deadline.
  const closesAt=c.startExclusive===true?Number(c.to):Math.floor(Number(c.to))+1;
  if(!Number.isFinite(closesAt)||through<closesAt||typeof c.choice!=='boolean')return null;
  // Minute-only data cannot classify an event in the first or last
  // fractional minute of a rolling market. No speculative wallet change.
  if(c.startExclusive===true&&data.rolling_boundary_uncertain===true)return null;
  const num=Number(c.cardColor?data.color_window_count:data.window_count);
  return decision(c.choice?(num>0):(num===0));
 }
 if(c.kind==='interval-result'){
  if(!Number.isSafeInteger(c.toExclusiveSeconds)||through*60<c.toExclusiveSeconds)return null;
  const h=Number(data.window_home),a=Number(data.window_away);
  return decision((h>a?'home':a>h?'away':'none')===c.side);
 }
 if(c.kind==='interval-leader'){
  const closesAt=Math.floor(Number(c.to))+1;
  if(!Number.isFinite(closesAt)||through<closesAt||
     !['home','away','none'].includes(c.side))return null;
  const h=Number(data.window_home),a=Number(data.window_away);
  return decision((h>a?'home':a>h?'away':'none')===c.side);
 }
 if(c.kind==='window-total'){
  const closesAt=Math.floor(Number(c.to))+1;
  if(!Number.isFinite(closesAt)||through<closesAt)return null;
  const found=Number(c.cardColor?data.color_window_count:data.window_count);
  if(c.choice==='over'||c.choice==='under'){
   if(!Number.isFinite(c.threshold)||!Number.isInteger(c.threshold*2))return null;
   if(found===c.threshold)return Number.isInteger(c.threshold)?'VOID':null;
   return decision(c.choice==='over'?found>c.threshold:found<c.threshold);
  }
  if(c.choice==='exact'&&Number.isInteger(c.target))return decision(found===c.target);
  if(c.choice==='atLeast'&&Number.isInteger(c.target))return decision(found>=c.target);
  return null;
 }
 if(c.kind==='nth-time'){
  if(!Number.isInteger(c.target)||c.target<1)return null;
  if(data.nth_team!=null){
   if(Number(data.nth_same_time)>1)return null;
   if(c.choice==='none')return 'LOST';
   if(c.choice!=='range'||!Number.isInteger(c.from)||!Number.isInteger(c.to))return null;
   return decision(Number(data.nth_minute)>=c.from&&Number(data.nth_minute)<=c.to);
  }
  if(!full)return null;
  return c.choice==='none'?'WON':'LOST';
 }
 if(c.kind==='sequence'){
  if(data.nth_team!=null){
   if(Number(data.nth_same_time)>1)return null;
   return decision(data.nth_team===c.side);
  }
  if(!full)return null;
  return c.side==='none'?'WON':decision(false);
 }
 if(c.kind==='race'){
  if(!Number.isInteger(c.target)||c.target<1||!['home','away'].includes(c.side))return null;
  const h=data.race_home_time==null?null:Number(data.race_home_time);
  const a=data.race_away_time==null?null:Number(data.race_away_time);
  if(h===null&&a===null)return full?'VOID':null; // race not reached in normal time
  // Simultaneous or minute-only indistinguishable milestones require review.
  if(h!==null&&a!==null&&h===a)return null;
  return decision(c.side===(h!==null&&(a===null||h<a)?'home':'away'));
 }
 if(c.kind==='player-goal'){
  if((!c.playerName&&!c.playerId)||typeof c.choice!=='boolean')return null;
  // A verified scorer proves YES/NO immediately; absence does not prove
  // participation, an own goal, or a losing player proposition.
  if(Number(data.player_goals)>0)return c.choice?'WON':'LOST';
  // A missing scorer name does not prove a player played or failed to score.
  // Require verified player participation before a negative settlement.
  return null;
 }
 if(c.kind==='team-total-goals'){
  if(!Number.isFinite(c.threshold)||!['over','under'].includes(c.choice))return null;
  if(count>c.threshold)return c.choice==='over'?'WON':'LOST';
  if(!full)return null;
  if(count===c.threshold&&Number.isInteger(c.threshold))return 'VOID';
  return c.choice==='under'?'WON':'LOST';
 }
 if(c.kind==='over'||c.kind==='under'){
  if(!Number.isFinite(expected))return null;
  if(count>expected)return c.kind==='over'?'WON':'LOST';
  if(!full)return null;
  if(count===expected&&Number.isInteger(expected))return 'VOID';
  return c.kind==='under'?'WON':'LOST';
 }
 if(c.kind==='atLeast'){
  if(!Number.isInteger(c.target))return null;
  if(count>=c.target)return 'WON';
  return full?'LOST':null;
 }
 if(c.kind==='exact'){
  if(!Number.isInteger(c.target))return null;
  if(count>c.target)return 'LOST';
  return full?decision(count===c.target):null;
 }
 if(c.kind==='range'&&Number.isFinite(c.min)&&Number.isFinite(c.max)){
  if(count>c.max)return 'LOST';
  return full?decision(count>=c.min&&count<=c.max):null;
 }
 return null;
}

/** Keep historical incidents in their own provider rows. A verified primary
 * decision wins; a complete historical FT may fill a genuinely missing
 * primary timeline. Conflicting historical verdicts are never paid.
 */
export async function gradeStoredEventContract(line,result,{execute}={}){
 const primary=await gradeSingleEventProvider(line,result,{execute,provider:'zizobet'});
 if(primary!==null)return primary;
 if(!result||!['goal','corner','card'].includes(line?.live_contract?.event)||
     typeof execute!=='function')return null;
 // A fully confirmed primary chronology that still cannot prove this contract
 // (e.g. a same-second ordinal tie) must not be overridden by a backup source.
 const authoritative=(await execute(`select 1 from app_match_event_coverage
   where match_id=$1 and provider='zizobet' and kind=$2
     and complete=true and confirmed_at is not null limit 1`,
   [line.match_id,line.live_contract.event])).rows;
 if(authoritative.length)return null;
 const {rows}=await execute(`select provider from app_match_event_coverage
   where match_id=$1 and kind=$5 and provider=any($2::text[])
     and complete=true and confirmed_at is not null
     and count_home=$3 and count_away=$4
   order by observed_at desc limit 8`,
   [line.match_id,['fotmob','apifootball','sportapi','goalapi','bsd','worldcup26'],
    line.live_contract.event==='goal'?result.home_score:
      line.live_contract.event==='corner'?result.corners_home:result.cards_home,
    line.live_contract.event==='goal'?result.away_score:
      line.live_contract.event==='corner'?result.corners_away:result.cards_away,
    line.live_contract.event]);
 if(!rows.length)return null;
 const verdicts=[];
 for(const row of rows){
   const status=await gradeSingleEventProvider(line,result,{execute,provider:row.provider});
   if(!['WON','LOST','VOID'].includes(status))return null;
   verdicts.push(status);
 }
 return new Set(verdicts).size===1?verdicts[0]:null;
}
