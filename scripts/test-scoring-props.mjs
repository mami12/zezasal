import assert from 'node:assert/strict';
import {isScoringPropMarket,gradeScoringPropMarket} from '../server/ledger/scoring-props.mjs';
const result={home_team:'Home',away_team:'Away',home_score:2,away_score:1,
 half_home_score:1,half_away_score:0};
const grade=(market_name,outcome_name,data=result)=>gradeScoringPropMarket({market_name,outcome_name},data);
for(const [market,outcome,expected] of [
 ['Both Teams To Score In Both Halves','No','WON'],
 ['Goal in Both Halves','Yes','WON'],
 ['Home Team To Score In Both Halves','Yes','WON'],
 ['Away Team To Score In Both Halves','No','WON'],
 ['Home Team To Win Both Halves','No','WON'],
 ['Home Team To Win Either Half','Yes','WON'],
 ['Away Team To Score In 1st Half','No','WON'],
 ['Away Team To Score In 2nd Half','Yes','WON'],
 ['Highest Scoring Half','2nd Half','WON'],
 ['Highest Scoring Half','Draw','LOST'],
 ['Home Team Goals Odd/Even','Even','WON'],
 ['Home Team Exact Goals','2','WON'],
 ['Home Team Win To Nil','Yes','LOST'],
 ['1st Half - Home Team To Score','Yes','WON'],
 ['Win Both Halves','Home','LOST'],
 ['Win Either Half','Home','WON'],
 ['Win To Nil','Away','LOST'],
 ['Home Team Highest Scoring Half','2nd Half','LOST'],
 ['Home Team Highest Scoring Half','Draw','WON']
])assert.equal(grade(market,outcome),expected,market+' '+outcome);
assert.equal(grade('Liverpool To Score In Both Halves','Yes',{
 ...result,home_team:'Liverpool'}),'WON');
assert.equal(grade('Liverpool To Score In Both Halves','Yes',result),null,
 'Unknown named side never becomes the home team by assumption');
assert.equal(grade('Home Team To Score In Both Halves','Maybe'),null);
assert.equal(grade('Home Team To Score In Both Halves','Yes',{...result,half_home_score:null}),null);
assert.equal(grade('Home Team To Score In Both Halves','Yes',{...result,half_home_score:3}),null,
 'A contradictory HT > FT cannot settle a bet');
assert.equal(grade('Home Team To Score In Both Halves','Yes',{...result,home_score:null}),null);
assert.equal(isScoringPropMarket({market_name:'Both Teams To Score'}),false);
assert.equal(isScoringPropMarket({market_name:'First Goalscorer'}),false);
assert.equal(isScoringPropMarket({market_name:'Asian Handicap'}),false);
console.log('PASS team-scoring props FT/HT: both halves, either/both wins, nil, parity, exact and contradictory evidence');
