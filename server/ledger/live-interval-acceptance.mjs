import {primaryLiveCounters} from './primary-live-counters.mjs';
/**
 * Verify an already-started interval against PRIMARY Zizobet incidents at bet
 * acceptance. PREMATCH never calls this lookup: the baseline is zero.
 *
 * Distinguish "interval started" from "selection decided". Do not infer an
 * empty interval from an absent incident archive, and never debit a stake
 * when an affirmative proposition is already irrevocably true or false.
 */
const whole=value=>value!=null&&value!==''&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
const invalid=(message,code='MARKET_EVIDENCE_UNSUPPORTED')=>Object.assign(new Error(message),{code,status:400});
const kinds=new Set(['window','window-total','interval-leader','interval-result','nth-time']);
export function intervalBounds(contract){
 if(!kinds.has(contract?.kind))return null;
 if(contract.kind==='interval-result')return Number.isFinite(contract.fromSeconds)&&Number.isFinite(contract.toExclusiveSeconds)
   ? {from:contract.fromSeconds/60,toExclusive:contract.toExclusiveSeconds/60}:null;
 return Number.isFinite(contract.from)&&Number.isFinite(contract.to)
   ? {from:contract.from,toExclusive:Math.floor(contract.to)+1}:null;
}
/** A pure state machine, used for every supported kind and event. */
export function assessInterval(contract,{clock,windowHome=null,windowAway=null,goalTotal=null}={}){
 const bounds=intervalBounds(contract);
 if(!bounds||!Number.isFinite(clock))return 'UNVERIFIABLE';
 // Nth-goal offers depend on the GLOBAL ordinal even before their
 // advertised minute window begins. A goal already scored at 1:00 makes
 // "who scores goal 1 at 6-10" irrevocably decided at 1:00.
 if(contract.kind==='nth-time'){
  if(whole(goalTotal)===null)return 'UNVERIFIABLE';
  return clock>=bounds.toExclusive||goalTotal>=contract.target?'DECIDED':'OPEN';
 }
 if(clock>=bounds.toExclusive)return 'DECIDED';
 if(clock<bounds.from)return 'OPEN';
 if(contract.kind==='window'&&contract.startExclusive===true)return 'OPEN';
 // The leader/result cannot be irreversible until its clock interval ends.
 // A valid current quote can be accepted without fetching ALL past events;
 // settlement still requires the complete primary fact history.
 if(contract.kind==='interval-leader'||contract.kind==='interval-result')return 'OPEN';
 const h=whole(windowHome),a=whole(windowAway);
 if(h===null||a===null)return 'UNVERIFIABLE';
 const n=contract.side==='home'?h:contract.side==='away'?a:h+a;
 if(contract.kind==='window')return n>0?'DECIDED':'OPEN';
 if(contract.kind==='window-total'){
  if((contract.choice==='over'||contract.choice==='under')&&n>contract.threshold)return 'DECIDED';
  if(contract.choice==='atLeast'&&n>=contract.target)return 'DECIDED';
  if(contract.choice==='exact'&&n>contract.target)return 'DECIDED';
 }
 return 'OPEN'; // interval leaders/results stay uncertain until the interval closes.
}
function enforce(decision){
 if(decision==='DECIDED')throw invalid('Ky treg është vendosur tashmë sipas të dhënave LIVE.','MARKET_DECIDED');
 if(decision==='UNVERIFIABLE')throw invalid('Mungon historia e konfirmuar e Zizobet për intervalin LIVE.');
}
/**
 * Called after the immutable contract has been parsed but BEFORE taking money.
 * The current score can prove 0 prior goals. Nonzero counters need complete
 * reconciling facts from Zizobet, not names or missing rows.
 */
export async function verifyLiveIntervalAcceptance(contract,match,{execute,at=Date.now()}={}){
 if(String(match?.service??'').toUpperCase()!=='LIVE')return;
 const bounds=intervalBounds(contract);
 if(!bounds)return;
 const clock=match.match_time_ms==null?null:Number(match.match_time_ms)/60000;
 if(!Number.isFinite(clock))throw invalid('Mungon ora e konfirmuar LIVE.');
 const counts=primaryLiveCounters(match,contract.event,{at});
 const goalTotal=counts?counts.home+counts.away:null;
 const inspect=(windowHome,windowAway)=>enforce(assessInterval(contract,{clock,goalTotal,windowHome,windowAway}));
 // The ordinal rule is decided by the current full-score aggregate regardless
 // of which minute range or score (including 100-0) the provider displays.
 if(contract.kind==='nth-time'){inspect(null,null);return;}
 if(clock<bounds.from||contract.kind==='window'&&contract.startExclusive===true){
  inspect(null,null);return;
 }
 if(clock>=bounds.toExclusive){inspect(null,null);return;}
 // A fresh Zizobet 0-0 counter proves the entire prior match had ZERO
 // events of this kind. Works for goals, corners, cards AND fouls at 0/1/6.
 // These values are not placeholders: primaryLiveCounters checks timestamps.
 if(counts?.home===0&&counts?.away===0){inspect(0,0);return;}
 if(typeof execute!=='function')throw invalid('Mungon kontrolli i kronologjisë LIVE.');
 let row;
 try{
  const res=await execute(`select c.count_home,c.count_away,c.through_minute,c.observed_at,
      c.confirmed_at,c.card_colors_verified,
      f.total_home,f.total_away,f.interval_home,f.interval_away,
      f.color_interval_home,f.color_interval_away
     from app_match_event_coverage c
     cross join lateral (
      select count(*) filter(where team='home')::int total_home,
        count(*) filter(where team='away')::int total_away,
        count(*) filter(where team='home' and minute between $3 and $4)::int interval_home,
        count(*) filter(where team='away' and minute between $3 and $4)::int interval_away,
        count(*) filter(where team='home' and card_color=$5 and minute between $3 and $4)::int color_interval_home,
        count(*) filter(where team='away' and card_color=$5 and minute between $3 and $4)::int color_interval_away
      from app_match_event_fact
      where match_id=$1 and provider='zizobet' and kind=$2 and active=true
     ) f
     where c.match_id=$1 and c.provider='zizobet' and c.kind=$2
       and c.confirmed_at is not null limit 1`,
   [Number(match.match_id),contract.event,Math.floor(bounds.from),
    Math.min(Math.floor(clock),Math.ceil(bounds.toExclusive)-1),contract.cardColor??'']);
  row=res.rows?.[0]??null;
 }catch{row=null;}
 const seen=row?.observed_at==null?NaN:new Date(row.observed_at).getTime();
 const confirmed=row?.confirmed_at==null?NaN:new Date(row.confirmed_at).getTime();
 const valid=row&&Number.isFinite(seen)&&Number.isFinite(confirmed)&&confirmed<=seen&&
  seen<=at+5000&&at-seen<=45000&&Number(row.through_minute)>=Math.floor(clock)&&
  whole(row.count_home)===whole(row.total_home)&&whole(row.count_away)===whole(row.total_away)&&
  (!counts||counts.home===whole(row.count_home))&&
  (!counts||counts.away===whole(row.count_away))&&
  (!contract.cardColor||row.card_colors_verified===true);
 if(!valid)throw invalid('Mungon kronologjia e freskët e konfirmuar e Zizobet për këtë interval.');
 const home=whole(contract.cardColor?row.color_interval_home:row.interval_home);
 const away=whole(contract.cardColor?row.color_interval_away:row.interval_away);
 inspect(home,away);
}
