/**
 * Read-only deployment audit of real quote variants + pending settlement
 * prerequisites. No HTTP calls, wallet writes, or settlement decisions.
 *
 * node scripts/audit-deployment-settlement.mjs [maxVariants=100000] [--all]
 * --all includes EVERY observed unique source quote in the JSON export.
 * Use a snapshot/offline copy for PGlite. Do not open its live data directory.
 */
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {auditOffer} from './audit-market-settlement-readiness.mjs';
import {gradeStoredEventContract,SUPPORTED_FACT_KINDS} from '../server/ledger/match-event-facts.mjs';
import {gradeLine,hasRequiredSettlementEvidence,isProvenTwoWayTotalPush} from '../server/ledger/settler.mjs';

export const QUOTED_SQL=`
with snapshots as (
 select 'current'::text source,match_id,provider_id,native_market_id,native_outcome_id,
   market_key,market_name,outcome_name,outcome_key,line,period
 from app_provider_offer_current
 union all
 select 'history'::text,match_id,provider_id,native_market_id,native_outcome_id,
   market_key,market_name,outcome_name,outcome_key,line,period
 from app_provider_offer_change
)
select source,coalesce(provider_id,'unknown') provider_id,
 coalesce(native_market_id,'') native_market_id,
 coalesce(native_outcome_id,'') native_outcome_id,
 market_key,market_name,outcome_name,outcome_key,line,period,
 count(*)::bigint observations,count(distinct match_id)::bigint fixtures
from snapshots
group by source,provider_id,native_market_id,native_outcome_id,
 market_key,market_name,outcome_name,outcome_key,line,period
order by source,provider_id,native_market_id,native_outcome_id,
 market_key,market_name,outcome_name,outcome_key,line,period
limit $1 offset $2
`;

export const PENDING_SQL=`
select l.market_name,l.outcome_name,l.outcome_key,l.line,l.market_key,
 coalesce(l.live_contract->>'kind','NO_FROZEN_CONTRACT') contract_kind,
 coalesce(l.live_contract->>'event','') contract_event,
 coalesce(l.settlement_reason,'') settlement_reason,
 count(*)::bigint pending_lines,
 count(*) filter(where l.live_contract is null)::bigint missing_contract,
 count(*) filter(where r.match_id is null)::bigint missing_final,
 count(*) filter(where l.live_contract->>'event' is not null and not exists(
   select 1 from app_match_event_coverage e
   where e.match_id=l.match_id and e.provider='zizobet'
     and e.kind=l.live_contract->>'event'
     and e.confirmed_at is not null
 ))::bigint no_primary_confirmation
from app_ticket_line l
join app_ticket t on t.id=l.ticket_id
left join app_match_result r on r.match_id=l.match_id
where t.status='PENDING' and l.status='PENDING'
group by l.market_name,l.outcome_name,l.outcome_key,l.line,l.market_key,
 coalesce(l.live_contract->>'kind','NO_FROZEN_CONTRACT'),
 coalesce(l.live_contract->>'event',''),coalesce(l.settlement_reason,'')
order by count(*) desc,l.market_name,l.outcome_name,l.outcome_key,l.line,
 l.market_key,coalesce(l.live_contract->>'kind','NO_FROZEN_CONTRACT'),
 coalesce(l.live_contract->>'event',''),coalesce(l.settlement_reason,'')
limit $1 offset $2
`;

export const EVIDENCE_SQL=`
select e.provider,e.kind,count(*)::bigint snapshots,
 count(*) filter(where e.complete)::bigint complete,
 count(*) filter(where e.confirmed_at is not null)::bigint confirmed,
 count(*) filter(where e.count_home<>f.home or e.count_away<>f.away)::bigint mismatch
from app_match_event_coverage e
cross join lateral (
 select count(*) filter(where f.team='home')::bigint home,
 count(*) filter(where f.team='away')::bigint away
 from app_match_event_fact f
 where f.match_id=e.match_id and f.provider=e.provider and f.kind=e.kind and f.active
) f
group by e.provider,e.kind
order by e.provider,e.kind
`;

export const DEFINITIONS_SQL=`
select count(*)::bigint definitions,
 count(*) filter(where not exists(
  select 1 from app_provider_offer_current c
  where c.provider_id=d.provider_id and c.native_market_id=d.native_market_id
 ) and not exists(
  select 1 from app_provider_offer_change h
  where h.provider_id=d.provider_id and h.native_market_id=d.native_market_id
 ))::bigint never_quoted
from app_provider_market_definition d
`;

export const STATS_USAGE_SQL=`
select provider,period,sum(calls)::bigint calls
from app_stats_usage group by provider,period
order by period desc,provider limit 50
`;

export const AISCORE_SQL=`
select mapping_status,count(*)::bigint matches
from app_football_information_map
group by mapping_status order by mapping_status
`;


/** Consistency only: SYSTEM bets are excluded due to column-specific maths. */
export const FINANCIAL_CONSISTENCY_SQL=`
select
 count(*) filter(where t.status='WON' and exists(
  select 1 from app_ticket_line l where l.ticket_id=t.id
   and l.status in ('LOST','PENDING')))::bigint won_with_lost_or_pending_leg,
 count(*) filter(where t.status='LOST' and not exists(
  select 1 from app_ticket_line l where l.ticket_id=t.id
   and l.status='LOST'))::bigint lost_without_lost_leg,
 count(*) filter(where t.status='PENDING' and not exists(
  select 1 from app_ticket_line l where l.ticket_id=t.id
   and l.status='PENDING'))::bigint pending_without_pending_leg
from app_ticket t
where t.ticket_type in ('SINGLE','COMBO')
  and t.status in ('PENDING','WON','LOST')
`;

/** Dry run uses the SAME existing graders but never the settlement writers. */
export const DRY_RUN_SQL=`
select l.*,to_jsonb(r) as archived_result
from app_ticket_line l
join app_ticket t on t.id=l.ticket_id
left join app_match_result r on r.match_id=l.match_id
where t.status='PENDING' and l.status='PENDING'
order by t.placed_at,l.match_id,l.id
limit $1
`;

export async function auditPendingDryRun({execute,limit=100}={}){
 if(typeof execute!=='function')throw Error('Read-only SQL executor required');
 if(!Number.isSafeInteger(limit)||limit<1||limit>300)throw Error('Dry run limit must be 1..300');
 const {rows}=await execute(DRY_RUN_SQL,[limit]);
 const statuses={WON:0,LOST:0,VOID:0,PENDING:0,UNVERIFIED_VOID:0,ERROR_REVIEW:0};
 const cases=[];
 for(const line of rows){
  let verdict=null,reason='EVIDENCE_INCOMPLETE';
  try{
   const result=line.archived_result;
   if(line.live_contract&&SUPPORTED_FACT_KINDS.has(line.live_contract.kind)){
    verdict=await gradeStoredEventContract(line,result,{execute});
   }else if(result&&hasRequiredSettlementEvidence(line,result)){
    verdict=gradeLine(line,result);
    if(verdict==='VOID'&&!isProvenTwoWayTotalPush(line,result)){
     verdict='UNVERIFIED_VOID';
     reason='LEGACY_VOID_NOT_PROVEN';
    }
   }
  }catch{
   verdict='ERROR_REVIEW';reason='GRADER_EXCEPTION';
  }
  if(!Object.hasOwn(statuses,verdict))verdict='PENDING';
  statuses[verdict]++;
  if(cases.length<40&&(verdict==='ERROR_REVIEW'||verdict==='UNVERIFIED_VOID'||verdict==='PENDING'))
   cases.push({market:line.market_name,selection:line.outcome_name,
     contractKind:line.live_contract?.kind??null,reason});
 }
 return {sampled:true,examined:rows.length,maxSample:limit,statuses,unresolvedExamples:cases,
  note:'Predicted decisions only. No line, ticket or balance is updated.'};
}

const n=x=>Number.isFinite(Number(x))?Number(x):0;
const add=(obj,k,count=1)=>obj[k]=(obj[k]??0)+count;
const sortCounts=o=>Object.fromEntries(Object.entries(o).sort(([a],[b])=>a.localeCompare(b)));
const key=r=>JSON.stringify([r.provider_id,r.native_market_id,r.native_outcome_id,
 r.market_key,r.market_name,r.outcome_name,r.outcome_key,r.line,r.period]);

/** A stable read-only transaction must be supplied by the caller. */
export async function auditDeployment({execute,maxVariants=100000,pageSize=400,includeAll=false}={}){
 if(typeof execute!=='function')throw Error('A SQL read-only executor is required');
 if(!Number.isSafeInteger(maxVariants)||maxVariants<1||maxVariants>300000)throw Error('Invalid maxVariants');
 if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>2000)throw Error('Invalid pageSize');
 const variants=new Map(),bySource={},counts={},pendingReasons={};
 async function scan(sql,visit){
  let offset=0,truncated=false;
  while(offset<maxVariants){
   const size=Math.min(pageSize,maxVariants-offset);
   const {rows}=await execute(sql,[size,offset]);
   for(const row of rows)visit(row);
   offset+=rows.length;
   if(rows.length<size)return {rows:offset,truncated:false};
  }
  truncated=(await execute(sql,[1,offset])).rows.length>0;
  return {rows:offset,truncated};
 }
 const quoted=await scan(QUOTED_SQL,r=>{
  add(bySource,r.source);
  const k=key(r);
  if(!variants.has(k)){
   const finding=auditOffer(r);
   variants.set(k,{provider:r.provider_id,market:r.market_name,
    nativeMarketId:r.native_market_id,nativeOutcomeId:r.native_outcome_id,
    selection:r.outcome_name,outcomeKey:r.outcome_key,line:r.line,period:r.period,
    category:finding.category,reason:finding.reason,
    sourceKinds:[],observations:0});
   add(counts,finding.category);
  }
  const v=variants.get(k);
  v.sourceKinds.push(r.source);
  v.observations+=n(r.observations);
 });
 const pending=[],totals={lines:0,missingContract:0,missingFinal:0,noPrimaryConfirmation:0};
 const outstanding=await scan(PENDING_SQL,r=>{
  const row={market:r.market_name,selection:r.outcome_name,
   contractKind:r.contract_kind,settlementReason:r.settlement_reason,
   category:auditOffer(r).category,pendingLines:n(r.pending_lines),
   missingContract:n(r.missing_contract),missingFinal:n(r.missing_final),
   noPrimaryConfirmation:n(r.no_primary_confirmation)};
  pending.push(row);
  totals.lines+=row.pendingLines;
  totals.missingContract+=row.missingContract;
  totals.missingFinal+=row.missingFinal;
  totals.noPrimaryConfirmation+=row.noPrimaryConfirmation;
  add(pendingReasons,row.settlementReason||'NOT_RECORDED',row.pendingLines);
 });
 const evidence=(await execute(EVIDENCE_SQL)).rows.map(r=>({
  provider:r.provider,kind:r.kind,snapshots:n(r.snapshots),complete:n(r.complete),
  confirmed:n(r.confirmed),mismatches:n(r.mismatch)
 }));
 const definition=(await execute(DEFINITIONS_SQL)).rows[0]??{};
 const financial=(await execute(FINANCIAL_CONSISTENCY_SQL)).rows[0]??{};
 const dryRun=await auditPendingDryRun({execute});
 const secondary={};
 for(const [name,sql] of [['statsUsage',STATS_USAGE_SQL],['aiscoreMappings',AISCORE_SQL]]){
  try{secondary[name]=(await execute(sql)).rows;}
  catch(e){
   if(e?.code!=='42P01')throw e;
   secondary[name]={unavailable:'TABLE_NOT_INSTALLED'};
  }
 }
 const priority=['DANGER_WRONG_RESULT','STOPPAGE_TIMELINE_UNVERIFIED',
  'UNSUPPORTED_OR_SPECIAL','NOT_SETTLEABLE','UNKNOWN_REVIEW',
  'RULE_MAPPED_NEEDS_EVIDENCE','INCIDENT_EVIDENCE_REQUIRED',
  'STATS_EVIDENCE_REQUIRED','SCORE_GRADEABLE'];
 const risky=[...variants.values()].filter(x=>x.category!=='SCORE_GRADEABLE')
  .sort((a,b)=>priority.indexOf(a.category)-priority.indexOf(b.category)||
    b.observations-a.observations);
 return {readOnly:true,realObservedQuotes:true,
  complete:!quoted.truncated&&!outstanding.truncated,
  sourceRows:sortCounts(bySource),sampledGroupedRows:quoted.rows,
  distinctQuoteVariants:variants.size,classification:sortCounts(counts),
  offerTruncated:quoted.truncated,pendingTruncated:outstanding.truncated,
  riskExamples:risky.slice(0,100),
  ...(includeAll?{allObservedQuoteVariants:[...variants.values()]}:{}),
  pending:{groupedRows:outstanding.rows,...totals,reasons:sortCounts(pendingReasons),
   examples:pending.sort((a,b)=>b.pendingLines-a.pendingLines).slice(0,100)},
  definitions:{total:n(definition.definitions),neverQuoted:n(definition.never_quoted)},
  incidentEvidence:evidence,supplemental:secondary,
  ticketStatusConsistency:{
   wonWithLostOrPendingLeg:n(financial.won_with_lost_or_pending_leg),
   lostWithoutLostLeg:n(financial.lost_without_lost_leg),
   pendingWithoutPendingLeg:n(financial.pending_without_pending_leg),
   scope:'SINGLE_AND_COMBO_ONLY; audit anomalies are not automatic corrections'
  },dryRun,
  limitations:[
   'Only quotes retained in the current and change archive are observable; absence is not proof of unsupported markets.',
   'LIVE fixtures normally have no final result yet.',
   'Matched provider counters and source parser are not official-independent event certification.',
   'No actual external API request or wallet/payment action was performed.'
  ]};
}
async function main(){
 const maxVariants=Number(process.argv[2]??100000);
 if(!Number.isSafeInteger(maxVariants)||maxVariants<1||maxVariants>300000)
  throw Error('Usage: node scripts/audit-deployment-settlement.mjs [1..300000]');
 const {pool}=await import('../server/db.mjs');
 let c,begun=false;
 try{
  c=await pool.connect();
  await c.query('begin isolation level repeatable read read only');begun=true;
  const result=await auditDeployment({execute:c.query.bind(c),maxVariants,
   includeAll:process.argv.includes('--all')});
  console.log(JSON.stringify(result,null,2));
  if(!result.complete||result.incidentEvidence.some(x=>x.mismatches>0)||
    result.dryRun.statuses.ERROR_REVIEW>0||
    result.ticketStatusConsistency.wonWithLostOrPendingLeg>0||
    result.ticketStatusConsistency.lostWithoutLostLeg>0)
   process.exitCode=2;
 }finally{
  if(begun)await c.query('rollback').catch(()=>{process.exitCode=1;});
  c?.release();
  await pool.end();
 }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
 main().catch(error=>{
  console.error('Read-only deployment audit failed:',error.code||error.message);
  process.exitCode=1;
 });
