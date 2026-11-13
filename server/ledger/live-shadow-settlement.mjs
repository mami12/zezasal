import {query} from '../db.mjs';
import {gradeLiveContract,gradeFromAcceptedCounters} from './live-contract-rules.mjs';
export const LIVE_PREVIEW_ROWS_SQL=
 'select l.id as line_id,l.ticket_id,l.match_id,l.live_contract,t.placed_at, '+
 'f.payload as provider_frame,f.observed_at as frame_at, '+
 "(select count(*)::int from app_live_event_recovery q where q.match_id=l.match_id "+
 "and q.status='AWAITING_BACKUP_API' and l.id=any(q.line_ids)) as open_recovery_gaps "+
 'from app_ticket_line l join app_ticket t on t.id=l.ticket_id '+
 'left join lateral (select payload,observed_at from app_live_event_frame '+
 'where match_id=l.match_id order by observed_at desc,id desc limit 1) f on true '+
 "where l.status='PENDING' and t.status='PENDING' and l.live_contract is not null "+
 'and not exists(select 1 from app_settlement_override o where o.line_id=l.id) '+
 'order by l.match_id,l.id limit $1';
/** Preview only: no financial writes happen in this function.
 * A separate verified writer may promote ONLY first/next/race counter proofs
 * after a second independent Zizobet observation; all other proposals are
 * diagnostic and still require their own confirmed incident history.
 */
export async function createLiveSettlementPreviews({
 runQuery=query,now=Date.now,limit=400
}={}){
 const cap=Math.max(1,Math.min(1000,Math.trunc(Number(limit)||400)));
 const rows=(await runQuery(LIVE_PREVIEW_ROWS_SQL,[cap])).rows;
 let proposed=0,held=0;
 const clear=async id=>runQuery('delete from app_live_settlement_preview where line_id=$1',[id]);
 for(const row of rows){
  const contract=typeof row.live_contract==='string'?JSON.parse(row.live_contract):row.live_contract;
  const frame=typeof row.provider_frame==='string'?JSON.parse(row.provider_frame):row.provider_frame;
  // Only the primary Zizobet frame can originate a real-money preview.
  if(!frame||frame.source!=='zizobet'){await clear(row.line_id);held++;continue;}
  const frameAt=new Date(row.frame_at).getTime();
  const placedAt=row.placed_at==null?NaN:new Date(row.placed_at).getTime();
  if(!Number.isFinite(placedAt)||!Number.isFinite(frameAt)||frameAt<placedAt||frameAt>now()+5000||
     (!frame.ended&&now()-frameAt>120000)||
     Number(row.open_recovery_gaps)>0){await clear(row.line_id);held++;continue;}
  const delta=gradeFromAcceptedCounters(contract,frame);
  // Timed LIVE quotes carry a frozen purchase baseline. A pre-purchase
  // incident in the provider timeline must never supply a new-bet verdict.
  const timed=['window','window-total','nth-time'].includes(contract?.kind)&&contract.entryBaseline!=null;
  const timeline=timed?null:gradeLiveContract(contract,frame,{ended:frame.ended===true});
  const status=timeline&&delta&&timeline!==delta?null:timeline??delta;
  if(!['WON','LOST','VOID'].includes(status)){await clear(row.line_id);held++;continue;}
  const evidence={contract,frame:{source:frame.source,clock:frame.clock,counts:frame.counts,
    teams:frame.teams,coverage:frame.coverage,ended:frame.ended,events:frame.events},frameAt:row.frame_at,
    recoveriesOpen:0,decision:'PREVIEW_REQUIRES_SECOND_PRIMARY_POLL'};
  await runQuery(
   'insert into app_live_settlement_preview(line_id,match_id,proposed_status,payload,updated_at) '+
   'values($1,$2,$3,$4::jsonb,now()) '+
   'on conflict(line_id) do update set proposed_status=excluded.proposed_status, '+
   'payload=excluded.payload,updated_at=excluded.updated_at '+
   // Keep the original evidence and proposal timestamp while the verdict
   // stays unchanged. The independent second poll must not reset its own
   // five-second confirmation clock on every provider update. A genuine
   // score/corner/card/foul increment starts a new confirmation pair, so a
   // more recent stable snapshot can still be financially decided.
   "where app_live_settlement_preview.proposed_status is distinct from excluded.proposed_status "+
   "or app_live_settlement_preview.payload->'contract' is distinct from excluded.payload->'contract' "+
   "or app_live_settlement_preview.payload->'frame'->'teams' is distinct from excluded.payload->'frame'->'teams'",
   [row.line_id,row.match_id,status,JSON.stringify(evidence)]);
  proposed++;
 }
 return {examined:rows.length,proposed,held,mode:'SHADOW_ONLY'};
}
/** Recheck a stored proposal against the exact retained timeline, without a wallet write. */
export function checkStoredLivePreview(row) {
 const payload=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;
 const contract=payload?.contract,frame=payload?.frame;
 const timeline=contract&&frame?gradeLiveContract(contract,frame,{ended:frame.ended===true}):null;
 return {...row,timelineCheck:timeline===row.proposed_status?'AGREES':timeline?'DIFFERS':'INSUFFICIENT'};
}

export const LIVE_SHADOW_ADMIN_SQL=
 'select p.line_id,p.match_id,p.proposed_status,p.payload,p.updated_at, '+
 'l.ticket_id,l.market_name,l.outcome_name,l.match_name,l.status as line_status '+
 'from app_live_settlement_preview p join app_ticket_line l on l.id=p.line_id '+
 'join app_ticket t on t.id=l.ticket_id '+
 "where l.status='PENDING' and t.status='PENDING' "+
 'order by p.updated_at desc limit $1';
