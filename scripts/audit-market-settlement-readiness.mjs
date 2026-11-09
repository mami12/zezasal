/**
 * Read-only audit of EVERY DISTINCT provider market/outcome retained by the
 * deployment's offer archive (up to the supplied row limit).
 *
 * Usage: node scripts/audit-market-settlement-readiness.mjs 30000
 *
 * WARNING: "score-gradeable" is a code-path classification, NOT evidence
 * that the provider will supply correct results. No bets, settings or wallet
 * rows are created or modified by this script.
 */
import {pool,query} from '../server/db.mjs';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';
import {SUPPORTED_FACT_KINDS} from '../server/ledger/match-event-facts.mjs';
import {eventMarketRequirement} from '../server/ledger/event-market-policy.mjs';
import {statisticMarketContract,isStatisticMarket} from '../server/ledger/statistic-markets.mjs';
import {goalTotalContract} from '../server/ledger/goal-total-contract.mjs';
import {cornerTotalContract} from '../server/ledger/corner-total-contract.mjs';
import {isPeriodGoalTotal,parsePeriodGoalTotal} from '../server/ledger/period-goal-totals.mjs';
import {isHtFtMarket,parseHtFtOutcome} from '../server/ledger/ht-ft.mjs';
import {auditQuotedMarket} from '../server/ledger/market-coverage.mjs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {isResultTotalMarket,isTotalBttsMarket,parseResultTotal,parseTotalBtts} from '../server/ledger/mixed-combos.mjs';
import {isResultBttsMarket,parseResultBttsOutcome} from '../server/ledger/result-btts.mjs';

const fold=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/\s+/g,' ').trim();
const label=row=>fold(row.outcome_name);
const category=(name,reason)=>({category:name,reason});
const isOverUnder=(v)=>/^(?:over|under)(?:\s|$)/.test(fold(v));
const isResult=(v)=>/^(?:1|x|2|home|away|draw|tie)$/.test(fold(v));
const isDC=(v)=>/^(?:1x|12|x2|homeordraw|homeoraway|draworaway)$/.test(fold(v));
const isYesNo=(v)=>/^(?:yes|no|po|jo)$/.test(fold(v));
const threshold=r=>r.line!=null&&String(r.line).trim()!==''?Number(String(r.line).replace(',','.')):null;
const cleanTotal=n=>n!==null&&Number.isFinite(n)&&n>=0&&Number.isInteger(n*2);

export function auditOffer(row){
 const n=fold(row.market_name), v=label(row),line=threshold(row),period=Number(row.period??0);
 if(!n)return category('NOT_SETTLEABLE','Mungon emri origjinal i marketit');
 // A 45+ / 90+ interval includes injury time. Normalized absolute minutes
 // alone cannot distinguish stoppage events from later-period incidents.
 if(/^\d{1,3}:[0-5]\d\s*[-–]\s*(?:45|90)\+\s*min\.?\s*[-–]/.test(n))
  return category('STOPPAGE_TIMELINE_UNVERIFIED',
   'Clock interval through 45+/90+ requires verified period/stoppage identities, not only minute totals');
 // Highest-risk aliases: the old generic score grader can misinterpret these.
 if(/\b(?:early payout|extra time|overtime|shootout|to qualify|qualif(?:y|ication)|lift the trophy)\b/.test(n))
  return category('DANGER_WRONG_RESULT','Kerkon rregulla per fitimin/promovimin ose kohe tjeter nga 90 minutat');
 if(/\b(?:asian|quarter|european)\b/.test(n)||/\bhandicap\b/.test(n))
  return category('DANGER_WRONG_RESULT','Handicap/Asian: linja, baseline live dhe kthimet e pjesshme duhen vertetuar');
 // The actual FT/HT goal grader, not event chronology, decides numeric totals.
 // This also covers second-half goals using verified FT minus HT.
 if(isPeriodGoalTotal(row)){
  const goal=parsePeriodGoalTotal(row);
  return goal?category('SCORE_GRADEABLE',goal.half?
   'Goal total with verified HT and FT scoreboards, never FT-only evidence':
   'Goal total with confirmed final score and quoted exact/OU line'):
   category('UNSUPPORTED_OR_SPECIAL','Goal total name or selection cannot be decoded safely');
 }
 if(isHtFtMarket(row.market_name)){
  const selection=parseHtFtOutcome(row.outcome_name,row.outcome_key);
  return selection?category('SCORE_GRADEABLE','HT/FT pair requires both independently confirmed scores'):
   category('UNSUPPORTED_OR_SPECIAL','HT/FT outcome does not contain two recognized results');
 }
 // Full-time corner totals use the verified aggregate, not a fabricated
 // corner-minute timeline. Half/sequence/window markets are excluded by parser.
 if(cornerTotalContract(row)&&cleanTotal(line)&&isOverUnder(v))
  return category('STATS_EVIDENCE_REQUIRED','Full-time corner counts need final source agreement');
 if(isStatisticMarket(row)){
  const c=statisticMarketContract(row);
  return c?.supported?category('STATS_EVIDENCE_REQUIRED','Statistike e verifikueshme vetem me burim te plote')
   :category('UNSUPPORTED_OR_SPECIAL','Statistike ose seleksion jashte kontrates se mbeshtetur');
 }
 const c=liveContract(row,{clock:0,counts:{goal:{home:0,away:0},corner:{home:0,away:0},card:{home:0,away:0}},teams:{}});
 if(c&&SUPPORTED_FACT_KINDS.has(c.kind)){
  if(['player-goal','nth-time','sequence','race','window','window-total','interval-result','interval-leader'].includes(c.kind))
   return category('INCIDENT_EVIDENCE_REQUIRED',c.kind+': kerkon Timeline te rakorduar dhe identitet te verifikuar');
  if(c.event==='card'||c.event==='foul')
   return category('INCIDENT_EVIDENCE_REQUIRED',c.kind+': ngjyra/lloji i kartonit ose faullit kerkon prova');
  return category('INCIDENT_EVIDENCE_REQUIRED',c.kind+': kontrata ruhet, por pagesa aktualisht mund te varet nga PostgreSQL incidents');
 }
 if(eventMarketRequirement(row))
  return category('UNSUPPORTED_OR_SPECIAL','API nuk provon ngjarjen/sekonden/lojtarin e kerkuar');
 if(isResultTotalMarket(n))
  return parseResultTotal(row.outcome_name)||parseResultTotal(row.outcome_key)?
   category('SCORE_GRADEABLE','Result + total, me outcome te deshifruar'):
   category('UNSUPPORTED_OR_SPECIAL','Rezultat+total pa outcome te deshifruar');
 if(isTotalBttsMarket(n))
  return parseTotalBtts(row.outcome_name)||parseTotalBtts(row.outcome_key)?
   category('SCORE_GRADEABLE','Total + BTTS, me outcome te deshifruar'):
   category('UNSUPPORTED_OR_SPECIAL','Total + BTTS pa outcome te deshifruar');
 if(isResultBttsMarket(n))
  return parseResultBttsOutcome(row.outcome_name)||parseResultBttsOutcome(row.outcome_key)?
   category('SCORE_GRADEABLE','Result + BTTS, me outcome te deshifruar'):
   category('UNSUPPORTED_OR_SPECIAL','Result + BTTS pa outcome te deshifruar');
 if(/^(?:full time result|match result|1x2|full time 1x2|half time result|1st half result|first half result|1st half 1x2|first half 1x2|2nd half result|second half result|2nd half 1x2|second half 1x2)$/.test(n))
  return isResult(v)?category('SCORE_GRADEABLE','Result 1/X/2; saktesia varet nga scope/score i sakte'):
   category('UNSUPPORTED_OR_SPECIAL','Kodi i rezultatit 1/X/2 nuk njihet');
 if(/^(?:double chance|full time double chance|1st half double chance|first half double chance)$/.test(n))
  return isDC(v)?category('SCORE_GRADEABLE','Double Chance'):category('UNSUPPORTED_OR_SPECIAL','Outcome i DC i panjohur');
 if(/^(?:both teams to score|btts|both teams score)$/.test(n))
  return isYesNo(v)?category('SCORE_GRADEABLE','BTTS Yes/No'):category('UNSUPPORTED_OR_SPECIAL','Outcome BTTS i panjohur');
 if(goalTotalContract(row)&&cleanTotal(line)&&isOverUnder(v))
  return category('SCORE_GRADEABLE','Total gola; kontrollo rregullin e push per linja te plota');
 // Only unmatched half-specific quotes are unsafe; parsed ones above must
 // not be declared unsupported simply because their period is not FT.
 if(/\b(?:first|1st|half.?time)\s*half\b/.test(n)&&/\b(?:cards?|bookings?)\b/.test(n))
  return category('DANGER_WRONG_RESULT','Unmapped first-half card outcome must not use FT totals');
 const mapped=auditQuotedMarket(row);
 if(mapped.status==='RULE_MAPPED')
  return category('RULE_MAPPED_NEEDS_EVIDENCE',
   'Known financial rule '+mapped.rule+'; a parser match alone does not prove source or final evidence');
 if(/\b(?:half.?time\s*[/&-]\s*full.?time|ht\s*[/&-]\s*ft|correct score|draw no bet|odd\s*[/&-]?\s*even|winning margin|clean sheet|to nil|both halves|either half|number of corners? in 1st half)\b/.test(n))
  return category('UNSUPPORTED_OR_SPECIAL','Kerkon llogaritje speciale; nuk ka verifikim te pergjithshem');
 if(period===2||/\b(?:2nd|second)\s+half\b/.test(n))
  return category('UNSUPPORTED_OR_SPECIAL','No verified second-half scoring or incident rule for this quote');
 if(period===1&&!/\b(?:first|1st)\s+half\b|\bhalf.?time\b|^ht(?:\b|\W)/.test(n))
  return category('DANGER_WRONG_RESULT','Period=1 but provider market name has no explicit first-half scope');
 return category('UNKNOWN_REVIEW','No tested financial rule for this exact provider market and outcome');
}
const argv=Number(process.argv[2]??30000);
const limit=Number.isSafeInteger(argv)&&argv>0?Math.min(argv,150000):30000;
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
const groups=new Map(),offers=[];
try{
 let offset=0;
 while(offset<limit){
  const cap=Math.min(2500,limit-offset);
  const {rows}=await query(`select
   coalesce(provider_id,'?') as provider_id,coalesce(native_market_id,'?') as native_market_id,
   market_name,outcome_name,period,line,count(*)::int as offers,
   count(distinct match_id)::int as fixtures
   from app_provider_offer_current
   group by provider_id,native_market_id,market_name,outcome_name,period,line
   order by provider_id,native_market_id,market_name,outcome_name,period,line
   limit $1 offset $2`,[cap,offset]);
  for(const row of rows){
   const audit=auditOffer(row),item={...row,...audit};
   groups.set(audit.category,(groups.get(audit.category)??0)+1);
   offers.push(item);
  }
  offset+=rows.length;
  if(rows.length<cap)break;
 }
 let pending=[];
 try{
  pending=(await query(`select l.market_name,l.outcome_name,l.line,count(*)::int as pending_lines
   from app_ticket_line l join app_ticket t on t.id=l.ticket_id
   where l.status='PENDING' and t.status='PENDING'
   group by l.market_name,l.outcome_name,l.line
   order by count(*) desc limit 2000`)).rows.map(row=>({...row,...auditOffer(row)}));
 }catch(error){console.error('Pending ticket audit unavailable:',error.message);}
 const priorities=['DANGER_WRONG_RESULT','STOPPAGE_TIMELINE_UNVERIFIED','UNSUPPORTED_OR_SPECIAL','UNKNOWN_REVIEW','RULE_MAPPED_NEEDS_EVIDENCE','INCIDENT_EVIDENCE_REQUIRED','STATS_EVIDENCE_REQUIRED','SCORE_GRADEABLE'];
 console.log(JSON.stringify({readOnly:true,scannedDistinctOffers:offers.length,
  partial:offers.length>=limit,limit,counts:Object.fromEntries(priorities.map(k=>[k,groups.get(k)??0])),
  riskyOffers:offers.filter(r=>!['SCORE_GRADEABLE'].includes(r.category))
   .sort((a,b)=>priorities.indexOf(a.category)-priorities.indexOf(b.category)||b.fixtures-a.fixtures).slice(0,200),
  pendingByMarket:pending.filter(r=>r.category!=='SCORE_GRADEABLE').slice(0,150),
  important:'RISK LABELS ARE A STATIC AUDIT, not settlement decisions; verify the PRIMARY provider rule and official match facts before money moves.'},null,2));
}catch(error){
 console.error('Read-only settlement market audit failed:',error.message);
 process.exitCode=1;
}finally{await pool.end();}
}
