import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';
import {gradeWithSyntheticStoredFacts} from './fixtures/simulimi-stored-evidence.mjs';
import {diagnosticForScope,diagnosticForAllScopes} from './fixtures/simulimi-acceptance.mjs';

const make=(id,type,team,minute,player=null)=>({
 id,type,team,minute,seconds:minute*60+11,
 phase:minute<45?'H1':'H2',
 ...(player?{player}:{}),ownGoal:false,
 ...(type==='card'?{cardColor:'yellow'}:{})
});
const fixture={
 name:'TEST_2_1',
 score:{
  home_team:'Home Team',away_team:'Away Team',
  home_score:2,away_score:1,half_home_score:1,half_away_score:0,
  corners_home:2,corners_away:1,cards_home:1,cards_away:1
 },
 final:{events:[
  make('g1','goal','home',12,'Home scorer'),
  make('g2','goal','away',49,'Away scorer'),
  make('g3','goal','home',70,'Home scorer'),
  make('c1','corner','home',11),
  make('c2','corner','away',14),
  make('c3','corner','home',52),
  make('k1','card','home',15,'Home player'),
  make('k2','card','away',60,'Away player')
 ]}
};
const quote=(market_name,outcome_name,line='')=>({market_name,outcome_name,line,period:0});
const checks=[
 ['Total Goals in minutes 10-20','Over','0.5','WON'],
 ['Total Goals in minutes 10-20','Under','0.5','LOST'],
 ['Total Corners in minutes 10-20','Over','1.5','WON'],
 ['Total Corners in minutes 10-20','Under','1.5','LOST'],
 ['Who takes most corners in minutes 10-20','X','','WON'],
 ['Who scores most goals in minutes 10-20','1','','WON'],
 ['1st half - Home team exact corners','1','','WON'],
 ['2nd half - Away team exact cards','1','','WON'],
 ['1st half - Away team red card','No','','WON'],
 ['Which team wins race to 2 goals','1','','WON'],
 ['Which team wins race to 4 corners','None','','WON']
];
for(const [name,choice,line,expected] of checks){
 const c=liveContract(quote(name,choice,line),{
  counts:{goal:{home:0,away:0},corner:{home:0,away:0},card:{home:0,away:0}},
  clock:0,teams:{home:'Home Team',away:'Away Team'}
 });
 assert.ok(c,'Production parser must recognize '+name+' / '+choice);
 assert.equal(await gradeWithSyntheticStoredFacts(c,fixture),expected,
  'Stored event grader: '+name+' / '+choice);
}
const window=quote('Will there be a goal in minutes 10-20','Yes');
assert.equal(diagnosticForScope(window,'PREMATCH').status,'CONTRACT_MAPPED_ONLY');
assert.equal(diagnosticForScope(window,'LIVE_0').status,'CONTRACT_MAPPED_ONLY');
const liveStarted=diagnosticForScope(window,'LIVE_15');
assert.equal(liveStarted.status,'CONTRACT_MAPPED_ONLY',
 'An interval already underway remains eligible for events after purchase, not automatically rejected');
assert.equal(liveStarted.rule,'window');
const handicap=diagnosticForScope(quote('Asian Handicap','Home','1.25'),'PREMATCH');
assert.equal(handicap.status,'REJECTED');
assert.match(handicap.reason,/0.25|0.75/);
const all=diagnosticForAllScopes(window);
assert.deepEqual(Object.keys(all),['PREMATCH','LIVE_0','LIVE_15','LIVE_60']);
console.log('PASS simulimi stored-event outcomes and precise PREMATCH/LIVE preflight reasons');
