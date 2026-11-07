import { query } from '../db.mjs';
import { getCounts } from '../matches.mjs';

/** Aggregated operational information only. The existing admin screens own details and actions. */
export async function stitchOverview({ runQuery = query, getMatchCounts = getCounts } = {}) {
  const [accountResult, ticketResult, transactionResult, matches] = await Promise.all([
    runQuery(`select count(*) filter (where role='PLAYER') as player,
      count(*) filter (where role='MANAGER') as manager,
      count(*) filter (where role='AGENT') as agent,
      count(*) filter (where role='ADMIN') as admin
      from app_user where deleted_at is null`),
    runQuery(`select count(*) as total,
      count(*) filter (where status='PENDING') as pending,
      count(*) filter (where status='WON') as won,
      count(*) filter (where status='LOST') as lost,
      count(*) filter (where status='VOID') as void,
      coalesce(sum(stake) filter (where status='PENDING'),0) as open_stake,
      coalesce(sum(stake) filter (where status in ('WON','LOST')),0) as settled_stake,
      coalesce(sum(potential_payout) filter (where status='WON'),0) as paid_out
      from app_ticket`),
    runQuery(`select count(*) as total,
      count(*) filter (where type in
        ('BET_PLACED','BET_WON','BET_REFUND','TICKET_REVERT','MANUAL_SETTLEMENT_CORRECTION')) as sport
      from app_transaction`),
    getMatchCounts(),
  ]);
  const accounts = accountResult.rows[0];
  const tickets = ticketResult.rows[0];
  const transactions = transactionResult.rows[0];
  const settledStake = Number(tickets.settled_stake);
  const paidOut = Number(tickets.paid_out);
  return {
    database: 'ready',
    accounts: {
      player: Number(accounts.player),
      manager: Number(accounts.manager),
      agent: Number(accounts.agent),
      admin: Number(accounts.admin),
    },
    tickets: {
      total: Number(tickets.total),
      pending: Number(tickets.pending),
      won: Number(tickets.won),
      lost: Number(tickets.lost),
      void: Number(tickets.void),
      openStake: Number(tickets.open_stake),
      settledStake,
      paidOut,
      netBeforeCommission: Number((settledStake - paidOut).toFixed(2)),
    },
    matches: { live: matches.live, prematch: matches.prematch, finished: matches.finished, updatedAt: matches.updatedAt },
    transactions: { sport: Number(transactions.sport), total: Number(transactions.total) },
  };
}
