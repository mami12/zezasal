import {query} from '../db.mjs';
import {eventMarketRequirement} from './event-market-policy.mjs';
import {settlementStatisticFields} from './settlement-review.mjs';

const NOTICE_LIFETIME_MS=48*60*60*1000;
const text=value=>String(value??'').trim();
const nowDate=value=>{const n=new Date(value).getTime();return Number.isFinite(n)?n:0;};
/** Why this specific selection should be reviewed, never an automatic decision. */
export function reviewReason(row,now=Date.now()){
 if(row.line_status==='VOID')return 'VOID_NEEDS_CONFIRMATION';
 if(row.line_status!=='PENDING'||row.ticket_status!=='PENDING')return null;
 const market=text(row.market_name);
 const review=row.statistics_review;
 if(row.result_id!=null){
  const fields=settlementStatisticFields(row);
  if(fields.some(field=>review?.conflicts?.[field]))return 'CONFLICTING_API_STATISTICS';
  if(eventMarketRequirement(row)||/\b(?:interval|minute|next goal|next corner|race to|early payout)\b/i.test(market))return 'MISSING_EVENT_TIMELINE';
  if(fields.length||/\b(?:half|period)\b/i.test(market))return 'MISSING_MARKET_STATISTICS';
  // Every unresolved final-market selection deserves an admin decision.
  return 'UNRESOLVED_FINAL_SELECTION';
 }
 // A live/prematch market cannot be called invalid merely because it has no FT.
 const status=text(row.feed_status??row.match_status).toLowerCase();
 if(/^(?:live|1h|2h|first half|second half|prematch|scheduled)$/.test(status))return null;
 if(now-nowDate(row.placed_at)<6*60*60*1000)return null;
 return 'MISSING_FINAL_RESULT';
}
export async function manualReviewQueue({runQuery=query,limit=150,now=Date.now()}={}){
 const cap=Math.min(300,Math.max(1,Math.trunc(Number(limit)||150)));
 const rows=(await runQuery(`select l.id as line_id,l.ticket_id,l.match_id,l.market_key,l.line,l.outcome_key,
    l.outcome_name,l.market_name,l.match_name,l.status as line_status,l.odds_at_placement,
    t.status as ticket_status,t.placed_at,t.stake,t.original_potential_payout,
    u.username,r.match_id as result_id,r.home_score,r.away_score,
    sr.payload as statistics_review,m.status as match_status,m.feed_status,
    o.status as override_status,n.first_seen_at
    from app_ticket_line l
    join app_ticket t on t.id=l.ticket_id
    left join app_user u on u.id=t.user_id
    left join app_match_result r on r.match_id=l.match_id
    left join app_stat_review sr on sr.match_id=l.match_id
    left join matches m on m.match_id=l.match_id
    left join app_settlement_override o on o.line_id=l.id
    left join app_manual_review_notice n on n.line_id=l.id
    where l.status in ('PENDING','VOID')
      and t.status not in ('CANCELLED','REVERTED','CASHED_OUT')
      and (o.line_id is null or o.status='PENDING')
      and (l.status='VOID' or r.match_id is not null or t.placed_at<now()-interval '6 hours')
    order by case when l.status='VOID' then 0 else 1 end,t.placed_at desc
    limit $1`,[cap*3])).rows;
 const items=[];
 for(const row of rows){
  const reason=reviewReason(row,now);if(!reason)continue;
  let firstSeenAt=row.first_seen_at;
  if(!firstSeenAt){
   const notice=await runQuery(`insert into app_manual_review_notice(line_id,first_seen_at)
    values($1,$2) on conflict(line_id) do update set first_seen_at=app_manual_review_notice.first_seen_at
    returning first_seen_at`,[row.line_id,new Date(now)]);
   firstSeenAt=notice.rows[0].first_seen_at;
  }
  const noticeExpiresAt=new Date(nowDate(firstSeenAt)+NOTICE_LIFETIME_MS);
  items.push({noticeExpiresAt:noticeExpiresAt.toISOString(),notificationActive:now<noticeExpiresAt.getTime(),lineId:row.line_id,ticketId:row.ticket_id,matchId:String(row.match_id),
   marketKey:row.market_key,marketLine:row.line??'',marketName:row.market_name,
   matchName:row.match_name,outcomeKey:row.outcome_key,outcomeName:row.outcome_name,
   lineStatus:row.line_status,ticketStatus:row.ticket_status,username:row.username??null,
   placedAt:row.placed_at,stake:row.stake,odds:row.odds_at_placement,
   potentialPayout:row.original_potential_payout,
   finalScore:row.result_id!=null?row.home_score+' - '+row.away_score:null,
   reason,conflicts:row.statistics_review?.conflicts??null});
  if(items.length>=cap)break;
 }
 return {items,count:items.length,notificationCount:items.filter(item=>item.notificationActive).length,hasMore:rows.length>items.length};
}
