import {gradeHtFt,parseHtFtOutcome} from './ht-ft.mjs';
/**
 * Native, single-price HT/FT + goals combinations. The left hand side is
 * a pair of final 1-X-2 results; the right side is a full/first-half total.
 * Never price or synthetically combine two unrelated odds.
 */
const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .trim().toLowerCase().replace(/\s+/g,' ');
const lineNumber=value=>{
 const s=String(value??'').trim();
 return /^\d{1,3}(?:[.,]\d+)?$/.test(s)?Number(s.replace(',','.')):null;
};
const kindOf=name=>{
 const n=normalize(name);
 const match=n.match(/^half[\s-]*time\s*\/\s*full[\s-]*time\s*(?:&|\+|and)\s*(?:(?:1st|first)\s+half\s+)?(total goals|exact goals)$/);
 if(!match)return null;
 return {scope:/\b(?:1st|first)\s+half\b/.test(n)?'ht':'ft',
  exact:match[1]==='exact goals'};
};
export function isUnverifiedHtFtFamily(line){
 const n=normalize(typeof line==='string'?line:
  line?.market_name??line?.marketName??line?.name);
 // These share HT/FT wording but have DIFFERENT statistics/contract:
 // do not settle a corners result or two exact scores using goal 1-X-2.
 return /^corners?\s+half[\s-]*time\s*\/\s*full[\s-]*time$/.test(n)||
  /^half[\s-]*time\s*\/\s*full[\s-]*time\s+correct score$/.test(n);
}
export function isHtFtTotalMarket(line){
 return kindOf(typeof line==='string'?line:line?.market_name??line?.marketName??line?.name)!==null;
}
export function parseHtFtTotal(line){
 const title=kindOf(line?.market_name??line?.marketName??line?.name);
 if(!title||Number(line?.period??0)!==0)return null;
 const quoted=lineNumber(line?.line??line?.specifier);
 for(const raw of [line?.outcome_name,line?.outcomeName,line?.outcome_key,line?.outcomeKey]){
  const s=String(raw??'').trim();
  // Separators between the two components are explicit; the slash INSIDE
  // 1/X is never treated as the total/score separator.
  const match=s.match(/^([12xX])\s*\/\s*([12xX])\s*(?:&|\+|\band\b|\|)\s*(.+)$/i);
  if(!match)continue;
  const htft=parseHtFtOutcome(match[1]+'/'+match[2]);
  const total=match[3].trim();
  if(!htft)continue;
  if(title.exact){
   const found=total.match(/^(?:exact(?:ly)?\s+)?(\d{1,3})$/i);
   const target=found?lineNumber(found[1]):null;
   if(target===null||!Number.isInteger(target)||target>99||
      quoted!==null&&quoted!==target)continue;
   return {version:1,kind:'ht-ft-total',htft,scope:title.scope,
    totalKind:'exact',target};
  }
  const found=total.match(/^(over|under|mbi|nen)(?:\s+(\d{1,3}(?:[.,]\d+)?))?$/i);
  if(!found)continue;
  const stated=found[2]==null?null:lineNumber(found[2]);
  if(stated===null&&quoted===null||stated!==null&&quoted!==null&&quoted!==stated)continue;
  const target=stated??quoted;
  if(target===null||target>99||!Number.isInteger(target*2))continue;
  return {version:1,kind:'ht-ft-total',htft,scope:title.scope,
   totalKind:found[1].toLowerCase()==='under'||found[1].toLowerCase()==='nen'?'under':'over',
   target};
 }
 return null;
}
const score=value=>value!=null&&value!==''&&Number.isSafeInteger(Number(value))&&
 Number(value)>=0?Number(value):null;
export function gradeHtFtTotal(contract,result){
 if(!contract||contract.kind!=='ht-ft-total'||!result||
    !['ht','ft'].includes(contract.scope)||
    !['over','under','exact'].includes(contract.totalKind)||
    !Number.isFinite(contract.target)||contract.target<0||contract.target>99||
    !Number.isInteger(contract.target*2))return null;
 const [fh,fa,hh,ha]=[result.home_score,result.away_score,
  result.half_home_score,result.half_away_score].map(score);
 if([fh,fa,hh,ha].some(v=>v===null)||hh>fh||ha>fa)return null;
 const htft=gradeHtFt(contract.htft,hh,ha,fh,fa);
 if(htft===null)return null;
 const goals=contract.scope==='ht'?hh+ha:fh+fa;
 if(contract.totalKind==='exact')
  return htft==='WON'&&goals===contract.target?'WON':'LOST';
 // An integer push is a refund ONLY for the provider's proved quoted
 // combination contract; no inferred refunds for unrecognized labels.
 if(Number.isInteger(contract.target)&&goals===contract.target)return 'VOID';
 const totalWins=contract.totalKind==='over'?goals>contract.target:goals<contract.target;
 return htft==='WON'&&totalWins?'WON':'LOST';
}
