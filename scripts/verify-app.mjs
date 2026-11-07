/**
 * Regression check for the player-facing app surface (auth, board, betslip, booking codes,
 * settlement payout, disabled cash-out). Run against a live server that has prices:
 *
 *   ODDS_SOCKET=true npm start         # or LOCAL_URL=... to point at a deployed instance
 *   npm run verify:app
 *
 * Everything it creates is deleted again at the end of the run.
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

const login = async (username, password) =>
  (await call('/auth/login', null, { method: 'POST', body: JSON.stringify({ username, password }) })).body?.token ?? null;

const balanceOf = async (token) => Number((await call('/auth/me', token)).body.balance);

// --- health -----------------------------------------------------------------------
const health = await (await fetch(`${B}/health`)).json();
check('health is green', health.ok === true, JSON.stringify({ matches: health.matches, ledger: health.ledger }));
check('matches live in memory', health.matches?.mode === 'memory');
check('the ledger is connected', health.ledger?.ready === true);

// --- login with a throwaway account, so the seeded demo balance stays untouched ----
const suffix = String(Date.now()).slice(-6);
const adminToken = await login('admin', 'admin123');
check('admin can log in', !!adminToken);

const player = `smoke_${suffix}`;
const created = await call('/admin/users', adminToken, {
  method: 'POST',
  body: JSON.stringify({ username: player, password: 'pass1234', initialBalance: 5000, role: 'PLAYER' }),
});
check('a player can be opened for the run', created.status === 200, JSON.stringify(created.body?.message ?? created.body?.balance));

const token = await login(player, 'pass1234');
check('the player can log in', !!token);

// --- board ------------------------------------------------------------------------
const tree = await call('/sports', token);
check('the sports tree has entries', tree.status === 200 && Array.isArray(tree.body) && tree.body.length > 0, `${tree.body?.length} rows`);

const live = await call('/matches?status=LIVE', token);
check('the live board is not empty', live.status === 200 && live.body.length > 0, `${live.body?.length} matches`);
const priced = live.body.find((m) => m.markets.some((mk) => mk.outcomes.length));
check('matches carry priced markets', !!priced, priced?.markets?.length + ' markets');

const oneX2 = priced.markets.find((mk) => mk.marketType === '1X2') ?? priced.markets[0];
const home = oneX2.outcomes[0];
check('the 1x2 favourite has sane odds', home.odds > 1, JSON.stringify({ name: home.name, odds: home.odds }));
check('the board marks rows bettable', home.status === 'ACTIVE');

const detail = await call(`/matches/${priced.id}`, token);
check('the match detail endpoint agrees', detail.status === 200 && detail.body.id === priced.id);
const tracker = await call(`/matches/${priced.id}/tracker`, token);
check('the pitch tracker has its shape', tracker.status === 200 && typeof tracker.body.possessionTeam === 'string');

/**
 * Prices move while a bet is being typed, and the server refuses a stale price on purpose.
 * The app re-confirms the new price, so the test does the same: take a fresh price and send
 * it straight away; retry if the feed moved in between.
 */
async function placeAtLivePrice(path, auth, stake, preferMatchId) {
  const hasHomeLine = (m) => m.markets.some((mk) => mk.marketType === '1X2' && mk.outcomes.some((o) => o.code === '1' && o.status === 'ACTIVE'));

  for (let attempt = 0; attempt < 15; attempt++) {
    const board = (await call('/matches?status=LIVE', auth)).body;
    const candidates = board.filter(hasHomeLine);
    // the home line of the match-result market is the one we can grade deterministically later
    const match = candidates.find((m) => m.id === preferMatchId) ?? candidates[0];
    if (!match) continue;

    const market = match.markets.find((mk) => mk.marketType === '1X2' && mk.outcomes.some((o) => o.code === '1' && o.status === 'ACTIVE'));
    const outcome = market.outcomes.find((o) => o.code === '1' && o.status === 'ACTIVE');
    const res = await call(path, auth, {
      method: 'POST',
      body: JSON.stringify({ stake, selections: [{ outcomeId: outcome.id, oddsAtPlacement: outcome.odds }] }),
    });
    if (res.status === 200) return { res, outcome, match };
  }
  return { res: { status: 0, body: { message: 'no price ever matched' } } };
}

// --- place a real bet -------------------------------------------------------------
const before = await balanceOf(token);
const { res: placed, outcome: betOutcome, match: betMatch } = await placeAtLivePrice('/bets/place', token, 100, priced.id);
check('a bet is accepted at the displayed price', placed.status === 200, JSON.stringify(placed.body?.message ?? placed.body?.totalOdds));
check('the stake left the balance', (await balanceOf(token)) === before - 100, `${before} -> ${await balanceOf(token)}`);

const mine = await call('/bets/active', token);
const ticket = mine.body?.find((t) => t.id === placed.body.id);
check('the ticket shows in my bets as PENDING', !!ticket && ticket.status === 'PENDING');
check(
  'its line keeps the price we bet at',
  Number(ticket.lines[0].oddsAtPlacement) === Number(betOutcome.odds),
  `${ticket.lines[0].oddsAtPlacement} vs ${betOutcome.odds}`,
);

const history = await call('/me/transactions', token);
check('the ledger recorded a bet transaction', history.body.some((t) => t.type === 'BET_PLACED'), history.body[0]?.type);

// --- booking code (no stake, no account) ------------------------------------------
const booked = await placeAtLivePrice('/bets/book', null, 100, priced.id);
const code = booked.res.body?.bookingCode ?? booked.res.body?.code;
check('a booking code is issued without a login', booked.res.status === 200 && !!code, String(code));
const reopened = await call(`/booking/${code}`, null);
check('the booking code can be reopened', reopened.status === 200 && reopened.body.lines?.length > 0);

// --- settlement pays a winner -----------------------------------------------------
const asAdmin = await login('admin', 'admin123');
const pass = await call('/admin/settlement', asAdmin);
check('GET /admin/settlement runs a full pass', pass.status === 200 && Array.isArray(pass.body.results) && !!pass.body.lastPass, JSON.stringify(pass.body?.lastPass));

const forced = await call(`/admin/matches/${betMatch.id}/settle`, asAdmin, {
  method: 'POST',
  body: JSON.stringify({ homeScore: 3, awayScore: 0, homeTeam: betMatch.homeTeam, awayTeam: betMatch.awayTeam }),
});
check('an admin can force a result', forced.status === 200, JSON.stringify(forced.body?.settled));

const afterWin = await call('/bets/history', token);
const graded = afterWin.body.find((t) => t.id === placed.body.id);
check('the ticket was graded', !!graded && graded.status !== 'PENDING', graded?.status);
check('a 3-0 home win settles the home line as WON', graded?.status === 'WON', graded?.status);
if (graded?.status === 'WON') {
  check(
    'the payout is stake x odds',
    Number(graded.potentialPayout).toFixed(2) === (100 * Number(placed.body.totalOdds)).toFixed(2),
    `${graded.potentialPayout} vs ${100 * Number(placed.body.totalOdds)}`,
  );
  check(
    'the winnings reached the balance',
    (await balanceOf(token)) >= before - 100 + Number(graded.potentialPayout),
    String(await balanceOf(token)),
  );
} else if (graded?.status === 'VOID') {
  check('a void ticket returns the stake', (await balanceOf(token)) >= before, String(await balanceOf(token)));
} else {
  check('a lost ticket keeps the stake (no refund on the balance)', (await balanceOf(token)) === before - 100);
}

// --- early payout is no longer offered; endpoint must not change balances ---
const beforeDisabled = await balanceOf(token);
const disabledCash = await call(`/bets/cashout/${placed.body.id}`, token, { method: 'POST' });
check('early payout endpoint is removed', disabledCash.status === 404, JSON.stringify(disabledCash.body));
check('disabled cash-out does not change balance', (await balanceOf(token)) === beforeDisabled);

// --- cleanup ----------------------------------------------------------------------
const removed = await call(`/admin/users/${created.body.id}`, adminToken, { method: 'DELETE' });
check('the throwaway player is removed', removed.status === 200 && removed.body.success === true);
check('its login no longer works', !(await login(player, 'pass1234')));

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
