/** Final-source comparison and manual holds, independent of provider presentation. */
export const SETTLEMENT_REVIEW_SQL=`
create table if not exists app_stat_review(match_id bigint primary key,payload jsonb not null,updated_at timestamptz not null default now());
create table if not exists app_settlement_override(line_id uuid primary key references app_ticket_line(id) on delete restrict,status text not null check(status in ('PENDING','WON','LOST','VOID')),actor_id uuid references app_user(id),reason text not null,source text not null,updated_at timestamptz not null default now());
alter table app_settlement_override drop constraint if exists app_settlement_override_status_check;
alter table app_settlement_override add constraint app_settlement_override_status_check check(status in ('PENDING','WON','LOST','VOID'));
`;
export const REVIEW_FIELDS=['corners','shots','shotsOnTarget','fouls','yellow','red','cards'];
const valid=v=>v!==null&&v!==undefined&&v!==''&&Number.isInteger(Number(v))&&Number(v)>=0;
export function compareFinalStatistics(observations,{attempted=[],unavailable={}}={}){
 const sources=observations.filter(item=>item.final===true),conflicts={},consensus={};
 for(const field of REVIEW_FIELDS){
  const evidence={};
  for(const source of sources){const p=source.values?.[field];if(p&&valid(p.home)&&valid(p.away))evidence[source.provider]={home:Number(p.home),away:Number(p.away)};}
  const variants=new Set(Object.values(evidence).map(pair=>JSON.stringify(pair)));
  if(variants.size>1)conflicts[field]=evidence;
  else if(variants.size===1)consensus[field]=Object.values(evidence)[0];
 }
 return {final:true,complete:true,attempted,unavailable,sources,consensus,conflicts,
  status:Object.keys(conflicts).length?'MANUAL_REVIEW':'VERIFIED',checkedAt:new Date().toISOString()};
}
export function settlementStatisticFields(line){
 if(Array.isArray(line.builder_legs))return [...new Set(line.builder_legs.flatMap(settlementStatisticFields))];
 const text=String(line.market_name??line.name??'').toLowerCase();
 if(/corner|korner/.test(text))return ['corners'];
 if(/yellow/.test(text))return ['yellow'];if(/red/.test(text))return ['red'];
 if(/card|booking|karton/.test(text))return ['yellow','red','cards'];
 if(/shot.*(?:target|goal)|goditj.*port/.test(text))return ['shotsOnTarget'];
 if(/shot|goditj/.test(text))return ['shots'];if(/foul|faull/.test(text))return ['fouls'];
 return [];
}
export function statisticsNeedReview(line,result){
 const fields=settlementStatisticFields(line);if(!fields.length)return false;
 const review=result?.statistics_review;
 if(result?.statistics_review_pending&&!review)return true;
 return Boolean(review&&(!review.complete||fields.some(field=>review.conflicts?.[field])));
}
