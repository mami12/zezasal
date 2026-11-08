/**
 * Football 2-way Asian and 3-way European handicaps.
 * This module supports 0 / .5 whole/half lines, NOT quarter split stakes.
 * The quoted 1/X/2 option and draw availability are frozen at acceptance.
 * Live Asian handicaps use a PRECISE accepted baseline only when explicitly
 * labelled "rest of match"; provider-specific unknown live rules are refused.
 */
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/\s+/g,' ').trim();
const int=v=>v!=null&&v!==''&&Number.isSafeInteger(Number(v))&&Number(v)>=0?Number(v):null;
const number=v=>v==null||v===''?null:/^[+-]?\d+(?:[.,]\d+)?$/.test(String(v).trim())?
 Number(String(v).trim().replace(',','.')):null;
export const isHandicapMarket=line=>/\b(?:handicap|spread|fora)\b/i.test(norm(line?.market_name??line?.marketName??line?.name));
const playerSide=(label,teams={})=>{
 const n=norm(label).replace(/\s+/g,' ').trim();
 const home=norm(teams.home??teams.home_team),away=norm(teams.away??teams.away_team);
 if(['1','home','home team','team 1'].includes(n)||home&&n===home)return 'home';
 if(['2','away','away team','team 2'].includes(n)||away&&n===away)return 'away';
 if(['x','draw','tie','barazim'].includes(n))return 'none';
 return null;
};
export function parseHandicapContract(line,{teams={},drawOffered=false}={}){
 if(!isHandicapMarket(line))return null;
 const name=norm(line.market_name??line.marketName??line.name);
 if(/\b(?:shots?|cards?|fouls?|players?|penalties|extra time|sets?)\b/.test(name))return null;
 const event=/\bcorners?\b/.test(name)?'corner':'goal';
 const first=/\b(?:1st|first) half\b/.test(name),second=/\b(?:2nd|second) half\b/.test(name);
 if(first&&second)return null;
 const explicit=Number(line.period??0);
 if(![0,1,2].includes(explicit)||explicit&&first&&explicit!==1||
    explicit&&second&&explicit!==2)return null;
 const half=first?1:second?2:explicit;
 // Half-corner handicaps are graded later from complete period-labelled facts.
 const is3way=/\b(?:european|3\s*way|three\s*way|1x2)\b/.test(name)||
  drawOffered===true||line.handicapDrawOffered===true;
 const label=String(line.outcome_name??line.outcomeName??'').trim();
 const key=String(line.outcome_key??line.outcomeKey??'').trim();
 const rawSide=label.match(/^(.+?)\s*\(([+-]?\d+(?:[.,]\d+)?)\)$/);
 let side=playerSide(rawSide?.[1]??label,teams)??playerSide(key,teams);
 if(!side)return null;
 let handicap=number(rawSide?.[2]),direct=handicap!==null;
 const rawLine=String(line.line??line.specifier??'').trim();
 const scoreStart=rawLine.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
 const marketLine=name.match(/\bhandicap\s*\(([+-]?\d+(?:[.,]\d+)?)\)$/);
 const titleLine=number(marketLine?.[1]);
 const lineValue=number(rawLine);
 const homeLine=scoreStart?Number(scoreStart[1])-Number(scoreStart[2]):titleLine??lineValue;
 if(homeLine===null&&!direct)return null;
 // In 1X2/European markets the handicap belongs to the HOME team.
 // In Asian markets a selected AWAY team's number is the negative of
 // the published HOME line, unless a selection quotes its own handicap.
 if(side==='none'&&!is3way)return null;
 if(!direct)handicap=side==='away'?-homeLine:homeLine;
 if(handicap===null||!Number.isFinite(handicap)||Math.abs(handicap)>30||
    !Number.isSafeInteger(handicap*2))return null;
 if(side==='none')handicap=homeLine;
 // The exact amount of a quarter-line win/loss cannot be represented by a
 // single WON/LOST/VOID ticket state. Never settle these as full wins/losses.
 const rest=/\brest of (?:the )?(?:match|game|half)\b/.test(name);
 return {version:1,kind:'score-handicap',event,half,side,handicap,
  threeWay:is3way,rest};
}
export function gradeHandicapContract(contract,result){
 if(!contract||contract.kind!=='score-handicap'||!result)return null;
 let home,away;
 if(contract.event==='corner'){
  if(contract.half!==0)return null;
  home=int(result.corners_home);away=int(result.corners_away);
 }else if(contract.event==='goal'){
  const fh=int(result.home_score),fa=int(result.away_score);
  if(fh===null||fa===null)return null;
  const hh=int(result.half_home_score),ha=int(result.half_away_score);
  if(contract.half){
   if(hh===null||ha===null||hh>fh||ha>fa)return null;
   home=contract.half===1?hh:fh-hh;
   away=contract.half===1?ha:fa-ha;
  }else{home=fh;away=fa;}
 }else return null;
 if(home===null||away===null)return null;
 if(contract.rest){
  const bh=int(contract.baseline?.home),ba=int(contract.baseline?.away);
  if(bh===null||ba===null||bh>home||ba>away)return null;
  home-=bh;away-=ba;
 }
 const h=Number(contract.handicap);
 if(!Number.isFinite(h)||!Number.isSafeInteger(h*2)||Math.abs(h)>30||
    !['home','away','none'].includes(contract.side))return null;
 const delta=contract.side==='away'?away+h-home:home+h-away;
 if(contract.threeWay){
  const signed=contract.side==='none'?home+h-away:delta;
  return contract.side==='none'?
    signed===0?'WON':'LOST':
    delta>0?'WON':'LOST';
 }
 if(contract.side==='none')return null;
 if(delta===0)return 'VOID';
 return delta>0?'WON':'LOST';
}

/** A half-specific corner handicap can only be calculated from chronologically
 * complete official incidents. Injury-time minute 45 without explicit phase
 * is ambiguous and cannot be placed into 1H or 2H by guessing.
 */
export function gradeHalfCornerHandicapFacts(contract,facts,{complete=false}={}){
 if(!complete||contract?.kind!=='score-handicap'||contract.event!=='corner'||
    ![1,2].includes(contract.half)||!Array.isArray(facts)||contract.rest)return null;
 const first=new Set(['1','h1','1h','1sthalf','firsthalf','half1','firstperiod','1stperiod','period1']);
 const second=new Set(['2','h2','2h','2ndhalf','secondhalf','half2','secondperiod','2ndperiod','period2']);
 const counts={home:0,away:0};
 for(const fact of facts){
  const minute=Number(fact?.minute),seconds=fact?.seconds==null?null:Number(fact.seconds);
  if(!Number.isSafeInteger(minute)||minute<0||minute>130||
     seconds!==null&&(!Number.isFinite(seconds)||seconds<0)||
     !['home','away'].includes(fact?.team))return null;
  const phase=String(fact.phase??'').toLowerCase().replace(/[^a-z0-9]/g,'');
  let half;
  if(first.has(phase)){if(minute>75)return null;half=1;}
  else if(second.has(phase)){if(minute<45)return null;half=2;}
  else if(phase)return null;
  else if(minute<45)half=1;
  else return null;
  if(half===contract.half)counts[fact.team]++;
 }
 return gradeHandicapContract({...contract,half:0},
  {corners_home:counts.home,corners_away:counts.away});
}
