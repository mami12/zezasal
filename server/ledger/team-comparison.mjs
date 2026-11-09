/**
 * Native full-time "Most corners/cards" markets.
 * Only confirmed FINAL per-team totals may grade them. Whether X was in the
 * quote is part of the accepted contract, because a two-way tie can VOID while
 * a genuine 1-X-2 selection has exactly one winner (X).
 */
const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/\s+/g,' ').trim();
export const isTeamComparisonMarket=value=>{
 const name=norm(typeof value==='string'?value:
  value?.market_name??value?.marketName??value?.name);
 return name==='most corners'||name==='most cards';
};
const choose=value=>{
 const s=norm(value);
 return ['1','home','home team','team 1'].includes(s)?'home':
  ['2','away','away team','team 2'].includes(s)?'away':
  ['x','draw','tie','barazim','none','neither'].includes(s)?'none':null;
};
export function parseTeamComparison(line,{drawOffered=null}={}){
 if(!isTeamComparisonMarket(line)||Number(line?.period??0)!==0)return null;
 const name=norm(line.market_name??line.marketName??line.name);
 const stat=name==='most corners'?'corner':'card';
 const side=choose(line.outcome_name??line.outcomeName)??
  choose(line.outcome_key??line.outcomeKey);
 if(!side)return null;
 if(drawOffered!==null&&typeof drawOffered!=='boolean')return null;
 if(side==='none'&&drawOffered===false)return null;
 return {version:1,kind:'team-comparison',event:stat,side,
  drawOffered:side==='none'?true:drawOffered};
}
const count=v=>v!=null&&v!==''&&Number.isSafeInteger(Number(v))&&
 Number(v)>=0?Number(v):null;
export function gradeTeamComparison(c,result){
 if(c?.kind!=='team-comparison'||!['corner','card'].includes(c.event)||
    !['home','away','none'].includes(c.side)||!result)return null;
 const h=count(c.event==='corner'?result.corners_home:result.cards_home);
 const a=count(c.event==='corner'?result.corners_away:result.cards_away);
 if(h===null||a===null)return null;
 const winner=h>a?'home':a>h?'away':'none';
 if(winner==='none'&&c.drawOffered!==true){
  if(c.drawOffered===false)return c.side==='none'?null:'VOID';
  return null; // Legacy quote: unknown whether draw was a priced selection.
 }
 return c.side===winner?'WON':'LOST';
}
