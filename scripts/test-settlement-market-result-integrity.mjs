import assert from 'node:assert/strict';
import {gradeLine,hasRequiredSettlementEvidence,isProvenDrawNoBetPush,
 scorePeriodOf} from '../server/ledger/settler.mjs';
import {finishedResultParameters,isFinished} from '../server/ledger/results.mjs';
const score={home_team:'Manchester City',away_team:'Manchester United',
 home_score:3,away_score:1,half_home_score:0,half_away_score:1,
 corners_home:3,corners_away:2,cards_home:3,cards_away:2};
const choice=(market_name,outcome_name,opts={})=>({market_name,outcome_name,
 outcome_key:outcome_name,line:'',...opts});
const grade=(market,outcome,opts={})=>gradeLine(choice(market,outcome,opts),score);

// A 1H/2H provider period MUST never use the FT 3-1.
assert.equal(scorePeriodOf(choice('1X2','1',{period:1})),1);
assert.equal(grade('1X2','1',{period:1}),'LOST');
assert.equal(grade('1X2','2',{period:1}),'WON');
assert.equal(grade('1X2','1',{period:2}),'WON');
assert.equal(grade('Both Teams To Score','Yes',{period:1}),'LOST');
assert.equal(grade('Both Teams To Score','Yes',{period:2}),'LOST');
assert.equal(grade('Both Teams To Score','Yes',{period:0}),'WON');
assert.equal(grade('Double Chance','1X',{period:1}),'LOST');
assert.equal(grade('Double Chance','X2',{period:1}),'WON');
assert.equal(grade('Odd/Even','Odd',{period:1}),'WON');
assert.equal(grade('Odd/Even','Even',{period:0}),'WON');
assert.equal(grade('Correct Score','0:1',{period:1}),'WON');
assert.equal(grade('Correct Score','3:0',{period:2}),'WON');
assert.equal(grade('1X2','1',{period:3}),null);
assert.equal(grade('1st Half Result','1',{period:2}),null);
assert.equal(grade('1X2','1',{period:1}), 'LOST');
assert.equal(gradeLine(choice('1X2','1',{period:1}),{...score,half_home_score:null}),null);
assert.equal(gradeLine(choice('1X2','1',{period:2}),{...score,half_home_score:5}),null);
assert.equal(hasRequiredSettlementEvidence(choice('1X2','1'),{...score,home_score:null}),false);
assert.equal(gradeLine(choice('1X2','1'),{...score,home_score:null}),null);

// Half-only corners cannot be inferred from the final match corner total.
assert.equal(grade('Total Corners','Over',{period:1,line:'0.5'}),null);
assert.equal(grade('Corner Result 1X2','1',{period:1}),null);

// Team-named clean sheet: Manchester City conceded 1; Man U conceded 3.
// Generic "Clean Sheet" cannot be allocated to an arbitrary team.
assert.equal(grade('Manchester City Clean Sheet','Yes'),'LOST');
assert.equal(grade('Manchester United Clean Sheet','No'),'WON');
assert.equal(grade('Clean Sheet','Yes'),null);
assert.equal(grade('Home and Away Clean Sheet','Yes'),null);

// A DNB code that is not 1 or 2 cannot be silently interpreted as LOST.
assert.equal(grade('Draw No Bet','Mystery'),null);
assert.equal(gradeLine(choice('Draw No Bet','Mystery'),{...score,home_score:1,away_score:1}),null);
const draw={...score,home_score:1,away_score:1,half_home_score:1,half_away_score:1};
assert.equal(gradeLine(choice('Draw No Bet','1'),draw),'VOID');
assert.equal(isProvenDrawNoBetPush(choice('Draw No Bet','1'),draw),true);
assert.equal(isProvenDrawNoBetPush(choice('Draw No Bet','Mystery'),draw),false);
assert.equal(isProvenDrawNoBetPush(choice('Draw No Bet','1'),score),false);
assert.equal(gradeLine(choice('Draw No Bet','2',{period:1}),draw),'VOID');
assert.equal(isProvenDrawNoBetPush(choice('Draw No Bet','2',{period:1}),draw),true);
assert.equal(grade('Draw No Bet + BTTS','1'),null);

// Corners 4+ means four OR MORE, not exactly four. The legacy norm()
// erased '+' before detecting a lower-bound selection.
assert.equal(grade('Exact Corners','4+'),'WON');
assert.equal(grade('Exact Corners','5'),'WON');
assert.equal(grade('Exact Corners','4'),'LOST');
assert.equal(grade('Exact Corners','6+'),'LOST');
assert.equal(grade('Exact Corners','4 or more'),'WON');

// A missing red count is unknown, NOT zero, for either team.
const raw={match_id:99,home:'Home',away:'Away',home_score:2,away_score:1,
 score_at:'2026-11-11T20:00:00Z',stats:{
  home:{yellow:3,corners:5},away:{yellow:1,red:0,corners:4}}};
let params=finishedResultParameters(raw);
assert.equal(params[7],null,'Home yellow+red cannot be computed from yellow alone');
assert.equal(params[8],1);
params=finishedResultParameters({...raw,stats:{home:{yellow:3,red:0,corners:5},
 away:{yellow:1,red:0,corners:4}}});
assert.equal(params[7],3);
assert.equal(params[8],1);
const finishedFrame={feed_status:'FT',score_at:'2026-11-11T20:00:00Z',home_score:1,away_score:1};
assert.equal(isFinished(finishedFrame),true);
for(const status of ['After penalties','Penalties','Extra time','After match','Penalty shootout']){
 assert.equal(isFinished({...finishedFrame,feed_status:status}),false,
  status+' score could be non-regulation and must not settle 90m bets');
}
console.log('PASS period-scoped score markets, strict DNB refund, clean sheets, exact bands, card unknowns');
