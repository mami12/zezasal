/**
 * Confirmed corner chronology gives every half its own home/away counters.
 * This supports "half with most corners", "most corners in each half",
 * and 1X2 corner results restricted to a specified half.
 */
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const side=v=>{
 const n=norm(v);
 return ['1','home','home team','team 1'].includes(n)?'home':
  ['2','away','away team','team 2'].includes(n)?'away':
  ['x','draw','tie','neither','none'].includes(n)?'none':null;
};
const periodOption=v=>{
 const n=norm(v);
 return ['1','first','1st','1st half','first half','half 1'].includes(n)?1:
  ['2','second','2nd','2nd half','second half','half 2'].includes(n)?2:
  ['x','draw','tie','equal','same','neither','none'].includes(n)?0:null;
};
export function parseCornerComparison(line){
 let title=norm(line?.market_name??line?.marketName??line?.name);
 const explicit=Number(line?.period??0);
 if(![0,1,2].includes(explicit))return null;
 let scope=null;
 const a=title.match(/^(home(?: team)?|away(?: team)?|team [12])\s+/);
 if(a){
  scope=/^(?:home|team 1)/.test(a[1])?'home':'away';
  title=title.slice(a[0].length);
 }
 const raw=line.outcome_name??line.outcomeName??line.outcome_key??line.outcomeKey;
 // "Corners Halftime/Fulltime" is the corner count comparison at 1H AND FT,
 // not the 1H/FT football SCORE. Both parts are selected in one quoted code.
 if(title==='corners halftime fulltime'){
  if(explicit!==0||scope)return null;
  for(const value of [line.outcome_name,line.outcomeName,line.outcome_key,line.outcomeKey]){
   const rawValue=String(value??'').trim();
   const pair=rawValue.match(/^([12x])\s*(?:\/|->|→|\||:)\s*([12x])$/i)??
    rawValue.match(/^([12x])([12x])$/i);
   if(!pair)continue;
   const code=v=>v==='1'?'home':v==='2'?'away':'none';
   return {version:1,kind:'corner-comparison',event:'corner',
    mode:'ht-ft',halfSide:code(pair[1].toLowerCase()),
    fullSide:code(pair[2].toLowerCase())};
  }
  return null;
 }
 if(/^(?:half with (?:the )?most corners?|half most corners?|most corners? (?:in|by) (?:the )?half)$/.test(title)){
  if(explicit!==0)return null;
  const choice=periodOption(raw);
  return choice===null?null:{version:1,kind:'corner-comparison',
   event:'corner',mode:'most-half',scope,choice};
 }
 if(!scope&&/^(?:most corners? in (?:each|both) half|most corners? (?:in )?both halves)$/.test(title)){
  if(explicit!==0)return null;
  const team=side(raw);
  return team?{version:1,kind:'corner-comparison',event:'corner',
   mode:'wins-both',side:team}:null;
 }
 if(scope)return null;
 const period=title.match(/^(1st|first|2nd|second) half\s+(?:corners? (?:result|1x2)|most corners?|corners? 1x2)$/);
 if(!period)return null;
 const half=/^(?:1st|first)$/.test(period[1])?1:2;
 if(explicit!==0&&explicit!==half)return null;
 const team=side(raw);
 if(!team)return null;
 return {version:1,kind:'corner-comparison',event:'corner',
  mode:'period-result',half,side:team,
  drawOffered:/1x2|result/.test(title)||line.cornerDrawOffered===true||team==='none'};
}
const first=new Set(['1','h1','1h','1sthalf','firsthalf','half1','firstperiod','1stperiod','period1']);
const second=new Set(['2','h2','2h','2ndhalf','secondhalf','half2','secondperiod','2ndperiod','period2']);
export function gradeCornerComparisonFacts(contract,facts,{complete=false}={}){
 if(!complete||contract?.kind!=='corner-comparison'||contract.event!=='corner'||!Array.isArray(facts))return null;
 const count={1:{home:0,away:0},2:{home:0,away:0}};
 for(const e of facts){
  const min=Number(e?.minute),sec=e?.seconds==null?null:Number(e.seconds);
  if(!Number.isSafeInteger(min)||min<0||min>130||
     sec!==null&&(!Number.isFinite(sec)||sec<0)||
     !['home','away'].includes(e?.team))return null;
  const raw=String(e.phase??'').toLowerCase().replace(/[^a-z0-9]/g,'');
  let phase;
  if(first.has(raw)){if(min>75)return null;phase=1;}
  else if(second.has(raw)){if(min<45)return null;phase=2;}
  else if(raw)return null;
  else if(min<45)phase=1;
  else return null;
  count[phase][e.team]++;
 }
 const result=(h,a)=>h>a?'home':a>h?'away':'none';
 const decision=(isWinner)=>isWinner?'WON':'LOST';
 if(contract.mode==='ht-ft'){
  if(!['home','away','none'].includes(contract.halfSide)||
     !['home','away','none'].includes(contract.fullSide))return null;
  const halfWinner=result(count[1].home,count[1].away);
  const allWinner=result(count[1].home+count[2].home,
   count[1].away+count[2].away);
  return decision(contract.halfSide===halfWinner&&contract.fullSide===allWinner);
 }
 if(contract.mode==='most-half'){
  if(![0,1,2].includes(contract.choice)||contract.scope!=null&&
     !['home','away'].includes(contract.scope))return null;
  const n=half=>contract.scope?count[half][contract.scope]:
   count[half].home+count[half].away;
  const firstCount=n(1),secondCount=n(2);
  const chosen=firstCount>secondCount?1:secondCount>firstCount?2:0;
  return decision(chosen===contract.choice);
 }
 if(contract.mode==='period-result'){
  if(![1,2].includes(contract.half)||!['home','away','none'].includes(contract.side))return null;
  const winner=result(count[contract.half].home,count[contract.half].away);
  return winner==='none'&&contract.drawOffered!==true?'VOID':decision(winner===contract.side);
 }
 if(contract.mode==='wins-both'){
  if(!['home','away','none'].includes(contract.side))return null;
  const home=count[1].home>count[1].away&&count[2].home>count[2].away;
  const away=count[1].away>count[1].home&&count[2].away>count[2].home;
  const winner=home?'home':away?'away':'none';
  return decision(winner===contract.side);
 }
 return null;
}
