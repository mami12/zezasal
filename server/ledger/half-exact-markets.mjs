/** Exact/range corner & card totals in a specified half.
 * Requires a COMPLETE same-provider incident list reconciled to FT counts.
 * Booking points are deliberately excluded: they use a different point scale.
 */
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/\s+/g,' ').trim();
const phase1=new Set(['1','h1','1h','1sthalf','firsthalf','half1','firstperiod','1stperiod','period1']);
const phase2=new Set(['2','h2','2h','2ndhalf','secondhalf','half2','secondperiod','2ndperiod','period2']);
const sideText=v=>/^(?:home(?: team)?|team 1)$/.test(v)?'home':
  /^(?:away(?: team)?|team 2)$/.test(v)?'away':null;
const leadSide=/^(home(?: team)?|away(?: team)?|team [12])\s+/;
const tailSide=/\s+(home(?: team)?|away(?: team)?|team [12])$/;
export function parseHalfExactMarket(line){
 const title=norm(line?.market_name??line?.marketName??line?.name).replace(/[()]/g,' ');
 const match=title.match(/^(1st|first|2nd|second) half\s*[-–:.]?\s*(.+)$/);
 if(!match)return null;
 const half=/^(?:1st|first)$/.test(match[1])?1:2;
 const period=Number(line?.period??0);
 if(!Number.isInteger(period)||![0,1,2].includes(period)||
    period!==0&&period!==half)return null;
 let name=match[2].trim(),side=null;
 const left=name.match(leadSide),right=name.match(tailSide);
 if(left&&right)return null;
 if(left){side=sideText(left[1]);name=name.slice(left[0].length);}
 else if(right){side=sideText(right[1]);name=name.slice(0,-right[0].length);}
 name=name.trim().replace(/\s+/g,' ');
 // Exact cards are event counts; yellow/red points and bookmaker-defined
 // "bookings" cannot be inferred from a generic card event timeline.
 const isRed=/^(?:red card|red cards)$/.test(name);
 const corner=/^(?:exact corners?|corners? exact|corners? range|corner range|total corners? exactly)$/.test(name);
 const card=/^(?:exact cards?|cards? exact|total cards? exactly)$/.test(name);
 if(!isRed&&!corner&&!card)return null;
 const event=corner?'corner':'card';
 const outcome=norm(line?.outcome_name??line?.outcomeName??line?.outcome_key??line?.outcomeKey);
 let choice=null,target=null,min=null,max=null;
 if(isRed&&['yes','po','no','jo'].includes(outcome)){
   choice=['yes','po'].includes(outcome)?'atLeast':'exact';
   target=choice==='atLeast'?1:0;
 }else {
   const exact=outcome.match(/^(?:exact(?:ly)?\s+)?(\d{1,3})$/);
   const plus=outcome.match(/^(\d{1,3})\s*(?:\+|or more)$/);
   const range=outcome.match(/^(\d{1,3})\s*(?:to|[-–]|or)\s*(\d{1,3})$/);
   if(exact){choice='exact';target=Number(exact[1]);}
   else if(plus){choice='atLeast';target=Number(plus[1]);}
   else if(range){
     choice='range';min=Number(range[1]);max=Number(range[2]);
   }else return null;
 }
 if(target!==null&&(target<0||target>150)||min!==null&&
   (min<0||max>150||max<min))return null;
 const quote=line?.line??line?.specifier;
 if(quote!=null&&String(quote).trim()!==''&&target!==null){
  const n=Number(String(quote).replace(',','.'));
  if(!Number.isSafeInteger(n)||n!==target)return null;
 }
 return {version:1,kind:'half-exact-count',event,half,
   ...(side?{side}:{}),...(isRed?{cardColor:'red'}:{}),
   choice,...(target!==null?{target}:{}),
   ...(min!==null?{min,max}:{})};
}
export function gradeHalfExactFacts(contract,facts,{complete=false,cardColorsVerified=false}={}){
 if(!complete||contract?.kind!=='half-exact-count'||
    ![1,2].includes(contract.half)||!['corner','card'].includes(contract.event)||
    contract.side!=null&&!['home','away'].includes(contract.side)||
    !Array.isArray(facts)||contract.cardColor&&cardColorsVerified!==true)return null;
 let count=0;
 for(const fact of facts){
  const minute=Number(fact?.minute);
  const seconds=fact?.seconds==null?null:Number(fact.seconds);
  if(!Number.isSafeInteger(minute)||minute<0||minute>130||
     seconds!==null&&(!Number.isFinite(seconds)||seconds<0)||
     !['home','away'].includes(fact?.team))return null;
  const raw=String(fact?.phase??'').toLowerCase().replace(/[^a-z0-9]/g,'');
  let half;
  if(phase1.has(raw)){if(minute>75)return null;half=1;}
  else if(phase2.has(raw)){if(minute<45)return null;half=2;}
  else if(raw)return null;
  else if(minute<45)half=1;
  else return null; // 45+ without phase is not an automatic 2H incident
  if(half!==contract.half||contract.side&&fact.team!==contract.side)continue;
  if(contract.cardColor){
    if(fact.card_color==null||!['yellow','red'].includes(fact.card_color))return null;
    if(fact.card_color===contract.cardColor)count++;
  }else count++;
 }
 const {choice,target,min,max}=contract;
 if(choice==='exact'&&Number.isSafeInteger(target)&&target>=0&&target<=150)
  return count===target?'WON':'LOST';
 if(choice==='atLeast'&&Number.isSafeInteger(target)&&target>=0&&target<=150)
  return count>=target?'WON':'LOST';
 if(choice==='range'&&Number.isSafeInteger(min)&&Number.isSafeInteger(max)&&
    min>=0&&max<=150&&max>=min)return count>=min&&count<=max?'WON':'LOST';
 return null;
}
