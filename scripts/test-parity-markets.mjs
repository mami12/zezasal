import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {parseParityMarket,gradeParityMarket} from '../server/ledger/parity-markets.mjs';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';
import {gradeHalfParityFacts} from '../server/ledger/match-event-facts.mjs';
import {gradeLine,hasRequiredSettlementEvidence} from '../server/ledger/settler.mjs';
const result={home_score:2,away_score:1,half_home_score:1,half_away_score:0,
 corners_home:4,corners_away:7,cards_home:1,cards_away:2};
const decision=(market_name,outcome_name,r=result)=>gradeLine({market_name,outcome_name,builder_legs:null},r);
for(const [name,choice,expected] of [
 ['Total Corners Odd/Even','Odd','WON'],
 ['Total Corners Odd/Even','Even','LOST'],
 ['Home Team Corners Odd/Even','Even','WON'],
 ['Away Team Corners Odd/Even','Odd','WON'],
 ['Goals Odd/Even','Odd','WON'],
 ['1st Half Goals Odd/Even','Odd','WON'],
 ['2nd Half Goals Odd/Even','Even','WON'],
 ['Odd/Even','Odd','WON']
])assert.equal(decision(name,choice),expected,name);
assert.equal(decision('Odd/Even','Even',{...result,home_score:0,away_score:0}),'WON',
 'Zero is EVEN under the official odd/even corners and goals rule');
for(const name of ['Cards Odd/Even','Unknown Team Corners Odd/Even','First Player Odd/Even']){
 assert.equal(decision(name,'Odd'),null,'Unsupported parity must never settle as goals: '+name);
 assert.equal(hasRequiredSettlementEvidence({market_name:name,outcome_name:'Odd'},result),false);
}
assert.equal(decision('Total Corners Odd/Even','Odd',{...result,corners_home:null}),null);
assert.equal(decision('2nd Half Goals Odd/Even','Even',{...result,half_home_score:null}),null);
assert.equal(decision('2nd Half Goals Odd/Even','Even',{...result,half_home_score:4}),null);
const half=parseParityMarket({market_name:'1st Half Corners Odd/Even',outcome_name:'Odd'});
assert.deepEqual([half.kind,half.event,half.half],['half-parity','corner',1]);
assert.equal(liveContract({market_name:'1st Half Corners Odd/Even',outcome_name:'Odd'})?.kind,'half-parity');
const events=[{team:'home',minute:12,phase:'H1'},{team:'away',minute:28,phase:'H1'},
 {team:'away',minute:45,phase:'H1'},{team:'home',minute:49,phase:'H2'},
 {team:'away',minute:52,phase:'H2'}];
assert.equal(gradeHalfParityFacts(half,events,{complete:true}),'WON');
assert.equal(gradeHalfParityFacts({...half,half:2,choice:'even'},events,{complete:true}),'WON');
assert.equal(gradeHalfParityFacts({...half,half:2,choice:'odd',side:'home'},events,{complete:true}),'WON');
assert.equal(gradeHalfParityFacts(half,events,{complete:false}),null);
assert.equal(gradeHalfParityFacts(half,[...events,{team:'away',minute:45,phase:null}],{complete:true}),null,
 'Minute 45 without period cannot be guessed as second half');
console.log('PASS odd/even for goals, FT corners, team and half corners, incomplete and ambiguous evidence');
