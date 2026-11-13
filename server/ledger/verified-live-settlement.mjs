/**
 * Two independent PRIMARY-feed observations are required before committing a
 * previously proposed LIVE decision. Never decide from AiScore discovery JSON,
 * an unresolved recovery gap, a browser label or a stale single observation.
 *
 * The existing atomic updatePendingLine/recalcTicket financial path is reused,
 * default-on for independently confirmed provider milestones; deployments may
 * explicitly pause real payouts with LIVE_VERIFIED_AUTO_SETTLEMENT_ENABLED=false.
 */
import {query} from '../db.mjs';
import {gradeLiveContract,gradeFromAcceptedCounters} from './live-contract-rules.mjs';

export const VERIFIED_LIVE_PROPOSALS_SQL=String.raw`
select p.line_id,p.match_id,p.proposed_status,p.payload,p.updated_at as preview_at,
       l.ticket_id,l.live_contract,t.placed_at,
       f.payload as provider_frame,f.observed_at as frame_at,
       c.last_seen_at as second_seen_at,
       exists(select 1 from app_live_event_recovery g
              where g.match_id=l.match_id and g.status='AWAITING_BACKUP_API'
                and l.id=any(g.line_ids)) as open_recovery_gap
from app_live_settlement_preview p
join app_ticket_line l on l.id=p.line_id
join app_ticket t on t.id=l.ticket_id
left join lateral (
  select payload,observed_at from app_live_event_frame
  where match_id=l.match_id order by observed_at desc,id desc limit 1
) f on true
left join app_live_event_cursor c on c.match_id=l.match_id
where t.status='PENDING' and l.status='PENDING'
  and l.live_contract is not null
  and not exists(select 1 from app_settlement_override o where o.line_id=l.id)
order by p.updated_at,p.line_id limit $1
`;

const obj=value=>{
 try{return typeof value==='string'?JSON.parse(value):value;}catch{return null;}
};
const millis=value=>{
 const n=value==null?NaN:new Date(value).getTime();
 return Number.isFinite(n)?n:NaN;
};
export function primaryLiveDecision(contract,frame){
 if(!contract||!frame||frame.source!=='zizobet')return null;
 // A LIVE timed purchase concerns events AFTER its frozen baseline, not
 // earlier events in the same named minute band. Only the delta can decide
 // an irreversible timed outcome from raw primary frames.
 const timed=['window','window-total'].includes(contract.kind)&&contract.entryBaseline!=null;
 const timeline=timed?null:gradeLiveContract(contract,frame,{ended:frame.ended===true});
 const delta=gradeFromAcceptedCounters(contract,frame);
 if(timeline&&delta&&timeline!==delta)return null;
 const decision=timeline??delta;
 // Early VOID decisions need official cancellation/push rules, not a guess.
 return decision==='WON'||decision==='LOST'?decision:null;
}

/** Return a financial-grade decision only after a separate later provider poll. */
export function verifiedSecondLiveDecision(row,{now=Date.now()}={}){
 if(row?.open_recovery_gap===true||!row)return null;
 const old=obj(row.payload),contract=obj(row.live_contract),current=obj(row.provider_frame);
 const oldFrame=old?.frame;
 if(!contract||!oldFrame||!current||!old?.contract||
    JSON.stringify(contract)!==JSON.stringify(old.contract))return null;
 // Prove ONLY irreversible outcomes by comparing accepted counters with
 // TWO independent primary observations. Sequence/race uses whole-match
 // counters. An interval uses its own purchase baseline and must still be
 // running in BOTH frames. Player identity and a final UNDER/NO win cannot
 // be decided by a scoreboard delta.
 const timed=['window','window-total'].includes(contract.kind);
 if(!['sequence','race','window','window-total'].includes(contract.kind)||
    !(timed?['goal','corner','card','foul']:['goal','corner','card']).includes(contract.event))return null;
 const base=timed?contract.entryBaseline:contract.baseline;
 if(!base||!['home','away'].every(side=>
    Number.isSafeInteger(base[side])&&base[side]>=0))return null;
 if(timed&&(!Number.isFinite(contract.entryClockMinute)||
    !Number.isFinite(contract.from)||!Number.isFinite(contract.to)||
    contract.entryClockMinute<contract.from||
    contract.entryClockMinute>=contract.to+1||contract.cardColor!=null))return null;
 const placed=millis(row.placed_at),first=millis(old.frameAt);
 const stored=millis(row.preview_at),latest=millis(row.frame_at),second=millis(row.second_seen_at);
 if(![placed,first,stored,latest,second,now].every(Number.isFinite))return null;
 // The first observation must follow the actual purchase. The second poll
 // must be later than the stored proposal, even if the returned JSON is equal.
 if(first<placed||stored<first||latest<first||latest>second||
    second<stored+5000||second>now+5000||now-second>60000||
    now-stored>300000||now-latest>300000)return null;
 // If Zizobet reassigns or corrects an incident between the two polls,
 // both snapshots might still have the same TOTAL even though its identity
 // changed. Never make a financial write from an unsettled correction.
 const firstTeamCounts=oldFrame.teams?.[contract.event];
 const secondTeamCounts=current.teams?.[contract.event];
 if(!['home','away'].every(side=>
    Number.isSafeInteger(firstTeamCounts?.[side])&&
    Number.isSafeInteger(secondTeamCounts?.[side])&&
    firstTeamCounts[side]===secondTeamCounts[side]))return null;
 if(!Number.isFinite(oldFrame.clock)||!Number.isFinite(current.clock)||
    current.clock<oldFrame.clock)return null;
 // A full provider timeline may corroborate the counters, but without
 // that timeline ONLY an unambiguous delta from the frozen purchase state
 // may authorize a financial write. Partial lists cannot choose the winner.
 const firstDelta=gradeFromAcceptedCounters(contract,oldFrame);
 const secondDelta=gradeFromAcceptedCounters(contract,current);
 if(!firstDelta||!['WON','LOST'].includes(firstDelta))return null;
 // The interval may end between two provider observations. If an earlier
 // in-window snapshot already proved an irreversible event, the second
 // observation still confirms it when both team totals are unchanged.
 // Never infer which minute a NEW post-window delta belongs to.
 const crossedTimedEnd=timed&&Number(current.clock)>Number(contract.to);
 if(crossedTimedEnd){
  if(!Number.isFinite(Number(contract.to))||secondDelta!==null)return null;
 }else if(secondDelta!==firstDelta)return null;
 const firstDecision=primaryLiveDecision(contract,oldFrame);
 const secondDecision=crossedTimedEnd?firstDelta:primaryLiveDecision(contract,current);
 return firstDecision===firstDelta&&secondDecision===firstDelta&&
    firstDelta===row.proposed_status?firstDelta:null;
}

/**
 * Controlled real writes. A failed/retried wallet update remains exactly-once via
 * the existing row-locked settlement transaction.
 */
export async function settleVerifiedLiveProposals({
 runQuery=query,updateLine,closeTicket,enabled=process.env.LIVE_VERIFIED_AUTO_SETTLEMENT_ENABLED!=='false',
 now=Date.now,limit=400
}={}){
 if(!enabled)return {enabled:false,examined:0,graded:0,closed:[]};
 if(typeof updateLine!=='function'||typeof closeTicket!=='function')
   throw new Error('Settlement writers required');
 const cap=Math.max(1,Math.min(1000,Math.trunc(Number(limit)||400)));
 const {rows}=await runQuery(VERIFIED_LIVE_PROPOSALS_SQL,[cap]);
 const ticketIds=new Set();
 let graded=0;
 for(const row of rows){
  const decision=verifiedSecondLiveDecision(row,{now:now()});
  if(!decision)continue;
  if(await updateLine(row.line_id,decision,row.ticket_id)){
   graded++;
   ticketIds.add(row.ticket_id);
  }
 }
 const closed=[];
 for(const ticketId of ticketIds){
  const value=await closeTicket(ticketId);
  if(value)closed.push(value);
 }
 return {enabled:true,examined:rows.length,graded,closed};
}
