import {primaryLiveCounters} from './primary-live-counters.mjs';

/**
 * The two contracts are deliberately separate:
 * - race/Nth event is judged from match-wide cumulative order;
 * - a timed proposition bought LIVE is judged only from events AFTER the
 * accepted primary-feed counters, inside the quoted time window.
 * PREMATCH uses its natural zero baseline and never needs incident history.
 */
const whole=value=>value!=null&&value!==''&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
const invalid=(message,code='MARKET_EVIDENCE_UNSUPPORTED')=>Object.assign(new Error(message),{code,status:400});
const timedKinds=new Set(['window','window-total','interval-leader','interval-result','nth-time']);
const remainingKinds=new Set(['window','window-total','interval-leader','interval-result']);

export function intervalBounds(contract){
 if(!timedKinds.has(contract?.kind))return null;
 if(contract.kind==='interval-result')return Number.isFinite(contract.fromSeconds)&&Number.isFinite(contract.toExclusiveSeconds)
   ?{from:contract.fromSeconds/60,toExclusive:contract.toExclusiveSeconds/60}:null;
 return Number.isFinite(contract.from)&&Number.isFinite(contract.to)
   ?{from:contract.from,toExclusive:Math.floor(contract.to)+1}:null;
}
/** Has the offered future proposition already closed at acceptance? */
export function assessInterval(contract,{clock,goalTotal=null}={}){
 const bounds=intervalBounds(contract);
 if(!bounds||!Number.isFinite(clock))return 'UNVERIFIABLE';
 if(clock>=bounds.toExclusive)return 'DECIDED';
 if(contract.kind==='nth-time'){
  const total=whole(goalTotal);
  if(total===null)return 'UNVERIFIABLE';
  if(!Number.isInteger(contract.target)||contract.target<1)return 'UNVERIFIABLE';
  return total>=contract.target?'DECIDED':'OPEN';
 }
 // Even a 90-0 score does not decide an unplayed timed window.
 // Older in-window incidents are not results of this NEW live wager.
 return 'OPEN';
}
const enforce=decision=>{
 if(decision==='DECIDED')throw invalid('Intervali ose ngjarja e kërkuar ka përfunduar.','MARKET_DECIDED');
 if(decision==='UNVERIFIABLE')throw invalid('Mungon ora ose numëruesi aktual i Zizobet për këtë treg LIVE.');
};
/**
 * Read ONLY the current cumulative totals when the primary match snapshot
 * omitted a field. This is not a request for historical incident chronology.
 * The coverage must be confirmed and at least as recent as the match clock.
 */
async function currentCounters(match,event,{execute,at,clock}){
 const primary=primaryLiveCounters(match,event,{at});
 if(primary)return primary;
 if(typeof execute!=='function')return null;
 try{
  const {rows}=await execute(`select count_home,count_away,through_minute,
    observed_at,confirmed_at from app_match_event_coverage
    where match_id=$1 and provider='zizobet' and kind=$2
      and confirmed_at is not null limit 1`,[Number(match.match_id),event]);
  const snapshot=rows?.[0],home=whole(snapshot?.count_home),away=whole(snapshot?.count_away);
  const observed=snapshot?.observed_at==null?NaN:new Date(snapshot.observed_at).getTime();
  const confirmed=snapshot?.confirmed_at==null?NaN:new Date(snapshot.confirmed_at).getTime();
  if(home===null||away===null||!Number.isFinite(observed)||!Number.isFinite(confirmed)||
    confirmed>observed||observed>at+5000||at-observed>45000||
    !Number.isFinite(Number(snapshot?.through_minute))||
    Number(snapshot.through_minute)<Math.floor(clock))return null;
  return {home,away,source:'zizobet-confirmed-counters'};
 }catch{return null;}
}
/**
 * Return the EXACT contract to store in app_ticket_line.live_contract.
 * No past events are imported into a newly placed timed bet. Its cumulative
 * event counts become immutable acceptance baselines. At settlement a primary
 * chronological fact is counted only if its within-team ordinal exceeds the
 * frozen count AND its minute is inside the offered interval.
 */
export async function verifyLiveIntervalAcceptance(contract,match,{
 execute,at=Date.now(),nativeQuoteVerified=false
}={}){
 if(String(match?.service??'').toUpperCase()!=='LIVE')return contract;
 const bounds=intervalBounds(contract);
 if(!bounds)return contract;
 if(nativeQuoteVerified===true){
  // Offer presence, suspension and price freshness were already checked in
  // bets.mjs. This helper only snapshots evidence for LATER settlement.
  // Never query incident history or throw because LIVE clock/counters lag.
  const clock=match.match_time_ms==null?null:Number(match.match_time_ms)/60000;
  const stamp=match.clock_at==null?NaN:new Date(match.clock_at).getTime();
  const freshClock=Number.isFinite(clock)&&clock>=0&&Number.isFinite(stamp)&&
    stamp<=at+5000&&at-stamp<=45000;
  const counts=['goal','corner','card','foul'].includes(contract.event)
    ?primaryLiveCounters(match,contract.event,{at}):null;
  if(contract.kind==='nth-time'){
    // Absolute Nth goal derives from the original quote and complete match
    // chronology. Optional counters are evidence, never a purchase gate.
    return freshClock&&counts?{...contract,entryBaseline:{home:counts.home,away:counts.away},
      entryClockMinute:clock,entryObservedAt:new Date(at).toISOString()}:contract;
  }
  if(!remainingKinds.has(contract.kind))return contract;
  // A future interval contains no incidents before this new acceptance.
  if(freshClock&&clock<bounds.from)return contract;
  // If it is already underway, old events must not be counted as new ones.
  // An absent baseline makes settlement PENDING/review, not placement rejected.
  if(!freshClock||!counts)return {...contract,entryEvidenceMissing:true};
  return {...contract,entryBaseline:{home:counts.home,away:counts.away},
    entryClockMinute:clock,entryObservedAt:new Date(at).toISOString()};
 }
 const quoteAnchoredOrdinal=nativeQuoteVerified===true&&contract.kind==='nth-time'&&
   contract.event==='goal'&&Number.isSafeInteger(contract.target);
 const clock=match.match_time_ms==null?null:Number(match.match_time_ms)/60000;
 const stamp=match.clock_at==null?NaN:new Date(match.clock_at).getTime();
 if(!Number.isFinite(clock)||!Number.isFinite(stamp)||stamp>at+5000||at-stamp>45000){
  // The explicitly quoted match-wide Nth goal keeps its exact number and
  // minute band. Missing a momentary clock update does not change that
  // original offer. At settlement we require a confirmed incident timeline.
  if(quoteAnchoredOrdinal)return contract;
  throw invalid('Mungon ora LIVE e freskët e Zizobet.');
 }
 if(!['goal','corner','card','foul'].includes(contract.event))
  throw invalid('Lloji i ngjarjes nuk është i verifikueshëm.');
 // No expensive incident-history query. Only a live counter may be needed.
 if(clock>=bounds.toExclusive){enforce('DECIDED');}
 const counts=await currentCounters(match,contract.event,{execute,at,clock});
 if(!counts){
  if(quoteAnchoredOrdinal)return contract;
  // A future, not-yet-started interval needs no purchase-time cumulative
  // baseline: ALL its incidents will be after acceptance. Confirmed primary
  // history later grades the full quoted band. This never applies to an
  // interval already under way, where pre-bet incidents must be excluded.
  const futureNativeBand=nativeQuoteVerified===true&&
    remainingKinds.has(contract.kind)&&clock<bounds.from;
  if(futureNativeBand)return contract;
  throw invalid('Mungojnë numëruesit LIVE të konfirmuar të Zizobet për këtë ngjarje.');
 }
 if(contract.kind==='nth-time'){
  enforce(assessInterval(contract,{clock,goalTotal:counts.home+counts.away}));
  // Preserve the GLOBAL goal ordinal and its current match-wide score.
  // A new first/second/third goal can only be inferred from two later primary
  // frames when the frozen total was exactly target-1 and its clock falls
  // inside the advertised minute band. Never rewrite it as interval goal #1.
  return {...contract,entryBaseline:{home:counts.home,away:counts.away},
   entryClockMinute:clock,entryObservedAt:new Date(at).toISOString()};
 }
 enforce(assessInterval(contract,{clock}));
 if(!remainingKinds.has(contract.kind))return contract;
 return {...contract,entryBaseline:{home:counts.home,away:counts.away},
   entryClockMinute:clock,entryObservedAt:new Date(at).toISOString()};
}
