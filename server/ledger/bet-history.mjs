/**
 * The user's actual bet history, separate from financial transactions.
 * REJECTED attempts are not tickets and never debit a wallet.
 */
import { query } from '../db.mjs';
import { listLogicalTickets } from './bets.mjs';

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PLAYER_BET_STATUSES = Object.freeze({
  ALL: null,
  WON: ['WON'],
  LOST: ['LOST'],
  PENDING: ['PENDING'],
  CANCELLED: ['CANCELLED', 'REVERTED', 'VOID'],
  REJECTED: [],
});

export function playerBetStatuses(filter) {
  const key = String(filter ?? 'ALL').trim().toUpperCase();
  if (!Object.hasOwn(PLAYER_BET_STATUSES, key)) fail('Filtër i pavlefshëm i basteve.');
  return { key, statuses: PLAYER_BET_STATUSES[key] };
}

function validHistoryDate(value, field) {
  if (value == null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) fail('Datë e pavlefshme: ' + field);
  return date.toISOString();
}

const TICKET_COLUMNS = 't.id, t.booking_code, t.user_id, t.stake, t.total_odds, t.potential_payout, t.original_potential_payout, t.potential_quote_reconstructed, ' +
  't.ticket_type, t.system_type, t.status, t.placed_at, t.settled_at';

export async function listPlayerBetActivity({ userId, status = 'ALL', from = null, to = null, limit = 200 } = {}, {runQuery = query} = {}) {
  const { key, statuses } = playerBetStatuses(status);
  const start = validHistoryDate(from, 'nga');
  const end = validHistoryDate(to, 'deri');
  if (start && end && start > end) fail('Intervali i datave është i pavlefshëm.');
  const max = Math.max(1, Math.min(Number(limit) || 200, 500));

  const dateConditions = (alias, field, params) => {
    const parts = [];
    if (start) {
      params.push(start);
      parts.push(alias + '.' + field + ' >= $' + params.length + '::timestamptz');
    }
    if (end) {
      params.push(end);
      parts.push(alias + '.' + field + ' <= $' + params.length + '::timestamptz');
    }
    return parts;
  };

  let tickets = [];
  if (key !== 'REJECTED') {
    tickets = (await listLogicalTickets({userId,statuses,from:start,to:end,limit:max},{runQuery}))
      .map(ticket => ({ ...ticket, kind: 'TICKET' }));
  }

  let rejected = [];
  if (key === 'ALL' || key === 'REJECTED') {
    const params = [userId];
    const conditions = ['r.user_id = $1', ...dateConditions('r', 'created_at', params)];
    params.push(max);
    const { rows } = await runQuery(
      'select r.id, r.stake, r.selection_count, r.reason, r.created_at from app_bet_rejection r where ' +
      conditions.join(' and ') + ' order by r.created_at desc, r.id desc limit $' + params.length,
      params,
    );
    rejected = rows.map(r => ({
      kind: 'REJECTED', id: r.id, status: 'REJECTED',
      stake: r.stake == null ? null : Number(r.stake),
      selectionCount: r.selection_count, reason: r.reason, placedAt: r.created_at,
    }));
  }

  // Filters operate in SQL before LIMIT; 500 recent PENDING bets cannot hide
  // older WON/LOST selections. "ALL" merges both collections chronologically.
  return [...tickets, ...rejected]
    .sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime())
    .slice(0, max);
}

/** Only definite 4xx placement rejections are recorded. No ticket, no charge. */
export async function recordRejectedBet({ userId, requestId, stake, selectionCount, reason } = {}) {
  if (!userId) return;
  const rawStake = Number(stake);
  const storedStake = stake != null && Number.isFinite(rawStake) && rawStake >= 0 && rawStake <= 1e9
    ? rawStake : null;
  const id = requestIdPattern.test(String(requestId ?? '')) ? String(requestId).toLowerCase() : null;
  const count = Math.min(1000, Math.max(0, Math.trunc(Number(selectionCount) || 0)));
  await query(
    'insert into app_bet_rejection (user_id, client_request_id, stake, selection_count, reason) ' +
    'values ($1, $2::uuid, $3, $4, $5) ' +
    'on conflict (user_id, client_request_id) where client_request_id is not null do nothing',
    [userId, id, storedStake, count, String(reason ?? 'Kërkesa u refuzua.').slice(0, 300)],
  );
}
