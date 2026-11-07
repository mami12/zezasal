/** Narrow, read-only inspection by the public codes supplied by the operator. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function inspectTickets({codes,runQuery}) {
  if(!Array.isArray(codes)||!codes.length||codes.length>50||codes.some(code=>!/^(?:SYS-)?[a-f0-9]{4,32}$/i.test(code)))throw Error('Supply 1–50 valid public ticket codes.');
  const plain=codes.filter(code=>!/^SYS-/i.test(code)).map(code=>code.toLowerCase());
  const systems=codes.filter(code=>/^SYS-/i.test(code)).map(code=>code.slice(4).toLowerCase());
  const {rows}=await runQuery(`select t.id,t.status as ticket_status,t.placed_at,
      l.match_id,l.match_name,l.market_name,l.outcome_name,l.status as line_status,l.builder_legs,
      to_jsonb(r) as result
    from app_ticket t join app_ticket_line l on l.ticket_id=t.id
    left join app_match_result r on r.match_id=l.match_id
    where exists(select 1 from unnest($1::text[]) prefix where replace(t.id::text,'-','') like prefix||'%')
      or t.id in(select unnest(b.ticket_ids) from app_ticket_batch b
        where exists(select 1 from unnest($2::text[]) prefix where replace(b.id::text,'-','') like prefix||'%'))
    order by t.placed_at,t.id,l.match_id,l.id`,[plain,systems]);
  return rows;
}
async function cli(){
  const codes=process.argv.slice(2);
  if(!codes.length||codes.includes('--help')){console.log('node scripts/diagnose-tickets.mjs ABCDEF12 1234ABCD SYS-ABCD\nRead only. Prints stored final-result evidence; never changes tickets or balances.');return;}
  const {pool}=await import('../server/db.mjs');
  const {hasRequiredSettlementEvidence}=await import('../server/ledger/settler.mjs');
  let client;
  try {
    client=await pool.connect();await client.query('begin read only');
    const rows=await inspectTickets({codes,runQuery:client.query.bind(client)});
    if(!rows.length)console.log('No tickets matched these codes in this database.');
    for(const row of rows){
      const reason=row.ticket_status!=='PENDING'?'TICKET_CLOSED':row.line_status!=='PENDING'?'LINE_GRADED_CHECK_OTHER_LEGS_OR_PAYMENT':!row.result?'FINAL_RESULT_MISSING':!hasRequiredSettlementEvidence(row,row.result)?'MARKET_STATISTICS_MISSING':'RESULT_READY_FOR_SETTLEMENT';
      console.log(JSON.stringify({ticket:row.id.replaceAll('-','').slice(0,8).toUpperCase(),status:row.ticket_status,
        matchId:row.match_id,match:row.match_name,market:row.market_name,selection:row.outcome_name,
        lineStatus:row.line_status,reason,confirmedFinal:row.result?`${row.result.home_score}-${row.result.away_score}`:null}));
    }
    await client.query('rollback');
  } finally {client?.release();await pool.end();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)cli().catch(()=>{
  console.error('Read-only diagnosis could not finish. Check the configured database. A local database must be inspected while its server is stopped.');process.exitCode=1;
});
