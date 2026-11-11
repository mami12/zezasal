/**
 * Read-only provider and evidence readiness. Prints ONLY key-present booleans,
 * NEVER API keys, tokens, credentials, user information or raw provider JSON.
 * Usage: node scripts/audit-provider-readiness.mjs > provider-readiness.json
 */
import {pool,query} from '../server/db.mjs';
const env=process.env;
const config={
 STATS_PROVIDERS_ENABLED:env.STATS_PROVIDERS_ENABLED==='true',
 AISCORE_INFO_ENABLED:env.AISCORE_INFO_ENABLED!=='false',
 providerKeys:{
  apifootball:!!env.APIFOOTBALL_API_KEY,
  sportapi:!!env.SPORTAPI_API_KEY,
  goalapi:!!env.GOALAPI_API_KEY,
  bsd:!!env.BSD_API_KEY,
  fotmob:'NO_KEY_CONFIGURED_IN_CODE',
  aiscore:'REQUIRES_CONFIRMED_FIXTURE_MAPPING',
  worldcup26:'NO_KEY_CONFIGURED_IN_CODE'
 }
};
const checks={};
async function check(name,sql){
 try{checks[name]=(await query(sql)).rows;}
 catch(error){checks[name]={status:'QUERY_UNAVAILABLE',reason:String(error?.code??'DB_SCHEMA_OR_CONNECTION')};}
}
try{
 await check('secondaryUsage',`select provider,period,calls from app_stats_usage
  where period>=to_char(now()-interval '7 days','YYYY-MM-DD')
  order by period desc,provider limit 80`);
 await check('fixtureMappings',`select count(*)::int as total,
  count(*) filter (where aiscore_id is not null)::int as aiscore_mapped,
  count(*) filter (where next_check_at<=now())::int as due_for_check
  from app_football_information_map`);
 await check('primaryEventFacts',`select kind,count(*)::int as events,
  count(distinct match_id)::int as matches
  from app_match_event_fact where provider='zizobet' and active=true
  group by kind order by kind`);
 await check('primaryCoverage',`select kind,count(*)::int as matches,
  count(*) filter (where complete=true)::int as complete,
  count(*) filter (where confirmed_at is not null)::int as confirmed
  from app_match_event_coverage where provider='zizobet' group by kind order by kind`);
 await check('secondaryIncidents',`select provider,kind,count(*)::int as events,
  count(distinct match_id)::int as matches
  from app_supplemental_match_incident where active=true
  group by provider,kind order by provider,kind`);
 await check('statisticsReview',`select count(*)::int as reviewed,
  count(*) filter (where payload->>'status'='MANUAL_REVIEW')::int as conflicts
  from app_stat_review`);
 await check('pendingReasons',`select coalesce(l.settlement_reason,'NOT_CLASSIFIED') as reason,
   count(*)::int as lines from app_ticket_line l join app_ticket t on t.id=l.ticket_id
   where l.status='PENDING' and t.status='PENDING'
   group by reason order by count(*) desc limit 40`);
 console.log(JSON.stringify({readOnly:true,config,checks,neverPrintSecrets:true,
   next:'For missing information, check the exact fixture mapping, upstream coverage, quota and source disagreement; only create a provider API key if its key-present boolean is false and you want that provider enabled.'},null,2));
}catch(error){console.error('Readiness audit failed:',error?.message??String(error));process.exitCode=1;}
finally{await pool.end();}
