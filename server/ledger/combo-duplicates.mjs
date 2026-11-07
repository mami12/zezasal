import {comboOutcomeLegs} from './combo-feasibility.mjs';
const signature=legs=>Array.isArray(legs)&&legs.length===2?legs.map(l=>`${l.market}:${String(l.outcome).toUpperCase()}:${l.line===''||l.line==null?'':Number(l.line)}`).sort().join('|'):null;
/** Display equivalence only: same full-time legs, never just matching titles. */
export function nativeComboSignatures(match,now=Date.now()){
 const result=new Set();
 for(const market of match.markets??[]){
  if(String(market.id).startsWith('BB|')||market.status==='SUSPENDED')continue;
  const name=String(market.name??'').replace(/^Outcome\b/i,'Result').replace(/Both To Score/ig,'Both Teams To Score');
  for(const o of market.outcomes??[]){
   if(o.status!=='ACTIVE'||!Number.isFinite(o.odds)||o.odds<=1||o.priceValidUntil===null||o.priceValidUntil!=null&&o.priceValidUntil<now)continue;
   const key=signature(comboOutcomeLegs(match,{...market,name,outcomeName:o.name,outcomeCode:o.code}));
   if(key)result.add(key);
  }
 }
 return result;
}
export const comboLegSignature=signature;
