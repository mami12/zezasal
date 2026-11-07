import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {normalizeLiveFrame} from '../server/ledger/live-observation-store.mjs';
import {liveContract,parseTeamGoalMarket,gradeLiveContract} from '../server/ledger/live-contract-rules.mjs';
import {primaryLiveDecision} from '../server/ledger/verified-live-settlement.mjs';
import {backfillPendingTeamGoalContracts} from '../server/ledger/live-contract-backfill.mjs';

// Match example: source displays a truncated incident list, but the primary
// scoreboard has 8 corners and 2 yellow cards. No fabricated old events.
const timeline=[
 {id:'c77',type:'corner_kick',team:1,gt:77},
 {id:'g74',type:'score_change',team:2,gt:74},
 {id:'y69',type:'yellow_card',team:1,gt:69},
 {id:'g67',type:'score_change',team:1,gt:67},
 {id:'c66',type:'corner_kick',team:2,gt:66},
 {id:'c64',type:'corner_kick',team:1,gt:64},
 {id:'c55',type:'corner_kick',team:1,gt:55},
 {id:'c33',type:'corner_kick',team:2,gt:33}
];
const actual=normalizeLiveFrame({Match:{Score:'1:1',MatchTimeExtended:'79:00',
 CornersTeam1:5,CornersTeam2:3,YellowCardsTeam1:1,YellowCardsTeam2:1,
 RedCardsTeam1:0,RedCardsTeam2:0,EventStatus:6},TimeLines:timeline});
assert.equal(actual.counts.goal,2);
assert.equal(actual.counts.corner,8);
assert.equal(actual.coverage.goalThrough,79);
assert.equal(actual.coverage.cornerThrough,undefined,'Partial corners do not prove no corner');
assert.equal(actual.coverage.cardThrough,undefined,'Partial yellow-card events do not prove no card');
const choice=(market,label,line='')=>({market_name:market,outcome_name:label,line});
const judge=(market,label,line='')=>{
 const c=liveContract(choice(market,label,line),{counts:{goal:{home:0,away:0}}});
 assert.ok(c,market+' '+label);return primaryLiveDecision(c,actual);
};
assert.equal(judge('Corner in minutes 75-80','Yes'),'WON',
 'A specific observed 77-minute corner proves YES even with partial events');
assert.equal(judge('Corner in minutes 75-80','No'),'LOST',
 'A specific observed 77-minute corner proves NO lost');
assert.equal(judge('Corner in minutes 20-30','Yes'),null,
 'No earlier incident in a truncated list is never proof of NO');
assert.equal(judge('Goal in minutes 70-75','Yes'),'WON','Minute 74 goal is inside the window');
assert.equal(judge('Goal in minutes 10-20','No'),'WON',
 'Complete goal list can prove a closed no-goal interval');
assert.equal(judge('00:00 - 09:59 min. - Result','X'),'WON',
 '0-0 during verified 00:00–09:59 is a DRAW despite later 1-1');
assert.equal(judge('60:00 - 69:59 min. - Result','1'),'WON',
 'Minute 67 home goal determines 60:00–69:59 interval');
assert.equal(judge('70:00 - 79:59 min. - Result','2'),null,
 'Never settle a result interval before 80:00');

for(const [label,expected] of [['1','WON'],['2','LOST'],['No Goal','LOST']]){
 const c=liveContract(choice('Next Goal',label),{counts:{goal:{home:0,away:0}}});
 assert.equal(primaryLiveDecision(c,actual),expected,
   'At 0-0 the first goal belonged to home; 1-1 later must not erase the decision');
}
for(const [label,expected] of [['Over','WON'],['Under','LOST']]){
 const market=choice('Home team total goals',label,'0.5');
 const c=parseTeamGoalMarket(market,{home:'AS Sariyer',away:'Igdir FK'});
 assert.deepEqual([c?.kind,c?.side,c?.threshold,c?.choice],['team-total-goals','home',0.5,label.toLowerCase()]);
 assert.equal(primaryLiveDecision(c,actual),expected,
   'At 1-1 AS Sariyer reached one goal, so home 0.5 OVER is won and UNDER is lost');
}
const awayOver=parseTeamGoalMarket(choice('Away team total goals','Over','1.5'));
assert.equal(primaryLiveDecision(awayOver,actual),null,'A not-yet-achieved OVER waits for goals');
const picked=[],db=async(sql,params=[])=>{
 if(sql.startsWith('select l.id,l.market_name'))return {rows:[{
  id:'line-test',market_name:'Home team total goals',outcome_name:'Under',outcome_key:'Under',line:'0.5'
 }]};
 if(sql.startsWith('update app_ticket_line')){picked.push(params);return {rowCount:1};}
 throw Error('Unexpected SQL '+sql);
};
assert.deepEqual(await backfillPendingTeamGoalContracts({runQuery:db}),
 {examined:1,filled:1});
assert.equal(JSON.parse(picked[0][1]).kind,'team-total-goals');
console.log('PASS primary Zizobet 79-minute partial incident list: precise intervals, YES/NO, goal order, 1X2 interval, existing home-total tickets');
