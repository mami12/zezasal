/**
 * Provider's native "Halftime/Fulltime correct score".
 * This is NOT an HT/FT 1-X-2 wager. It asserts two exact scoreboards,
 * e.g. "1:0 / 2:1" and can settle from verified halftime and fulltime facts.
 */
const title=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().trim().replace(/\s+/g,' ');
export const isHtFtCorrectScoreMarket=line=>
 /^half[\s-]*time\s*\/\s*full[\s-]*time\s+correct score$/.test(
  title(typeof line==='string'?line:line?.market_name??line?.marketName??line?.name));
const nonnegative=v=>v!=null&&v!==''&&Number.isSafeInteger(Number(v))&&
 Number(v)>=0&&Number(v)<100?Number(v):null;
export function parseHtFtCorrectScore(line){
 if(!isHtFtCorrectScoreMarket(line)||Number(line.period??0)!==0)return null;
 for(const raw of [line.outcome_name,line.outcomeName,line.outcome_key,line.outcomeKey]){
  const s=String(raw??'').trim();
  const match=s.match(/^(\d{1,2})\s*[:\-]\s*(\d{1,2})\s*(?:\/|\||→|->|and)\s*(\d{1,2})\s*[:\-]\s*(\d{1,2})$/i);
  if(!match)continue;
  const [hh,ha,fh,fa]=match.slice(1).map(Number);
  if(hh>fh||ha>fa)continue;
  return {version:1,kind:'ht-ft-correct-score',ht:{home:hh,away:ha},
   ft:{home:fh,away:fa}};
 }
 return null;
}
export function gradeHtFtCorrectScore(c,result){
 if(c?.kind!=='ht-ft-correct-score'||!result)return null;
 const [hh,ha,fh,fa]=[result.half_home_score,result.half_away_score,
  result.home_score,result.away_score].map(nonnegative);
 if([hh,ha,fh,fa].some(v=>v===null)||hh>fh||ha>fa)return null;
 const stored=[c.ht?.home,c.ht?.away,c.ft?.home,c.ft?.away].map(nonnegative);
 if(stored.some(v=>v===null)||stored[0]>stored[2]||stored[1]>stored[3])return null;
 return [hh,ha,fh,fa].every((v,i)=>v===stored[i])?'WON':'LOST';
}
