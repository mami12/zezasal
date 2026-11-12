/**
 * Admin and manager panels.
 *
 * Same endpoints the UI already calls, with the original behaviour: admins see everything,
 * a manager only ever sees the players they own. Match control is implemented as overrides
 * (see overrides.mjs) because the feed would otherwise overwrite any edit on the next frame.
 */
import express from 'express';
import { requireAuth, hashPassword } from './auth.mjs';
import {assertAccountPassword} from './account-password-policy.mjs';
import * as ledger from './store.mjs';
import * as bets from './bets.mjs';
import * as overrides from './overrides.mjs';
import { settleMatch, settleAll } from './settler.mjs';
import { recentResults, storeResult, pendingSettlementReview } from './results.mjs';
import { query } from '../db.mjs';
import { getMatches as getMatchRows, getMatchById as getMatchRow, boostMatch } from '../matches.mjs';
import { withOdds, serializeMatch } from '../collector.mjs';
import { toClientMatch, toClientMatches } from './view.mjs';
import { marketCategories, MARKET_CATEGORY_IDS } from '../market-catalog.mjs';

export const adminRouter = express.Router();

const guard = (fn) => (req, res, next) => {
  const sendJson = res.json.bind(res);
  return Promise.resolve().then(async () => {
    let queued = false;
    let body;
    res.json = (value) => {
      queued = true;
      body = value;
      return res;
    };
    await fn(req, res, next);
    if (!queued) return;

    const mutatingRequest = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) ||
      (req.method === 'GET' && req.path === '/admin/settlement');
    if (res.statusCode < 400 && mutatingRequest &&
        ['ADMIN', 'MANAGER'].includes(req.user?.role)) {
      try {
        const target = req.path.match(/\/(users|matches|markets|outcomes|tickets)\/([^/]+)/);
        const safeKeys = ['username', 'role', 'managerId', 'initialBalance', 'amount', 'status', 'isSuspended', 'odds', 'price', 'homeScore', 'awayScore', 'country', 'competitionId', 'category', 'suspended', 'hidden'];
        const input = Object.fromEntries(
          safeKeys.filter((key) => req.body?.[key] !== undefined).map((key) => [key, req.body[key]]),
        );
        const targetId = target?.[2] ?? body?.id ?? null;
        const targetType = target
          ? ({ users: 'user', matches: 'match', markets: 'market', outcomes: 'outcome', tickets: 'ticket' })[target[1]]
          : req.path.includes('commission') ? 'settings' : 'system';
        await query(
          `insert into app_admin_audit
             (actor_id, actor_name, actor_role, action, target_type, target_id, details)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            req.user.id,
            req.user.username,
            req.user.role,
            `${req.method} ${req.path}`,
            targetType,
            targetId ? String(targetId) : null,
            JSON.stringify({ input }),
          ],
        );
      } catch (error) {
        console.error('[admin audit] failed to persist action', req.method, req.path, '-', error?.message);
        res.status(500);
        return sendJson({
          message: 'Veprimi u krye, por regjistri i auditimit nuk u ruajt. Kontakto administratorin.',
          error: 'audit log write failed',
        });
      }
    }
    return sendJson(body);
  }).catch((e) => {
    const status = Number(e?.status) >= 400 && Number(e?.status) < 600 ? Number(e.status) : 500;
    if (status >= 500) console.error('[app api]', req.method, req.originalUrl, '-', e?.message);
    res.json = sendJson;
    res.status(status);
    sendJson({ message: e?.message ?? 'error', error: e?.message ?? 'error' });
  });
};

const requireLedger = (req, res, next) =>
  ledger.isLedgerReady() ? next() : res.status(503).json({ message: 'ledger database unavailable' });

const deny = (res, what) => res.status(403).json({ message: `${what} only` });
const normalizedCompetitionPart = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

/** admin-only routes */
const admin = [
  requireLedger,
  requireAuth,
  (req, res, next) => (req.user?.role === 'ADMIN' ? next() : deny(res, 'admin')),
];
/** manager-only routes */
const manager = [
  requireLedger,
  requireAuth,
  (req, res, next) => (req.user?.role === 'MANAGER' ? next() : deny(res, 'manager')),
];
/** both, each scoped to what they may touch */
const staff = [
  requireLedger,
  requireAuth,
  (req, res, next) => (req.user?.role === 'ADMIN' || req.user?.role === 'MANAGER' ? next() : deny(res, 'staff')),
];

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const asAmount = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw badRequest('amount must be a positive number');
  const amount = Number(n.toFixed(2));
  if (amount <= 0) throw badRequest('amount must be at least 0.01');
  return amount;
};

const commissionRate = (value, label) => {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw badRequest(`${label} must be between 0 and 100`);
  }
  return Number(rate.toFixed(2));
};

adminRouter.get(
  '/admin/commission-rates',
  ...admin,
  guard(async (_req, res) => {
    const result = await query(
      'select single_pct as single, double_pct as double, multi_pct as multi, casino_pct as casino from app_commission_config where id = 1',
    );
    const row = result.rows[0] ?? { single: 3, double: 5, multi: 7, casino: 0 };
    res.json({ single: Number(row.single), double: Number(row.double), multi: Number(row.multi), casino: Number(row.casino ?? 0) });
  }),
);

adminRouter.patch(
  '/admin/commission-rates',
  ...admin,
  guard(async (req, res) => {
    const { single, double, multi, casino } = req.body ?? {};
    const rates = {
      single: commissionRate(single, 'single'),
      double: commissionRate(double, 'double'),
      multi: commissionRate(multi, 'multi'),
      casino: casino === undefined ? null : commissionRate(casino, 'casino'),
    };
    const result = await query(
      `update app_commission_config
          set single_pct = $1, double_pct = $2, multi_pct = $3, casino_pct = coalesce($5, casino_pct),
              updated_by = $4, updated_at = now()
        where id = 1
        returning single_pct as single, double_pct as double, multi_pct as multi, casino_pct as casino`,
      [rates.single, rates.double, rates.multi, req.user.id, rates.casino],
    );
    res.json(Object.fromEntries(Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)])));
  }),
);

adminRouter.get(
  '/admin/audit-log',
  ...admin,
  guard(async (req, res) => res.json(await ledger.listAdminAudit({
    from: req.query.from,
    to: req.query.to,
    actorId: req.query.actorId,
    limit: req.query.limit,
  }))),
);

adminRouter.get(
  '/admin/transactions',
  ...admin,
  guard(async (req, res) => res.json(await ledger.listTransactions({
    role: 'ADMIN',
    from: req.query.from,
    to: req.query.to,
    limit: req.query.limit,
  }))),
);

adminRouter.get(
  '/manager/transactions',
  ...manager,
  guard(async (req, res) => res.json(await ledger.listTransactions({
    role: 'MANAGER',
    userId: req.user.id,
    from: req.query.from,
    to: req.query.to,
    limit: req.query.limit,
  }))),
);

/** a manager may only touch the players they own */
async function assertOwned(req, userId) {
  const target = await ledger.getUserById(userId);
  if (!target) throw Object.assign(new Error('user not found'), { status: 404 });
  if (req.user.role === 'MANAGER' && target.managerId !== req.user.id) {
    throw Object.assign(new Error('this user belongs to another manager'), { status: 403 });
  }
  return target;
}

/* ------------------------------------------------------------------- stats */

/** dashboard numbers in the shape the admin screen expects */
adminRouter.get(
  '/admin/stats',
  ...admin,
  guard(async (_req, res) => {
    const base = await ledger.ledgerStats(null);
    const money = await query(
      `select
         coalesce(sum(stake) filter (where status = 'PENDING'), 0)          as open_stake,
         coalesce(sum(stake) filter (where status in ('WON','LOST')), 0)    as settled_stake,
         coalesce((select sum(amount) from app_transaction where type='BET_WON'), 0) as paid_out
       from app_ticket`,
    );
    const row = money.rows[0] ?? {};
    const managers = await ledger.managerFinancials();
    const commissionTotal = managers.reduce((sum, item) => sum + item.sportCommission, 0);
    const casinoCommission = managers.reduce((sum, item) => sum + item.casinoCommission, 0);
    res.json({
      users: base.users,
      activeBets: base.pendingTickets,
      totalStake: Number(row.open_stake ?? 0),
      revenue: Number(Number(row.settled_stake ?? 0) - Number(row.paid_out ?? 0) - commissionTotal),
      commission: commissionTotal,
      sportCommission: commissionTotal,
      casinoCommission,
      blocked: base.blocked,
      tickets: base.tickets,
      totalBalance: base.totalBalance,
      managers,
    });
  }),
);

/** the same view for a manager, scoped to the players they own */
adminRouter.get(
  '/manager/stats',
  ...manager,
  guard(async (req, res) => {
    const base = await ledger.ledgerStats(req.user.id);
    const financials = await ledger.managerFinancials(req.user.id);
    res.json({
      users: base.users,
      activeBets: base.pendingTickets,
      totalStake: base.pendingStake,
      revenue: financials.manager?.netDifference ?? 0,
      balance: financials.manager?.balance ?? req.user.balance,
      tickets: base.tickets,
      blocked: base.blocked,
      financials,
    });
  }),
);

/* ------------------------------------------------------------------- users */

const publicUsers = (rows) => rows;

adminRouter.get(
  '/admin/users',
  ...admin,
  guard(async (_req, res) => res.json(publicUsers(await ledger.listUsers({})))),
);

adminRouter.get(
  '/manager/users',
  ...manager,
  guard(async (req, res) => res.json(publicUsers(await ledger.listUsers({ managerId: req.user.id })))),
);

/**
 * Creates a login. An admin picks the role (ADMIN / MANAGER / PLAYER) and, for players, who
 * owns them; a manager can only create their own players. Any starting balance is written as
 * a real DEPOSIT so the ledger stays consistent.
 */
const createUser = (resolveRole) =>
  guard(async (req, res) => {
    const { username, password, initialBalance = 0, managerId = null } = req.body ?? {};
    if (!username || !password) throw badRequest('username and password are required');


    const name = String(username).trim();
    if (await ledger.findUserByUsername(name)) throw badRequest('this username is already taken');

    const role = resolveRole(req);
    assertAccountPassword(password,role,{staffMin:4});
    const owner = role !== 'PLAYER' ? null : req.user.role === 'MANAGER' ? req.user.id : managerId || null;

    const openingValue = Number(initialBalance);
    const opening = Number(openingValue.toFixed(2));
    if (!Number.isFinite(openingValue) || opening < 0 || (openingValue > 0 && opening === 0)) {
      throw badRequest('initial balance must be zero or at least 0.01');
    }
    const managedPlayer = role === 'PLAYER' && Boolean(owner);
    const user =
      req.user.role === 'MANAGER' || managedPlayer
        ? await ledger.createManagedPlayer({
            username: name,
            passwordHash: hashPassword(password),
            managerId: req.user.role === 'MANAGER' ? req.user.id : owner,
            initialBalance: opening,
          })
        : await ledger.createUser({ username: name, passwordHash: hashPassword(password), role, managerId: owner });

    if (req.user.role !== 'MANAGER' && !managedPlayer && opening > 0) {
      await ledger.moveMoney(user.id, opening, {
        type: 'DEPOSIT',
        description: 'Bilanci fillestar',
        allowNegative: true,
      });
    }

    res.json(await ledger.getUserById(user.id));
  });

adminRouter.post('/admin/users', ...admin, createUser((req) => {
  const role = String(req.body?.role ?? 'PLAYER').toUpperCase();
  return ['ADMIN', 'MANAGER', 'PLAYER'].includes(role) ? role : 'PLAYER';
}));
adminRouter.post('/manager/users', ...manager, createUser(() => 'PLAYER'));

/** edit username / password (admin), and the role (admin only) */
adminRouter.patch(
  '/admin/users/:id',
  ...admin,
  guard(async (req, res) => {
    const id = req.params.id;
    const { username, password, role } = req.body ?? {};

    if (username) {
      const taken = await ledger.findUserByUsername(String(username).trim());
      if (taken && taken.id !== id) throw badRequest('this username is already taken');
      await query('update app_user set username = $2, updated_at = now() where id = $1', [id, String(username).trim()]);
    }
    if (password) {
      const existing=await ledger.getUserById(id);
      if(!existing)throw badRequest('Përdoruesi nuk u gjet.');
      assertAccountPassword(password,role?String(role).toUpperCase():existing.role,{staffMin:4});
      await query('update app_user set password_hash = $2, updated_at = now() where id = $1', [id, hashPassword(password)]);
    }
    if (role) await ledger.updateUser(id, { role: String(role).toUpperCase() });

    res.json(await ledger.getUserById(id));
  }),
);

adminRouter.patch(
  '/manager/users/:id',
  ...manager,
  guard(async (req, res) => {
    const id = req.params.id;
    await assertOwned(req, id);
    const { username, password } = req.body ?? {};

    if (username) {
      const taken = await ledger.findUserByUsername(String(username).trim());
      if (taken && taken.id !== id) throw badRequest('this username is already taken');
      await query('update app_user set username = $2, updated_at = now() where id = $1', [id, String(username).trim()]);
    }
    if (password) {
      assertAccountPassword(password,'PLAYER',{staffMin:4});
      await query('update app_user set password_hash = $2, updated_at = now() where id = $1', [id, hashPassword(password)]);
    }

    res.json(await ledger.getUserById(id));
  }),
);

/** freeze / ban / reactivate */
const setStatus = (checkOwnership) =>
  guard(async (req, res) => {
    const id = req.params.id;
    if (checkOwnership) await assertOwned(req, id);

    const status = String(req.body?.status ?? '').toUpperCase();
    if (!['ACTIVE', 'FROZEN', 'BANNED'].includes(status)) throw badRequest('status must be ACTIVE, FROZEN or BANNED');
    if (id === req.user.id) throw badRequest('you cannot change your own status');

    res.json(await ledger.updateUser(id, { status }));
  });

adminRouter.patch('/admin/users/:id/status', ...admin, setStatus(false));
adminRouter.patch('/manager/users/:id/status', ...manager, setStatus(true));

/** The transfer rechecks ownership under the money lock, including safe retries
 * after the login has already been removed from the active account list. */
const removeUser = (checkOwnership) =>
  guard(async (req, res) => {
    const id = req.params.id;
    if (id === req.user.id) throw badRequest('you cannot delete your own account');

    const deleted = await ledger.deleteUser(id, req.user);
    if (!deleted) throw Object.assign(new Error('user not found'), { status: 404 });
    res.json({ success: true, ...deleted });
  });

adminRouter.delete('/admin/users/:id', ...admin, removeUser(false));
adminRouter.delete('/manager/users/:id', ...manager, removeUser(true));

/* ------------------------------------------------------------------- money */

/** deposit / withdraw, recorded in the ledger with the resulting balance */
const moveBalance = (sign, type, checkOwnership) =>
  guard(async (req, res) => {
    const id = req.params.id;
    if (checkOwnership) await assertOwned(req, id);

    const amount = asAmount(req.body?.amount);
    if (req.user.role === 'MANAGER') {
      const transfer = await ledger.moveManagerFunds(req.user.id, id, amount, sign > 0 ? 'deposit' : 'withdraw');
      return res.json({ ...transfer.user, manager: transfer.manager, transaction: transfer.playerTransaction });
    }
    const { user, transaction } = await ledger.moveMoney(id, sign * amount, {
      type,
      description: type === 'DEPOSIT' ? 'Depozitim nga paneli' : 'Tërheqje nga paneli',
    });
    res.json({ ...user, transaction });
  });

adminRouter.post('/admin/users/:id/deposit', ...admin, moveBalance(1, 'DEPOSIT', false));
adminRouter.post('/admin/users/:id/withdraw', ...admin, moveBalance(-1, 'WITHDRAWAL', false));
adminRouter.post('/manager/users/:id/deposit', ...manager, moveBalance(1, 'DEPOSIT', true));
adminRouter.post('/manager/users/:id/withdraw', ...manager, moveBalance(-1, 'WITHDRAWAL', true));

/* ----------------------------------------------------------------- tickets */

const listTickets = (scoped) =>
  guard(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    res.json(await bets.listLogicalTickets({managerId:scoped?req.user.id:null,limit}));
  });

adminRouter.get('/admin/tickets', ...admin, listTickets(false));
adminRouter.get('/manager/tickets', ...manager, listTickets(true));

/**
 * Revert a ticket: refund the stake, void the lines and close it as REVERTED - the original
 * admin behaviour. Only open tickets can be reverted.
 */
const revertTicket = (scoped) =>
  guard(async (req, res) => {
    const id = req.params.id;
    const result = await bets.revertTicket(id, scoped ? req.user.id : null);
    res.json({ ...result, ticket: await bets.getTicketWithLines(id) });
  });

adminRouter.post('/admin/tickets/:id/revert', ...admin, revertTicket(false));
adminRouter.post('/manager/tickets/:id/revert', ...manager, revertTicket(true));

/* --------------------------------------------------- match control (overrides) */

const matchList = guard(async (req, res) => {
  const rows = await getMatchRows({
    service: req.query.status === 'LIVE' ? 'LIVE' : null,
    q: req.query.q ? String(req.query.q) : null,
    limit: Math.min(Number(req.query.limit) || 200, 2000),
    includeEnded: true,
  });
  // The administration list needs fixture metadata, not every price in every
  // fixture. Keep the original full response unless the client opts in.
  if (req.query.summary === 'true') {
    const now = Date.now();
    const items = rows.map((row) => ({
      ...toClientMatch(serializeMatch(row, [], now)),
      // Unknown until the selected detail loads; zero would imply no markets.
      marketCount: null,
    }));
    return res.json({ items, overrides: await overrides.list(), summary: true });
  }
  const withPrices = await withOdds(rows);
  res.json({ items: toClientMatches(withPrices), overrides: await overrides.list() });
});

adminRouter.get('/admin/matches', ...admin, matchList);
adminRouter.get('/manager/matches', ...manager, matchList);

const matchDetail = guard(async (req, res) => {
  const matchId = Number(req.params.id);
  if (!Number.isSafeInteger(matchId) || matchId <= 0) {
    return res.status(404).json({ message: 'match not found' });
  }
  let row = await getMatchRow(matchId);
  if (!row) return res.status(404).json({ message: 'match not found' });
  // Like the public detail view, ask the feed for this fixture's full markets.
  boostMatch(row.match_id);
  await req.app.locals.loadMatchDetail?.(row.match_id);
  row = await getMatchRow(matchId) ?? row;
  const [serialized] = await withOdds([row],Date.now(),{displayStats:true});
  const id = String(row.match_id);
  const relevantOverrides = (await overrides.list()).filter((entry) =>
    entry.kind === 'match' ? entry.ref === id : entry.ref.startsWith(`${id}|`));
  return res.json({ item: {...toClientMatch(serialized),fullMarketsReady:req.app.locals.matchMarketsReady?.(matchId)??true}, overrides: relevantOverrides });
});

adminRouter.get('/admin/matches/:id', ...admin, matchDetail);
adminRouter.get('/manager/matches/:id', ...manager, matchDetail);

adminRouter.post('/admin/markets/bulk-suspend', ...admin, guard(async (req, res) => {
  const country = String(req.body?.country ?? '').trim();
  const competitionId = String(req.body?.competitionId ?? '').trim();
  const category = String(req.body?.category ?? '').trim();
  const suspended = req.body?.suspended;
  if (!country || !competitionId || !category || typeof suspended !== 'boolean') {
    throw badRequest('Zgjidh shtetin, kampionatin, kategorinë dhe veprimin.');
  }
  if (category !== 'all' && !MARKET_CATEGORY_IDS.includes(category)) {
    throw badRequest('Kategori tregu e pavlefshme.');
  }

  const countryKey = normalizedCompetitionPart(country);
  const rows = (await getMatchRows({ limit: 2000 })).filter(row =>
    normalizedCompetitionPart(row.category_name) === countryKey &&
    String(row.tournament_id ?? row.tournament_name ?? '') === competitionId,
  );
  if (!rows.length) return res.json({ success: true, count: 0, suspended });

  const refs = [];
  for (const match of await withOdds(rows)) {
    for (const market of match.markets ?? []) {
      if (category !== 'all' && !marketCategories(market.name).includes(category)) continue;
      refs.push(`${match.id}|${market.key}|${market.line ?? ''}`);
    }
  }
  const count = await overrides.suspendMarkets(refs, suspended);
  res.json({ success: true, count, suspended });
}));

/** the toggle the UI sends is `isSuspended`; a market/outcome sends `status` */
const wantsSuspend = (body = {}) =>
  body.isSuspended !== undefined ? body.isSuspended === true : String(body.status ?? '').toUpperCase() === 'SUSPENDED';

adminRouter.patch(
  '/admin/matches/:id/suspend',
  ...admin,
  guard(async (req, res) => {
    const suspended = wantsSuspend(req.body);
    const list = await overrides.upsert('match', String(req.params.id), { suspended });
    res.json({ success: true, suspended, overrides: list });
  }),
);

/** marketId from the UI is `matchId|marketKey|line` */
adminRouter.patch(
  '/admin/markets/:id/suspend',
  ...admin,
  guard(async (req, res) => {
    const suspended = wantsSuspend(req.body);
    res.json({ success: true, suspended, overrides: await overrides.upsert('market', req.params.id, { suspended }) });
  }),
);

/**
 * Pin a price. The feed keeps sending its own price, so the override wins in the board view
 * and in bet validation until it is cleared - that is what makes the admin edit meaningful.
 */
adminRouter.patch(
  '/admin/outcomes/:id/odds',
  ...admin,
  guard(async (req, res) => {
    const price = Number(req.body?.odds ?? req.body?.price);
    if (!Number.isFinite(price) || price <= 1) throw badRequest('odds must be a number greater than 1');
    res.json({ success: true, overrides: await overrides.upsert('outcome', req.params.id, { price: Number(price.toFixed(3)) }) });
  }),
);

/** also accepted, matching the original route names */
adminRouter.patch(
  '/admin/markets/:id/odds-adjust',
  ...admin,
  guard(async (req, res) => {
    const price = Number(req.body?.odds ?? req.body?.price);
    if (!Number.isFinite(price) || price <= 1) throw badRequest('odds must be a number greater than 1');
    res.json({ success: true, overrides: await overrides.upsert('outcome', req.params.id, { price: Number(price.toFixed(3)) }) });
  }),
);
adminRouter.patch(
  '/admin/outcomes/:id/suspend',
  ...admin,
  guard(async (req, res) => {
    const suspended = wantsSuspend(req.body);
    res.json({ success: true, suspended, overrides: await overrides.upsert('outcome', req.params.id, { suspended }) });
  }),
);

/** clear one override (or every override when no ref is given) */
adminRouter.delete(
  '/admin/overrides',
  ...admin,
  guard(async (req, res) => {
    const { kind, ref } = req.query;
    if (kind && ref) return res.json({ success: true, overrides: await overrides.clear(String(kind), String(ref)) });
    if (kind) {
      await query('delete from app_feed_override where kind = $1', [String(kind)]);
      await overrides.refresh(true);
      return res.json({ success: true, overrides: await overrides.list() });
    }
    await query('delete from app_feed_override');
    await overrides.refresh(true);
    return res.json({ success: true, overrides: await overrides.list() });
  }),
);

/** what the admin screen shows on its feed-status card */
adminRouter.get(
  '/admin/feed-status',
  ...staff,
  guard(async (_req, res) => {
    const { matchStats } = await import('../matches.mjs');
    res.json({
      matches: matchStats(),
      overrides: (await overrides.list()).length,
      lastPass: null,
    });
  }),
);

/* --------------------------------------------------------------- settlement */

/** Read-only queue of actual pending fixture IDs and missing final evidence. */
adminRouter.get(
  '/admin/settlement/pending',
  ...admin,
  guard(async (req, res) => {
    res.json({ pending: await pendingSettlementReview(req.query.limit) });
  }),
);

/** stored results plus a settlement pass (safe: idempotent) */
const runSettlementHandler = guard(async (_req, res) => {
  const lastPass = await settleAll();
  res.json({ results: await recentResults(50), lastPass });
});
adminRouter.get('/admin/settlement', ...admin, runSettlementHandler);
adminRouter.post('/admin/settlement', ...admin, runSettlementHandler);

/** settle, or correct, a match by hand: stores the score, then recalculates every ticket */
adminRouter.post(
  '/admin/matches/:id/settle',
  ...admin,
  guard(async (req, res) => {
    const matchId = Number(req.params.id);
    const body = req.body ?? {};
    const homeScore = Number(body.homeScore ?? body.home_score ?? NaN);
    const awayScore = Number(body.awayScore ?? body.away_score ?? NaN);

    if (Number.isFinite(homeScore) && Number.isFinite(awayScore)) {
      await storeResult(matchId, homeScore, awayScore, { homeTeam: body.homeTeam, awayTeam: body.awayTeam });
    }

    res.json({ ...(await settleMatch(matchId)), ok: true });
  }),
);

adminRouter.patch('/admin/matches/:id/visibility',...admin,guard(async(req,res)=>res.json(await overrides.setMatchHidden(req.params.id,req.body?.hidden))));
