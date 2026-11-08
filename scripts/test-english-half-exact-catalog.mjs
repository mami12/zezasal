import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {parseHalfExactMarket,gradeHalfExactFacts,isHalfExactMarketFamily}
 from '../server/ledger/half-exact-markets.mjs';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
import {parsePeriodGoalTotal,gradePeriodGoalTotal}
 from '../server/ledger/period-goal-totals.mjs';
import {gradeLine,hasRequiredSettlementEvidence} from '../server/ledger/settler.mjs';

const quote=(market_name,outcome_name,period=0)=>({market_name,outcome_name,period});
const names=[
 ['1st half - Away team exact cards','2','card','away'],
 ['1st half - Away team exact corners','2','corner','away'],
 ['1st half - Home team exact cards','1','card','home'],
 ['1st half - Home team exact corners','1','corner','home'],
 ['1st half - Exact cards','3','card',null],
 ['1st half - Corner range','1-3','corner',null],
 ['1st Half - Total Cards (exactly)','3','card',null],
 ['1st half - Away team red card','No','card','away'],
 ['2nd half - Home team red card','No','card','home']
];
for(const [title,choice,event,side] of names){
 const line=quote(title,choice);
 const contract=liveContract(line);
 assert.equal(contract?.kind,'half-exact-count',title);
 assert.equal(contract.event,event);
 assert.equal(contract.side??null,side);
 assert.equal(isHalfExactMarketFamily(line),true);
 assert.equal(gradeLine(line,{home_score:3,away_score:1,
  corners_home:8,corners_away:7,cards_home:2,cards_away:4}),null,
  'Legacy half-exact bets must never be graded from FT counters');
 assert.equal(hasRequiredSettlementEvidence(line,{corners_home:8,corners_away:7,
  cards_home:2,cards_away:4,home_score:3,away_score:1}),false);
}
const corners=[
 {minute:10,team:'home',phase:'H1'},
 {minute:18,team:'away',phase:'H1'},
 {minute:45,team:'away',phase:'H1'},
 {minute:70,team:'home',phase:'H2'},
 {minute:89,team:'home',phase:'H2'}
];
const cards=[
 {minute:10,team:'home',phase:'H1',card_color:'yellow'},
 {minute:32,team:'away',phase:'H1',card_color:'yellow'},
 {minute:45,team:'away',phase:'H1',card_color:'red'},
 {minute:82,team:'away',phase:'H2',card_color:'yellow'}
];
const corner=(title,choice)=>parseHalfExactMarket(quote(title,choice));
assert.equal(gradeHalfExactFacts(corner('1st half - Away team exact corners','2'),
 corners,{complete:true}),'WON');
assert.equal(gradeHalfExactFacts(corner('1st half - Corner range','1-3'),
 corners,{complete:true}),'WON');
assert.equal(gradeHalfExactFacts(corner('1st half - Corner range','4-6'),
 corners,{complete:true}),'LOST');
assert.equal(gradeHalfExactFacts(corner('1st half - Away team exact corners','2'),
 corners,{complete:false}),null);
assert.equal(gradeHalfExactFacts(corner('1st half - Away team exact corners','2'),
 [...corners,{minute:45,team:'away',phase:null}],{complete:true}),null,
 'The boundary minute cannot be assigned to a half without a period');
const red=corner('1st half - Away team red card','Yes');
assert.equal(gradeHalfExactFacts(red,cards,
 {complete:true,cardColorsVerified:true}),'WON');
assert.equal(gradeHalfExactFacts(red,cards,
 {complete:true,cardColorsVerified:false}),null,
 'Generic card totals cannot prove a red card');
assert.equal(gradeHalfExactFacts(corner('1st half - Away team exact cards','2'),
 cards,{complete:true}),'WON');
assert.equal(gradeHalfExactFacts(corner('2nd half - Away team exact cards','1'),
 cards,{complete:true}),'WON');
assert.equal(parseHalfExactMarket(quote('1st half - Away team exact corners','2',2)),null,
 'Do not substitute the second-half facts for a first-half quote');
for(const title of ['1st Half - Total Booking Points',
 '1st Half - Total Card Points','1st Half - Total Bookings (exactly)',
 '1st half - Handicap','1st half - Cornerbet']){
 assert.equal(parseHalfExactMarket(quote(title,'2')),null,title);
}
const stamp='2026-11-08T20:10:00Z';
const execute=async(sql,args)=>{
 if(sql.startsWith('with covered as'))return {rows:[{
  home:3,away:2,total:5,count_home:3,count_away:2,
  through_minute:92,complete:true,open_recovery_gap:false,
  observed_at:stamp,confirmed_at:stamp,second_poll_at:stamp
 }]};
 if(sql.includes('select minute,seconds,team,phase,card_color')){
  assert.deepEqual(args,[114,'zizobet','corner']);
  return {rows:corners};
 }
 throw Error('Unexpected SQL '+sql.slice(0,110));
};
assert.equal(await gradeStoredEventContract({
 id:'00000000-0000-4000-8000-000000000114',match_id:114,
 live_contract:corner('1st half - Away team exact corners','2')
},{home_score:0,away_score:0,corners_home:3,corners_away:2},{execute}),'WON');

const score={home_score:4,away_score:2,half_home_score:1,half_away_score:1};
for(const [title,choice,want] of [
 ['1st half - exact goals','2','WON'],
 ['1st half - exact goals','3','LOST'],
 ['2nd half - exact goals','4','WON'],
 ['2nd half - exact goals 2+','4','WON'],
 ['1st half - exact goals 3+','3','LOST'],
 ['Exact goals 5+','6','WON']
]){
 const contract=parsePeriodGoalTotal(quote(title,choice));
 assert.equal(gradePeriodGoalTotal(contract,score),want,title);
 assert.equal(gradeLine(quote(title,choice),score),want,
  'Historical goal totals use verified FT minus HT scoreboard');
}
assert.equal(parsePeriodGoalTotal(quote('1st half - exact goals 2+','1')),null);
console.log('PASS: catalogue-derived half exact corners/cards/red cards, HT/FT exact goals and SQL fact checks');
