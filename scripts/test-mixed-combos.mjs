import assert from 'node:assert/strict';
import { isResultTotalMarket, isTotalBttsMarket, isFirstHalfResultBtts, parseResultTotal, parseTotalBtts, gradeMixedTotal } from '../server/ledger/mixed-combos.mjs';
import { isResultBttsMarket, parseResultBttsOutcome, gradeResultBtts } from '../server/ledger/result-btts.mjs';
// The settler's database pool is constructed on import, but these tests never connect.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/mixed_test';
const { gradeLine } = await import('../server/ledger/settler.mjs');
const { verifiedFirstHalf } = await import('../server/ledger/results.mjs');
const { betRequestHash } = await import('../server/ledger/bets.mjs');
const home = 'Lyon', away = 'Crystal Palace';
assert.ok(isResultTotalMarket('Result and total'));
assert.ok(isTotalBttsMarket('Total and both teams to score'));
assert.ok(isResultBttsMarket('Result and both teams to score'));
assert.ok(isFirstHalfResultBtts('1st half. Result and both teams to score'));
assert.ok(isResultBttsMarket('1st half. Result and both teams to score'));
for (const label of [
  'Crystal Palace And Over 2.5', 'Crystal Palace And Under 2.5',
  'Draw And Over 2.5', 'Draw And Under 2.5',
  'Lyon And Over 2.5', 'Lyon And Under 2.5',
]) assert.ok(parseResultTotal(label, home, away), label);
for (const label of [
  'Over 2.5 And No', 'Over 2.5 And Yes',
  'Under 2.5 And No', 'Under 2.5 And Yes',
]) assert.ok(parseTotalBtts(label), label);
for (const label of [
  'Both Teams Not To Score and Draw',
  'Both Teams To Score And Draw',
  'Crystal Palace And Both To Score',
  'Crystal Palace To Nil',
  'Lyon And Both To Score',
  'Lyon To Nil',
]) assert.ok(parseResultBttsOutcome(label, home, away), label);
assert.deepEqual(parseResultBttsOutcome('Crystal Palace To Nil', home, away), {result:'2',bothScore:false});
assert.deepEqual(parseResultBttsOutcome('Lyon To Nil', home, away), {result:'1',bothScore:false});
assert.deepEqual(parseResultBttsOutcome('Crystal Palace And Both To Score', home, away), {result:'2',bothScore:true});
assert.equal(gradeResultBtts(parseResultBttsOutcome('Lyon To Nil', home, away), 2, 0), 'WON');
assert.equal(gradeResultBtts(parseResultBttsOutcome('Lyon To Nil', home, away), 2, 1), 'LOST');
assert.equal(gradeMixedTotal('Result and total', parseResultTotal('Lyon And Over 2.5', home, away), 2, 1), 'WON');
assert.equal(gradeMixedTotal('Result and total', parseResultTotal('Lyon And Under 2.5', home, away), 2, 1), 'LOST');
assert.equal(gradeMixedTotal('Total and both teams to score', parseTotalBtts('Over 2.5 And Yes'), 2, 1), 'WON');
assert.equal(gradeMixedTotal('Total and both teams to score', parseTotalBtts('Under 2.5 And Yes'), 1, 1), 'WON');
assert.equal(gradeMixedTotal('Total and both teams to score', parseTotalBtts('Under 2.5 And No'), 1, 0), 'WON');
assert.equal(parseResultTotal('Unknown And Over 2.5', home, away), null);
assert.equal(parseTotalBtts('Over 2.5 And Maybe'), null);
const result={home_team:home,away_team:away,home_score:2,away_score:1};
const line=(market_name,outcome_name)=>({market_name,outcome_name,outcome_key:'unknown',line:''});
assert.equal(gradeLine(line('Result and total','Lyon And Over 2.5'), result), 'WON');
assert.equal(gradeLine(line('Total and both teams to score','Over 2.5 And Yes'), result), 'WON');
assert.equal(gradeLine(line('Result and both teams to score','Lyon And Both To Score'), result), 'WON');
assert.equal(gradeLine(line('1st half. Result and both teams to score','Lyon And Both To Score'), result), null,
  'Missing first-half result is PENDING, never a stake refund');
console.log('All four provider mixed market contract regressions passed.');

assert.deepEqual(verifiedFirstHalf([{t1:'1',t2:'1'}, {t1:'2',t2:'0'}]), {home:1,away:1});
assert.equal(verifiedFirstHalf([{t1:'1',t2:'1'}]), null, 'One unlabeled period is not enough');
assert.equal(verifiedFirstHalf([{t1:null,t2:'1'}, {t1:'1',t2:'0'}]), null);
assert.equal(gradeLine(
  line('1st half. Result and both teams to score', 'Both Teams To Score And Draw'),
  {...result, half_home_score:1, half_away_score:1}
), 'WON', 'Settle first-half draw with BTTS using halftime data');
assert.equal(gradeLine(
  line('1st half. Result and both teams to score', 'Both Teams To Score And Draw'),
  {...result, half_home_score:1, half_away_score:0}
), 'LOST', 'Do not use final result for first-half grading');

const ticketPayload = { stake: 500, ticketType: 'SINGLE', systemType: '',
  selections: [{outcomeId:'match:market:outcome',oddsAtPlacement:2.25}] };
assert.equal(betRequestHash(ticketPayload), betRequestHash({...ticketPayload}),
  'The same retry must have the same payload hash');
assert.notEqual(betRequestHash(ticketPayload), betRequestHash({...ticketPayload, stake: 600}),
  'A changed stake must not be treated as an identical request');
assert.notEqual(betRequestHash(ticketPayload),
  betRequestHash({...ticketPayload, selections:[{outcomeId:'different',oddsAtPlacement:2.25}]}),
  'A changed selection must not be treated as an identical request');
