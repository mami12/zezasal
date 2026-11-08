import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {parseMultiCornerContract,gradeMultiCornerFacts} from '../server/ledger/multi-corners.mjs';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';

const events=[
 {team:'home',phase:'H1',minute:10},{team:'away',phase:'H1',minute:15},
 {team:'home',phase:'H1',minute:25},{team:'away',phase:'H2',minute:47},
 {team:'home',phase:'H2',minute:67},{team:'away',phase:'H2',minute:88}
]; // 1H=3; 2H=3; Multi-Corners=9. Home: 2x1=2; Away: 1x2=2.
for(const [market_name,outcome_name,line,expected] of [
 ['Multi-Corners','Over','8.5','WON'],['Multi Corners','Under','8.5','LOST'],
 ['Multi-Corners','Over','9','VOID'],['Multi Corners','Exactly 9','','WON'],
 ['Home Team Multi Corners','Over','1.5','WON'],
 ['Team 2 Multi Corners','Under','2.5','WON'],
 ['Team Multi Corners','Over','8.5','WON']
]){
 const c=parseMultiCornerContract({market_name,outcome_name,line});
 assert.ok(c,market_name+' contract');
 assert.equal(gradeMultiCornerFacts(c,events,{complete:true}),expected,market_name);
 assert.equal(gradeMultiCornerFacts(c,events,{complete:false}),null);
}
const contract=liveContract({market_name:'Multi Corners',outcome_name:'Over',line:'8.5'});
assert.equal(contract.kind,'multi-corners');
assert.equal(contract.event,'corner');
assert.equal(parseMultiCornerContract({market_name:'Asian Multi Corners',outcome_name:'Over',line:'8.5'}),null);
assert.equal(gradeMultiCornerFacts(contract,[...events,{team:'home',minute:45,phase:null}],{complete:true}),null,
 'A 45+ injury-time corner must not be guessed into the 2nd half');
const result={home_score:1,away_score:0,corners_home:3,corners_away:3};
const execute=async(sql,args)=>{
 if(sql.startsWith('with covered as'))return {rows:[{
  home:3,away:3,total:6,count_home:3,count_away:3,
  through_minute:93,complete:true,open_recovery_gap:false,
  observed_at:'2026-11-08T13:30:00Z',confirmed_at:'2026-11-08T13:30:00Z',
  second_poll_at:'2026-11-08T13:30:00Z'
 }]};
 if(sql.includes('select minute,seconds,team,phase')){
  assert.equal(args[1],'zizobet');
  return {rows:events};
 }
 throw Error('Unexpected SQL: '+sql.slice(0,110));
};
assert.equal(await gradeStoredEventContract({
 id:'00000000-0000-4000-8000-000000000002',match_id:99,live_contract:contract
},result,{execute}),'WON','An agreed full chronology is sufficient to grade Multi-Corners');
console.log('PASS Multi/Team Multi Corners, bookmaker 1H*2H rule, DB incidents, void at integer line');
