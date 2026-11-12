import assert from 'node:assert/strict';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';
import {parsePlayerGoalSpecial,gradePlayerGoalSpecial} from '../server/ledger/player-goal-specials.mjs';
import {playerGoalLiveGuard} from '../server/ledger/player-goal-live-guard.mjs';
import {verifyLiveIntervalAcceptance} from '../server/ledger/live-interval-acceptance.mjs';

const now=Date.parse('2026-11-12T20:00:00Z');
const observed=new Date(now);
const home='Alpha',away='Beta';
const prematch={match_id:3401,service:'PREMATCH',home,away,
 start_at:new Date(now+3600000)};
const live=(minute,goalHome=0,goalAway=0,cornerHome=0,cornerAway=0)=>({
 match_id:3401,service:'LIVE',home,away,
 start_at:new Date(now-3600000),home_score:goalHome,away_score:goalAway,
 score_at:observed,clock_at:observed,match_time_ms:minute*60000,
 raw:{homeTeam:{id:'home'},awayTeam:{id:'away'}},
 stats:{home:{corners:cornerHome,_observedAt:{corners:observed.toISOString()}},
  away:{corners:cornerAway,_observedAt:{corners:observed.toISOString()}}}
});
const quote=(name,selection,line='')=>({market_name:name,outcome_name:selection,line});
let count=0;
const check=(name,selection,kind,opts={})=>{
 const rule=liveContract(quote(name,selection,opts.line??''),{
  counts:{goal:{home:0,away:0},corner:{home:0,away:0},card:{home:0,away:0}},
  clock:0
 });
 assert.equal(rule?.kind,kind,name+' / '+selection);
 if(opts.target!=null)assert.equal(rule.target,opts.target,name);
 if(opts.to!=null)assert.equal(rule.to,opts.to,name);
 if(opts.event!=null)assert.equal(rule.event,opts.event,name);
 count++;return rule;
};
for(const [name,choice,kind,opts]of [
 ['Next Goal','1','sequence',{target:1,event:'goal'}],
 ['Next Goal','No goal','sequence',{target:1}],
 ['Next Goal 2nd','2','sequence',{target:2}],
 ['Next Corner','2','sequence',{target:1,event:'corner'}],
 ['First Goal','1','sequence',{target:1}],
 ['Who scores first','1','sequence',{target:1}],
 ['Which team scores first','2','sequence',{target:1}],
 ['Who scores second','1','sequence',{target:2}],
 ['Who scores third','2','sequence',{target:3}],
 ['Race to 3 Goals','1','race',{target:3}],
 ['Race to 7 Corners','None','race',{target:7}],
 ['Race to 2 Cards','2','race',{target:2}],
 ['Who scores goal 1 in minutes 6-10 (5-minute interval)','1','nth-time',{target:1,to:10}],
 ['Who scores the first goal in minutes 6-10 (5-minute interval)','2','nth-time',{target:1,to:10}],
 ['Who scores 2nd goal in minutes 6-10 (5-minute interval)','2','nth-time',{target:2,to:10}],
 ['Who scores goal 3 in minutes 30-45 (15-minute interval)','1','nth-time',{target:3,to:44}],
 ['Will there be a goal in minutes 30-45 (15-minute interval)','Yes','window',{to:44}],
 ['Who takes most corners in minutes 30-45 (15-minute interval)','X','interval-leader',{to:44,event:'corner'}],
 ['Who receives most cards in minutes 30-45 (15-minute interval)','1','interval-leader',{to:44,event:'card'}],
 ['Who commits most fouls in minutes 30-45 (15-minute interval)','2','interval-leader',{to:44,event:'foul'}],
 ['Total goals in minutes 30-45 (15-minute interval)','Over','window-total',{line:'0.5',to:44}],
 ['Total corners in minutes 1-10 (10-minute interval)','Under','window-total',{line:'1.5',to:10}],
 ['Total cards in minutes 1-10 (10-minute interval)','Over','window-total',{line:'0.5',to:10}],
 ['Total fouls in minutes 1-10 (10-minute interval)','Under','window-total',{line:'2.5',to:10}],
 ['Anytime Goalscorer','Alice','player-goal',{}],
 ['Player to score','Alice','player-goal',{}],
 ['First Goalscorer','Alice','player-ordinal-goal',{}],
 ['Last Goalscorer','Alice','player-ordinal-goal',{}],
 ['Player to score 2 or more goals','Alice','player-goal-special',{}],
 ['Player to score 3+ goals','Alice','player-goal-special',{}],
 ['Player hat trick','Alice','player-goal-special',{}],
])check(name,choice,kind,opts);

for(const [name,target]of [
 ['Player to score 2 or more goals',2],
 ['Player to score 3+ goals',3],
 ['Player hat trick',3]
]){
 const c=parsePlayerGoalSpecial(quote(name,'Alice'));
 assert.equal(c?.playerName,'Alice');assert.equal(c?.choice,true);
 assert.equal(c?.threshold,target);count++;
}
assert.equal(parsePlayerGoalSpecial(quote('Player to score 2 or more goals','Yes')),null,
 'A yes-only quote WITHOUT a nominated player cannot charge a wager');count++;
assert.equal(check('Player to score 2 or more goals · Alice','Yes','player-goal-special')?.playerName,'Alice');

for(const [market,selected]of [
 ['Next Goal','1'],['Next Corner','2'],['Race to 3 Goals','1'],
 ['Race to 7 Corners','None'],['Who scores first','Alpha'],
 ['Who scores goal 3 in minutes 30-45 (15-minute interval)','2'],
 ['Player to score 3+ goals','Alice']
]){
 const c=frozenLiveContract(quote(market,selected),prematch,now);
 assert.ok(c,market+' prematch');count++;
}
const next=frozenLiveContract(quote('Next Goal','2'),live(6,1,0),now);
assert.equal(next.target,2);assert.deepEqual(next.baseline,{home:1,away:0});count++;
const race=frozenLiveContract(quote('Race to 7 Corners','1'),live(6,0,0,3,2),now);
assert.deepEqual(race.baseline,{home:3,away:2});count++;
assert.throws(()=>frozenLiveContract(quote('Race to 7 Corners','1'),
 live(35,0,0,7,2),now),/përfunduar/);count++;
assert.throws(()=>frozenLiveContract(quote('First Goal','1'),live(6,1,0),now),
 /ndodhur/);count++;

const two=parsePlayerGoalSpecial(quote('Player to score 2 or more goals','Alice'));
const three=parsePlayerGoalSpecial(quote('Player to score 3+ goals','Alice'));
const alice=n=>Array.from({length:n},(_,i)=>({team:'home',minute:i*10+1,
 player_name:'Alice',own_goal:false}));
assert.equal(gradePlayerGoalSpecial(two,alice(2),{complete:false}),'WON');
assert.equal(gradePlayerGoalSpecial(three,alice(2),{complete:false}),null);
assert.equal(gradePlayerGoalSpecial(three,alice(3),{complete:false}),'WON');
count+=3;

const early=playerGoalLiveGuard(two,null,null,live(0),{now});
assert.equal(early.allowed,true,'0-0 has no possible existing scorer');
assert.equal(playerGoalLiveGuard(two,null,null,live(6,1,0),{now}).allowed,true,
 '1 total goal cannot complete ANY nominated player 2+ target');
assert.equal(playerGoalLiveGuard(three,null,null,live(6,2,0),{now}).allowed,true,
 '2 total goals cannot complete ANY nominated player 3+ target');
assert.equal(playerGoalLiveGuard(two,null,null,live(6,2,0),{now}).allowed,false,
 '2 total goals can already belong to one player, so require scorer facts');
assert.equal(playerGoalLiveGuard(three,null,null,live(6,3,0),{now}).allowed,false,
 '3 total goals may already have completed an actor hat trick');
assert.equal(playerGoalLiveGuard({
 ...two,choice:'over',threshold:1.5
},null,null,live(6,1,0),{now}).allowed,true);
assert.equal(playerGoalLiveGuard({
 ...two,choice:'under',threshold:2.5
},null,null,live(6,2,0),{now}).allowed,true);
assert.equal(playerGoalLiveGuard({
 ...two,choice:'exact',threshold:2
},null,null,live(6,2,0),{now}).allowed,true);
assert.equal(playerGoalLiveGuard({
 ...two,choice:'exact',threshold:2
},null,null,live(6,3,0),{now}).allowed,false);
assert.equal(playerGoalLiveGuard(two,null,null,{...live(0),
 score_at:new Date(now-120000)},{now}).allowed,false,'stale zero cannot be trusted');
count+=10;

const timed=check('Total goals in minutes 1-10 (10-minute interval)','Over','window-total',{line:'0.5'});
const accepted=await verifyLiveIntervalAcceptance(timed,live(6,1,0),{at:now,
 execute:()=>{throw Error('No past incident history is needed at entry')}});
assert.deepEqual(accepted.entryBaseline,{home:1,away:0});
assert.equal(accepted.entryClockMinute,6);count++;
console.log('PASS '+count+' core event-market cases: scorer 2+/3+, next/first/races, post-bet baselines and 5/10/15-minute timing');
