import { pool, query } from '../db.mjs';
import { assertBetWithinLimits, planLimitChanges } from './player-control-policy.mjs';

const SELF_EXCLUSION_DAYS = new Set([1, 7, 30, 180, 365]);
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

function publicControls(row = {}) {
  return {
    dailyLimit: row.daily_limit === null || row.daily_limit === undefined ? null : Number(row.daily_limit),
    weeklyLimit: row.weekly_limit === null || row.weekly_limit === undefined ? null : Number(row.weekly_limit),
    monthlyLimit: row.monthly_limit === null || row.monthly_limit === undefined ? null : Number(row.monthly_limit),
    pendingLimits: row.pending_limits ?? null,
    limitsEffectiveAt: row.limits_effective_at ?? null,
    selfExcludedUntil: row.self_excluded_until ?? null,
  };
}

async function applyMaturePendingLimits(executor, userId) {
  const runQuery = typeof executor === 'function' ? executor : executor.query.bind(executor);
  await runQuery(
    `update app_player_controls
        set daily_limit = case when pending_limits ? 'dailyLimit' then nullif(pending_limits->>'dailyLimit', '')::numeric else daily_limit end,
            weekly_limit = case when pending_limits ? 'weeklyLimit' then nullif(pending_limits->>'weeklyLimit', '')::numeric else weekly_limit end,
            monthly_limit = case when pending_limits ? 'monthlyLimit' then nullif(pending_limits->>'monthlyLimit', '')::numeric else monthly_limit end,
            pending_limits = null,
            limits_effective_at = null,
            updated_at = now()
      where user_id = $1 and limits_effective_at <= now()`,
    [userId],
  );
}

export async function getPlayerControls(userId) {
  await applyMaturePendingLimits(query, userId);
  const result = await query('select * from app_player_controls where user_id = $1', [userId]);
  return publicControls(result.rows[0]);
}

export async function updatePlayerLimits(userId, requested) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('insert into app_player_controls (user_id) values ($1) on conflict (user_id) do nothing', [userId]);
    await client.query('select user_id from app_player_controls where user_id = $1 for update', [userId]);
    await applyMaturePendingLimits(client, userId);
    const result = await client.query('select * from app_player_controls where user_id = $1', [userId]);
    const current = publicControls(result.rows[0]);
    const { pending, pendingFields, immediate, effectiveAt } = planLimitChanges(current, requested);
    const updated = await client.query(
      `update app_player_controls
          set daily_limit = case when $2::boolean then $3::numeric else daily_limit end,
              weekly_limit = case when $4::boolean then $5::numeric else weekly_limit end,
              monthly_limit = case when $6::boolean then $7::numeric else monthly_limit end,
              pending_limits = $8::jsonb,
              limits_effective_at = $9,
              updated_at = now()
        where user_id = $1 returning *`,
      [
        userId,
        Object.prototype.hasOwnProperty.call(immediate, 'dailyLimit'), immediate.dailyLimit ?? null,
        Object.prototype.hasOwnProperty.call(immediate, 'weeklyLimit'), immediate.weeklyLimit ?? null,
        Object.prototype.hasOwnProperty.call(immediate, 'monthlyLimit'), immediate.monthlyLimit ?? null,
        pendingFields.length ? JSON.stringify(pending) : null,
        effectiveAt,
      ],
    );
    await client.query('commit');
    return publicControls(updated.rows[0]);
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function requestSelfExclusion(userId, days) {
  const duration = Number(days);
  if (!SELF_EXCLUSION_DAYS.has(duration)) {
    throw badRequest('Self-exclusion duration must be 1, 7, 30, 180 or 365 days');
  }
  await query(
    `insert into app_player_controls (user_id, self_excluded_until)
     values ($1, now() + ($2::text || ' days')::interval)
     on conflict (user_id) do update
       set self_excluded_until = greatest(coalesce(app_player_controls.self_excluded_until, now()),
                                           now()) + ($2::text || ' days')::interval,
           updated_at = now()`,
    [userId, duration],
  );
  return getPlayerControls(userId);
}

export async function assertPlayerCanBet(client, userId, stake) {
  await applyMaturePendingLimits(client, userId);
  const result = await client.query('select * from app_player_controls where user_id = $1 for update', [userId]);
  const controls = publicControls(result.rows[0]);
  // Most players have no period caps. Keep exclusion and mature-limit checks,
  // but avoid scanning their transaction history on every casino spin.
  if ([controls.dailyLimit, controls.weeklyLimit, controls.monthlyLimit].every(limit => limit === null)) {
    assertBetWithinLimits({ stake, controls, used: {} });
    return;
  }
  // A week can begin in the previous month; retain both periods using the
  // database timezone, just like the individual totals below.
  const usage = await client.query(
    `select
       coalesce(sum(-amount) filter (where created_at >= date_trunc('day', now())), 0) as daily_used,
       coalesce(sum(-amount) filter (where created_at >= date_trunc('week', now())), 0) as weekly_used,
       coalesce(sum(-amount) filter (where created_at >= date_trunc('month', now())), 0) as monthly_used
     from app_transaction
     where user_id = $1 and type in ('BET_PLACED','CASINO_SPIN') and amount < 0
       and created_at >= least(date_trunc('week', now()), date_trunc('month', now()))`,
    [userId],
  );
  const used = usage.rows[0] ?? {};
  assertBetWithinLimits({ stake, controls, used: used });
}
