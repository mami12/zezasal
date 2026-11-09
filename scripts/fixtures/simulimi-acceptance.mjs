/**
 * Dry-run of existing contract parsers against PREMATCH and three LIVE clocks.
 * NOT a wallet placement request. It cannot know real price suspension/admin
 * policy without a real fixture and does not claim "accepted" status.
 */
import {frozenLiveContract} from '../../server/ledger/live-contract-context.mjs';
import {isHandicapMarket,parseHandicapContract} from '../../server/ledger/handicap-contracts.mjs';
import {isHtFtMarket,parseHtFtOutcome} from '../../server/ledger/ht-ft.mjs';
import {isDcBttsMarket,parseDcBttsOutcome} from '../../server/ledger/dc-btts.mjs';
import {isHalfComboFamily,parseHalfCombination} from '../../server/ledger/half-combinations.mjs';
import {isPeriodGoalTotal,parsePeriodGoalTotal} from '../../server/ledger/period-goal-totals.mjs';
import {isPlayerGoalSpecial,parsePlayerGoalSpecial} from '../../server/ledger/player-goal-specials.mjs';
import {isStatisticMarket,statisticMarketContract} from '../../server/ledger/statistic-markets.mjs';

const label=x=>String(x??'').trim();
const reject=(stage,reason,code='MARKET_EVIDENCE_UNSUPPORTED')=>
 ({status:'REJECTED',code,stage,reason});
const possible=(stage,rule)=>({status:'CONTRACT_MAPPED_ONLY',stage,rule,
 note:'Dry-run parser passed; actual bet admission still checks native quote, odds, suspended status, admin settings and match evidence.'});
const unverified=(why)=>({status:'NOT_VERIFIED',stage:'other-booking-conditions',reason:why});
function sampleMatch(scope,now){
 const prematch=scope==='PREMATCH';
 const minute=scope==='LIVE_0'?0:scope==='LIVE_15'?15:scope==='LIVE_60'?60:null;
 const score=minute===0?[0,0]:minute===15?[1,0]:minute===60?[2,1]:[0,0];
 const corner=minute===0?[0,0]:minute===15?[1,1]:minute===60?[5,4]:[0,0];
 const card=minute===0?[0,0]:minute===15?[0,0]:minute===60?[2,1]:[0,0];
 const at=new Date(now).toISOString();
 const match={
  service:prematch?'PREMATCH':'LIVE',
  home:'Home Team',away:'Away Team',
  start_at:new Date(now+(prematch?3600000:-3600000)).toISOString(),
  home_score:score[0],away_score:score[1],score_at:at,
  clock_at:at,feed_status:minute>=45?'Second Half':'First Half',
  match_time_ms:prematch?null:minute*60000,
  stats:{home:{corners:corner[0]},away:{corners:corner[1]}}
 };
 const cardSnapshot={count_home:card[0],count_away:card[1],through_minute:minute??0,
  observed_at:at,confirmed_at:at,booked:false};
 return {match,cardSnapshot,minute};
}
export function diagnosticForScope(line,scope,{at=Date.now(),mapped=false}={}){
 const {match,cardSnapshot,minute}=sampleMatch(scope,at);
 const market=label(line.market_name),outcome=label(line.outcome_name??line.outcome_key);
 const preflight={...line,raceCardSnapshot:cardSnapshot,playerCardSnapshot:cardSnapshot};
 // Mirror the explicit contracts checked at the wallet's first gate. These
 // are not replacements for resolveSelection; they expose deterministic
 // rejection messages before any stake is touched.
 if(isHtFtMarket(market)&&!parseHtFtOutcome(outcome,line.outcome_key))
  return reject('HT_FT_SELECTION','Opsioni Pjesa e parë / Fundi i ndeshjes nuk u njoh.');
 if(isDcBttsMarket(market)&&!parseDcBttsOutcome(outcome,line.outcome_key))
  return reject('DC_BTTS_SELECTION','Kombinimi Double Chance + BTTS nuk ka opsion të identifikueshëm.');
 if(isHalfComboFamily(line)&&!parseHalfCombination(line,{home:match.home,away:match.away}))
  return reject('HALF_COMBO_SELECTION','Opsioni i kombinimit nuk përputhet me rezultatin dhe totalin e tregut.');
 if(isPeriodGoalTotal(line)&&!parsePeriodGoalTotal(line,{home:match.home,away:match.away}))
  return reject('PERIOD_GOAL_SELECTION','Tregu i golave ka limit ose pjesë të paidentifikuar.');
 if(isPlayerGoalSpecial(line)&&!parsePlayerGoalSpecial(line))
  return reject('PLAYER_GOAL_SPECIAL','Mungon emri i lojtarit ose limiti i saktë i golave.');
 if(isStatisticMarket(line)&&statisticMarketContract(line)?.supported!==true)
  return reject('STATISTIC_SELECTION','Këtij tregu i mungon një rregull i verifikuar për statistikën.');
 if(isHandicapMarket(line)){
  const handicap=parseHandicapContract(line,{teams:match,drawOffered:false});
  if(!handicap)
   return reject('HANDICAP_SELECTION','Handikapi nuk ka opsion të qartë ose kërkon pagesë pjesore 0.25/0.75.');
  if(!scope.startsWith('LIVE'))
   return possible('HANDICAP_CONTRACT',handicap.kind);
  if(!handicap.rest||handicap.event!=='goal'||handicap.half!==0)
   return reject('LIVE_HANDICAP','Mungon rregulli i furnizuesit për handikapin LIVE.');
  return possible('LIVE_HANDICAP',handicap.kind);
 }
 try{
  const contract=frozenLiveContract(preflight,match,at);
  if(contract){
   // A player market may need a verified, same-player incident history and
   // participation proof. Passing a parser alone is NEVER wallet approval.
   return possible('FROZEN_EVENT_CONTRACT',contract.kind);
  }
  return mapped?possible('FINAL_SCORE_OR_STAT_RULE','mapped-final-grader'):
   unverified('Nuk u gjet kontratë e ngrirë për këtë përzgjedhje. Duhet kontroll i veçantë i rrugës së pranimit dhe shlyerjes.');
 }catch(error){
  return reject('FROZEN_EVENT_CONTRACT',error?.message??String(error),
   error?.code??'MARKET_EVIDENCE_UNSUPPORTED');
 }
}
export function diagnosticForAllScopes(line,{at=Date.now(),mapped=false}={}){
 return Object.fromEntries(['PREMATCH','LIVE_0','LIVE_15','LIVE_60']
  .map(scope=>[scope,diagnosticForScope(line,scope,{at,mapped})]));
}
