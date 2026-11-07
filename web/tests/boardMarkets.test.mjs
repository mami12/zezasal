import assert from 'node:assert/strict';
// Exercise the shared selector directly. The browser wrapper in
// src/utils/boardMarkets.ts is a typed pass-through, and a data: URL module
// cannot resolve a relative import of the server implementation.
const { selectBoardMarkets, getBoardTotalLine, findBoardOutcome } = await import(new URL('../../server/board-markets.mjs', import.meta.url).href);

const goal = (line, extra = {}) => ({ id: `total-${line}`, name: 'Total Goals', marketType: 'OVER_UNDER', line, status: 'ACTIVE', outcomes: [{ name: 'Over' }, { name: 'Under' }], ...extra });
const result = (extra = {}) => ({ id: 'result', name: 'Full Time Result', marketType: '1X2', status: 'ACTIVE', outcomes: [{ name: '1' }, { name: 'X' }, { name: '2' }], ...extra });
const dc = (extra = {}) => ({ id: 'dc', name: 'Double Chance', marketType: 'DOUBLE_CHANCE', status: 'ACTIVE', outcomes: [{ name: '1X' }, { name: '12' }, { name: 'X2' }], ...extra });
const btts = (extra = {}) => ({ id: 'btts', name: 'Both Teams to Score', marketType: 'BTTS', status: 'ACTIVE', outcomes: [{ name: 'Yes' }, { name: 'No' }], ...extra });
const visible = market => market.status === 'ACTIVE' && !market.expired && !market.hidden;
const suspended = market => !market.expired && (market.status === 'SUSPENDED' || market.locked);
const select = (markets, teams) => selectBoardMarkets(markets, visible, suspended, teams);
let checks = 0;
const test = (name, run) => { run(); checks++; console.log(`PASS ${name}`); };

test('2.5 remains preferred regardless of API array order', () => assert.equal(select([goal(4.5), goal(2.5), goal(3.5)]).totalLine, 2.5));
test('missing 2.5 selects 3.5 before 4.5', () => assert.equal(select([goal(4.5), goal(3.5)]).totalLine, 3.5));
test('equally close lines prefer higher threshold', () => assert.equal(select([goal(1.5), goal(3.5)]).totalLine, 3.5));
test('4.5 is used when it is the only available total', () => assert.equal(select([goal(4.5)]).totalLine, 4.5));
test('nearest lower threshold is allowed when it is the available offer', () => assert.equal(select([goal(1.5), goal(5.5)]).totalLine, 1.5));
test('suspended 2.5 keeps its locked contract', () => {
  const locked = goal(2.5, { status: 'SUSPENDED' });
  assert.equal(select([locked, goal(3.5)]).total, locked);
});
test('expired suspended total does not return through lock eligibility', () => assert.equal(select([goal(2.5, { status: 'SUSPENDED', expired: true }), goal(4.5)]).totalLine, 4.5));
test('closed and settled totals are never selected through a stale lock', () => assert.equal(select([goal(2.5, { status: 'CLOSED', locked: true }), goal(3.5, { status: 'SETTLED', locked: true }), goal(4.5)]).totalLine, 4.5));
test('present suspended 1X2 never becomes DC', () => {
  const locked = result({ status: 'SUSPENDED' });
  const selected = select([locked, dc(), btts()]);
  assert.equal(selected.primary, locked); assert.equal(selected.primaryType, '1X2');
});
test('present but empty 1X2 does not silently change its contract', () => assert.equal(select([result({ outcomes: [] }), dc()]).primaryType, '1X2'));
test('absent 1X2 selects original DC market identity', () => {
  const market = dc(), selected = select([btts(), market]);
  assert.equal(selected.primary, market); assert.equal(selected.primaryType, 'DC');
});
test('absent result and DC selects BTTS', () => assert.equal(select([btts()]).primaryType, 'BTTS'));
test('explicit DC name overrides generic result-column 1X2 classification', () => {
  const market = dc({ marketType: '1X2' }), selected = select([market]);
  assert.equal(selected.primary, market); assert.equal(selected.primaryType, 'DC');
});
test('explicit BTTS name overrides generic result-column 1X2 classification', () => {
  const market = btts({ marketType: '1X2' }), selected = select([market]);
  assert.equal(selected.primary, market); assert.equal(selected.primaryType, 'BTTS');
});
test('a named total cannot masquerade as result because of generic 1X2 type', () => {
  const selected = select([goal(3.5, { marketType: '1X2' }), dc()]);
  assert.equal(selected.primaryType, 'DC'); assert.equal(selected.totalLine, 3.5);
});
test('suspended DC is retained instead of being swapped for BTTS', () => {
  const locked = dc({ status: 'SUSPENDED' });
  assert.equal(select([locked, btts()]).primary, locked);
});
test('closed DC cannot block an active BTTS fallback', () => assert.equal(select([dc({ status: 'CLOSED', locked: true }), btts()]).primaryType, 'BTTS'));
test('all closed alternatives produce no tradable primary', () => assert.equal(select([dc({ status: 'VOID' }), btts({ status: 'SETTLED' })]).primary, null));
test('a present closed 1X2 has no active prices and does not trigger substitution', () => {
  const selected = select([result({ status: 'CLOSED' }), dc()]);
  assert.equal(selected.primaryType, '1X2'); assert.equal(selected.primary, null);
});
test('half, minute and statistical result scopes are excluded', () => {
  const selected = select([result({ id: 'half', period: 1 }), result({ id: 'corner', name: 'Total Corners 1X2' }), result({ id: 'minute', name: 'First 10 minutes result' }), btts({ id: 'halves', name: 'Both teams to score in both halves' }), dc()]);
  assert.equal(selected.primary.id, 'dc');
});
test('canonical Match Result (1X2) alias works without a market type', () => assert.equal(select([result({ marketType: '', name: 'Match Result (1X2)' })]).primary.id, 'result'));
test('explicit regulation 90 minutes is accepted', () => assert.equal(select([result({ name: 'Full Time Result (90 minutes)' })]).primary.id, 'result'));
test('team, corner, half and mixed totals never replace full-time goals', () => {
  const selected = select([goal(2.5, { id: 'team', name: 'Arsenal Total Goals' }), goal(2.5, { id: 'corner', name: 'Total Corners' }), goal(2.5, { id: 'half', name: 'First Half Total Goals' }), goal(2.5, { id: 'mixed', name: 'Total Goals + BTTS' }), goal(4.5)], { homeTeam: 'Arsenal', awayTeam: 'Chelsea' });
  assert.equal(selected.totalLine, 4.5);
});
test('short team names do not accidentally match letters inside total titles', () => assert.equal(select([goal(2.5)], { homeTeam: 'A', awayTeam: 'B' }).totalLine, 2.5));
test('line parsing supports commas, specifiers, name and consistent outcome labels', () => {
  assert.equal(getBoardTotalLine(goal('3,5')), 3.5);
  assert.equal(getBoardTotalLine(goal(undefined, { specifier: 'total=4.5' })), 4.5);
  assert.equal(getBoardTotalLine(goal(undefined, { name: 'Total Goals (3.5)' })), 3.5);
  assert.equal(getBoardTotalLine(goal(undefined, { outcomes: [{ name: 'Over (4.5)' }, { name: 'Under (4.5)' }] })), 4.5);
  assert.equal(getBoardTotalLine(goal(undefined, { outcomes: [{ name: 'Over 3.5' }, { name: 'Under 4.5' }] })), null);
});
test('unknown thresholds are not displayed as an invented 2.5', () => assert.equal(select([goal(undefined)]).total, null));
test('named outcomes win over conflicting numeric codes', () => {
  const under = { id: 'u', name: 'Under', code: '1' }, over = { id: 'o', name: 'Over', code: '2' };
  assert.equal(findBoardOutcome({ outcomes: [under, over] }, ['over', 'o', '1']), over);
  assert.equal(findBoardOutcome({ outcomes: [over, under] }, ['under', 'u', '2']), under);
  assert.equal(findBoardOutcome({ outcomes: [under] }, ['over', '1']), null);
});
test('numeric code fallback is limited to empty or numeric outcome labels', () => {
  const unnamed = { id: 'numeric', name: '', code: '1' };
  assert.equal(findBoardOutcome({ outcomes: [unnamed] }, ['over', '1']), unnamed);
  assert.equal(findBoardOutcome({ outcomes: [{ name: 'Other meaning', code: '1' }] }, ['over', '1']), null);
});
test('short semantic aliases support a separated line or qualifier', () => {
  assert.equal(findBoardOutcome({ outcomes: [{ name: 'O 3.5' }, { name: 'U (3.5)' }] }, ['over', 'o']).name, 'O 3.5');
  assert.equal(findBoardOutcome({ outcomes: [{ name: 'No (BTTS)' }] }, ['no', 'ng']).name, 'No (BTTS)');
});
test('DC and BTTS labels remain distinct native selections', () => {
  const market = dc();
  assert.equal(findBoardOutcome(market, ['1x', '1/x', 'home or draw']).name, '1X');
  assert.equal(findBoardOutcome(market, ['12', '1/2', 'home or away']).name, '12');
  assert.equal(findBoardOutcome(btts(), ['yes', 'gg']).name, 'Yes');
});
test('choosing a total does not reorder or mutate the API snapshot', () => {
  const markets = [goal(4.5), goal(2.5)], before = JSON.stringify(markets);
  select(markets); assert.equal(JSON.stringify(markets), before);
});
const nextGoalMarket = (name, extra = {}) => ({ id: 'next', name, marketType: 'NEXT_GOAL', status: 'ACTIVE', outcomes: [{ name: 'Home' }, { name: 'Away' }], ...extra });
test('the 0-0 title "First team to score" is the next-goal column', () => {
  assert.equal(select([nextGoalMarket('First Team to Score')]).nextGoal?.name, 'First Team to Score');
});
test('the post-goal title "Next Goal" is the same next-goal column', () => {
  assert.equal(select([nextGoalMarket('Next Goal')]).nextGoal?.name, 'Next Goal');
});
test('a team-to-score title without a market type is still recognised', () => {
  assert.equal(select([{ ...nextGoalMarket('First Team to Score'), marketType: undefined }]).nextGoal?.name, 'First Team to Score');
});
test('goal-timing markets never become the team-to-score column', () => {
  assert.equal(select([nextGoalMarket('When will goal 1 be scored')]).nextGoal, null);
});
test('player goalscorer markets never become the team-to-score column', () => {
  assert.equal(select([nextGoalMarket('First Goalscorer')]).nextGoal, null);
});
test('the next-goal column coexists with the main board contracts', () => {
  const selected = select([result(), goal(2.5), nextGoalMarket('Next Goal')]);
  assert.equal(selected.primaryType, '1X2');
  assert.equal(selected.totalLine, 2.5);
  assert.equal(selected.nextGoal?.name, 'Next Goal');
});
console.log(`PASS ${checks} board selection cases`);
