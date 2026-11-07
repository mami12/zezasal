import assert from 'node:assert/strict';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';
import {normalizeLiveFrame} from '../server/ledger/live-observation-store.mjs';
import {gradeLiveContract} from '../server/ledger/live-contract-rules.mjs';

const now=Date.parse('2026-11-06T16:00:00Z');
const match={match_id:1001,service:'PREMATCH',status:'scheduled',start_at:new Date(now+3600000),
 home:'Team A',away:'Team B',home_score:null,away_score:null,stats:null};
const contract=(market,selection,fixture=match)=>frozenLiveContract(
 {market_name:market,outcome_name:selection},fixture,now);
const firstGoal=contract('Next Goal','1');
const firstCorner=contract('Next Corner','2');
const raceGoal=contract('Race to 2 Goals','1');
const raceCorner=contract('Race to 3 Corners','1');
const window=contract('Will there be a goal in minutes 10-20','Yes');
assert.deepEqual([firstGoal.event,firstGoal.target,firstGoal.baseline.home,firstGoal.baseline.away],
 ['goal',1,0,0]);
assert.deepEqual([firstCorner.event,firstCorner.target,firstCorner.baseline.home,firstCorner.baseline.away],
 ['corner',1,0,0]);
assert.deepEqual([raceGoal.event,raceGoal.kind,raceGoal.target],['goal','race',2]);
assert.deepEqual([raceCorner.event,raceCorner.kind,raceCorner.target],['corner','race',3]);
assert.deepEqual([window.kind,window.from,window.to],['window',10,20]);
assert.throws(()=>contract('Next Goal','1',{...match,start_at:new Date(now-1000)}),
 /prematch|verifikuar/i,'A stale PREMATCH fixture must not get a fake 0:0 baseline');
assert.throws(()=>contract('Race to 3 Corners','1',{...match,start_at:null}),
 /prematch|verifikuar/i,'No observed kickoff means no fictional zero baseline');

const events=[
 {id:'g1',type:'score_change',team:1,gt:12,clk:'12:05'},
 {id:'c1',type:'corner_kick',team:2,gt:14,clk:'14:05'},
 {id:'c2',type:'corner_kick',team:1,gt:16,clk:'16:03'},
 {id:'g2',type:'score_change',team:1,gt:19,clk:'19:03'},
 {id:'c3',type:'corner_kick',team:1,gt:25,clk:'25:02'},
 {id:'c4',type:'corner_kick',team:1,gt:31,clk:'31:01'}
];
const frame=normalizeLiveFrame({Match:{Score:'2:0',MatchTimeExtended:'35:00',
 CornersTeam1:3,CornersTeam2:1,EventStatus:6},TimeLines:events});
assert.equal(gradeLiveContract(firstGoal,frame),'WON');
assert.equal(gradeLiveContract(firstCorner,frame),'WON');
assert.equal(gradeLiveContract(raceGoal,frame),'WON');
assert.equal(gradeLiveContract(raceCorner,frame),'WON');
assert.equal(gradeLiveContract(window,frame),'WON');
assert.equal(gradeLiveContract({...window,choice:false},frame),'LOST');
assert.equal(gradeLiveContract({...raceCorner,side:'away'},frame),'LOST');
console.log('PASS PREMATCH: frozen 0:0 counters, goal/corner races, minute windows, transition to live and stale kickoff rejection');
