import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {isHandicapMarket,parseHandicapContract,gradeHandicapContract,gradeHalfCornerHandicapFacts} from '../server/ledger/handicap-contracts.mjs';
import {gradeLine} from '../server/ledger/settler.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';

const result={home_team:'Home',away_team:'Away',home_score:2,away_score:1,
 half_home_score:1,half_away_score:0,corners_home:6,corners_away:5};
const quote=(market_name,outcome_name,line,other={})=>({
 market_name,outcome_name,line,...other
});
for(const [ticket,expected]of [
 [quote('European Handicap 1X2','X','-1'),'WON'],
 [quote('European Handicap 1X2','1','-1'),'LOST'],
 [quote('European Handicap 1X2','2','-1'),'LOST'],
 [quote('Asian Handicap','1','-1'),'VOID'],
 [quote('Asian Handicap','2','-1'),'VOID'],
 [quote('Asian Handicap','1','-0.5'),'WON'],
 [quote('Asian Handicap','2','-0.5'),'LOST'],
 [quote('Corner Handicap','2','-2'),'WON'],
 [quote('2nd Half Asian Handicap','1','-0.5'),'WON'],
 [quote('Asian Handicap','2 (+1.5)','-1.5'),'WON'],
 [quote('Asian Handicap','1','0'),'WON']
]){
 const contract=parseHandicapContract(ticket);
 assert.ok(contract,ticket.market_name+' has contract');
 assert.equal(gradeHandicapContract(contract,result),expected,JSON.stringify(ticket));
 assert.equal(await gradeStoredEventContract({live_contract:contract},result,{execute:()=>{throw Error('should not fetch chronology');}}),expected);
}
assert.equal(parseHandicapContract(quote('Asian Handicap','1','-0.25')),null,
 'Quarter ball needs split-stake accounting: never pay it as a full WIN or LOSS');
assert.equal(parseHandicapContract(quote('Asian Handicap','1','-0.75')),null);
const firstHalf=quote('1st Half Corner Handicap','1','-0.5');
const firstContract=parseHandicapContract(firstHalf);
assert.equal(firstContract?.half,1,'A first-half corner handicap is distinct from FT');
const secondContract=parseHandicapContract(quote('2nd Half Corner Handicap','2','0.5'));
assert.equal(secondContract?.half,2);
const firstEvents=[
 {minute:13,team:'home',phase:'H1'}, {minute:23,team:'home',phase:'H1'},
 {minute:40,team:'away',phase:'H1'}, {minute:45,team:'home',phase:'H1'},
 {minute:60,team:'away',phase:'H2'}, {minute:77,team:'away',phase:'H2'},
 {minute:83,team:'home',phase:'H2'}
];
assert.equal(gradeHalfCornerHandicapFacts(firstContract,firstEvents,{complete:true}),'WON',
 '3-1 first-half corners adjusted by -0.5 wins');
assert.equal(gradeHalfCornerHandicapFacts(secondContract,firstEvents,{complete:true}),'WON',
 'Away 2-1 in second-half corners adjusted by +0.5 wins');
assert.equal(gradeHalfCornerHandicapFacts(firstContract,firstEvents,{complete:false}),null);
assert.equal(gradeHalfCornerHandicapFacts(firstContract,
 [...firstEvents,{minute:45,team:'home',phase:null}],{complete:true}),null,
 'Unlabelled 45+ corner cannot be allocated to a half');
const halfExecute=async(sql)=>{
 if(sql.startsWith('with covered as'))return {rows:[{
  home:4,away:3,total:7,count_home:4,count_away:3,
  complete:true,through_minute:92,open_recovery_gap:false,
  observed_at:'2026-11-08T13:30:00Z',
  confirmed_at:'2026-11-08T13:30:00Z',
  second_poll_at:'2026-11-08T13:30:00Z'
 }]};
 if(sql.includes('select minute,seconds,team,phase'))return {rows:firstEvents};
 throw Error('Unexpected SQL query: '+sql.slice(0,90));
};
assert.equal(await gradeStoredEventContract({
 id:'00000000-0000-4000-8000-000000000111',match_id:144,
 live_contract:firstContract},
 {home_score:0,away_score:0,corners_home:4,corners_away:3},
 {execute:halfExecute}),'WON',
 'Frozen first half handicap must be settled from verified PostgreSQL corner chronology');
assert.equal(parseHandicapContract(quote('Asian Handicap Yellow Cards','1','-0.5')),null);
assert.equal(gradeLine(quote('Generic Handicap','1','-1'),result),null,
 'Historical ambiguous 2-way vs 3-way handicaps remain ungraded');
assert.equal(gradeLine(quote('Asian Handicap','1','-1'),result),'VOID',
 'Verified Asian integer spread is a refund, not a loss');
assert.equal(gradeLine(quote('Corner Handicap','2','-2'),result),'WON',
 'Corner handicap uses corners, not final goals');
const live=parseHandicapContract(quote('Rest of Match Asian Handicap','2','-0.5'));
assert.equal(gradeHandicapContract({...live,baseline:{home:1,away:0}},
 {...result,home_score:2,away_score:1}),'WON',
 'Rest-of-match handicap ignores accepted earlier goals');
assert.equal(gradeHandicapContract({...live,baseline:{home:3,away:0}},result),null,
 'Impossible baseline must not pay');
console.log('PASS Asian and European 1X2 handicaps, FT/corners/halves, live baseline, pushes and quarter-line guards');
