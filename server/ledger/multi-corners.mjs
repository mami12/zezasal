/**
 * Multi Corners: (corners taken in 1H) x (corners taken in 2H).
 * Team Multi Corners uses that team's incidents in each half.
 * Only a COMPLETE confirmed chronology can establish both factors.
 */
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const decimal=v=>v==null||v===''?null:/^\d+(?:[.,]\d{1,2})?$/.test(String(v).trim())?
 Number(String(v).trim().replace(',','.')):null;
export function parseMultiCornerContract(line){
 if(Number(line?.period??0)!==0)return null;
 let name=norm(line?.market_name??line?.marketName??line?.name);
 if(/\b(?:half|quarter|player|booking|card|handicap|asian|spread|corner race|first|last)\b/.test(name))return null;
 name=name.replace(/^(?:full time|match)\s+/,'');
 let side=null;
 const pre=name.match(/^(?:home(?: team)?|away(?: team)?|team [12])\s+/);
 const post=name.match(/\s+(?:home(?: team)?|away(?: team)?|team [12])$/);
 if(pre){side=/^(?:home|team 1)/.test(pre[0])?'home':'away';name=name.slice(pre[0].length);}
 if(post){const suffix=post[0].trim();const s=/^(?:home|team 1)/.test(suffix)?'home':'away';
  if(side&&s!==side)return null;side=s;name=name.slice(0,-post[0].length);}
 name=name.replace(/^team\s+(?=multi corners?$)/,'');
 if(!/^(?:multi corners?|multicorners?)$/.test(name))return null;
 const selection=norm(line.outcome_name??line.outcomeName??line.outcome_key??line.outcomeKey);
 const raw=decimal(line.line??line.specifier);
 const over=selection.match(/^(over|under)(?: (\d+(?:\s+\d+)?))?$/);
 if(over){
  const embedded=decimal(over[2]?.replace(' ','.'));
  const vals=[raw,embedded].filter(x=>x!==null);
  if(!vals.length||vals.some(v=>v!==vals[0])||vals[0]<0||vals[0]>10000||
     !Number.isSafeInteger(vals[0]*2))return null;
  return {version:1,kind:'multi-corners',event:'corner',side,choice:over[1],threshold:vals[0]};
 }
 const exact=selection.match(/^(?:exactly? )?(\d{1,4})$/);
 if(exact)return {version:1,kind:'multi-corners',event:'corner',side,choice:'exact',target:Number(exact[1])};
 const band=selection.match(/^(\d{1,4}) (?:to|or) (\d{1,4})$/);
 if(band&&Number(band[2])>=Number(band[1]))
  return {version:1,kind:'multi-corners',event:'corner',side,choice:'range',min:Number(band[1]),max:Number(band[2])};
 return null;
}
const first=new Set(['1','h1','1h','1sthalf','firsthalf','half1','firstperiod','1stperiod','period1']);
const second=new Set(['2','h2','2h','2ndhalf','secondhalf','half2','secondperiod','2ndperiod','period2']);
export function gradeMultiCornerFacts(contract,facts,{complete=false}={}){
 if(!complete||contract?.kind!=='multi-corners'||contract.event!=='corner'||
    contract.side!=null&&!['home','away'].includes(contract.side)||
    !Array.isArray(facts))return null;
 const count={1:{home:0,away:0},2:{home:0,away:0}};
 for(const e of facts){
  const minute=Number(e?.minute),sec=e?.seconds==null?null:Number(e.seconds);
  if(!Number.isSafeInteger(minute)||minute<0||minute>130||
     sec!==null&&(!Number.isFinite(sec)||sec<0)||
     !['home','away'].includes(e.team))return null;
  const raw=String(e.phase??'').toLowerCase().replace(/[^a-z0-9]/g,'');
  let period;
  if(first.has(raw)){if(minute>75)return null;period=1;}
  else if(second.has(raw)){if(minute<45)return null;period=2;}
  else if(raw)return null;
  else if(minute<45)period=1;
  else return null;
  count[period][e.team]++;
 }
 const v=n=>contract.side?count[n][contract.side]:count[n].home+count[n].away;
 const total=v(1)*v(2);
 const decide=matched=>matched?'WON':'LOST';
 if(contract.choice==='over'||contract.choice==='under'){
  const t=contract.threshold;
  if(!Number.isFinite(t)||t<0||!Number.isSafeInteger(t*2))return null;
  if(total===t&&Number.isSafeInteger(t))return 'VOID';
  return decide(contract.choice==='over'?total>t:total<t);
 }
 if(contract.choice==='exact')
  return Number.isSafeInteger(contract.target)&&contract.target>=0?decide(total===contract.target):null;
 if(contract.choice==='range')
  return Number.isSafeInteger(contract.min)&&Number.isSafeInteger(contract.max)&&
   contract.min>=0&&contract.max>=contract.min?decide(total>=contract.min&&total<=contract.max):null;
 return null;
}
