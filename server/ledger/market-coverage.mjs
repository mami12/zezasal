/**
 * Admin-only audit of REAL native market definitions and quoted outcomes.
 * Rule presence is not settlement certification. No changes to live odds.
 */
import {query} from '../db.mjs';
import {liveContract} from './live-contract-rules.mjs';
import {isScoringPropMarket,gradeScoringPropMarket} from './scoring-props.mjs';
import {isStatisticMarket,statisticMarketContract} from './statistic-markets.mjs';
import {gradeLine} from './settler.mjs';
const clean=v=>String(v??'').trim();
const norm=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const samples=[
 [0,0,0,0,0,0,0,0],[1,0,1,0,7,3,2,1],
 [0,2,0,1,2,9,1,4],[3,3,2,1,4,4,3,3],[5,1,2,1,11,6,1,2]
].map(([h,a,hh,ha,ch,ca,dh,da])=>({
 home_score:h,away_score:a,half_home_score:hh,half_away_score:ha,
 corners_home:ch,corners_away:ca,cards_home:dh,cards_away:da,
 home_team:'Home Team',away_team:'Away Team',
 statistics:{shots:{home:15,away:7},shotsOnTarget:{home:5,away:2},fouls:{home:11,away:14}}
}));
export function auditQuotedMarket(raw){
 const line={market_name:clean(raw.market_name??raw.native_market_name),
  market_key:clean(raw.market_key),line:clean(raw.line),
  outcome_name:clean(raw.outcome_name),outcome_key:clean(raw.outcome_key),
  period:raw.period??0};
 if(!line.market_name||!line.outcome_name)
  return {status:'NEEDS_RULE',reason:'NO_NATIVE_OUTCOME'};
 const counts={goal:{home:0,away:0},corner:{home:0,away:0},card:{home:0,away:0}};
 try{
  const c=liveContract(line,{counts,clock:null,teams:{home:'Home Team',away:'Away Team'}});
  if(c)return {status:'RULE_MAPPED',rule:'EVENT:'+c.kind,evidence:c.event??'goal'};
 }catch{}
 if(isScoringPropMarket(line)){
  if(samples.some(r=>['WON','LOST','VOID'].includes(gradeScoringPropMarket(line,r))))
   return {status:'RULE_MAPPED',rule:'HT_FT_SCORE'};
  return {status:'NEEDS_RULE',reason:'UNRECOGNIZED_TEAM_OR_SELECTION'};
 }
 if(isStatisticMarket(line)){
  const c=statisticMarketContract(line),choice=norm(line.outcome_name);
  const valid=c?.scope==='result'?
   ['1','x','2','home','away','draw','home team','away team'].includes(choice):
   /^(?:over|under)(?:\b|$)/.test(choice);
  if(c?.supported&&valid)
   return {status:'RULE_MAPPED',rule:'FINAL_STATISTICS:'+c.stat};
  return {status:'NEEDS_RULE',reason:'UNRECOGNIZED_STATISTIC_CONTRACT'};
 }
 try{
  if(samples.some(r=>['WON','LOST','VOID'].includes(gradeLine({...line,builder_legs:null},r))))
   return {status:'RULE_MAPPED',rule:'FINAL_SCORE_OR_TOTAL'};
 }catch{}
 return {status:'NEEDS_RULE',reason:'NO_FINANCIAL_GRADER'};
}
export function summarizeMarketCoverage(definitions=[],quotes=[]){
 const groups=new Map();
 const get=(id,name,scope)=>{
  // Native numeric IDs may be reused across PREMATCH and LIVE with
  // different definitions. Never merge two different native titles.
  const key=(clean(id)||'anonymous')+'|'+norm(name);
  if(!groups.has(key))groups.set(key,{
   nativeMarketId:clean(id)||null,name:clean(name),scopes:new Set(),
   quotedOutcomes:0,ruleMapped:0,unmapped:0,ruleTypes:new Set(),
   unmappedExamples:[],seen:new Set()
  });
  const g=groups.get(key);
  if(scope)g.scopes.add(scope);
  return g;
 };
 for(const d of definitions)get(d.native_market_id,d.native_market_name,d.scope);
 for(const row of quotes){
  const g=get(row.native_market_id,row.native_market_name??row.market_name,'QUOTED');
  const signature=[row.market_key,row.line,row.outcome_key,row.market_name,row.outcome_name,row.period].map(clean).join('|');
  if(g.seen.has(signature))continue;
  g.seen.add(signature);g.quotedOutcomes++;
  const finding=auditQuotedMarket(row);
  if(finding.status==='RULE_MAPPED'){g.ruleMapped++;g.ruleTypes.add(finding.rule);}
  else{g.unmapped++;if(g.unmappedExamples.length<4)g.unmappedExamples.push({
   marketName:row.market_name,outcomeName:row.outcome_name,
   line:row.line??'',reason:finding.reason??'NEEDS_RULE'
  });}
 }
 const markets=[...groups.values()].map(g=>({
  nativeMarketId:g.nativeMarketId,name:g.name,scopes:[...g.scopes],
  status:!g.quotedOutcomes?'NOT_QUOTED_IN_SAMPLE':
   g.unmapped===0?'ALL_SAMPLED_RULES_MAPPED':
   g.ruleMapped===0?'NO_SAMPLED_RULE_MAPPED':'PARTIALLY_MAPPED',
  quotedOutcomes:g.quotedOutcomes,ruleMapped:g.ruleMapped,unmapped:g.unmapped,
  ruleTypes:[...g.ruleTypes],unmappedExamples:g.unmappedExamples
 }));
 const rank={NO_SAMPLED_RULE_MAPPED:0,PARTIALLY_MAPPED:1,
  NOT_QUOTED_IN_SAMPLE:2,ALL_SAMPLED_RULES_MAPPED:3};
 markets.sort((a,b)=>rank[a.status]-rank[b.status]||b.unmapped-a.unmapped||a.name.localeCompare(b.name));
 const counts={};for(const m of markets)counts[m.status]=(counts[m.status]??0)+1;
 return {summary:{marketFamilies:markets.length,definitions:definitions.length,
  sampledQuoteRows:quotes.length,...counts},markets};
}
export async function providerMarketCoverage({execute=query,quoteLimit=12000,definitionLimit=10000}={}){
 const limit=Math.min(15000,Math.max(100,Number(quoteLimit)||12000));
 const defCap=Math.min(15000,Math.max(100,Number(definitionLimit)||10000));
 const [dict,sample]=await Promise.all([
  execute("select provider_id,scope,native_market_id,native_market_name "+
   "from app_provider_market_definition where lower(provider_id)='zizobet' "+
   "order by scope,native_market_id limit $1",[defCap]),
  execute("select native_market_id,native_market_name,market_key,market_name, "+
   "outcome_key,outcome_name,line,period from app_provider_offer_current "+
   "where lower(provider_id)='zizobet' or market_key like 'zz%@%' limit $1",[limit])
 ]);
 return {...summarizeMarketCoverage(dict.rows,sample.rows),sampled:true,
  note:'Bounded quote sample only. RULE_MAPPED describes a known parser, not proof that all providers or financial settlements are ready.'};
}
