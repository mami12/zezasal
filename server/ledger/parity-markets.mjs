/**
 * Odd/Even settlement for GOALS and CORNERS.
 * 0 is EVEN. Only corners actually taken (and each retake once) count.
 * Full-match corners come from the independently verified final counters.
 * Half-corners require the recorded period of every confirmed incident.
 */
const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const integer=value=>value!=null&&value!==''&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
export function parseParityMarket(line){
 let name=normalize(line?.market_name??line?.marketName??line?.name);
 const marker=/\b(?:odd (?:or )?even|even (?:or )?odd)\b/;
 if(!marker.test(name))return null;
 name=name.replace(marker,'').replace(/\s+/g,' ').trim();
 const label=normalize(line?.outcome_name??line?.outcomeName);
 const key=normalize(line?.outcome_key??line?.outcomeKey);
 const choice= ['odd','tek'].includes(label)?'odd':['even','cift'].includes(label)?'even':
   ['odd','tek'].includes(key)?'odd':['even','cift'].includes(key)?'even':null;
 if(!choice)return null;
 let half=null;
 const period=name.match(/^(?:(?:1st|first|2nd|second) half)\b/);
 if(period){half=/^(?:1st|first)/.test(period[0])?1:2;name=name.slice(period[0].length).trim();}
 if(half===null){
  const post=name.match(/\b(?:1st|first|2nd|second) half$/);
  if(post){half=/^(?:1st|first)/.test(post[0])?1:2;name=name.slice(0,-post[0].length).trim();}
 }
 name=name.replace(/^(?:(?:full time|match)\s+)/,'').trim();
 let side=null;
 const prefix=name.match(/^(?:home(?: team)?|away(?: team)?|team [12])\b/);
 if(prefix){
  side=/^(?:home|team 1)/.test(prefix[0])?'home':'away';
  name=name.slice(prefix[0].length).trim();
 }
 const suffix=name.match(/\b(?:home(?: team)?|away(?: team)?|team [12])$/);
 if(suffix){
  const last=/^(?:home|team 1)/.test(suffix[0])?'home':'away';
  if(side&&side!==last)return null;
  side=last;name=name.slice(0,-suffix[0].length).trim();
 }
 name=name.replace(/^(?:total )/,'').replace(/ (?:total)$/,'').trim();
 const event=/^goals?$/.test(name)?'goal':/^corners?$/.test(name)?'corner':null;
 if(!event)return null;
 const explicit=Number(line?.period??0);
 if(!Number.isInteger(explicit)||![0,1,2].includes(explicit)||half!==null&&explicit!==0&&explicit!==half)return null;
 if(half===null&&explicit!==0)half=explicit;
 return {version:1,kind:half&&event==='corner'?'half-parity':'parity',
  event,half,side,choice};
}
export function gradeParityMarket(line,result){
 const c=parseParityMarket(line);
 if(!c||!result||c.kind==='half-parity')return null;
 const score=c.event==='goal'?
  [integer(result.home_score),integer(result.away_score)]:
  [integer(result.corners_home),integer(result.corners_away)];
 if(score.some(x=>x===null))return null;
 let [home,away]=score;
 if(c.half){
  if(c.event!=='goal')return null;
  const h=integer(result.half_home_score),a=integer(result.half_away_score);
  if(h===null||a===null||h>home||a>away)return null;
  if(c.half===1){home=h;away=a;}
  else{home-=h;away-=a;}
 }
 const count=c.side==='home'?home:c.side==='away'?away:home+away;
 return (count%2===(c.choice==='even'?0:1))?'WON':'LOST';
}
