/** Strict Half-Time / Full-Time double result.
 * Both parts are required; an unrecognized provider quote cannot lose.
 */
export const isHtFtMarket=value=>
 /half\s*time\s*[\/-]?\s*full\s*time|\bht\s*[\/-]?\s*ft\b/i.test(String(value??''));
const canonical=value=>{
 const text=String(value??'').normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 if(['1','home','home team','vendas'].includes(text))return '1';
 if(['2','away','away team','udhetues'].includes(text))return '2';
 if(['x','draw','tie','barazim'].includes(text))return 'X';
 return null;
};
export function parseHtFtOutcome(...values){
 for(const value of values){
  const text=String(value??'').trim();
  if(!text)continue;
  const compact=text.toUpperCase().match(/^([12X])([12X])$/);
  if(compact)return {half:compact[1],full:compact[2]};
  const parts=text.split(/\s*(?:\/|\\|\||:|->|→|-)\s*/);
  if(parts.length!==2)continue;
  const half=canonical(parts[0]),full=canonical(parts[1]);
  if(half&&full)return {half,full};
 }
 return null;
}
export function gradeHtFt(selection,htHome,htAway,ftHome,ftAway){
 const values=[htHome,htAway,ftHome,ftAway];
 if(!selection||values.some(v=>!Number.isSafeInteger(v)||v<0))return null;
 const result=(h,a)=>h>a?'1':a>h?'2':'X';
 return selection.half===result(htHome,htAway)&&selection.full===result(ftHome,ftAway)?'WON':'LOST';
}
