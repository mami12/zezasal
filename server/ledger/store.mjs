/**
 * Ledger data access (users, money, tickets).
 *
 * Money always moves inside a transaction that locks the user row, and every movement
 * writes an app_transaction row carrying the resulting balance - so a balance can be
 * reconstructed from the ledger at any time.
 */
import { query, pool } from '../db.mjs';
import { LEDGER_SQL } from './schema.mjs';
import { getManagerCommissionRates, managerCommissionReport } from './manager-finance.mjs';
import { removePlayer } from './user-removal.mjs';

export async function initLedgerSchema() {
  await query(LEDGER_SQL);
  ledgerReady = true;
}

/**
 * The board does not need the database, but the login/ledger endpoints do. Routes check
 * this so a missing ledger answers 503 with a clear reason instead of a 500 stack trace.
 */
let ledgerReady = false;
export const isLedgerReady = () => ledgerReady;

/** the only columns ever returned to clients - never the password hash */
const USER_COLUMNS = `u.id, u.username, u.role, u.status, u.balance, u.currency,
                      u.manager_id as "managerId", u.agent_id as "agentId", u.financial_epoch as "financialEpoch", u.created_at, u.updated_at`;

export const publicUser = (row) =>
  row
    ? {
        id: row.id,
        username: row.username,
        role: row.role,
        status: row.status,
        balance: Number(row.balance ?? 0),
        currency: row.currency ?? 'LEK',
        managerId: row.managerId ?? row.manager_id ?? null,
        agentId: row.agentId ?? row.agent_id ?? null,
        financialEpoch: Number(row.financialEpoch ?? row.financial_epoch ?? 0),
        manager: row.managerUsername ? { id: row.managerId, username: row.managerUsername } : null,
        _count: row.managedUsers !== undefined ? { managedUsers: Number(row.managedUsers) } : undefined,
        createdAt: row.created_at,
      }
    : null;

export async function findUserByUsername(username) {
  const res = await query('select * from app_user where username = $1 and deleted_at is null', [username]);
  return res.rows[0] ?? null;
}

export async function getUserById(id) {
  const res = await query(`select ${USER_COLUMNS} from app_user u where u.id = $1 and u.deleted_at is null`, [id]);
  return res.rows[0] ? publicUser(res.rows[0]) : null;
}

/** admin: everyone; manager: only the users they own */
export async function listUsers({ managerId = null, limit = 500 } = {}) {
  const res = await query(
    `select ${USER_COLUMNS},
            m.username as "managerUsername",
            (select count(*) from app_user c where c.manager_id = u.id and c.deleted_at is null) as "managedUsers"
       from app_user u
       left join app_user m on m.id = u.manager_id
      where u.deleted_at is null and ($1::uuid is null or u.manager_id = $1::uuid)
      order by u.created_at desc
      limit $2`,
    [managerId, Math.min(Number(limit) || 500, 2000)],
  );
  return res.rows.map(publicUser);
}

export async function createUser({
  username,
  passwordHash,
  role = 'PLAYER',
  status = 'ACTIVE',
  balance = 0,
  currency = 'LEK',
  managerId = null,
}) {
  const res = await query(
    `insert into app_user (username, password_hash, role, status, balance, currency, manager_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [username, passwordHash, role, status, balance, currency, managerId],
  );
  return getUserById(res.rows[0].id);
}

export async function createManagedPlayer({ username, passwordHash, managerId, initialBalance = 0 }) {
  const openingValue = Number(initialBalance);
  const opening = Number(openingValue.toFixed(2));
  if (!Number.isFinite(openingValue) || opening < 0 || (openingValue > 0 && opening === 0)) {
    throw Object.assign(new Error('initial balance must be zero or greater'), { status: 400 });
  }
  const client = await pool.connect();
  let userId;
  try {
    await client.query('begin');
    const manager = await client.query('select balance, role from app_user where id = $1 for update', [managerId]);
    if (!manager.rows.length || manager.rows[0].role !== 'MANAGER') throw new Error('manager account not found');
    const managerBefore = Number(manager.rows[0].balance);
    if (managerBefore < opening) {
      throw Object.assign(new Error('insufficient manager balance'), { status: 400 });
    }
    const created = await client.query(
      `insert into app_user (username, password_hash, role, manager_id)
       values ($1, $2, 'PLAYER', $3) returning id`,
      [username, passwordHash, managerId],
    );
    userId = created.rows[0].id;
    if (opening > 0) {
      const managerAfter = Number((managerBefore - opening).toFixed(2));
      await client.query('update app_user set balance = $2, updated_at = now() where id = $1', [managerId, managerAfter]);
      await client.query(
        `insert into app_transaction (user_id, amount, type, reference_id, balance_after, description)
         values ($1, $2, 'MANAGER_PLAYER_FUNDING', $3, $4, $5)`,
        [managerId, -opening, userId, managerAfter, `Bilanci fillestar për lojtarin ${username}`],
      );
      await client.query(
        `insert into app_transaction (user_id, amount, type, reference_id, balance_after, description)
         values ($1, $2, 'DEPOSIT', $3, $4, $5)`,
        [userId, opening, managerId, opening, 'Bilanci fillestar nga menaxheri'],
      );
      await client.query('update app_user set balance = $2 where id = $1', [userId, opening]);
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return getUserById(userId);
}

/** Transfer player funds through the manager's wallet, atomically. */
export async function moveManagerFunds(managerId, playerId, amount, direction) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw Object.assign(new Error('amount must be a positive number'), { status: 400 });
  }
  if (direction !== 'deposit' && direction !== 'withdraw') throw new Error('invalid transfer direction');
  const delta = Number(amount.toFixed(2));
  if (delta <= 0) throw Object.assign(new Error('amount must be at least 0.01'), { status: 400 });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const rows = await client.query(
      `select id, balance, role, manager_id, deleted_at from app_user
        where id = any($1::uuid[]) order by id for update`,
      [[managerId, playerId]],
    );
    const accounts = new Map(rows.rows.map((row) => [row.id, row]));
    const manager = accounts.get(managerId);
    const player = accounts.get(playerId);
    if (!manager || manager.role !== 'MANAGER') throw Object.assign(new Error('manager account not found'), { status: 404 });
    if (!player || player.deleted_at || player.manager_id !== managerId) throw Object.assign(new Error('player not found'), { status: 404 });

    const managerBefore = Number(manager.balance);
    const playerBefore = Number(player.balance);
    const playerDelta = direction === 'deposit' ? delta : -delta;
    const managerDelta = -playerDelta;
    const managerAfter = Number((managerBefore + managerDelta).toFixed(2));
    const playerAfter = Number((playerBefore + playerDelta).toFixed(2));
    if (direction === 'deposit' && managerAfter < 0) {
      throw Object.assign(new Error('insufficient manager balance'), { status: 400 });
    }
    if (playerAfter < 0) throw Object.assign(new Error('insufficient player balance'), { status: 400 });

    await client.query('update app_user set balance = $2, updated_at = now() where id = $1', [managerId, managerAfter]);
    await client.query('update app_user set balance = $2, updated_at = now() where id = $1', [playerId, playerAfter]);
    const managerTx = await client.query(
      `insert into app_transaction (user_id, amount, type, reference_id, balance_after, description)
       values ($1, $2, $3, $4, $5, $6)
       returning id, amount, type, balance_after as "balanceAfter", description, created_at as "createdAt"`,
      [
        managerId,
        managerDelta,
        direction === 'deposit' ? 'MANAGER_PLAYER_FUNDING' : 'MANAGER_PLAYER_RETURN',
        playerId,
        managerAfter,
        direction === 'deposit' ? `Fonde për lojtarin ${player.username}` : `Fonde të kthyera nga lojtari ${player.username}`,
      ],
    );
    const playerTx = await client.query(
      `insert into app_transaction (user_id, amount, type, reference_id, balance_after, description)
       values ($1, $2, $3, $4, $5, $6)
       returning id, amount, type, balance_after as "balanceAfter", description, created_at as "createdAt"`,
      [
        playerId,
        playerDelta,
        direction === 'deposit' ? 'DEPOSIT' : 'WITHDRAWAL',
        managerId,
        playerAfter,
        direction === 'deposit' ? 'Depozitim nga menaxheri' : 'Tërheqje nga menaxheri',
      ],
    );
    await client.query('commit');
    return {
      manager: await getUserById(managerId),
      user: await getUserById(playerId),
      managerTransaction: managerTx.rows[0],
      playerTransaction: playerTx.rows[0],
    };
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function managerFinancials(managerId = null, {runQuery = query} = {}) {
  const commissionRates = await getManagerCommissionRates(runQuery);
  const commissions = await managerCommissionReport(runQuery);
  const managers = await runQuery(
    `select m.id, m.username, m.balance,
            coalesce(p.player_balance, 0) as player_balance,
            coalesce(t.total_stake, 0) as total_stake,
            coalesce(t.won_payouts, 0) as won_payouts,
            coalesce(t.settled_stake, 0) as settled_stake,
            coalesce(t.lost_stake, 0) as lost_stake,
            coalesce(c.commission, 0) as commission,
            coalesce(t.ticket_count, 0) as ticket_count,
            coalesce(p.player_count, 0) as player_count
       from app_user m
       left join lateral (
         select count(*) filter(where u.deleted_at is null)::int as player_count, coalesce(sum(u.balance), 0) as player_balance
           from app_user u where u.manager_id = m.id
       ) p on true
       left join lateral (
         select coalesce(sum(t.stake) filter (where t.status not in ('REVERTED', 'VOID')), 0) as total_stake,
                coalesce(sum(coalesce((select sum(x.amount) from app_transaction x where x.reference_id=t.id and x.user_id=t.user_id and x.type='BET_WON'),0)) filter (where t.status = 'WON'), 0) as won_payouts,
                coalesce(sum(t.stake) filter (where t.status in ('WON','LOST')),0) as settled_stake,
                coalesce(sum(t.stake) filter (where t.status = 'LOST'), 0) as lost_stake,
                count(distinct coalesce('SYS-'||b.id::text,t.id::text))::int as ticket_count
           from app_ticket t
           left join app_ticket_batch b on b.ticket_ids @> ARRAY[t.id] and t.user_id=b.user_id
           join app_user u on u.id = t.user_id
          where u.manager_id = m.id
       ) t on true
       left join lateral (
         select coalesce(sum(-x.amount), 0) as commission
           from app_transaction x
          where x.user_id = m.id
            and x.type in ('MANAGER_COMMISSION_DEBIT', 'MANAGER_COMMISSION_REFUND')
       ) c on true
      where m.role = 'MANAGER'
        and ($1::uuid is null or m.id = $1::uuid)
      order by m.username`,
    [managerId],
  );
  const summaries = managers.rows.map((row) => {
    const totalStake = Number(row.total_stake ?? 0);
    const wonPayouts = Number(row.won_payouts ?? 0);
    return {
      id: row.id,
      username: row.username,
      balance: Number(row.balance ?? 0),
      playerBalance: Number(row.player_balance ?? 0),
      totalStake,
      wonPayouts,
      lostStake: Number(row.lost_stake ?? 0),
      commission: 0, sportCommission: 0, casinoCommission: 0,
      ...commissions.managers.get(row.id),
      commissionBasis: 'REPORT_ONLY_ON_STAKE',
      commissionRates,
      ticketCount: Number(row.ticket_count ?? 0),
      playerCount: Number(row.player_count ?? 0),
      netDifference: Number((Number(row.settled_stake ?? row.settledStake ?? 0) - wonPayouts).toFixed(2)),
    };
  });
  if (managerId) {
    const playerRows = await runQuery(
      `select u.id, u.username, u.balance,
              coalesce(t.ticket_count, 0) as "ticketCount",
              coalesce(t.total_stake, 0) as "totalStake",
              coalesce(t.won_payouts, 0) as "wonPayouts",
              coalesce(t.settled_stake, 0) as "settledStake",
              coalesce(t.lost_stake, 0) as "lostStake",
              coalesce(c.commission, 0) as commission,
              coalesce(c.single_commission, 0) as single_commission,
              coalesce(c.double_commission, 0) as double_commission,
              coalesce(c.multi_commission, 0) as multi_commission
         from app_user u
         left join lateral (
           select count(distinct coalesce('SYS-'||b.id::text,t.id::text))::int as ticket_count,
                  coalesce(sum(t.stake) filter (where t.status not in ('REVERTED', 'VOID')), 0) as total_stake,
                  coalesce(sum(coalesce((select sum(x.amount) from app_transaction x where x.reference_id=t.id and x.user_id=t.user_id and x.type='BET_WON'),0)) filter (where t.status = 'WON'), 0) as won_payouts,
                  coalesce(sum(t.stake) filter (where t.status in ('WON','LOST')),0) as settled_stake,
                  coalesce(sum(t.stake) filter (where t.status = 'LOST'), 0) as lost_stake
             from app_ticket t left join app_ticket_batch b on b.ticket_ids @> ARRAY[t.id] and t.user_id=b.user_id
             where t.user_id = u.id
         ) t on true
         left join lateral (
           select coalesce(sum(-x.amount), 0) as commission,
                  coalesce(sum(-x.amount) filter (where line_count.selection_count = 1), 0) as single_commission,
                  coalesce(sum(-x.amount) filter (where line_count.selection_count = 2), 0) as double_commission,
                  coalesce(sum(-x.amount) filter (where line_count.selection_count >= 3), 0) as multi_commission
             from app_transaction x
             join app_ticket ticket on ticket.id = x.reference_id
             join lateral (
               select count(*)::int as selection_count
                 from app_ticket_line line
                where line.ticket_id = ticket.id
             ) line_count on true
            where ticket.user_id = u.id
              and x.user_id = $1
              and x.type in ('MANAGER_COMMISSION_DEBIT', 'MANAGER_COMMISSION_REFUND')
         ) c on true
        where u.manager_id = $1
        order by u.username`,
      [managerId],
    );
    return {
      manager: summaries[0] ?? null,
      players: playerRows.rows.map((row) => {
        const totalStake = Number(row.totalStake ?? 0);
        const wonPayouts = Number(row.wonPayouts ?? 0);
        return {
          id: row.id,
          username: row.username,
          balance: Number(row.balance ?? 0),
          ticketCount: Number(row.ticketCount ?? 0),
          totalStake,
          wonPayouts,
          lostStake: Number(row.lostStake ?? 0),
          commission: 0,
          commissionByTier: { single: 0, double: 0, multi: 0 },
          sportCommission: 0, casinoCommission: 0,
          ...commissions.players.get(row.id),
          commissionRates,
          netDifference: Number((Number(row.settledStake ?? 0) - wonPayouts).toFixed(2)),
        };
      }),
    };
  }
  return summaries;
}

const EDITABLE = { role: 'role', status: 'status', currency: 'currency', managerId: 'manager_id' };

export async function updateUser(id, fields = {}) {
  const sets = [];
  const values = [id];
  for (const [key, column] of Object.entries(EDITABLE)) {
    if (fields[key] !== undefined) {
      values.push(fields[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  if (!sets.length) return getUserById(id);
  sets.push('updated_at = now()');
  await query(`update app_user set ${sets.join(', ')} where id = $1 and deleted_at is null`, values);
  return getUserById(id);
}

export const deleteUser = (id, actor) => removePlayer(id, actor);

/**
 * Moves money and records it. `delta` may be negative (withdrawal, stake).
 * Returns { user, transaction }; throws when the balance would go negative.
 */
export async function moveMoney(userId, delta, { type = 'ADJUSTMENT', description = null, referenceId = null, allowNegative = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const locked = await client.query('select balance, deleted_at from app_user where id = $1 for update', [userId]);
    if (!locked.rows.length) throw new Error('user not found');

    const before = Number(locked.rows[0].balance);
    const amount = Number(delta);
    if (locked.rows[0].deleted_at && amount > 0) throw Object.assign(new Error('Llogaria e fshirë nuk pranon depozita.'), { status: 409 });
    if (!Number.isFinite(amount) || amount === 0) throw new Error('amount must be a non-zero number');

    const after = Number((before + amount).toFixed(2));
    if (after < 0 && !allowNegative) {
      const err = new Error('insufficient balance');
      err.status = 400;
      throw err;
    }

    const tx = await client.query(
      `insert into app_transaction (user_id, amount, type, reference_id, balance_after, description)
       values ($1, $2, $3, $4, $5, $6)
       returning id, amount, type, balance_after as "balanceAfter", description, created_at as "createdAt"`,
      [userId, amount, type, referenceId, after, description],
    );
    await client.query('update app_user set balance = $2, updated_at = now() where id = $1', [userId, after]);
    await client.query('commit');

    return { user: await getUserById(userId), transaction: tx.rows[0] };
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const transactionDate = (value, label) => {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? `${value}${label === 'to' ? 'T23:59:59.999' : 'T00:00:00.000'}Z`
    : value;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) {
    throw Object.assign(new Error(`${label} must be a valid date`), { status: 400 });
  }
  return date.toISOString();
};

function transactionDateConditions(from, to) {
  const start = transactionDate(from, 'from');
  const end = transactionDate(to, 'to');
  if (start && end && new Date(start) > new Date(end)) {
    throw Object.assign(new Error('from must be earlier than or equal to to'), { status: 400 });
  }
  return { start, end };
}

export async function listTransactions({ role = 'PLAYER', userId = null, from = null, to = null, limit = 100 } = {}, {runQuery = query} = {}) {
  const { start, end } = transactionDateConditions(from, to);
  const params = [];
  const conditions = [];
  if (role === 'PLAYER') {
    params.push(userId);
    conditions.push(`tx.user_id = $${params.length}`);
  } else if (role === 'MANAGER') {
    params.push(userId);
    conditions.push(`(tx.user_id = $${params.length} or u.manager_id = $${params.length})`);
  }
  if (start) {
    params.push(start);
    conditions.push(`tx.created_at >= $${params.length}::timestamptz`);
  }
  if (end) {
    params.push(end);
    conditions.push(`tx.created_at <= $${params.length}::timestamptz`);
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
  const res = await runQuery(
    `with source as (
      select tx.*,u.username,u.role as user_role,b.id as batch_id
       from app_transaction tx
       join app_user u on u.id = tx.user_id
       left join app_ticket_batch b on b.ticket_ids @> ARRAY[tx.reference_id]
       ${where}
    ), visible as (
      select id::text,user_id,username,user_role,amount,type,
        coalesce('SYS-'||batch_id::text,reference_id::text) as reference_id,
        balance_after,description,created_at,
        case when batch_id is not null then 'SYS-'||batch_id::text end as system_ticket_id,
        jsonb_build_array(id::text) as raw_transaction_ids
      from source where type<>'BET_PLACED' or batch_id is null
      union all
      select 'SYS-'||batch_id::text||':BET_PLACED',user_id,username,user_role,sum(amount),'BET_PLACED',
        'SYS-'||batch_id::text,min(balance_after),'Sistem - '||count(*)::text||' kolona - shuma totale',min(created_at),
        'SYS-'||batch_id::text,jsonb_agg(id::text order by created_at,id)
      from source where type='BET_PLACED' and batch_id is not null
      group by batch_id,user_id,username,user_role
    ) select id,user_id as "userId",username,user_role as "userRole",amount,type,
      reference_id as "referenceId",balance_after as "balanceAfter",description,created_at as "createdAt",
      system_ticket_id as "systemTicketId",raw_transaction_ids as "rawTransactionIds"
      from visible order by created_at desc,id desc limit $${params.length}`,
    params,
  );
  return res.rows.map((row) => ({ ...row, amount: Number(row.amount), balanceAfter: Number(row.balanceAfter) }));
}

export async function playerTransactionSummary({ userId, from = null, to = null } = {}) {
  const { start, end } = transactionDateConditions(from, to);
  const params = [userId];
  const conditions = [
    'user_id = $1',
    "status in ('WON', 'LOST')",
    'settled_at is not null',
  ];
  if (start) {
    params.push(start);
    conditions.push(`settled_at >= $${params.length}::timestamptz`);
  }
  if (end) {
    params.push(end);
    conditions.push(`settled_at <= $${params.length}::timestamptz`);
  }
  const result = await query(
    `select coalesce(sum(greatest(potential_payout - stake, 0)) filter (where status = 'WON'), 0) as winnings,
            coalesce(sum(stake) filter (where status = 'LOST'), 0)
              + coalesce(sum(greatest(stake - potential_payout, 0)) filter (where status = 'WON'), 0) as losses
       from app_ticket
      where ${conditions.join(' and ')}`,
    params,
  );
  const winnings = Number(result.rows[0]?.winnings ?? 0);
  const losses = Number(result.rows[0]?.losses ?? 0);
  return { winnings, losses, net: Number((winnings - losses).toFixed(2)) };
}

export async function listAdminAudit({ from = null, to = null, actorId = null, limit = 200 } = {}) {
  const { start, end } = transactionDateConditions(from, to);
  const params = [];
  const conditions = [];
  if (start) {
    params.push(start);
    conditions.push(`created_at >= $${params.length}::timestamptz`);
  }
  if (end) {
    params.push(end);
    conditions.push(`created_at <= $${params.length}::timestamptz`);
  }
  if (actorId) {
    params.push(actorId);
    conditions.push(`actor_id = $${params.length}`);
  }
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 500));
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
  const result = await query(
    `select id, actor_id as "actorId", actor_name as "actorName", actor_role as "actorRole",
            action, target_type as "targetType", target_id as "targetId", details,
            created_at as "createdAt"
       from app_admin_audit ${where}
      order by created_at desc limit $${params.length}`,
    params,
  );
  return result.rows;
}

/** headline numbers for the admin/manager dashboards */
export async function ledgerStats(managerId = null, {runQuery = query} = {}) {
  const res = await runQuery(
    `select
        count(*) filter(where deleted_at is null)::int as users,
        count(*) filter (where role = 'PLAYER' and deleted_at is null)::int as players,
        count(*) filter (where status <> 'ACTIVE' and deleted_at is null)::int as blocked,
        coalesce(sum(balance), 0)                        as balance
       from app_user
      where ($1::uuid is null or manager_id = $1::uuid)`,
    [managerId],
  );
  const tickets = await runQuery(
    `select count(distinct coalesce('SYS-'||b.id::text,t.id::text))::int as total,
            count(distinct coalesce('SYS-'||b.id::text,t.id::text)) filter (where t.status = 'PENDING')::int as pending,
            coalesce(sum(t.stake) filter (where t.status = 'PENDING'), 0) as pending_stake
       from app_ticket t
       left join app_ticket_batch b on b.ticket_ids @> ARRAY[t.id] and t.user_id=b.user_id
      where ($1::uuid is null or t.user_id in (select id from app_user where manager_id = $1::uuid))`,
    [managerId],
  );
  const u = res.rows[0] ?? {};
  const t = tickets.rows[0] ?? {};
  return {
    users: u.users ?? 0,
    players: u.players ?? 0,
    blocked: u.blocked ?? 0,
    totalBalance: Number(u.balance ?? 0),
    tickets: t.total ?? 0,
    pendingTickets: t.pending ?? 0,
    pendingStake: Number(t.pending_stake ?? 0),
  };
}
