/**
 * Placement-time safeguard for every provider offer without a frozen event
 * contract. The grader used here is EXACTLY the financial score grader, not
 * an independent heuristic about how a market name sounds.
 *
 * A synthetic scoreboard is never settlement evidence: it is only a
 * pre-debit parser test. Real ticket grades still need verified source facts.
 */
import {gradeLine,hasRequiredSettlementEvidence} from './settler.mjs';

const snapshots=[
 [0,0,0,0,0,0,0,0],
 [1,0,1,0,1,0,1,0],
 [0,1,0,1,0,1,0,1],
 [2,1,1,0,6,4,2,1],
 [1,2,0,1,3,7,1,3],
 [2,2,1,1,4,4,2,2],
 [4,0,2,0,9,2,3,1],
 [0,4,0,2,2,9,1,3],
 [10,5,5,2,11,7,6,4],
];
const valid=new Set(['WON','LOST','VOID']);
export function hasFinalSettlementRule(offer,{home='Home',away='Away'}={}){
 if(!offer?.market_name||(!offer.outcome_name&&!offer.outcome_key))return false;
 const line={...offer,builder_legs:null,accepted_contract:{
  ...(offer.accepted_contract??{}),
  providerPeriod:offer.period??offer.accepted_contract?.providerPeriod??0
 }};
 for(const [h,a,hh,ha,ch,ca,cdh,cda] of snapshots){
  const result={home_team:home,away_team:away,
   home_score:h,away_score:a,half_home_score:hh,half_away_score:ha,
   corners_home:ch,corners_away:ca,cards_home:cdh,cards_away:cda,
   statistics:{shots:{home:12,away:9},shotsOnTarget:{home:6,away:3},
    fouls:{home:12,away:14}}};
  try{
   if(hasRequiredSettlementEvidence(line,result)&&valid.has(gradeLine(line,result)))
    return true;
  }catch{
   // Unknown or malformed contracts never become a guessed LOST or VOID.
  }
 }
 return false;
}
