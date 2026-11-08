import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {isHalfComboFamily,parseHalfCombination,gradeHalfCombination} from '../server/ledger/half-combinations.mjs';
import {gradeLine,hasRequiredSettlementEvidence} from '../server/ledger/settler.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';

const score={home_team:'Home',away_team:'Away',
 home_score:3,away_score:2,half_home_score:1,half_away_score:0};
const quote=(market_name,outcome_name,period=0)=>({market_name,outcome_name,period});
for(const [market,outcome,expected]of [
 ['1st Half Result and Total','1 and Over 0.5','WON'],
 ['1st Half Result and BTTS','1 & No','WON'],
 ['1st Half Total and BTTS','Over 0.5 & NG','WON'],
 ['1st Half Double Chance and BTTS','1X & No','WON'],
 ['2nd Half Result and Total','X & Over 3.5','WON'],
 ['2nd Half Total and BTTS','Over 3.5 & GG','WON'],
 ['2nd Half Result and Both Teams to Score','Draw and Yes','WON'],
 ['2nd Half Double Chance and Total','X2 & Over 3.5','WON'],
 ['Full Time Result and Total Goals','1 & Over 4.5','WON'],
 ['Full Time Double Chance and Total','1X & Over 5.5','LOST'],
 ['1st Half Result and Total','2 and Over 0.5','LOST'],
 ['1st Half Result and Total','1 & Under 1.0','VOID']
]){
 const line=quote(market,outcome);
 const contract=parseHalfCombination(line,score);
 assert.ok(contract,market+' could not parse');
 assert.equal(gradeHalfCombination(contract,score),expected,market+' '+outcome);
 assert.equal(gradeLine(line,score),expected,'Legacy wager must use identical math');
 assert.equal(hasRequiredSettlementEvidence(line,score),true);
 assert.equal(await gradeStoredEventContract({live_contract:contract},score,{execute:()=>{
  throw Error('A score-only combination must not require incident chronology');}}),expected);
}
for(const line of [
 quote('1st Half Result and Total','Unknown and Over 2.5'),
 quote('1st Half Result and BTTS','1 and Unknown'),
 quote('2nd Half Result and BTTS','Draw and Yes',1),
 quote('2nd Half Double Chance and Total','1X and Over 0.25'),
 quote('1st Half Result and Total','1 and Over 2.5 and Yes')
]){
 assert.equal(isHalfComboFamily(line),true,'Still a combination market');
 assert.equal(parseHalfCombination(line,score),null,'Invalid contract cannot be guessed');
 assert.equal(gradeLine(line,score),null,'Invalid option must not be LOST or VOID');
 assert.equal(hasRequiredSettlementEvidence(line,score),false);
}
const incomplete={...score,half_home_score:null};
assert.equal(gradeLine(quote('2nd Half Result and Total','X and Over 3.5'),incomplete),null,
 'FT alone cannot prove second-half correlated props');
assert.equal(gradeLine(quote('1st Half Total and BTTS','Over 0.5 & NG'),incomplete),null);
assert.equal(gradeLine(quote('1st Half Result and Total','1 and Over 0.5'),
 {...score,half_home_score:5}),null,'HT cannot exceed FT');
const secondNoGoals={...score,half_home_score:3,half_away_score:2};
assert.equal(gradeLine(quote('2nd Half Total and BTTS','Under 0.5 & NG'),secondNoGoals),'WON');
console.log('PASS first/second/full time result-total BTTS and DC combos with period scoring and unknown selection holds');
