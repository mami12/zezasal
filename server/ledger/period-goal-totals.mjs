/**
 * Full-time, first-half and second-half goal totals (match and named team).
 * Team identities must be explicit, HT/FT must be internally consistent.
 * Two-way integer lines push; a quoted 3-way exact selection is distinct.
 */
const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[_:—–-]/g,' ').replace(/\s+/g,' ').trim();
const real=value=>value==null||value===''?null:
 /^[0-9]+(?:[.,][0-9]+)?$/.test(String(value).trim())?
  Number(String(value).replace(',','.')):null;
const score=value=>value!==null&&value!==undefined&&value!==''&&
 Number.isSafeInteger(Number(value))&&Number(value)>=0&&Number(value)<200?Number(value):null;
const aliases=(name,known)=>[
 ['home',['home','home team','team 1',known.home,known.home_team]],
 ['away',['away','away team','team 2',known.away,known.away_team]]
].flatMap(([side,values])=>values.filter(Boolean).map(v=>[side,norm(v)]));
export function isPeriodGoalTotal(line){
 const name=norm(line?.market_name??line?.marketName??line?.name);
 if(/(?:\bgoals?\b|\bgoal line\b|\btotal\b)/.test(name)&&
    /\b(?:player|scorer|asian|handicap|minutes?|corner|card|shots?|foul|result|btts|both|race|next|first goal|last goal|odd|even)\b/.test(name))return false;
 return /(?:^|\b)(?:total goals?|goals? total|team [12] goals?|goals?|goal line|over\s*\/\s*under)/.test(name)||\n  /^(?:(?:1st|first|2nd|second) half|full time|match) total$/.test(name)||name==='total';
}
export function parsePeriodGoalTotal(line,teams={}){
 if(!isPeriodGoalTotal(line))return null;
 let name=norm(line.market_name??line.marketName??line.name).replace(/[()]/g,' ');
 const numTitle=name.match(/\s+(\d+(?:[.,]\d+)?)$/);
 const embedded=numTitle?real(numTitle[1]):null;
 if(numTitle)name=name.slice(0,-numTitle[0].length).trim();
 let half=0;
 const pre=name.match(/^(?:1st|first|2nd|second)\s+half\b/);
 const post=name.match(/\b(?:1st|first|2nd|second)\s+half$/);
 if(pre&&post)return null;
 if(pre){
  half=/^(?:1st|first)/.test(pre[0])?1:2;
  name=name.slice(pre[0].length).trim();
 }else if(post){
  half=/^(?:1st|first)/.test(post[0])?1:2;
  name=name.slice(0,-post[0].length).trim();
 }else name=name.replace(/^(?:full time|match)\b/,'').trim();
 const explicit=Number(line.period??0);
 if(![0,1,2].includes(explicit)||half&&explicit&&explicit!==half)return null;
 if(half===0)half=explicit;
 let side=null;
 const sorted=aliases(name,teams).sort((a,b)=>b[1].length-a[1].length);
 for(const [candidate,label]of sorted){
  if(!label)continue;
  if(name.startsWith(label+' ')){
   side=candidate;name=name.slice(label.length).trim();break;
  }
  if(name.endsWith(' '+label)){
   side=candidate;name=name.slice(0,-label.length).trim();break;
  }
 }
 name=name.replace(/^total\s+/,'').replace(/\s+total$/,'').trim();
 // Catalogue: "1st half - exact goals", "Exact goals 5+",
 // "2nd half - exact goals 2+". The outcome still supplies the
 // chosen number/range; a title saying 2+ is a lower bound, not
 // permission to invent a hidden player, period or total.
 const exactGroup=name.match(/^exact goals?(?:\s+(\d{1,2})\+)?$/);
 const titleMinimum=exactGroup?.[1]==null?null:Number(exactGroup[1]);
 if(exactGroup)name='goals';
 if(!/^(?:goals?|goal line|total|over\s*\/\s*under)$/.test(name))return null;
 const title=norm(line.market_name??line.marketName??'');
 const threeWay=/\b(?:3\s*way|three\s*way|1x2)\b/.test(title);
 let label=norm(line.outcome_name??line.outcomeName??line.outcome_key??line.outcomeKey);
 let kind=null,target=null;
 const over=label.match(/^(?:over|mbi)\s*(\d+(?:[.,]\d+)?)?$/);
 const under=label.match(/^(?:under|nen)\s*(\d+(?:[.,]\d+)?)?$/);
 const exact=label.match(/^(?:exact(?:ly)?\s*)?(\d{1,2})$/);
 const more=label.match(/^(\d{1,2})\s*(?:\+|or more)$/);
 const range=label.match(/^(\d{1,2})\s*(?:to|or)\s*(\d{1,2})$/);
 const stated=real(over?.[1]??under?.[1]);
 const quoted=real(line.line??line.specifier);
 const nums=[embedded,stated,quoted].filter(x=>x!==null);
 if(over||under){
  if(!nums.length||nums.some(n=>n!==nums[0]))return null;
  kind=over?'over':'under';target=nums[0];
 }else if(exact){kind='exact';target=Number(exact[1]);}
 else if(more){kind='atLeast';target=Number(more[1]);}
 else if(range){kind='range';target=[Number(range[1]),Number(range[2])];}
 else return null;
 if(titleMinimum!==null&&
    (kind==='range'?target[0]<titleMinimum:
     (typeof target==='number'&&target<titleMinimum)))return null;
 if(kind==='range'){
  if(target[1]<target[0]||target[1]>100)return null;
 }else if(!Number.isFinite(target)||target<0||target>100||
     !Number.isSafeInteger(target*2))return null;
 return {version:1,kind:'period-goal-total',event:'goal',half,side,threeWay,
  selection:kind,...(kind==='range'?{min:target[0],max:target[1]}:{target})};
}
export function gradePeriodGoalTotal(c,result){
 if(c?.kind!=='period-goal-total'||!result||
    ![0,1,2].includes(c.half)||c.side!=null&&!['home','away'].includes(c.side))return null;
 const [fh,fa,hh,ha]=[result.home_score,result.away_score,
  result.half_home_score,result.half_away_score].map(score);
 if(fh===null||fa===null||c.half&&
    (hh===null||ha===null||hh>fh||ha>fa))return null;
 const home=c.half===1?hh:c.half===2?fh-hh:fh;
 const away=c.half===1?ha:c.half===2?fa-ha:fa;
 const goals=c.side==='home'?home:c.side==='away'?away:home+away;
 if(c.selection==='range')return Number.isSafeInteger(c.min)&&Number.isSafeInteger(c.max)&&
   c.min>=0&&c.max>=c.min?(goals>=c.min&&goals<=c.max?'WON':'LOST'):null;
 if(c.selection==='atLeast')return Number.isSafeInteger(c.target)?
   (goals>=c.target?'WON':'LOST'):null;
 if(c.selection==='exact')return Number.isSafeInteger(c.target)?
   (goals===c.target?'WON':'LOST'):null;
 const target=Number(c.target);
 if(!['over','under'].includes(c.selection)||!Number.isFinite(target)||
    !Number.isSafeInteger(target*2))return null;
 if(goals===target&&Number.isSafeInteger(target))
   return c.threeWay?'LOST':'VOID';
 return (c.selection==='over'?goals>target:goals<target)?'WON':'LOST';
}
