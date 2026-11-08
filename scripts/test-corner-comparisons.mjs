import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {parseCornerComparison,gradeCornerComparisonFacts} from '../server/ledger/corner-comparisons.mjs';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
const events=[
 {team:'home',minute:9,phase:'1H'},{team:'away',minute:18,phase:'1H'},
 {team:'home',minute:27,phase:'1H'},{team:'home',minute:51,phase:'2H'},
 {team:'away',minute:60,phase:'2H'},{team:'home',minute:77,phase:'2H'}
]; // HT 2-1 corners, 2H 2-1 corners, both halves had 3 corners.
for(const [title,choice,expected]of [
 ['Half with Most Corners','1st Half','LOST'],
 ['Half with Most Corners','2nd Half','LOST'],
 ['Half with Most Corners','Draw','WON'],
 ['Home Team Half with Most Corners','Draw','WON'],
 ['Most Corners in Each Half','1','WON'],
 ['Most Corners in Each Half','2','LOST'],
 ['Most Corners in Each Half','None','LOST'],
 ['1st Half Corners 1X2','1','WON'],
 ['2nd Half Corners Result','1','WON'],
 ['1st Half Most Corners','2','LOST']
]){
 const c=liveContract({market_name:title,outcome_name:choice});
 assert.equal(c?.kind,'corner-comparison',title+' parsed');
 assert.equal(gradeCornerComparisonFacts(c,events,{complete:true}),expected,title+' '+choice);
 assert.equal(gradeCornerComparisonFacts(c,events,{complete:false}),null);
}
assert.equal(parseCornerComparison({market_name:'1st Half Corners Result',outcome_name:'1',period:2}),null);
const weird=[...events,{team:'home',minute:45,phase:null}];
const half=liveContract({market_name:'Half with Most Corners',outcome_name:'Draw'});
assert.equal(gradeCornerComparisonFacts(half,weird,{complete:true}),null,
 '45+ incident with missing phase cannot be assigned to 2H');
const tie=[
 {team:'home',phase:'H1',minute:10},
 {team:'away',phase:'H1',minute:20}
];
const two=liveContract({market_name:'1st Half Most Corners',outcome_name:'1'});
assert.equal(gradeCornerComparisonFacts(two,tie,{complete:true}),'VOID',
 'Two-way Most Corners ties refund');
const three=liveContract({market_name:'1st Half Most Corners',outcome_name:'1',
 cornerDrawOffered:true});
assert.equal(gradeCornerComparisonFacts(three,tie,{complete:true}),'LOST',
 'When 1/X/2 are quoted, the draw selection is the winner');
const execute=async(sql,args)=>{
 if(sql.startsWith('with covered as'))return {rows:[{
  home:4,away:2,total:6,count_home:4,count_away:2,through_minute:92,
  complete:true,open_recovery_gap:false,
  observed_at:'2026-11-08T13:30:00Z',confirmed_at:'2026-11-08T13:30:00Z',
  second_poll_at:'2026-11-08T13:30:00Z'
 }]};
 if(sql.includes('select minute,seconds,team,phase'))return {rows:events};
 throw Error('Unexpected SQL '+sql.slice(0,120));
};
assert.equal(await gradeStoredEventContract({id:'00000000-0000-4000-8000-000000000003',
 match_id:99,live_contract:half},{home_score:2,away_score:0,corners_home:4,corners_away:2},
 {execute}),'WON','Verified 1H/2H corner counts settle draw of halves');
console.log('PASS most corners by half, team wins corners both halves, corners 1X2 and quoted draw variants');
