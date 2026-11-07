import {quoteValidUntil,quoteExpired} from './quote-validity.mjs';
import {frozenSelectionPrice} from './system-columns.mjs';
import {isDecidedLiveOutcome} from './decided-markets.mjs';
/** Apply the same admin/freshness constraints as REST to only the changed rows.
 * Keep null-price removals so stale tabs/slips receive a lock immediately. */
export function projectOddsDelta(row,markets,{matchOverride=()=>null,marketOverride=()=>null,outcomeOverride=()=>null,prematchMaxAgeMs,now=Date.now()}={}){
 const id=String(row.match_id??row.id),matchLocked=row.has_open_odds===false||row.suspended===true||matchOverride(id)?.suspended===true;
 return markets.map(market=>{
  const locked=matchLocked||market.suspended===true||marketOverride(id,market.key,market.line)?.suspended===true;
  return {...market,suspended:locked,outcomes:(market.outcomes??[]).map(outcome=>{
   const override=outcomeOverride(id,market.key,market.line,outcome.key);
   const raw=outcome.price==null?null:Number(override?.price??outcome.price);
   const price=raw!==null&&Number.isFinite(raw)&&raw>=1&&raw<=9999999999.9999?frozenSelectionPrice(raw):null;
   const priceValidUntil=quoteValidUntil(outcome.priceUpdatedAt,row,prematchMaxAgeMs);
   const decided=isDecidedLiveOutcome(row,{name:market.name,line:market.line,period:market.period,outcomeName:outcome.name,outcomeCode:outcome.key});
   return {...outcome,price,priceValidUntil,suspended:locked||outcome.suspended===true||override?.suspended===true||price===null||quoteExpired(priceValidUntil,now)||decided};
  })};
 });
}
