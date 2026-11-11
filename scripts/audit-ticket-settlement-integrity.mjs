/**
 * Read-only audit of historical football ticket lines against the CURRENT
 * frozen settlement contracts and presently stored facts.
 *
 * Usage: node scripts/audit-ticket-settlement-integrity.mjs 2000 > ticket-integrity.json
 * This never places bets, changes balances, resettles or refunds anything.
 * After provider history retention, missing evidence cannot prove a prior payout
 * was wrong, so such cases are labelled NEEDS_HISTORICAL_EVIDENCE.
 */
import {pool,query} from '../server/db.mjs';
import {getResult} from '../server/ledger/results.mjs';
import {gradeStoredEventContract,SUPPORTED_FACT_KINDS} from '../server/ledger/match-event-facts.mjs';
import {gradeLine,hasRequiredSettlementEvidence,isProvenTwoWayTotalPush,
 isProvenDrawNoBetPush} from '../server/ledger/settler.mjs';
import {isHandicapMarket,gradeHandicapContract} from '../server/ledger/handicap-contracts.mjs';
const actualStatuses=new Set(['PENDING','WON','LOST','VOID']);
const reportStatus=(actual,expected,manual)=>{
 if(manual)return 'MANUAL_OVERRIDE';
 if(!actualStatuses.has(actual))return 'OTHER_STATUS';
 if(expected==null)return actual==='PENDING'?'WAITING_FOR_EVIDENCE':'NEEDS_HISTORICAL_EVIDENCE';
 if(actual===expected)return 'AGREES_WITH_CURRENT_EVIDENCE';
 if(actual==='PENDING')return 'PENDING_BUT_GRADEABLE';
 return 'POSSIBLE_WRONG_SETTLEMENT';
};
const maximum=Number(process.argv[2]??2000);
const limit=Number.isSafeInteger(maximum)&&maximum>0?Math.min(100000,maximum):2000;
const summary={},byMarket=new Map(),examples=[];
let scanned=0,gradeErrors=0,withResult=0;
try{
 const {rows}=await query(`select l.*,t.status as ticket_status,
  (o.line_id is not null) as manual_override,
  (r.match_id is not null) as has_final_result
  from app_ticket_line l
  join app_ticket t on t.id=l.ticket_id
  left join app_settlement_override o on o.line_id=l.id
  left join app_match_result r on r.match_id=l.match_id
  order by t.placed_at desc,l.id
  limit $1`,[limit]);
 const results=new Map();
 for(const line of rows){
  scanned++;
  const id=String(line.match_id);
  let result=results.get(id);
  if(result===undefined){
   try{result=await getResult(id);}catch(error){
    result=null;gradeErrors++;
   }
   results.set(id,result??null);
  }
  if(result)withResult++;
  let expected=null,reason=null;
  if(result&&!line.manual_override){
   try{
    if(line.live_contract&&SUPPORTED_FACT_KINDS.has(line.live_contract.kind))
     expected=await gradeStoredEventContract(line,result,{execute:query});
    else if(hasRequiredSettlementEvidence(line,result)){
     expected=gradeLine(line,result);
     if(expected==='VOID'&&!isProvenTwoWayTotalPush(line,result)&&
        !isProvenDrawNoBetPush(line,result)&&
        !(isHandicapMarket(line)&&line.live_contract?.kind==='score-handicap'&&
          gradeHandicapContract(line.live_contract,result)==='VOID'))
      expected=null;
    }else reason='MARKET_EVIDENCE_INCOMPLETE';
   }catch(error){gradeErrors++;reason='READ_ONLY_GRADE_ERROR';}
  }
  const status=reportStatus(line.status,expected,line.manual_override===true);
  summary[status]=(summary[status]??0)+1;
  if(status!=='AGREES_WITH_CURRENT_EVIDENCE'){
   const key=line.market_name??'?';
   const aggregate=byMarket.get(key)??{marketName:key,lines:0,pending:0,possiblyWrong:0,missingHistory:0};
   aggregate.lines++;
   if(status==='PENDING_BUT_GRADEABLE')aggregate.pending++;
   if(status==='POSSIBLE_WRONG_SETTLEMENT')aggregate.possiblyWrong++;
   if(status==='NEEDS_HISTORICAL_EVIDENCE')aggregate.missingHistory++;
   byMarket.set(key,aggregate);
   if(examples.length<250)examples.push({
    lineId:line.id,ticketId:line.ticket_id,matchId:id,
    market:line.market_name,selection:line.outcome_name,
    period:line.accepted_contract?.period??null,
    actual:line.status,expected,status,
    reason:reason??line.settlement_reason??null,
    resultSource:result?.source??null
   });
  }
 }
 console.log(JSON.stringify({readOnly:true,limit,scanned,withResult,
  gradeErrors,summary,
  problematicMarketFamilies:[...byMarket.values()].sort((a,b)=>b.possiblyWrong-a.possiblyWrong||
    b.pending-a.pending||b.lines-a.lines).slice(0,250),
  examples,
  warning:'A discrepancy is a REVIEW SIGNAL, not proof of wrong settlement. Evidence can be revised or expire. Do not change wallets from this report.'},null,2));
}catch(error){
 console.error('Ticket settlement read-only audit failed:',error?.message??String(error));
 process.exitCode=1;
}finally{await pool.end();}
