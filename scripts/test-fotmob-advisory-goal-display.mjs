import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {displayOnlyFotMobScorers} from '../server/stats-providers/primary-goal-display.mjs';
import {needsFotMobScorerLookup} from '../server/stats-providers/service.mjs';

const row={match_id:9911,service:'LIVE',home:'Alpha',away:'Beta',home_score:1,away_score:1,
 raw:{eventTimeline:[
  {id:'zizo1',type:'goal',team:'home',minute:12},
  {id:'zizo2',type:'goal',team:'away',minute:30}
 ]}};
const fotmob={homeScore:1,awayScore:1,goalEvents:[
 {type:'goal',team:'home',minute:12,player:'First Scorer',own:false},
 {type:'goal',team:'away',minute:30,player:'Second Scorer',own:false}
]};
assert.equal(needsFotMobScorerLookup(row,null),true,'Current score with no primary archive still needs names');
assert.equal(needsFotMobScorerLookup({...row,home_score:0,away_score:0},null),false);
assert.equal(needsFotMobScorerLookup(row,{hasGoals:true,missingScorers:false}),false);
assert.equal(needsFotMobScorerLookup(row,{hasGoals:true,missingScorers:true}),true);
const names=displayOnlyFotMobScorers(row,fotmob);
assert.deepEqual(names.map(x=>[x.minute,x.team,x.player,x.source]),[
 [12,'home','First Scorer','fotmob'],[30,'away','Second Scorer','fotmob']]);
assert.deepEqual(displayOnlyFotMobScorers({...row,home_score:2},fotmob),[],
 'A contradictory scoreboard must not attach a different fixture scorer');
assert.deepEqual(displayOnlyFotMobScorers({...row,raw:{eventTimeline:[]}},fotmob),[],
 'No PRIMARY incident: FotMob cannot create a synthetic goal');
assert.deepEqual(displayOnlyFotMobScorers(row,{...fotmob,goalEvents:[
 {...fotmob.goalEvents[0],minute:13},fotmob.goalEvents[1]
]}).map(s=>s.player),['Second Scorer'],
 'Only exact team/minute verified slots can borrow actor names');
assert.deepEqual(displayOnlyFotMobScorers(row,{...fotmob,goalEvents:[
 {...fotmob.goalEvents[0],own:true},fotmob.goalEvents[1]
]}).map(s=>s.player),['Second Scorer'],
 'Own goals never identify a player as a credited scorer');
assert.deepEqual(displayOnlyFotMobScorers({...row,home_score:2,away_score:0,
 raw:{eventTimeline:[
  {id:'z1',type:'goal',team:'home',minute:12},
  {id:'z2',type:'goal',team:'home',minute:12}
 ]}},{
 homeScore:2,awayScore:0,goalEvents:[
  {type:'goal',team:'home',minute:12,player:'A',own:false},
  {type:'goal',team:'home',minute:12,player:'B',own:false}
 ]}),[], 'Two primary goals in the same minute cannot be uniquely named');
console.log('PASS FotMob advisory names only for existing source-matched goals; no extra market or financial authority');
