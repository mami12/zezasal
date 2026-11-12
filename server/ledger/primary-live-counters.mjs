import {teamStatisticsFromRow} from '../match-statistics.mjs';

const nonnegative=value=>value!=null&&value!==''&&
  Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
const timestamp=value=>{
 const milliseconds=value==null?NaN:new Date(value).getTime();
 return Number.isFinite(milliseconds)?milliseconds:null;
};
const fresh=(value,at,maxAge)=>{
 const ms=timestamp(value);
 return ms!==null&&ms<=at+5000&&at-ms<=maxAge;
};
/**
 * Zizobet's live Match.Score and Match.Corners/YellowCards/RedCards/Fouls
 * are actual running counters. Race-to-X needs THESE current values, not
 * the existence of historical incidents or a second upstream API.
 *
 * Never substitute 0 when the provider did not send a number. Require a
 * fresh, observed value for EACH side; minute zero is no exception.
 */
export function primaryLiveCounters(match,event,{at=Date.now()}={}){
 if(String(match?.service??'').toUpperCase()!=='LIVE'||
    !fresh(match?.clock_at,at,45000))return null;
 if(event==='goal'){
  const home=nonnegative(match.home_score),away=nonnegative(match.away_score);
  return home!==null&&away!==null&&fresh(match.score_at,at,90000)?
   {home,away,source:'zizobet-score'}:null;
 }
 if(!['corner','card','foul'].includes(event))return null;
 const teams=teamStatisticsFromRow(match);
 const fields=event==='card'?['yellow','red']:[event==='corner'?'corners':'fouls'];
 const values=[];
 for(const side of ['home','away']){
  const team=teams[side];
  if(!team)return null;
  const numbers=[];
  for(const field of fields){
   const n=nonnegative(team[field]);
   if(n===null||!fresh(team._observedAt?.[field],at,45000))return null;
   numbers.push(n);
  }
  values.push(numbers.reduce((sum,n)=>sum+n,0));
 }
 return {home:values[0],away:values[1],source:'zizobet-stats'};
}
