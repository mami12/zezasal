import { moneyCents } from './system-columns.mjs';

export const DEFAULT_COMMISSION_RATES = Object.freeze({ single: 3, double: 5, multi: 7, casino: 0 });

export async function getManagerCommissionRates(executor) {
  const runQuery = typeof executor === 'function' ? executor : executor.query.bind(executor);
  const result = await runQuery(
    `select single_pct as single, double_pct as double, multi_pct as multi, casino_pct as casino
       from app_commission_config where id = 1`,
  );
  const row = result.rows[0];
  if (!row) return { ...DEFAULT_COMMISSION_RATES };
  return {
    single: Number(row.single),
    double: Number(row.double),
    multi: Number(row.multi),
    casino: Number(row.casino ?? 0),
  };
}

export function managerCommissionRate(selectionCount, rates = DEFAULT_COMMISSION_RATES) {
  const tier = selectionCount <= 1 ? 'single' : selectionCount === 2 ? 'double' : 'multi';
  return Number(rates[tier]) / 100;
}

export function managerCommission(stake, selectionCount, rates = DEFAULT_COMMISSION_RATES) {
  const tier = selectionCount <= 1 ? 'single' : selectionCount === 2 ? 'double' : 'multi';
  // Rates are persisted to two decimals. Round the actual column stake once,
  // using decimal half-up arithmetic (25.10 * 5% is 1.26, never 1.25).
  const stakeCents = BigInt(moneyCents(stake));
  const rateHundredths = BigInt(moneyCents(rates[tier]));
  return Number((stakeCents * rateHundredths + 5000n) / 10000n) / 100;
}

export function managerCommissionPercent(selectionCount, rates = DEFAULT_COMMISSION_RATES) {
  const tier = selectionCount <= 1 ? 'single' : selectionCount === 2 ? 'double' : 'multi';
  return Number(rates[tier]);
}

/** Freeze commission for reporting only. No manager wallet or ledger mutation. */
export async function chargeManagerCommission(client, { managerId, ticketId, stake, selectionCount }) {
  if (!managerId) return 0;
  const saved=await client.query('select amount from app_manager_commission where ticket_id=$1',[ticketId]);
  if(saved.rows.length) return Number(saved.rows[0].amount);
  // Old debits stay intact; never charge or book an old ticket a second time.
  const historical=await client.query(`select -sum(amount) as amount from app_transaction
    where reference_id=$1 and type in ('MANAGER_COMMISSION_DEBIT','MANAGER_COMMISSION_REFUND')`,[ticketId]);
  if(historical.rows[0]?.amount!=null) return Number(historical.rows[0].amount);
  const rates=await getManagerCommissionRates(client);
  const commission=managerCommission(stake,selectionCount,rates);
  const inserted=await client.query(`insert into app_manager_commission(manager_id,player_id,kind,ticket_id,stake,selection_count,rate_pct,amount)
    select $1,user_id,'SPORT',id,$3,$4,$5,$6 from app_ticket where id=$2 and user_id is not null
    on conflict(ticket_id) do nothing returning amount`,
    [managerId,ticketId,stake,selectionCount,managerCommissionPercent(selectionCount,rates),commission]);
  if(inserted.rows.length) return Number(inserted.rows[0].amount);
  return Number((await client.query('select amount from app_manager_commission where ticket_id=$1',[ticketId])).rows[0]?.amount||0);
}

/** Separate informational totals; no transfers or account credits are performed. */
export async function managerCommissionReport(executor) {
  const run=typeof executor==='function'?executor:executor.query.bind(executor);
  const result=await run(`select c.manager_id,c.player_id,c.kind,c.selection_count,sum(c.amount) as amount
    from app_manager_commission c left join app_ticket t on t.id=c.ticket_id
    where c.kind='CASINO' or t.status in ('PENDING','WON','LOST')
    group by c.manager_id,c.player_id,c.kind,c.selection_count
    union all
    select x.user_id,t.user_id,'SPORT',
      (select count(*)::int from app_ticket_line l where l.ticket_id=t.id),sum(-x.amount)
    from app_transaction x join app_ticket t on t.id=x.reference_id
    where x.type in ('MANAGER_COMMISSION_DEBIT','MANAGER_COMMISSION_REFUND') and t.status in ('PENDING','WON','LOST')
      and not exists(select 1 from app_manager_commission c where c.ticket_id=t.id)
    group by x.user_id,t.user_id,t.id`);
  const managers=new Map(),players=new Map();
  const add=(map,id,row)=>{
    if(!id)return;const totals=map.get(id)||{sportCommission:0,casinoCommission:0,commissionByTier:{single:0,double:0,multi:0}};
    const amount=Number(row.amount||0);
    if(row.kind==='CASINO')totals.casinoCommission+=amount;
    else {totals.sportCommission+=amount;const tier=Number(row.selection_count)<=1?'single':Number(row.selection_count)===2?'double':'multi';totals.commissionByTier[tier]+=amount;}
    map.set(id,totals);
  };
  for(const row of result.rows){add(managers,row.manager_id,row);add(players,row.player_id,row);}
  for(const map of [managers,players])for(const total of map.values()){
    total.sportCommission=Number(total.sportCommission.toFixed(2));total.casinoCommission=Number(total.casinoCommission.toFixed(2));
    total.commission=Number((total.sportCommission+total.casinoCommission).toFixed(2));
    for(const key of Object.keys(total.commissionByTier))total.commissionByTier[key]=Number(total.commissionByTier[key].toFixed(2));
  }
  return {managers,players};
}

/** Reverses a charged commission once when a ticket is voided or reverted. */
export async function refundManagerCommission(client, { managerId, ticketId, username }) {
  if (!managerId) return 0;

  const transactions = await client.query(
    `select type, amount from app_transaction
      where user_id = $1 and reference_id = $2
        and type in ('MANAGER_COMMISSION_DEBIT', 'MANAGER_COMMISSION_REFUND')`,
    [managerId, ticketId],
  );
  const debit = transactions.rows.find((transaction) => transaction.type === 'MANAGER_COMMISSION_DEBIT');
  const alreadyRefunded = transactions.rows.some((transaction) => transaction.type === 'MANAGER_COMMISSION_REFUND');
  if (!debit || alreadyRefunded) return 0;

  const commission = Number(-debit.amount);
  if (commission <= 0) return 0;

  const manager = await client.query('select balance from app_user where id = $1 for update', [managerId]);
  if (!manager.rows.length) throw new Error(`Manager account ${managerId} not found while refunding ticket commission`);
  const balanceAfter = Number((Number(manager.rows[0].balance) + commission).toFixed(2));
  await client.query('update app_user set balance = $2, updated_at = now() where id = $1', [managerId, balanceAfter]);
  await client.query(
    `insert into app_transaction (user_id, amount, type, reference_id, balance_after, description)
     values ($1, $2, 'MANAGER_COMMISSION_REFUND', $3, $4, $5)`,
    [managerId, commission, ticketId, balanceAfter, `Kthim komisioni për biletën e anuluar të lojtarit ${username}`],
  );
  return commission;
}
