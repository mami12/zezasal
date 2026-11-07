import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {normalizeLiveFrame} from '../server/ledger/live-observation-store.mjs';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';
import {primaryLiveDecision} from '../server/ledger/verified-live-settlement.mjs';

const source=normalizeLiveFrame({Match:{Score:'1:1',MatchTimeExtended:'79:00',
 CornersTeam1:2,CornersTeam2:2,YellowCardsTeam1:1,YellowCardsTeam2:0,
 RedCardsTeam1:0,RedCardsTeam2:0,EventStatus:6},TimeLines:[
 {id:'c10',type:'corner_kick',team:1,gt:10,clk:'10:30'},
 {id:'c20',type:'corner_kick',team:2,gt:20,clk:'20:15'},
 {id:'c30',type:'corner_kick',team:1,gt:30,clk:'30:00'},
 {id:'c40',type:'corner_kick',team:2,gt:40,clk:'40:00'},
 {id:'g15',type:'score_change',team:1,gt:15,clk:'15:00'},
 {id:'g74',type:'score_change',team:2,gt:74,clk:'74:00'},
 {id:'y19',type:'yellow_card',team:1,gt:19,clk:'19:00'}]});
assert.equal(source.coverage.goalThrough,79);
assert.equal(source.coverage.cornerThrough,79);
assert.equal(source.coverage.cardThrough,79);
function decision(name,choice){
 const contract=liveContract({market_name:name,outcome_name:choice});
 assert.equal(contract?.kind,'window','Unsupported: '+name);
 return primaryLiveDecision(contract,source);
}
for(const [market,yes,no] of [
 ['Total goals in minutes 10-20 (10-minute interval)','WON','LOST'],
 ['Total corners in minutes 10-20 (10-minute interval)','WON','LOST'],
 ['Total cards in minutes 10-20 (10-minute interval)','WON','LOST'],
 ['Total corners from 10:00 to 20 min','WON','LOST'],
 ['Total goals in minutes 50-60 (10-minute interval)','LOST','WON'],
 ['Total corners in minutes 50-60 (10-minute interval)','LOST','WON']
]){
 assert.equal(decision(market,'Yes'),yes,market+' YES');
 assert.equal(decision(market,'No'),no,market+' NO');
}
console.log('PASS Zizobet live minute-based goals, corners and cards settle YES/NO correctly');
