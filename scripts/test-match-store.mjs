/**
 * Offline test for the in-memory match store (server/match-store.mjs).
 *
 * Checks the contract the board relies on: poll upserts that must NOT clobber score/clock
 * data written by match-info frames, the filters/order of getMatches, league and count
 * aggregation, subscription ids, expiry, and feed-freshness tracking.
 *
 * Run: node scripts/test-match-store.mjs
 */
import * as store from '../server/match-store.mjs';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`);
  if (!ok) failures++;
};

const minutesAgo = (n) => new Date(Date.now() - n * 60000);

const mkRow = (over = {}) => ({
  match_id: 1,
  sport_id: 18,
  sport_tag: 'football',
  category_id: 10,
  category_slug: 'premier-league',
  category_name: 'Premier League',
  tournament_id: 100,
  tournament_slug: 'epl',
  tournament_name: 'Premier League',
  home: 'Home FC',
  away: 'Away FC',
  service: 'LIVE',
  start_at: minutesAgo(30),
  is_hot: false,
  is_real: true,
  live_minute: 30,
  phase: '2H',
  status: 'live',
  raw: { homeTeam: { id: 111 }, awayTeam: { id: 222 } },
  ...over,
});

store.clear();

// --- poll upsert -----------------------------------------------------------------
store.upsert([
  mkRow({ match_id: 1 }),
  mkRow({ match_id: 2, service: 'PREMATCH', status: 'scheduled', start_at: minutesAgo(-120), home: 'Alpha', away: 'Beta' }),
  mkRow({ match_id: 3, home: 'Gamma', away: 'Delta', status: 'ended', start_at: minutesAgo(200) }),
]);
check('three matches stored', store.stats().matches === 3, JSON.stringify(store.stats()));

// match-info writes score/clock, then the next poll must not wipe them
store.applyInfo({ matchId: 1, homeScore: 2, awayScore: 1, matchTimeMs: 2820000, feedStatus: '2nd Half', stats: { 111: { corners: 3 } } });
store.upsert([mkRow({ match_id: 1 })]); // fresh poll cycle, regenerated metadata only
const afterPoll = store.getById(1);
check('poll upsert keeps the score', afterPoll.home_score === 2 && afterPoll.away_score === 1, `${afterPoll.home_score}-${afterPoll.away_score}`);
check('poll upsert keeps the clock + anchor', afterPoll.match_time_ms === 2820000 && afterPoll.clock_at instanceof Date);
check('poll upsert keeps stats', afterPoll.stats?.[111]?.corners === 3);
check('poll upsert keeps score_at', afterPoll.score_at instanceof Date);

// --- applyInfo semantics ---------------------------------------------------------
store.applyInfo({ matchId: 1, stats: { 111: { corners: 4 } } }); // stats-only frame: no clock/score
const statsOnly = store.getById(1);
check('stats-only frame leaves the score alone', statsOnly.home_score === 2 && statsOnly.away_score === 1);
check('stats-only frame does not move the clock anchor', statsOnly.match_time_ms === 2820000);
check('stats-only frame merges stats', statsOnly.stats[111].corners === 4, JSON.stringify(statsOnly.stats[111]));
check('unknown match id is ignored', store.applyInfo({ matchId: 999, homeScore: 1, awayScore: 1 }) === null);
check('frames without a matchId are ignored', store.applyInfo({ homeScore: 1 }) === null);

// --- reads -----------------------------------------------------------------------
check('service filter', store.getMatches({ service: 'live' }).length === 1 && store.getMatches({ service: 'live' }).every((m) => m.service === 'LIVE'));
check('prematch filter', store.getMatches({ service: 'PREMATCH' }).length === 1);
check('ended matches are hidden by default', !store.getMatches({}).some((m) => m.status === 'ended'));
check('includeEnded shows them', store.getMatches({ includeEnded: true }).length === 3);
check(
  'search matches home/away/league',
  store.getMatches({ includeEnded: true, q: 'gamma' }).length === 1 &&
    store.getMatches({ includeEnded: true, q: 'zzz' }).length === 0,
);
check('league filter', store.getMatches({ league: 'premier-league' }).length === 2);
check('live sorts before prematch', store.getMatches({})[0].service === 'LIVE');
check(
  'limit/offset',
  store.getMatches({ limit: 1 }).length === 1 &&
    store.getMatches({ limit: 1, offset: 1 }).length === 1 &&
    store.getMatches({ offset: 5 }).length === 0,
);
check('getById', store.getById(2)?.home === 'Alpha' && store.getById(9999) === null);
check('knownIds', [...store.knownIds([1, 999, 3])].join() === '1,3');

const leagues = store.getLeagues();
check('leagues aggregate by slug', leagues.length === 1 && leagues[0].live === 2 && leagues[0].prematch === 1, JSON.stringify(leagues[0]));

const counts = store.getCounts();
check('counts: live/prematch/finished', counts.live === 1 && counts.prematch === 1 && counts.finished === 1, JSON.stringify(counts));

const subs = store.getSubscriptionIds({ liveLimit: 1, prematchLimit: 5 });
check('subscription ids respect limits', subs.live.length === 1 && subs.prematch.length === 1, JSON.stringify(subs));

// --- freshness -------------------------------------------------------------------
const fresh = store.getFeedFreshness(90);
check('freshness: live counted, stale not', fresh.live === 2 && fresh.staleClock === 1 && fresh.staleScore === 1, JSON.stringify(fresh));

// --- expiry ----------------------------------------------------------------------
const expired = store.expireStale(0, Date.now() + 60 * 60 * 1000); // everything is "old" an hour from now
check('missing listings suspend unresolved matches instead of inventing FT', expired.length === 1 && store.getMatches({ includeEnded: true }).length === 2);
check('unconfirmed live match retains its phase and is suspended', store.getById(1).status === 'live' && store.getById(1).listing_stale === true);
check('reappearing match becomes active again', store.upsert([mkRow({ match_id: 1 })]) === 1 && store.getById(1).active === true);
// --- subscription tiers (what the pusher subscribes, and how often) --------------
store.clear();
store.upsert([
  mkRow({ match_id: 11, service: 'PREMATCH', status: 'scheduled', start_at: minutesAgo(-10) }), // in 10 min
  mkRow({ match_id: 12, service: 'PREMATCH', status: 'scheduled', start_at: minutesAgo(-120) }), // in 2h
  mkRow({ match_id: 13, service: 'PREMATCH', status: 'scheduled', start_at: minutesAgo(5) }), // already started
]);
const tiers = store.getSubscriptionIds({ prematchLimit: 10 });
check('prematch tiering: soon = within 30 min (started or starting)', tiers.prematchSoon.join() === '13,11', tiers.prematchSoon.join());
check('prematch tiering: later = the fixtures hours away', tiers.prematchLater.join() === '12', tiers.prematchLater.join());
check(
  'prematch still lists everything (it decides how many fixtures are visible at all)',
  tiers.prematch.join() === '13,11,12',
  tiers.prematch.join(),
);
check(
  'soonMs=0 (the kill switch) puts every fixture in the cheap tier',
  store.getSubscriptionIds({ prematchLimit: 10, soonMs: 0 }).prematchSoon.length === 0,
);
check(
  'the two tiers never overlap',
  tiers.prematchSoon.every((id) => !tiers.prematchLater.includes(id)) &&
    tiers.prematchSoon.length + tiers.prematchLater.length === tiers.prematch.length,
);



console.log(`\nstats: ${JSON.stringify(store.stats())}`);
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
