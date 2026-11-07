import assert from 'node:assert/strict';
import {normalizeLiveFrame} from '../server/ledger/live-observation-store.mjs';
import {
 parseSequenceBet,parseEventWindow,parseCountMarket,
 gradeLiveContract,gradeFromAcceptedCounters
} from '../server/ledger/live-contract-rules.mjs';
import {gradeMixedTotal,parseResultTotal} from '../server/ledger/mixed-combos.mjs';

const bet=(market,choice,line)=>({market_name:market,outcome_name:choice,line});
const g1={id:'g1',type:'score_change',team:1,gt:12,clk:'12:04'};
const g2={id:'g2',type:'score_change',team:2,gt:15,clk:'15:03'};
const g3={id:'g3',type:'score_change',team:1,gt:19,clk:'19:11'};
const c=(i,team,minute)=>({id:'c'+i,type:'corner_kick',team,gt:minute,clk:String(minute).padStart(2,'0')+':00'});
const make=(time,score,homeCorners,awayCorners,events,ended=false)=>normalizeLiveFrame({
 Match:{MatchTimeExtended:time,Score:score,CornersTeam1:homeCorners,CornersTeam2:awayCorners,
  EventStatus:ended?40:6},
 TimeLines:events
});
const goals=make('21:20','2:1',0,0,[g1,g2,g3]);
assert.equal(goals.coverage.goalThrough,21+20/60);
for(const [choice,expected] of [['Yes','WON'],['No','LOST']]){
 const contract=parseEventWindow(bet('Will there be a goal in minutes 10-20',choice));
 assert.equal(gradeLiveContract(contract,goals),expected,'10-20 goals: '+choice);
}
const misses=make('21:20','0:0',0,0,[]);
assert.equal(gradeLiveContract(parseEventWindow(bet('Goal in minutes 10-20','Yes')),misses),'LOST');
assert.equal(gradeLiveContract(parseEventWindow(bet('Goal in minutes 10-20','No')),misses),'WON');
assert.equal(gradeLiveContract(parseEventWindow(bet('Goal in minutes 10-20','Yes')),
 {...misses,coverage:{}}),null,'Missing coverage is PENDING, never false loss');
assert.equal(gradeLiveContract(parseEventWindow(bet('Goal in minutes 10-20','No')),
 make('19:40','0:0',0,0,[])),null,'No goal cannot win before interval ends');

// Goal and corner races use the SAME PRIMARY provider, but a race to six
// corners means one team reaches six, NOT six cumulative match corners.
const raceGoal=parseSequenceBet(bet('Race to 2 Goals','1'));
assert.deepEqual([raceGoal.kind,raceGoal.event,raceGoal.target,raceGoal.side],
 ['race','goal',2,'home']);
assert.equal(gradeLiveContract(raceGoal,goals),'WON');
assert.equal(gradeLiveContract({...raceGoal,side:'away'},goals),'LOST');
const corners=[
 c(1,1,2),c(2,2,3),c(3,1,5),c(4,1,8),c(5,2,10),c(6,1,11),
 c(7,1,14),c(8,1,17)
];
const beforeSix=make('13:30','0:0',4,2,corners.slice(0,6));
const afterSix=make('20:00','0:0',6,2,corners);
const raceCorner=parseSequenceBet(bet('Which team wins race to 6 corners','1'));
assert.equal(gradeLiveContract(raceCorner,beforeSix),null,'Six total corners is NOT race to 6 for home');
assert.equal(gradeLiveContract(raceCorner,afterSix),'WON','Six corners for home proves the race');
assert.equal(gradeLiveContract({...raceCorner,side:'away'},afterSix),'LOST');
assert.equal(gradeFromAcceptedCounters({...raceCorner,baseline:{home:2,away:0}},afterSix),'WON',
 'PRIMARY accepted baseline + subsequent counters decides the corner race');
assert.equal(gradeLiveContract(parseSequenceBet(bet('Next Corner','1'),{
 corner:{home:5,away:2}}),afterSix),'WON');
assert.equal(gradeLiveContract(parseSequenceBet(bet('Next Goal','2'),{
 goal:{home:1,away:0}}),goals),'WON');
assert.equal(gradeLiveContract(raceCorner,{...afterSix,events:[],coverage:{}}),null,
 'A missing timeline cannot prove an ambiguous race');
const simultaneous={...afterSix,teams:{corner:{home:6,away:6}}};
assert.equal(gradeFromAcceptedCounters({...raceCorner,baseline:{home:2,away:2}},simultaneous),null,
 'Both sides reached six since the last snapshot: use chronological events or PENDING');

// Totals are monotonic; an early over is safe but an under must wait.
const over=parseCountMarket(bet('Total Goals','Over','2.5'));
const under=parseCountMarket(bet('Total Goals','Under','2.5'));
assert.equal(gradeLiveContract(over,goals),'WON');
assert.equal(gradeLiveContract(under,goals),'LOST');
assert.equal(gradeLiveContract(under,misses),null);
assert.equal(gradeLiveContract(under,{...misses,ended:true},{ended:true}),'WON');
const exact=parseCountMarket(bet('Total Corners','Exactly 6'));
assert.equal(gradeLiveContract(exact,beforeSix),null);
assert.equal(gradeLiveContract(exact,afterSix),'LOST');
assert.equal(gradeLiveContract(exact,{...beforeSix,ended:true},{ended:true}),'WON');

// A mixed quote requires BOTH legs, not whichever leg becomes true first.
assert.equal(gradeMixedTotal('Result and Total',parseResultTotal('1 and Over 2.5'),2,1), 'WON');
assert.equal(gradeMixedTotal('Result and Total',parseResultTotal('1 and Over 2.5'),2,0), 'LOST');
console.log('PASS PRIMARY: goal minutes yes/no, missed intervals, Race to X Goals/Corners, next goal/corner, count thresholds, mixed two-leg loss and missing-evidence holds');
