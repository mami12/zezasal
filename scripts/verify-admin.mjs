/**
 * Regression check for the admin + manager panels: users, money, account status,
 * roles/scoping, ticket revert, match control through overrides, stats, settlement.
 * Run against a live server:
 *
 *   ODDS_SOCKET=true npm start         # or LOCAL_URL=... to point at a deployed instance
 *   npm run verify:admin
 *
 * Requires the seeded admin/admin123 account; everything it creates is deleted again.
 */
const B = process.env.LOCAL_URL ?? 'http://localhost:3100';
const API = `${B}/app/api`;
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

const call = async (path, token, init = {}) => {
  const r = await fetch(API + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  let body = null;
  try {
    body = await r.json();
  } catch {
    /* empty */
  }
  return { status: r.status, body };
};

const login = async (username, password) => {
  const r = await call('/auth/login', null, { method: 'POST', body: JSON.stringify({ username, password }) });
  return r.body?.token ?? null;
};

const suffix = String(Date.now()).slice(-6);
const admin = await login('admin', 'admin123');
check('admin can log in', !!admin);
const asAdmin = (p, i) => call(p, admin, i);

// --- stats -----------------------------------------------------------------------
const stats = await asAdmin('/admin/stats');
check(
  'GET /admin/stats has the dashboard shape',
  stats.status === 200 && ['users', 'activeBets', 'totalStake', 'revenue'].every((k) => typeof stats.body[k] === 'number'),
  JSON.stringify(stats.body),
);

// --- create a player with an opening balance --------------------------------------
const player = `p_${suffix}`;
const created = await asAdmin('/admin/users', {
  method: 'POST',
  body: JSON.stringify({ username: player, password: 'pass1234', initialBalance: 500, role: 'PLAYER' }),
});
check('POST /admin/users creates the player', created.status === 200 && created.body.username === player, JSON.stringify(created.body?.balance));
check('the opening balance is on the account', Number(created.body.balance) === 500);
check('no password hash is ever returned', !JSON.stringify(created.body).toLowerCase().includes('hash'));

const playerToken = await login(player, 'pass1234');
check('the new player can log in', !!playerToken);

const dup = await asAdmin('/admin/users', { method: 'POST', body: JSON.stringify({ username: player, password: 'pass1234' }) });
check('duplicate username is refused', dup.status === 400, dup.body?.message);

// --- deposit / withdraw ----------------------------------------------------------
const dep = await asAdmin(`/admin/users/${created.body.id}/deposit`, { method: 'POST', body: JSON.stringify({ amount: 250 }) });
check('deposit credits the balance', dep.status === 200 && Number(dep.body.balance) === 750, JSON.stringify(dep.body?.balance));
check('deposit is recorded in the ledger', dep.body.transaction?.type === 'DEPOSIT' && Number(dep.body.transaction.balanceAfter) === 750);

const wd = await asAdmin(`/admin/users/${created.body.id}/withdraw`, { method: 'POST', body: JSON.stringify({ amount: 50 }) });
check('withdrawal debits the balance', wd.status === 200 && Number(wd.body.balance) === 700, JSON.stringify(wd.body?.balance));

const badAmount = await asAdmin(`/admin/users/${created.body.id}/deposit`, { method: 'POST', body: JSON.stringify({ amount: -5 }) });
check('a negative deposit is refused', badAmount.status === 400, badAmount.body?.message);
const overdraft = await asAdmin(`/admin/users/${created.body.id}/withdraw`, { method: 'POST', body: JSON.stringify({ amount: 999999 }) });
check('withdrawing more than the balance is refused', overdraft.status === 400, overdraft.body?.message);

const txs = await call('/me/transactions', playerToken);
check('the player sees the movements', txs.body.length === 3, txs.body.map((t) => t.type).join(','));

// --- status ----------------------------------------------------------------------
const frozen = await asAdmin(`/admin/users/${created.body.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'FROZEN' }) });
check('admin can freeze an account', frozen.status === 200 && frozen.body.status === 'FROZEN');

// a frozen player cannot bet
const live = (await call('/matches?status=LIVE', playerToken)).body;
const seed = (matchId, price) =>
  fetch(`${B}/ingest/odds`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ingest-token': process.env.INGEST_TOKEN ?? 'change-me' },
    body: JSON.stringify({
      matchId: Number(matchId),
      markets: [{ key: '1x2', name: 'Full Time Result', outcomes: [{ key: '1', name: 'Home', price }, { key: 'x', name: 'Draw', price: 3 }, { key: '2', name: 'Away', price: 4 }] }],
    }),
  });
const target = live[0];
if (!target?.id) throw new Error('Admin verification requires at least one live match');
await seed(target.id, 2);

/** the home line of a match, read straight off the board (prices move, so read then send) */
async function liveHomeLine(matchId, { anyStatus = false } = {}) {
  const board = (await call('/matches?status=LIVE', token)).body;
  const market = board.find((m) => m.id === String(matchId))?.markets?.find((k) => k.marketType === '1X2');
  const outcomes = market?.outcomes ?? [];
  const outcome = anyStatus ? outcomes.find((o) => o.name === '1') ?? outcomes[0] : outcomes.find((o) => o.name === '1' && o.status === 'ACTIVE');
  return outcome ? { outcomeId: outcome.id, odds: outcome.odds, status: outcome.status } : null;
}

/** places at the price the board is showing right now; the feed moves, so retry on drift */
async function placeAtLivePrice(stake, matchId, token = playerToken) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const line = await liveHomeLine(matchId);
    if (!line) continue;
    const res = await call('/bets/place', token, {
      method: 'POST',
      body: JSON.stringify({ stake, selections: [{ outcomeId: line.outcomeId, oddsAtPlacement: line.odds }] }),
    });
    if (res.status === 200) return res;
  }
  return { status: 0, body: { message: 'no price ever matched' } };
}

const frozenLine = await liveHomeLine(target.id);
const frozenBet = await call('/bets/place', playerToken, {
  method: 'POST',
  body: JSON.stringify({ stake: 100, selections: [{ outcomeId: frozenLine.outcomeId, oddsAtPlacement: frozenLine.odds }] }),
});
check('a frozen account cannot bet', frozenBet.status === 403, frozenBet.body?.message);

await asAdmin(`/admin/users/${created.body.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) });
const activeBet = await placeAtLivePrice(100, target.id);
check('reactivating lets them bet again', activeBet.status === 200, JSON.stringify(activeBet.body?.message ?? activeBet.status));

// --- ticket revert ----------------------------------------------------------------
const tickets = await asAdmin('/admin/tickets');
check('GET /admin/tickets lists tickets', tickets.status === 200 && tickets.body.length >= 1, `${tickets.body?.length} tickets`);
let openTicket = tickets.body.find((t) => t.status === 'PENDING' && t.userId === created.body.id);
check('our player has an open ticket with its lines', !!openTicket && openTicket.lines.length > 0, String(openTicket?.id));
check('the list never leaks a password hash', !JSON.stringify(tickets.body).toLowerCase().includes('hash'));

// the settlement pass can grade our ticket while we work (that is the point of it), in which case
// the revert is refused by design - place another bet and retry with a fresh ticket
let revert = null;
let balanceBefore = 0;
let stake = 0;
for (let attempt = 0; attempt < 5 && !revert; attempt++) {
  if (!openTicket) {
    if ((await placeAtLivePrice(100, target.id)).status !== 200) continue;
    const list = (await asAdmin('/admin/tickets')).body;
    openTicket = list.find((t) => t.status === 'PENDING' && t.userId === created.body.id);
    if (!openTicket) continue;
  }

  balanceBefore = Number((await call('/auth/me', playerToken)).body.balance);
  stake = Number(openTicket.stake);
  const res = await asAdmin(`/admin/tickets/${openTicket.id}/revert`, { method: 'POST' });
  if (res.status === 200) revert = res;
  else openTicket = null; // graded in the meantime
}

check('POST /admin/tickets/:id/revert refunds the stake', revert?.status === 200 && Number(revert.body.refunded) === stake, JSON.stringify(revert?.body ?? null).slice(0, 180));
const balanceAfter = Number((await call('/auth/me', playerToken)).body.balance);
check('the refund reached the player', balanceAfter === balanceBefore + stake, `${balanceBefore} -> ${balanceAfter}`);
check('the ticket is now REVERTED', revert?.body.ticket?.status === 'REVERTED');
check('its lines were voided', revert?.body.ticket?.lines.every((l) => l.status === 'VOID'));
const revertTwice = await asAdmin(`/admin/tickets/${revert.body.ticket.id}/revert`, { method: 'POST' });
check('reverting twice is refused', revertTwice.status === 400, revertTwice.body?.message);

// --- match control (overrides) ----------------------------------------------------
const matches = await asAdmin('/admin/matches');
check('GET /admin/matches lists the board', matches.status === 200 && matches.body.items?.length > 0, `${matches.body?.items?.length} matches`);

const suspend = await asAdmin(`/admin/matches/${target.id}/suspend`, { method: 'PATCH', body: JSON.stringify({ isSuspended: true }) });
check('admin can suspend a match', suspend.status === 200 && suspend.body.suspended === true);

const boardSuspended = (await call('/matches?status=LIVE', playerToken)).body.find((m) => m.id === String(target.id));
check('the board shows it suspended', boardSuspended?.isSuspended === true);
check('its outcomes are shown suspended too', boardSuspended?.markets.every((m) => m.outcomes.every((o) => o.status === 'SUSPENDED')));

const suspendedLine = await liveHomeLine(target.id, { anyStatus: true });
const betOnSuspended = await call('/bets/place', playerToken, {
  method: 'POST',
  body: JSON.stringify({ stake: 100, selections: [{ outcomeId: suspendedLine.outcomeId, oddsAtPlacement: suspendedLine.odds }] }),
});
check('a suspended match cannot take bets', betOnSuspended.status === 400, betOnSuspended.body?.message);
check('the refusal is about the suspension, not the price', /pezulluar|suspend/i.test(betOnSuspended.body?.message ?? ''), betOnSuspended.body?.message);

await asAdmin(`/admin/matches/${target.id}/suspend`, { method: 'PATCH', body: JSON.stringify({ isSuspended: false }) });
const afterUnsuspend = (await call('/matches?status=LIVE', playerToken)).body.find((m) => m.id === String(target.id));
check('unsuspending restores the match', afterUnsuspend?.isSuspended === false);

// pin a price: the feed keeps sending its own price, the override must win
const outcomeId = (await liveHomeLine(target.id)).outcomeId;
const pinned = await asAdmin(`/admin/outcomes/${outcomeId}/odds`, { method: 'PATCH', body: JSON.stringify({ odds: 5 }) });
check('admin can pin an outcome price', pinned.status === 200);
const boardPinned = (await call('/matches?status=LIVE', playerToken)).body.find((m) => m.id === String(target.id));
const pinnedOutcome = boardPinned?.markets.flatMap((m) => m.outcomes).find((o) => o.id === outcomeId);
check('the board shows the pinned price, not the feed price', pinnedOutcome?.odds === 5, `odds=${pinnedOutcome?.odds}`);

const betAtPinned = await call('/bets/place', playerToken, {
  method: 'POST',
  body: JSON.stringify({ stake: 100, selections: [{ outcomeId, oddsAtPlacement: 5 }] }),
});
check('a bet is accepted at the pinned price', betAtPinned.status === 200 && betAtPinned.body.totalOdds === 5, JSON.stringify(betAtPinned.body?.totalOdds));

const cleared = await asAdmin(`/admin/overrides?kind=outcome&ref=${encodeURIComponent(outcomeId)}`, { method: 'DELETE' });
check('clearing the override works', cleared.status === 200 && Array.isArray(cleared.body.overrides));
const boardCleared = (await call('/matches?status=LIVE', playerToken)).body.find((m) => m.id === String(target.id));
const clearedOutcome = boardCleared?.markets.flatMap((m) => m.outcomes).find((o) => o.id === outcomeId);
check('the feed price is back after clearing', clearedOutcome && clearedOutcome.odds !== 5, `odds=${clearedOutcome?.odds}`);

// --- managers ---------------------------------------------------------------------
const managerName = `m_${suffix}`;
const manager = await asAdmin('/admin/users', {
  method: 'POST',
  body: JSON.stringify({ username: managerName, password: 'pass1234', role: 'MANAGER' }),
});
check('admin can create a manager', manager.status === 200 && manager.body.role === 'MANAGER');

const managerToken = await login(managerName, 'pass1234');
check('the manager can log in', !!managerToken);
const asManager = (p, i) => call(p, managerToken, i);

const managerFunding = await asAdmin(`/admin/users/${manager.body.id}/deposit`, {
  method: 'POST',
  body: JSON.stringify({ amount: 400 }),
});
check('admin can fund the manager wallet', managerFunding.status === 200 && Number(managerFunding.body.balance) === 400);

const mStats = await asManager('/manager/stats');
check('GET /manager/stats works for a manager', mStats.status === 200, JSON.stringify(mStats.body));

const mPlayerName = `mp_${suffix}`;
const mPlayer = await asManager('/manager/users', {
  method: 'POST',
  body: JSON.stringify({ username: mPlayerName, password: 'pass1234', initialBalance: 300 }),
});
check('a manager creates their own player', mPlayer.status === 200 && Number(mPlayer.body.balance) === 300);
check('the player is owned by the manager', mPlayer.body.managerId === manager.body.id);
check('the manager cannot choose the role', mPlayer.body.role === 'PLAYER');
const managerAfterCreate = await asManager('/auth/me');
check('creating a player debits the manager wallet', Number(managerAfterCreate.body.balance) === 100, `${managerAfterCreate.body.balance}`);

const mList = await asManager('/manager/users');
check('the manager only sees their own players', mList.body.length === 1 && mList.body[0].username === mPlayerName, `${mList.body.length} users`);

const mDeposit = await asManager(`/manager/users/${mPlayer.body.id}/deposit`, {
  method: 'POST',
  body: JSON.stringify({ amount: 100 }),
});
check('manager deposit credits the player and debits the manager', mDeposit.status === 200 && Number(mDeposit.body.balance) === 400);
const managerAfterDeposit = await asManager('/auth/me');
check('manager balance reflects the transfer', Number(managerAfterDeposit.body.balance) === 0);
const overfund = await asManager(`/manager/users/${mPlayer.body.id}/deposit`, {
  method: 'POST',
  body: JSON.stringify({ amount: 1 }),
});
check('manager cannot fund a player beyond available funds', overfund.status === 400);
const mStatsAfterFunding = await asManager('/manager/stats');
check(
  'manager stats include financial totals and player rows',
  mStatsAfterFunding.status === 200 &&
    Number(mStatsAfterFunding.body.financials?.manager?.playerBalance) === 400 &&
    mStatsAfterFunding.body.financials?.players?.some((p) => p.id === mPlayer.body.id),
);

const managerWalletTopUp = await asAdmin(`/admin/users/${manager.body.id}/deposit`, {
  method: 'POST',
  body: JSON.stringify({ amount: 50 }),
});
check('admin can top up a manager wallet', managerWalletTopUp.status === 200 && Number(managerWalletTopUp.body.balance) === 50);

const mPlayerToken = await login(mPlayerName, 'pass1234');
check('a manager player can log in', !!mPlayerToken);
const managerPlayerBet = await placeAtLivePrice(100, target.id, mPlayerToken);
check('a managed player can place a bet', managerPlayerBet.status === 200, managerPlayerBet.body?.message);
if (managerPlayerBet.status === 200) {
  const managerStatsAfterBet = await asManager('/manager/stats');
  const managerPlayerFinance = managerStatsAfterBet.body.financials?.players?.find((p) => p.id === mPlayer.body.id);
  check(
    'the single-bet commission and all tier rates are reported immediately',
    managerPlayerFinance?.commission === 3 &&
      managerPlayerFinance?.commissionByTier?.single === 3 &&
      managerPlayerFinance?.commissionRates?.single === 3 &&
      managerPlayerFinance?.commissionRates?.double === 5 &&
      managerPlayerFinance?.commissionRates?.multi === 7 &&
      Number(managerStatsAfterBet.body.financials?.manager?.balance) === 47,
    JSON.stringify({ commission: managerPlayerFinance?.commission, balance: managerStatsAfterBet.body.financials?.manager?.balance }),
  );
  const adminStatsAfterBet = await asAdmin('/admin/stats');
  const adminManagerFinance = adminStatsAfterBet.body.managers?.find((entry) => entry.id === manager.body.id);
  check(
    'admin stats show the updated manager wallet and commission',
    Number(adminManagerFinance?.balance) === 47 && Number(adminManagerFinance?.commission) === 3,
    JSON.stringify({ balance: adminManagerFinance?.balance, commission: adminManagerFinance?.commission }),
  );
  const managerRevert = await asManager(`/manager/tickets/${managerPlayerBet.body.id}/revert`, { method: 'POST' });
  check('reverting a managed ticket refunds its stake', managerRevert.status === 200 && managerRevert.body.refunded === 100);
  const managerStatsAfterRevert = await asManager('/manager/stats');
  const managerPlayerFinanceAfterRevert = managerStatsAfterRevert.body.financials?.players?.find((p) => p.id === mPlayer.body.id);
  check(
    'reverting the bet refunds its commission to the manager',
    managerPlayerFinanceAfterRevert?.commission === 0 &&
      Number(managerStatsAfterRevert.body.financials?.manager?.balance) === 50,
    JSON.stringify({ commission: managerPlayerFinanceAfterRevert?.commission, balance: managerStatsAfterRevert.body.financials?.manager?.balance }),
  );
} else {
  check('the 3% single commission is charged as soon as the bet is placed', false, 'no ticket was created');
  check('admin stats show the updated manager wallet and commission', false, 'no ticket was created');
  check('reverting a managed ticket refunds its stake', false, 'no ticket was created');
  check('reverting the bet refunds its commission to the manager', false, 'no ticket was created');
}

const managerWithdrawal = await asManager(`/manager/users/${mPlayer.body.id}/withdraw`, {
  method: 'POST',
  body: JSON.stringify({ amount: 40 }),
});
const managerStatsAfterWithdrawal = await asManager('/manager/stats');
check('withdrawing from a player transfers funds back to the manager', managerWithdrawal.status === 200 &&
  Number(managerWithdrawal.body.balance) === 360 &&
  Number(managerStatsAfterWithdrawal.body.financials?.manager?.balance) === 90);

const crossRoute = await asManager(`/admin/users/${created.body.id}/deposit`, { method: 'POST', body: JSON.stringify({ amount: 20 }) });
check('a manager cannot use the admin routes', crossRoute.status === 403, crossRoute.body?.message);

const steal = await asManager(`/manager/users/${created.body.id}/deposit`, { method: 'POST', body: JSON.stringify({ amount: 20 }) });
check("a manager cannot touch another manager's player", steal.status === 403, steal.body?.message);

const adminOnly = await call('/admin/users', playerToken);
check('a player cannot reach the admin panel', adminOnly.status === 403, adminOnly.body?.message);

// --- cleanup ----------------------------------------------------------------------
await asAdmin(`/admin/users/${mPlayer.body.id}`, { method: 'DELETE' });
const deleted = await asAdmin(`/admin/users/${created.body.id}`, { method: 'DELETE' });
check('admin can delete a user', deleted.status === 200 && deleted.body.success === true);
check('the deleted user can no longer log in', !(await login(player, 'pass1234')));
await asAdmin(`/admin/users/${manager.body.id}`, { method: 'DELETE' });
await asAdmin('/admin/overrides', { method: 'DELETE' });

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);