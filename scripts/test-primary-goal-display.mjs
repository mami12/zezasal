import assert from 'node:assert/strict';
import {primaryGoalDisplay,matchedSupplementalScorers} from '../server/stats-providers/primary-goal-display.mjs';

const coverage={count_home:2,count_away:1,through_minute:78,
 confirmed_at:'2026-11-08T12:00:00Z'};
const row={home_score:2,away_score:1,match_time_ms:76*60*1000};
const facts=[
 {provider_event_id:'g1',minute:12,phase:'H1',team:'home',player_name:'First Scorer'},
 {provider_event_id:'g2',minute:48,phase:'H2',team:'away',player_name:null},
 {provider_event_id:'g3',minute:74,phase:'H2',team:'home',player_name:null,
  aiscore_player_name:'Second Scorer',aiscore_verified:true}
];
const primary=primaryGoalDisplay(coverage,facts,row);
assert.ok(primary,'Complete and confirmed Zizobet chronology should create display data');
assert.equal(primary.source,'zizobet');
assert.deepEqual(primary.goalIntervals.map(x=>[x.home,x.away]),
 [[1,0],[0,0],[0,0],[0,1],[1,0],[0,0]]);
assert.deepEqual(primary.scorers.map(x=>x.player),
 ['First Scorer','Second Scorer']);
assert.equal(primary.missingScorers,true);
assert.equal(primary.hasGoals,true);
assert.equal(primaryGoalDisplay({...coverage,confirmed_at:null},facts,row),null,
 'Unconfirmed primary snapshots must not supply supplementary scorer facts');
assert.equal(primaryGoalDisplay({...coverage,count_home:1},facts,row),null,
 'Missing goal incidents cannot be silently treated as a complete timeline');
assert.equal(primaryGoalDisplay(coverage,facts,{...row,home_score:3}),null,
 'A goal timeline must agree with Zizobet current scoreboard');
assert.equal(primaryGoalDisplay(coverage,facts,{...row,match_time_ms:85*60000}),null,
 'An out-of-date Zizobet source cannot pretend to cover the current clock');
assert.equal(primaryGoalDisplay(coverage,[facts[0],facts[0],facts[2]],row),null,
 'Duplicate primary event IDs cannot produce a complete timeline');
const matched=matchedSupplementalScorers(facts,[
 {minute:48,team:'away',player:'Missing Away Scorer'},
 {minute:48,team:'home',player:'Wrong Team'},
 {minute:65,team:'home',player:'No Primary Goal'},
 {minute:12,team:'home',player:'Alternate Name'},
]);
assert.deepEqual(matched,[
 {minute:48,team:'away',player:'Missing Away Scorer'},
 {minute:12,team:'home',player:'Alternate Name'}
], 'FotMob can only add a display name to a unique existing same-team/same-minute primary goal');
assert.deepEqual(matchedSupplementalScorers([
 {...facts[0],provider_event_id:'g1'},{...facts[0],provider_event_id:'g4'}
],[{minute:12,team:'home',player:'Unknown'}]),[],
 'Two Zizobet goals in the same minute cannot receive a guessed matching name');
const addedTime=primaryGoalDisplay({
 count_home:1,count_away:1,through_minute:94,confirmed_at:'2026-11-08T12:00:00Z'
},[
 {provider_event_id:'h1',minute:47,phase:'1st half',team:'home',player_name:'A'},
 {provider_event_id:'h2',minute:93,phase:'2nd half',team:'away',player_name:'B'}
],{home_score:1,away_score:1,match_time_ms:92*60000});
assert.ok(addedTime,'Zizobet 45+2 / 90+3 remain valid regulation injury-time goals');
assert.deepEqual(addedTime.goalIntervals.map(i=>[i.home,i.away]),
 [[0,0],[0,0],[1,0],[0,0],[0,0],[0,1]],
 '45+2 must display in 31-45+, and 90+3 in 76-90+');
assert.deepEqual(matchedSupplementalScorers(facts,[
 {minute:48,team:'away',player:'First Name'},
 {minute:48,team:'away',player:'Conflicting Name'},
 {minute:74,team:'home',player:'Own Goal',own:true}
]),[],'Ambiguous source actors and own goals may not supply a scorer name');
console.log('PASS primary Zizobet verified goal time buckets and strictly matched supplemental scorer names');
