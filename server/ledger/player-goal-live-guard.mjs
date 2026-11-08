import {gradePlayerGoalSpecial} from './player-goal-specials.mjs';
/**
 * A LIVE player-goal quote must be based on the current, independently
 * reconfirmed goals and scorer list. No stale 'Yes' after a player has
 * already met the quoted target.
 */
const num=value=>value!=null&&value!==''&&Number.isSafeInteger(Number(value))&&
 Number(value)>=0?Number(value):null;
export function playerGoalLiveGuard(contract,coverage,events,match,{now=Date.now()}={}){
 if(contract?.kind!=='player-goal-special'||!match||!Array.isArray(events))
  return {allowed:false,reason:'MISSING_SCORER_EVIDENCE'};
 const clockMs=match.match_time_ms;
 const minute=clockMs!=null&&Number.isFinite(Number(clockMs))?Number(clockMs)/60000:null;
 const observed=coverage?.observed_at==null?null:Date.parse(coverage.observed_at);
 const confirmed=coverage?.confirmed_at==null?null:Date.parse(coverage.confirmed_at);
 const through=coverage?.through_minute==null?null:Number(coverage.through_minute);
 const [h,a,ch,ca]=[match.home_score,match.away_score,
  coverage?.count_home,coverage?.count_away].map(num);
 if(!Number.isFinite(minute)||minute<0||
    observed===null||confirmed===null||!Number.isFinite(observed)||!Number.isFinite(confirmed)||
    confirmed>observed||now-observed>45000||observed-now>5000||
    !Number.isFinite(through)||through<Math.floor(minute)||
    [h,a,ch,ca].some(x=>x===null)||h!==ch||a!==ca||
    events.length!==ch+ca)return {allowed:false,reason:'STALE_OR_UNRECONCILED_SCORER_SNAPSHOT'};
 // Missing own-goal classification makes the player's already-decided
 // status unknowable. No one may bet from a possibly decided old quote.
 if(events.some(e=>e.own_goal==null&&e.aiscore_verified!==true))
  return {allowed:false,reason:'UNVERIFIED_PLAYER_GOAL_CLASSIFICATION'};
 const decided=gradePlayerGoalSpecial(contract,events,{complete:false});
 if(decided==='WON'||decided==='LOST')
  return {allowed:false,reason:'PLAYER_GOAL_MARKET_ALREADY_DECIDED',status:decided};
 return {allowed:true};
}
