/**
 * Read-only incident audit against the DEPLOYMENT PostgreSQL database.
 * Run after loading deployment env: node scripts/audit-zizobet-provider-evidence.mjs 250
 * No ticket, match, wallet or evidence updates; prints no player/financial data.
 * A matching feed counter proves internal consistency, not necessarily whether
 * a corner was actually taken. External match footage/offical stats still matter.
 */
import {pool,query} from '../server/db.mjs';

const given=Number(process.argv[2]??200);
const limit=Number.isSafeInteger(given)&&given>0?Math.min(given,1000):200;
const SQL=`
with recent as (
 select match_id,kind,through_minute,count_home,count_away,complete,observed_at
 from app_match_event_coverage
 where provider='zizobet'
 order by observed_at desc,match_id,kind
 limit $1
)
select r.*,
 (select count(*)::int from app_match_event_fact f
  where f.match_id=r.match_id and f.provider='zizobet' and f.kind=r.kind
   and f.active and f.team='home') as incident_home,
 (select count(*)::int from app_match_event_fact f
  where f.match_id=r.match_id and f.provider='zizobet' and f.kind=r.kind
   and f.active and f.team='away') as incident_away
from recent r
order by r.observed_at desc,r.match_id,r.kind
`;
try{
 const {rows}=await query(SQL,[limit]);
 const mismatch=rows.filter(r=>Number(r.incident_home)!==Number(r.count_home)||
   Number(r.incident_away)!==Number(r.count_away));
 const kinds=[...new Set(rows.map(r=>r.kind))];
 console.log(JSON.stringify({
  source:'zizobet',readOnly:true,examined:rows.length,limit,
  kinds,complete:rows.filter(r=>r.complete===true).length,
  mismatches:mismatch.length,
  mismatchFixtures:mismatch.map(r=>({
   matchId:r.match_id,kind:r.kind,provider:[r.count_home,r.count_away],
   acceptedIncidents:[r.incident_home,r.incident_away],
   observedAt:r.observed_at
  })),
  limitations:[
   'No access to events not provided by primary feed',
   'Taken vs awarded corner meaning requires external provider/documented confirmation',
   'This is feed-consistency evidence, not production-payout certification'
  ]
 },null,2));
 if(!rows.length||mismatch.length)process.exitCode=2;
}catch(error){
 console.error('[zizobet incident read-only audit] '+error.message);
 process.exitCode=1;
}finally{
 if(typeof pool.end==='function')await pool.end();
}
