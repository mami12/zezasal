/** Offline subscription-tier and always-on server policy regressions. */
import {
  SUBSCRIBE_GROUPS,
  dueGroups,
  retryIntervals,
  splitByKickoff,
  withoutDuplicates,
} from '../server/subscribe-plan.mjs';
import {
  FEED_IDLE,
  FEED_LIVE,
  FEED_WAKING,
  createIdleMonitor,
  getFeedMode,
  setFeedMode,
  shouldSleep,
  shouldWake,
} from '../server/idle-mode.mjs';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`);
  if (!ok) failures++;
};

const MIN = 60 * 1000;
const NOW = 1_700_000_000_000;

/* ---------------------------------------------- when is a group due? ------- */
console.log('-- tiers (dueGroups) --');
const intervals = { live: 20 * 1000, soon: 5 * MIN, later: 60 * MIN, unpriced: MIN };

check(
  'nothing has ever been sent -> every group is due (first pass after connecting)',
  dueGroups({ now: NOW, lastSent: {}, intervals }).join(',') === SUBSCRIBE_GROUPS.join(','),
  dueGroups({ now: NOW, lastSent: {}, intervals }).join(','),
);

check(
  'just sent everything -> nothing is due',
  dueGroups({ now: NOW, lastSent: { live: NOW, soon: NOW, later: NOW, unpriced: NOW }, intervals }).length === 0,
);

const sent = { live: NOW, soon: NOW, later: NOW, unpriced: NOW };
check(
  'after 20s only live is due (the clock/score cadence is unchanged)',
  dueGroups({ now: NOW + 20 * 1000, lastSent: sent, intervals }).join(',') === 'live',
  dueGroups({ now: NOW + 20 * 1000, lastSent: sent, intervals }).join(','),
);

check(
  'the unpriced fixtures are retried every minute, the rest of prematch only after an hour',
  dueGroups({ now: NOW + 60 * 1000, lastSent: { ...sent, live: NOW + 60 * 1000 }, intervals }).join(',') === 'unpriced',
  dueGroups({ now: NOW + 60 * 1000, lastSent: { ...sent, live: NOW + 60 * 1000 }, intervals }).join(','),
);

check(
  'near-kickoff fixtures are refreshed after 5 min, the rest still wait',
  dueGroups({ now: NOW + 5 * MIN, lastSent: { ...sent, live: NOW + 5 * MIN, unpriced: NOW + 5 * MIN }, intervals }).join(',') === 'soon',
  dueGroups({ now: NOW + 5 * MIN, lastSent: { ...sent, live: NOW + 5 * MIN, unpriced: NOW + 5 * MIN }, intervals }).join(','),
);

check(
  'after an hour everything prematch comes back',
  dueGroups({ now: NOW + 60 * MIN, lastSent: { ...sent, live: NOW + 60 * MIN, unpriced: NOW + 60 * MIN }, intervals }).join(',') === 'soon,later',
);

check(
  'a zero/absent interval means "every cycle" (that is what PREMATCH_REFRESH_MS=0 relies on)',
  dueGroups({ now: NOW, lastSent: sent, intervals: { live: 0, soon: 0, later: 0, unpriced: 0 } }).join(',') ===
    SUBSCRIBE_GROUPS.join(','),
);

/* ---------------------------------------------- empty groups retry -------- */
console.log('\n-- groups that went out empty (cold start) --');
const ti = retryIntervals(intervals, ['soon', 'later']);
check(
  'an empty group retries on the live cadence instead of waiting an hour',
  ti.soon === intervals.live && ti.later === intervals.live,
  JSON.stringify(ti),
);
check('a group that did carry ids keeps its own interval', ti.unpriced === intervals.unpriced && ti.live === intervals.live);
check('live is unaffected', retryIntervals(intervals, ['live', 'unpriced']).live === intervals.live);
check(
  'the retry is what makes the second pass subscribe prematch (it was empty on connect)',
  dueGroups({ now: NOW + 20 * 1000, lastSent: sent, intervals: retryIntervals(intervals, ['soon', 'later']) }).join(',') ===
    'live,soon,later',
  dueGroups({ now: NOW + 20 * 1000, lastSent: sent, intervals: retryIntervals(intervals, ['soon', 'later']) }).join(','),
);

/* ---------------------------------------------- kickoff tiers -------------- */
console.log('\n-- kickoff tiers (splitByKickoff) --');
const kickoff = {
  1: NOW + 10 * MIN, // soon
  2: NOW + 29 * MIN, // soon (boundary)
  3: NOW + 31 * MIN, // later
  4: NOW - 5 * MIN, // already started -> soon
  5: null, // unknown kickoff -> later (sending it too rarely is the recoverable mistake)
  6: NOW + 2 * 60 * MIN, // hours away, ids arrive as strings from the database
};
const split = splitByKickoff([1, 2, 3, 4, 5, 6], kickoff, { now: NOW, soonMs: 30 * MIN });
check('soon = kicking off within 30 min (including one that already started)', split.soon.join(',') === '1,2,4', split.soon.join(','));
check('later = the rest, unknown kickoff included', split.later.join(',') === '3,5,6', split.later.join(','));
check(
  'soonMs=0 puts everything in later (the kill switch must not subscribe twice)',
  splitByKickoff([1, 2], kickoff, { now: NOW, soonMs: 0 }).later.length === 2,
);
check('every id ends up in exactly one tier', split.soon.length + split.later.length === 6);
check(
  'a Date kickoff value is accepted too',
  splitByKickoff([7], { 7: new Date(NOW + 5 * MIN) }, { now: NOW, soonMs: 30 * MIN }).soon.join(',') === '7',
);

/* ---------------------------------------------- no duplicate ids ----------- */
console.log('\n-- no duplicate subscriptions --');
check(
  'an unpriced fixture already sent as soon/later is not asked for twice in one cycle',
  withoutDuplicates([10, 11, 12], [11, 12, 13]).join(',') === '10',
);
check('ids compare as strings, so number/string forms do not slip through', withoutDuplicates(['10'], [10]).length === 0);

/* Always-on policy: inactivity and old Railway flags may never pause the feed. */
console.log('\n-- always-on server --');
setFeedMode(FEED_LIVE);
check('no visitors for days never triggers sleep',shouldSleep({clients:0,visits:0,lastActivityAt:0,now:NOW,idleAfterMs:1,coldBootIdleMs:1})===false);
const events=[];
const monitor=createIdleMonitor({enabled:true,idleAfterMs:1,coldBootIdleMs:1,onIdle:()=>events.push('idle'),onWake:()=>events.push('wake')});
check('legacy enabled flag cannot install sleep timers',monitor.start()===false&&monitor.state().enabled===false);
monitor.clientOpen();monitor.clientClose();monitor.touch();
await new Promise(resolve=>setTimeout(resolve,15));
check('an empty board keeps running',monitor.evaluate()===false&&getFeedMode()===FEED_LIVE&&events.length===0);
check('visitor metrics remain available',monitor.state().visits===1&&monitor.state().clients===0&&monitor.state().sleeps===0);
setFeedMode(FEED_IDLE);
check('legacy idle state cannot stop the server',getFeedMode()===FEED_LIVE&&shouldWake({mode:FEED_IDLE,requested:true})===false);
setFeedMode(FEED_WAKING);
check('explicit refresh safety guard is preserved',getFeedMode()===FEED_WAKING);
check('a completed explicit refresh returns live',monitor.markLive()===true&&getFeedMode()===FEED_LIVE);
monitor.stop();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

