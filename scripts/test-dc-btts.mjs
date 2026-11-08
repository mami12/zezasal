import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {isDcBttsMarket,parseDcBttsOutcome,gradeDcBtts} from '../server/ledger/dc-btts.mjs';
import {gradeLine} from '../server/ledger/settler.mjs';

assert.equal(isDcBttsMarket('Double Chance & Both Teams to Score'),true);
assert.equal(isDcBttsMarket('DC + BTTS'),true);
assert.equal(isDcBttsMarket('Full Time Result'),false);
for(const [label,dc,btts] of [
 ['1X & GG','1X',true],['X2 + NG','X2',false],
 ['12 & BTTS Yes','12',true],['Home or Draw & BTTS Yes','1X',true],
 ['Away or Draw & No','X2',false],['Draw or Home & Both Teams Score','1X',true],
 ['GG + X2','X2',true],['No & Home or Away','12',false],
 ['1X & Both Teams Not To Score','1X',false]
]){
 assert.deepEqual(parseDcBttsOutcome(label),{dc,btts},label);
}
for(const label of ['1X','BTTS Yes','1X & BTTS','No','Unknown 1X Stuff','1X GG 12']){
 assert.equal(parseDcBttsOutcome(label),null,label+' must not become a losing bet');
}
const game={home_score:2,away_score:1,half_home_score:1,half_away_score:0,
 home_team:'Home',away_team:'Away'};
for(const [label,expected] of [
 ['1X & GG','WON'],['12 & GG','WON'],['X2 & GG','LOST'],
 ['1X & NG','LOST'],['X2 & NG','LOST']
]){
 const choice=parseDcBttsOutcome(label);
 assert.equal(gradeDcBtts(choice,game.home_score,game.away_score),expected,label);
 assert.equal(gradeLine({market_name:'Double Chance & Both Teams to Score',
  outcome_name:label,outcome_key:label,builder_legs:null},game),expected,
  'Must use the same frozen selection at settlement');
}
assert.equal(gradeLine({market_name:'Double Chance & Both Teams to Score',
 outcome_name:'Unknown Combination',outcome_key:'opaque',builder_legs:null},game),null,
 'Unknown provider combinations remain ungraded, never automatically LOST');
assert.equal(gradeDcBtts(null,2,1),null);
assert.equal(gradeDcBtts(parseDcBttsOutcome('1X & GG'),NaN,1),null);
console.log('PASS DC+BTTS exact quote parsing and settlement with unknowns held for review');
