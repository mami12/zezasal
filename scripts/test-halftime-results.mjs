import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {HALFTIME_RESULT_SQL,extractConfirmedHalfTimeCandidate,
 persistHalfTimeCandidate} from '../server/ledger/halftime-results.mjs';
import {firstHalfScoreOnly,gradeAtVerifiedHalfTime,scorePeriodOf} from '../server/ledger/settler.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
const observed='2026-11-11T20:45:30Z',status='2026-11-11T20:45:31Z';
const live={match_id:123,home:'Red FC',away:'Blue FC',home_score:2,away_score:1,
 periods_score:[{t1:2,t2:1}],feed_status:'HT',score_at:observed,
 feed_status_at:status,raw:{provider:'ZIZOBET'}};
const candidate=extractConfirmedHalfTimeCandidate(live);
assert.deepEqual([candidate.home,candidate.away],[2,1]);
assert.ok(HALFTIME_RESULT_SQL.includes('app_match_half_result'));
for(const phase of ['LIVE','PREMATCH','1H','']){
 assert.equal(extractConfirmedHalfTimeCandidate({...live,feed_status:phase}),null);
}
assert.equal(extractConfirmedHalfTimeCandidate({...live,raw:{provider:'YBETS'}}),null);
assert.equal(extractConfirmedHalfTimeCandidate({...live,home_score:3}),null,
 'At HT, current score and confirmed first period must agree');
assert.equal(extractConfirmedHalfTimeCandidate({...live,
 feed_status_at:'2026-11-11T20:50:00Z'}),null,'reject stale half time scores');
assert.ok(extractConfirmedHalfTimeCandidate({...live,feed_status:'2H',
 home_score:3,away_score:1}),'Later known first-period score may still be captured');
const half={home_team:'Red FC',away_team:'Blue FC',half_home_score:2,
 half_away_score:1,confirmed_at:'2026-11-11T20:46:00Z'};
const pick=(market_name,outcome_name,opts={})=>({
 market_name,outcome_name,outcome_key:outcome_name,period:1,
 line:'',...opts
});
const check=(line,expected)=>assert.equal(gradeAtVerifiedHalfTime(line,half),expected,
 JSON.stringify(line));
check(pick('1st half - Total Goals','Over',{line:'2.5'}),'WON');
check(pick('1st half - Total Goals','Under',{line:'2.5'}),'LOST');
check(pick('1st half - Result','1'),'WON');
check(pick('1st half - Result','2'),'LOST');
check(pick('Halftime - 3way','1'),'WON');
check(pick('1st half - Correct score','2:1'),'WON');
check(pick('1st half - Correct score','0:0'),'LOST');
check(pick('1st half - Both teams to score','Yes'),'WON');
check(pick('1st half - Double chance','X2'),'LOST');
check(pick('Draw No Bet first half','1'),'WON');
check(pick('1st half - Total Goals','Over',{line:'3.0'}),'VOID');
const noEvidence={...half,confirmed_at:null};
assert.equal(gradeAtVerifiedHalfTime(pick('1st half - Result','1'),noEvidence),null);
const frozen=pick('1X2','1',{period:undefined,
 accepted_contract:{providerPeriod:1}});
assert.equal(scorePeriodOf(frozen),1);
assert.equal(gradeAtVerifiedHalfTime(frozen,half),'WON');
assert.equal(gradeAtVerifiedHalfTime(pick('1X2','1',{period:0}),half),null);
for(const line of [
 pick('Full Time Result','1',{period:0}),
 pick('HT/FT','1/1'),
 pick('2nd half - Result','1',{period:2}),
 pick('Both teams to score in both halves','Yes'),
 pick('1st half - Total Corners','Over',{line:'2.5'}),
 pick('1st half - Exact cards','3'),
 pick('First corner','1'),
 pick('Anytime goalscorer','Yes'),
 pick('1st half - Total Fouls','Over',{line:'5.5'})
]){
 assert.equal(firstHalfScoreOnly(line),false,'Other scopes require different evidence: '+line.market_name);
 assert.equal(gradeAtVerifiedHalfTime(line,half),null);
}
let sql='',args;
await persistHalfTimeCandidate(candidate,{execute:async(q,p)=>{sql=q;args=p;return {rowCount:1,rows:[{confirmed_at:null,correction_count:0}]};}});
assert.match(sql,/excluded\.observed_at>app_match_half_result\.observed_at/);
assert.match(sql,/interval '5 seconds'/);
assert.match(sql,/when app_match_half_result\.signature<>excluded\.signature then null/);
assert.equal(args[0],123);
// First-half corners/cards use the actual verified PRIMARY chronology; the
// half-time score alone is insufficient to decide their event totals.
const facts=[
 {team:'home',minute:12,phase:'First Half',seconds:null},
 {team:'home',minute:25,phase:'First Half',seconds:null},
 {team:'away',minute:41,phase:'First Half',seconds:null}
];
const cornerContract={kind:'half-total',event:'corner',half:1,side:'home',
 choice:'over',threshold:1.5};
const verifiedCorner=async(sql)=>{
 if(sql.startsWith('with covered as'))return {rows:[{
  home:2,away:1,total:3,count_home:2,count_away:1,complete:false,
  through_minute:45,open_recovery_gap:false,card_colors_verified:false,
  confirmed_at:'2026-11-11T20:46:00Z',observed_at:'2026-11-11T20:47:00Z',
  second_poll_at:'2026-11-11T20:47:00Z'
 }]};
 if(sql.includes('from app_match_half_result'))return {rows:[{
   confirmed_at:'2026-11-11T20:46:30Z'
 }]};
 if(sql.includes('select minute,seconds,team,phase,card_color'))return {rows:facts};
 throw Error('Unexpected query '+sql);
};
assert.equal(await gradeStoredEventContract({id:'a',match_id:123,live_contract:cornerContract},
 null,{execute:verifiedCorner}),'WON',
 '1H corner contract can settle from the confirmed HT primary chronology');
const noHT=async sql=>sql.includes('from app_match_half_result')?{rows:[]}:verifiedCorner(sql);
assert.equal(await gradeStoredEventContract({id:'a',match_id:123,live_contract:cornerContract},
 null,{execute:noHT}),null,'No HT confirmation => no 1H corner payout');

console.log('PASS HT-only grades 1st half, rejects FT/2H, freezes real periods and requires 2 primary snapshots');
