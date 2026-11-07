import assert from 'node:assert/strict';
import {
  assertLiveMoneyLimits, assertLiveMatchExposure,
} from '../server/ledger/bet-risk.mjs';
import {
  DEFAULT_LIVE_RISK_SETTINGS, validateLiveRiskSettings,
} from '../server/live-risk-settings.mjs';

const { limits } = validateLiveRiskSettings(DEFAULT_LIVE_RISK_SETTINGS);

// Gross stakes are counted across all LIVE columns in the one request.
assert.doesNotThrow(() => assertLiveMoneyLimits(10000,100000,limits));
assert.throws(() => assertLiveMoneyLimits(10001,1000,limits), e => e.code === 'LIVE_RISK_LIMIT');
assert.throws(() => assertLiveMoneyLimits(1000,100001,limits), e => e.code === 'LIVE_RISK_LIMIT');
assert.doesNotThrow(() =>
  assertLiveMoneyLimits(100000000,100000000,{maxLiveStake:null,maxLivePayout:null}));

// Existing pending liability plus proposed payout is compared under the
// global settings row lock (see assertLiveBetRisk integration).
const existing = new Map([['123',450000],['124',100000]]);
assert.doesNotThrow(() =>
  assertLiveMatchExposure(new Map([['123',50000]]),existing,500000));
assert.throws(() =>
  assertLiveMatchExposure(new Map([['123',50001]]),existing,500000),
  e => e.code === 'LIVE_MATCH_EXPOSURE');
assert.doesNotThrow(() =>
  assertLiveMatchExposure(new Map([['123',2000000]]),existing,null));
assert.throws(() =>
  assertLiveMatchExposure(new Map([['124',400001],['123',100]]),existing,500000),
  e => e.code === 'LIVE_MATCH_EXPOSURE');

console.log('Live stake, payout and per-match financial risk caps passed');
