import {query} from '../db.mjs';
import {parseTeamGoalMarket} from './live-contract-rules.mjs';

/** Previous releases stored some ordinary home/away goal totals without a
 * frozen live contract. These totals do not depend on an acceptance-time goal
 * baseline, so their original market, line and choice can be recovered safely.
 *
 * Do not backfill Next Goal or Race to X: those require the exact snapshot at
 * acceptance and must never be guessed from the latest score.
 */
export async function backfillPendingTeamGoalContracts({runQuery=query,limit=250}={}){
 const cap=Math.max(1,Math.min(1000,Math.trunc(Number(limit)||250)));
 const {rows}=await runQuery(`select l.id,l.market_name,l.line,l.outcome_name,l.outcome_key
  from app_ticket_line l join app_ticket t on t.id=l.ticket_id
  where l.status='PENDING' and t.status='PENDING' and l.live_contract is null
    and lower(l.market_name) like '%team%' and lower(l.market_name) like '%total%'
    and not exists(select 1 from app_settlement_override o where o.line_id=l.id)
  order by t.placed_at,l.id limit $1`,[cap]);
 let filled=0;
 for(const line of rows){
  const contract=parseTeamGoalMarket(line);
  if(!contract)continue;
  const updated=await runQuery(`update app_ticket_line set live_contract=$2::jsonb
    where id=$1 and status='PENDING' and live_contract is null
      and exists(select 1 from app_ticket t
                 where t.id=app_ticket_line.ticket_id and t.status='PENDING')`,
    [line.id,JSON.stringify(contract)]);
  filled+=updated.rowCount??0;
 }
 return {examined:rows.length,filled};
}
