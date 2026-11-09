/**
 * Half-Time / Full-Time is one selection with TWO exact results:
 * first code = HT, second code = FT. Regulation time plus stoppage only.
 * The nine outcomes are 1/1, 1/X, 1/2, X/1, X/X, X/2, 2/1, 2/X, 2/2.
 * See standard soccer sportsbook HT/FT rules.
 */
export const isHtFtMarket=value=>{
 const name=String(value??'').toLowerCase().trim();
 // HT/FT GOALS is an exact, standalone market. A name containing
 // corners, card results, total-goal conjuncts or correct score must
 // never be settled from the halftime/fulltime goal scoreboard.
 return /^(?:half[\s-]*time\s*(?:(?:\/|&|-|and|to)\s*)?full[\s-]*time|ht\s*(?:\/|&|-|and)\s*ft)$/.test(name);
};
const canonical=value=>{
 const text=String(value??'').normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
 if(['1','home','home team','home win','vendas','vendasit','ekipi 1'].includes(text))return '1';
 if(['2','away','away team','away win','udhetues','miqte','ekipi 2'].includes(text))return '2';
 if(['x','draw','tie','barazim','barazimi'].includes(text))return 'X';
 return null;
};
/** Parse the quoted selection, not a substring of an unrelated market.
 * Provider outcome labels take precedence; use native outcome key only
 * as a fallback when it is a recognizable two-result code.
 */
export function parseHtFtOutcome(...values){
 for(const value of values){
  const text=String(value??'').trim();
  if(!text||text.length>100)continue;
  const compact=text.toUpperCase().match(/^([12X])([12X])$/);
  if(compact)return {half:compact[1],full:compact[2]};
  const pair=text.split(/\s*(?:\/|\||->|→|–|—|-|:|&|\+)\s*/);
  if(pair.length===2){
   const half=canonical(pair[0]),full=canonical(pair[1]);
   if(half&&full)return {half,full};
  }
  // Some native feeds separate the compact codes only by whitespace.
  const space=text.trim().split(/\s+/);
  if(space.length===2&&/^[12xX]$/.test(space[0])&&/^[12xX]$/.test(space[1]))
   return {half:canonical(space[0]),full:canonical(space[1])};
 }
 return null;
}
const nonnegative=v=>v!==null&&v!==undefined&&v!==''&&
 Number.isSafeInteger(Number(v))&&Number(v)>=0?Number(v):null;
/** Both true scores must be established; never guess HT from FT. */
export function gradeHtFt(selection,htHome,htAway,ftHome,ftAway){
 if(!selection||!['1','X','2'].includes(selection.half)||!['1','X','2'].includes(selection.full))
  return null;
 const [hh,ha,fh,fa]=[htHome,htAway,ftHome,ftAway].map(nonnegative);
 if([hh,ha,fh,fa].some(v=>v===null)||hh>fh||ha>fa)return null;
 const result=(home,away)=>home>away?'1':away>home?'2':'X';
 return selection.half===result(hh,ha)&&selection.full===result(fh,fa)?'WON':'LOST';
}
