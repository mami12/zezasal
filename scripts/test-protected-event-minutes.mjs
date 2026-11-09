import assert from 'node:assert/strict';
import {providerTimeline,inheritEventPlayers} from '../server/live-event-timeline.mjs';
const rows=[{id:'g',type:'score_change',team:'home',gt:23},{id:'y',type:'yellow_card',team:'away',gt:'45+2'},
 {id:'c',type:'corner_kick',team:'home',gt:78},{id:'x',type:'score_change',team:'home'},
 {id:'bad',type:'red_card',team:'unknown',gt:44},{id:'cancelled',cancelled:true,type:'score_change',team:'home',gt:50}];
const events=providerTimeline(9,rows);
assert.deepEqual(events.map(e=>[e.type,e.minuteLabel]),[['goal','23'],['yellow_card','45+2'],['corner','78']]);
assert.equal(providerTimeline(9,undefined),undefined,'missing events do not synthesize a timeline from the current clock');
assert.deepEqual(providerTimeline(9,rows.concat(rows)),events,'stable IDs deduplicate repeated incidents');
assert.deepEqual(providerTimeline(9,[{id:'late',type:'corner',team:'home',gt:'45+10'},{id:'early',type:'goal',team:'away',gt:'45+2'}]).map(e=>e.minuteLabel),['45+2','45+10'],'stoppage incidents are ordered by their real added minute');
assert.deepEqual(providerTimeline(9,[{id:'goal',type:'goal',team:'home',gt:23},{id:'goal',cancelled:true}]),[],'a provider cancellation removes the same incident instead of retaining its earlier version');
// Event actor labels belong to ALL provider incident types, not just goals.
// A fast socket snapshot without an actor must never permanently erase these.
const named=providerTimeline(44,[
 {id:'goal-1',type:'score_change',team:1,gt:12,pl:'Scorer One'},
 {id:'corner-1',type:'corner_kick',team:2,gt:23,player:{name:'Corner Taker'}},
 {id:'yellow-1',type:'yellow_card',team:1,gt:34,player_name:'Booked Player'},
 {id:'red-1',type:'red_card',team:2,gt:46,playerName:'Sent Off Player'},
 {id:'foul-1',type:'foul_committed',team:1,gt:58,pl:'Fouling Player'}
]);
assert.deepEqual(named.map(e=>[e.type,e.player]),[
 ['goal','Scorer One'],['corner','Corner Taker'],
 ['yellow_card','Booked Player'],['red_card','Sent Off Player'],['foul','Fouling Player']
]);
assert.equal(providerTimeline(44,[{id:'unknown',type:'foul',team:1,gt:55}])[0].player,
 undefined,'Do not invent a player name when no actor was supplied');

const stripped=named.map(event=>({...event,player:undefined}));
const preserved=inheritEventPlayers(stripped,named);
assert.deepEqual(preserved.map(event=>event.player),named.map(event=>event.player),
 'A header missing player labels must retain exact matched actors');
assert.equal(inheritEventPlayers([{...stripped[0],minute:13}],named)[0].player,undefined,
 'A corrected event minute must never inherit a stale player');
assert.equal(inheritEventPlayers([{...stripped[0],team:'away'}],named)[0].player,undefined,
 'A corrected team must never inherit the previous actor');
assert.equal(inheritEventPlayers(stripped.slice(1),named).length,4,
 'A removed event must not be revived from older named snapshots');
console.log('PASS provider event minutes:23,45+2,78; unknown times/teams not invented; repeated/cancelled events handled');
