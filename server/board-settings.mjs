/** Presentation policy only: never removes feed rows or pending-ticket facts. */
import {competitionDecision,normalizeCompetition,isEuropeanFootballCountry,isSyntheticFootballMatch} from './football-competitions.mjs';
import {splitByKickoff} from './subscribe-plan.mjs';
export const DEFAULT_BOARD_SETTINGS=Object.freeze({prematchLimit:0});
let settings={...DEFAULT_BOARD_SETTINGS};const listeners=new Set();
export const boardSettings=()=>({...settings});
export function validateBoardSettings(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>k!=='prematchLimit')||typeof value.prematchLimit!=='number'||!Number.isInteger(value.prematchLimit)||value.prematchLimit<0||value.prematchLimit>10000)throw Object.assign(new Error('Kufiri prematch duhet të jetë numër i plotë nga 0 deri në 10000. 0 do të thotë pa kufi.'),{status:400});
 return {prematchLimit:value.prematchLimit};
}
export function setBoardSettings(value){const next=validateBoardSettings(value);if(next.prematchLimit!==settings.prematchLimit){settings=next;for(const fn of listeners)try{fn(boardSettings());}catch{}}return boardSettings();}
export function subscribeBoardSettings(fn){listeners.add(fn);return()=>listeners.delete(fn);}
const countries=['england','italy','spain','germany','france','portugal'];
export function competitionPriority(row){
 const country=String(row.category_slug??row.tournament?.category?.slug??'').toLowerCase();
 const name=row.tournament_name??row.tournament?.name??'';
 const decision=competitionDecision({name},{slug:country});
 if(!decision.allowed)return {priority:100,protected:false};
 const label=normalizeCompetition(name);
 if((['europe','uefa'].includes(country)||/\buefa\b/.test(label))&&/\b(?:european championship|champions league|europa league|conference league|nations league)\b/.test(label))return {priority:1,protected:true};
 if(decision.tier&&countries.includes(country))return {priority:10+countries.indexOf(country)+(decision.tier-1)*10,protected:true};
 if(decision.tier===1&&isEuropeanFootballCountry(country))return {priority:40,protected:true};
 return {priority:100,protected:false};
}
const time=value=>{const n=new Date(value??0).getTime();return Number.isFinite(n)?n:0;};
const live=row=>String(row.service??row.status).toUpperCase()==='LIVE';
function compare(a,b){return Number(live(b))-Number(live(a))||(!live(a)?a.listing_priority-b.listing_priority:0)||time(a.competition_first_seen_at??a.first_seen_at)-time(b.competition_first_seen_at??b.first_seen_at)||String(a.tournament_id??'').localeCompare(String(b.tournament_id??''),'en',{numeric:true})||time(live(a)?a.live_first_seen_at:a.prematch_first_seen_at??a.first_seen_at)-time(live(b)?b.live_first_seen_at:b.prematch_first_seen_at??b.first_seen_at)||String(a.match_id).localeCompare(String(b.match_id),'en',{numeric:true});}
export function selectPublishedMatches(catalog,config=boardSettings()){
 const rows=catalog.filter(r=>r.active!==false&&!isSyntheticFootballMatch(r)&&!/^(?:ended|finished|cancelled|closed|uncovered)$/i.test(String(r.status??''))&&!/^(?:ft|finished|ended|full.?time)$/i.test(String(r.feed_status??''))).map(row=>{const rank=competitionPriority(row);return {...row,listing_priority:rank.priority,protected_prematch:!live(row)&&rank.protected};}).sort(compare);
 const prematch=rows.filter(r=>!live(r)),protectedRows=prematch.filter(r=>r.protected_prematch),others=prematch.filter(r=>!r.protected_prematch);
 const limit=validateBoardSettings({prematchLimit:config.prematchLimit??0}).prematchLimit;
 const activePrematch=limit>0?prematch.slice(0,limit):prematch;
 const activeIds=new Set(activePrematch.map(row=>String(row.match_id)));
 const selected=rows.filter(row=>live(row)||activeIds.has(String(row.match_id)));
 const competitions=new Map();for(const r of protectedRows){const key=`${r.category_slug}|${r.tournament_id??r.tournament_name}`;const old=competitions.get(key);if(old)old.matches++;else competitions.set(key,{country:r.category_name??r.category_slug,name:r.tournament_name,matches:1});}
 return {rows:selected,summary:{availablePrematch:prematch.length,protectedPrematch:protectedRows.length,visiblePrematch:activePrematch.length,hiddenPrematch:prematch.length-activePrematch.length,live:rows.filter(live).length,protectedExceedsLimit:false},protectedCompetitions:[...competitions.values()]};
}
/** Stop ordinary prematch refresh work for hidden fixtures. LIVE, boosted
 * details and pending-result subscriptions retain their independent paths. */
export function filterBoardSubscriptionPlan(plan,rows,options={}){
 const visible=new Set(rows.filter(r=>!live(r)).map(r=>String(r.match_id)));
 const filtered={...plan,...Object.fromEntries(['prematch','prematchSoon','prematchLater','unpriced'].filter(k=>Array.isArray(plan[k])).map(k=>[k,plan[k].filter(id=>visible.has(String(id)))]))};
 if(options.prematchLimit!=null){
  // Apply the feed quota AFTER canonical priority. Otherwise early foreign
  // fixtures could consume the quota before protected European leagues.
  const selected=rows.filter(r=>!live(r)),ids=selected.map(r=>r.match_id);
  const kickoff=Object.fromEntries(selected.map(r=>[r.match_id,time(r.start_at)]));
  const {soon,later}=splitByKickoff(ids,kickoff,{soonMs:options.soonMs});
  Object.assign(filtered,{prematch:ids,prematchSoon:soon,prematchLater:later});
 }
 return filtered;
}

