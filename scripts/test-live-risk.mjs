import assert from 'node:assert/strict';
import { config } from '../server/config.mjs';
import {
  liveRiskReason, riskMinute, isFullTimeWinnerMarket, isLeaderWinChoice,
  isRiskMarketCategory,
} from '../server/live-risk.mjs';
import {
  DEFAULT_LIVE_RISK_SETTINGS, liveRiskSettings, setLiveRiskSettings, validateLiveRiskSettings,
} from '../server/live-risk-settings.mjs';

const now = Date.now();
const match = (minute, home, away, options = {}) => ({
  service: 'LIVE',
  match_time_ms: minute * 60000,
  clock_at: new Date(now).toISOString(),
  home_score: home,
  away_score: away,
  score_at: new Date(now).toISOString(),
  ...options,
});
const result = (side, price, options = {}) => ({
  marketName: 'Full Time Result',
  marketKey: '1x2',
  outcomeKey: side,
  price,
  ...options,
});
const check = (m, o) => liveRiskReason(m, o, now);

assert.equal(isFullTimeWinnerMarket('Full Time Result', 'g6321'), true);
for (const name of ['Next Goal','Corners Result','Half Time Result','Correct Score','Double Chance']) {
  assert.equal(isFullTimeWinnerMarket(name, '1x2'), false);
}
assert.equal(isLeaderWinChoice('1','Home','home'),true);
assert.equal(isLeaderWinChoice('2','Away','home'),false);
assert.equal(riskMinute(match(60,0,3),now),60);

// Milan 0-3 at minute 60: block only the away leader priced <=1.60.
assert.equal(check(match(59,0,3), result('2',1.50)),null);
assert.equal(check(match(60,0,3), result('2',1.60)),'leader_low_odds');
assert.equal(check(match(60,0,3), result('2',1.61)),null);
assert.equal(check(match(60,0,3), result('1',1.60)),null);
assert.equal(check(match(60,0,3), result('X',1.60)),null);
assert.equal(check(match(60,2,0), result('1',1.50)),null);
assert.equal(check(match(65,2,0), result('1',1.40)),'leader_low_odds');
assert.equal(check(match(65,2,0), result('1',1.41)),null);
assert.equal(check(match(70,2,0), result('1',1.60)),'leader_low_odds');
assert.equal(check(match(70,2,0), result('1',1.61)),null);
assert.equal(check(match(72,2,1), result('1',1.40)),null);
assert.equal(check(match(85,1,0), result('1',1.10)),'low_live_odds');

// Full-market closure at minute 90: a 1-1 score must lock ALL 1/X/2,
// even though 1 and 2 may have odds of 11.00+.
for (const [side,price] of [['1',11],['X',1.05],['2',13]]) {
  assert.equal(check(match(89,1,1),result(side,price)),side==='X' ? 'low_live_odds' : null);
  assert.equal(check(match(90,1,1),result(side,price)),'market_closed');
}
assert.equal(check(match(90,2,1),result('2',12)),'market_closed',
  'A late goal must not reopen 1X2 when the rule is ANY score');
assert.equal(check(match(90,1,1),{marketName:'Total Corners',marketKey:'corners',price:11}),null);
assert.equal(check(match(90,1,1),{marketName:'Double Chance',marketKey:'dc',price:11}),null);
assert.equal(check(match(90,1,1,{service:'PREMATCH'}),result('1',11)),null);

// Category matching must not close other, similarly named markets.
for(const [name,key,category,expected] of [
  ['Full Time Result','g6321','1X2',true],
  ['Half Time Result','1x2','1X2',false],
  ['Double Chance','dc','DOUBLE_CHANCE',true],
  ['Both Teams To Score','btts','BTTS',true],
  ['Total Goals','total','TOTAL_GOALS',true],
  ['Total Corners','total','TOTAL_GOALS',false],
  ['Total Cards','total','TOTAL_GOALS',false],
  ['Next Goal','goals','TOTAL_GOALS',false],
  ['Total Corners','corners','CORNERS',true],
  ['Booking Points','cards','CARDS',true],
]) assert.equal(isRiskMarketCategory(name,key,category),expected,`${name} as ${category}`);

const customPolicy = {
  ...structuredClone(DEFAULT_LIVE_RISK_SETTINGS),
  marketClosureRules:[{minute:80,market:'1X2',score:'DRAW'}],
};
assert.equal(liveRiskReason(match(80,1,1),result('1',11),now,customPolicy),'market_closed');
assert.equal(liveRiskReason(match(80,2,1),result('1',11),now,customPolicy),null);
assert.equal(liveRiskReason(match(80,1,1,{score_at:null}),result('1',11),now,customPolicy),null);
assert.equal(liveRiskReason(match(80,1,1),{marketName:'Total Goals',price:11},now,{
  ...customPolicy,marketClosureRules:[{minute:80,market:'ALL',score:'ANY'}],
}),'market_closed');

// Across all markets, including X, corners, cards, and totals.
for (const name of ['Full Time Result','Total Corners','Total Cards','Total Goals','Both Teams to Score']) {
  assert.equal(check(match(60,0,0),{marketName:name,outcomeKey:'X',price:1.05}),'low_live_odds');
  assert.equal(check(match(60,0,0),{marketName:name,outcomeKey:'X',price:1.06}),null);
  assert.equal(check(match(70,0,0),{marketName:name,outcomeKey:'X',price:1.10}),'low_live_odds');
  assert.equal(check(match(80,0,0),{marketName:name,outcomeKey:'X',price:1.20}),'low_live_odds');
  assert.equal(check(match(80,0,0),{marketName:name,outcomeKey:'X',price:1.21}),null);
}
assert.equal(check(match(70,0,0,{service:'PREMATCH'}), result('X',1.05)),null);

// Provider evidence is required for the leader rule.
assert.equal(check(match(65,3,0,{score_at:null}),result('1',1.40)),null);
assert.equal(check(match(60,3,0,{match_time_ms:null,live_minute:null}),result('1',1.40)),null);
const halftime=match(45,2,0,{phase:'HT',clock_at:new Date(now-45*60000).toISOString()});
assert.equal(riskMinute(halftime,now),45);

// Both master and admin switches are reversible.
const enabled=config.liveRiskEnabled;
config.liveRiskEnabled=false;
try {assert.equal(check(match(70,3,0),result('1',1.20)),null);}
finally {config.liveRiskEnabled=enabled;}
assert.equal(check(match(70,3,0),result('1',1.20)),'leader_low_odds');
const saved=structuredClone(liveRiskSettings());
try {
  setLiveRiskSettings({...saved,enabled:false});
  assert.equal(check(match(70,3,0),result('1',1.20)),null);
  setLiveRiskSettings({...saved,lowOddsRules:[{minute:45,maxOdds:1.25}]});
  assert.equal(check(match(46,0,0),result('X',1.25)),'low_live_odds');
} finally {setLiveRiskSettings(saved);}

// Admin validation: no malformed settings may reach the database.
assert.equal(validateLiveRiskSettings(DEFAULT_LIVE_RISK_SETTINGS).limits.maxLiveStake,10000);
assert.deepEqual(validateLiveRiskSettings({
  ...DEFAULT_LIVE_RISK_SETTINGS,marketClosureRules:undefined,
}).marketClosureRules,[{minute:90,market:'1X2',score:'ANY'}],
'Old persisted settings must receive the new closure rule');
assert.equal(validateLiveRiskSettings({
  ...DEFAULT_LIVE_RISK_SETTINGS,marketClosureRules:[],
}).marketClosureRules.length,0,'Admin may turn off every full-market rule');
for(const invalid of [
  {...saved,leaderRules:[{minute:-1,goals:2,maxOdds:1.6}]},
  {...saved,marketClosureRules:[{minute:130,market:'1X2',score:'ANY'}]},
  {...saved,marketClosureRules:[{minute:90,market:'SOMETHING',score:'ANY'}]},
  {...saved,marketClosureRules:[{minute:90,market:'1X2',score:'UNKNOWN'}]},
  {...saved,marketClosureRules:[{minute:90,market:'1X2',score:'ANY'},{minute:90,market:'1X2',score:'ANY'}]},
  {...saved,lowOddsRules:[{minute:70,maxOdds:1.1},{minute:70,maxOdds:1.2}]},
  {...saved,limits:{...saved.limits,maxLiveStake:Infinity}},
  {...saved,limits:{...saved.limits,maxMatchExposure:0}},
]) assert.throws(()=>validateLiveRiskSettings(invalid),e=>e.status===400);
console.log('Admin-configured live risk policy checks passed');
