import assert from 'node:assert/strict';
import {enrichFotMobScorerNames} from '../server/stats-providers/fotmob-scorer-enrichment.mjs';
import {statisticMarketContract,gradeStatisticLine} from '../server/ledger/statistic-markets.mjs';

const fact=(overrides={})=>({provider_event_id:'z1',team:'home',minute:23,
 player_name:null,own_goal:false,aiscore_verified:false,...overrides});
const goal=(overrides={})=>({type:'goal',team:'home',minute:23,injury:0,
 player:'Player Example',own:false,...overrides});
let calls=[];
const execute=async(sql,args)=>{calls.push({sql,args});return {rowCount:1};};
let result=await enrichFotMobScorerNames(123,[fact()],[goal()],{execute});
assert.equal(result.updated,1);
assert.equal(calls.length,1);
assert.deepEqual(calls[0].args,[123,'z1','home','Player Example',23]);
assert.match(calls[0].sql,/own_goal=false/);
assert.match(calls[0].sql,/provider='zizobet'/);
assert.doesNotMatch(calls[0].sql,/insert into app_match_event_fact/);

for(const invalidFacts of [
 [fact({own_goal:null})],
 [fact({own_goal:true})],
 [fact({aiscore_verified:true,aiscore_player_name:'Different Player'})],
 [fact({player_name:'Different Player'})],
 [fact(),fact({provider_event_id:'z2'})]
]){
 calls=[];
 result=await enrichFotMobScorerNames(123,invalidFacts,[goal()],{execute});
 assert.equal(result.updated,0,'Ambiguous, own-goal or contradictory identity cannot be verified');
 assert.equal(calls.length,0);
}
calls=[];
assert.equal((await enrichFotMobScorerNames(123,[fact()],[goal({own:true})],{execute})).updated,0);
assert.equal(calls.length,0);

const fouls={market_name:'Which team has more fouls 1X2',outcome_name:'1'};
const shots={market_name:'Who has most shots on target 1X2',outcome_name:'2'};
assert.equal(statisticMarketContract(fouls)?.supported,true);
assert.equal(statisticMarketContract(fouls)?.scope,'result');
assert.equal(statisticMarketContract(shots)?.supported,true);
assert.equal(statisticMarketContract({market_name:'Who has most fouls',outcome_name:'1'})?.supported,false);
const final={home_team:'Home',away_team:'Away',statistics:{
 fouls:{home:14,away:10},shotsOnTarget:{home:3,away:6}}};
assert.equal(gradeStatisticLine({...fouls,outcome_key:'1'},final),'WON');
assert.equal(gradeStatisticLine({...fouls,outcome_key:'2',outcome_name:'2'},final),'LOST');
assert.equal(gradeStatisticLine({...shots,outcome_key:'2'},final),'WON');
console.log('PASS FotMob scorer identity anchored to verified Zizobet fact; 1X2 full-time foul and shot comparisons');
