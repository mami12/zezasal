/** Full-match team statistics are separate from goals and player event props. */
import {statisticNumber} from '../match-statistics.mjs';
const text=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/over\s*\/\s*under/g,'over under').replace(/[_:.,()]+/g,' ').replace(/\s+/g,' ').trim();
const nameOf=line=>text(line?.market_name??line?.marketName??line?.name);
const number=value=>value!=null&&/^\d+(?:[.,]\d+)?$/.test(String(value).trim())?Number(String(value).replace(',','.')):null;
export function isStatisticMarket(line){return /\b(?:shots?|fouls?)\b|goditj|faulle?/.test(nameOf(line));}
export function statisticMarketContract(line){
 if(!isStatisticMarket(line))return null;
 const name=nameOf(line);
 const stat=/\bshots? (?:on target|on goal)\b|goditj\w* ne porte/.test(name)?'shotsOnTarget'
  :/\bfouls?\b|faulle?/.test(name)?'fouls':/\bshots?\b|goditj/.test(name)?'shots':null;
 const unsupported=!stat||Number(line?.period??0)!==0||/\b(?:players?|scorer|first|1st|second|2nd|half|halves|ht|1h|2h|quarter|period|minute|minutes|next|last|race|handicap|asian|overtime|extra|both|each|off target|blocked|odd|even|exact|range)\b|[+&/]|lojtari|pjesa|minut/.test(name);
 const home=/\b(?:team 1|1 team|home(?: team)?)\b|skuadra 1|ekipi 1/.test(name);
 const away=/\b(?:team 2|2 team|away(?: team)?)\b|skuadra 2|ekipi 2/.test(name);
 // A plain two-way "winner/most" may return stakes on a draw. Only an
 // explicitly three-way 1X2 contract proves that a draw is its own selection.
 const result=/\b1x2\b/.test(name);
 const unclearResult=!result&&/\b(?:result|winner|most)\b/.test(name);
 const lineValue=number(line?.line??line?.specifier);
 const total=/\btotal|over\s*under/.test(name)||lineValue!==null;
 const scope=home?'home':away?'away':result?'result':'total';
 // Unknown qualifiers can name a team/player or change the statistic. Never
 // treat "Arsenal total..." as both teams, or fouls WON as fouls COMMITTED.
 let remainder=name
  .replace(/\bshots? on (?:target|goal)\b|\bshots?\b|\bfouls?(?: committed)?\b|goditj\w* ne porte|goditj\w*|faulle?/g,' ')
  .replace(/\b(?:home(?: team)?|away(?: team)?|team [12]|[12] team)\b|skuadra [12]|ekipi [12]/g,' ')
  .replace(/\b(?:full time|regular time|match|total|totals|over|under|result|winner|most|1x2|totali|totalit|ndeshjes|ndeshja|lart|poshte|mbi|nen)\b/g,' ');
 // Team-comparison statistics are settlement-safe only for an explicit
 // three-way 1/X/2 quote. A two-way 'most fouls' may refund on a tie.
 if(result)remainder=remainder.replace(/\b(?:which team|who)\s+(?:has|have|commits?|makes?|takes?|will have)\s+(?:the\s+)?(?:most|more)\b/g,' ');
 if((home||away))remainder=remainder.replace(/\bby\b/g,' ');
 if(lineValue!==null){const literal=text(line.line??line.specifier).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');remainder=remainder.replace(new RegExp(`\\b${literal}\\b`,'g'),' ');}
 const unrecognized=/[a-z0-9]/.test(remainder);
 return {stat,scope,supported:!unsupported&&!unrecognized&&!unclearResult&&!(home&&away)&&(result?!home&&!away:total&&lineValue!==null&&Number.isInteger(lineValue*2)),line:lineValue};
}
function pair(result,stat){
 let stats=result?.statistics;
 if(typeof stats==='string'){try{stats=JSON.parse(stats);}catch{stats=null;}}
 const values=stats?.[stat];return {home:statisticNumber(values?.home),away:statisticNumber(values?.away)};
}
export function hasStatisticEvidence(line,result){
 const contract=statisticMarketContract(line);if(!contract?.supported||!result)return false;
 const values=pair(result,contract.stat);
 return contract.scope==='home'?values.home!==null:contract.scope==='away'?values.away!==null:values.home!==null&&values.away!==null;
}
export function gradeStatisticLine(line,result){
 const contract=statisticMarketContract(line);if(!contract||!hasStatisticEvidence(line,result))return 'VOID';
 const values=pair(result,contract.stat),key=text(line.outcome_key??line.code),label=text(line.outcome_name??line.outcomeName);
 const selected=`${key} ${label}`;
 if(contract.scope==='result'){
  const side=key==='1'||key==='home'||label==='home'||label!==''&&label===text(result.home_team)?'home'
   :key==='2'||key==='away'||label==='away'||label!==''&&label===text(result.away_team)?'away'
   :key==='x'||key==='draw'||label==='x'||label==='draw'?'draw':null;
  if(!side)return 'VOID';
  return (side==='home'?values.home>values.away:side==='away'?values.away>values.home:values.home===values.away)?'WON':'LOST';
 }
 if(contract.line===null)return 'VOID';
 const over=/\b(?:over|lart|mbi)\b/.test(selected),under=/\b(?:under|poshte|nen)\b/.test(selected);
 if(over===under)return 'VOID';
 const target=contract.scope==='home'?values.home:contract.scope==='away'?values.away:values.home+values.away;
 if(target===contract.line)return 'VOID';
 return (over?target>contract.line:target<contract.line)?'WON':'LOST';
}
