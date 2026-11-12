import assert from 'node:assert/strict';
import {
 primaryLiveDecision,verifiedSecondLiveDecision,settleVerifiedLiveProposals,
 VERIFIED_LIVE_PROPOSALS_SQL
} from '../server/ledger/verified-live-settlement.mjs';

const now=Date.parse('2026-11-06T17:30:00Z');
const contract={version:1,kind:'sequence',event:'goal',target:2,side:'away',baseline:{home:1,away:0}};
const frame={
 source:'zizobet',clock:37,counts:{goal:2,corner:1},
 teams:{goal:{home:1,away:1},corner:{home:1,away:0}},
 coverage:{goalThrough:37,cornerThrough:37},
 events:[
  {id:'g1',type:'goal',team:'home',minute:10,seconds:600},
  {id:'g2',type:'goal',team:'away',minute:36,seconds:2160}
 ],ended:false
};
assert.equal(primaryLiveDecision(contract,frame),'WON');
assert.equal(primaryLiveDecision(contract,{...frame,source:'aiscore'}),null,
 'AiScore discovery cannot authorize money movements');
assert.equal(primaryLiveDecision({...contract,baseline:null},{...frame,coverage:{}}),null,
 'Without complete PRIMARY evidence or safe delta, no winner may be guessed');
assert.match(VERIFIED_LIVE_PROPOSALS_SQL,/app_live_event_cursor/);
assert.match(VERIFIED_LIVE_PROPOSALS_SQL,/app_live_event_recovery/);
const row={
 line_id:'line-a',ticket_id:'ticket-a',match_id:1,proposed_status:'WON',
 payload:{contract,frame,frameAt:new Date(now-30000).toISOString()},
 live_contract:contract,provider_frame:frame,
 placed_at:new Date(now-60000).toISOString(),
 preview_at:new Date(now-25000).toISOString(),
 frame_at:new Date(now-30000).toISOString(),
 second_seen_at:new Date(now-5000).toISOString(),
 open_recovery_gap:false,
};
assert.equal(verifiedSecondLiveDecision(row,{now}),'WON');
assert.equal(verifiedSecondLiveDecision({...row,open_recovery_gap:true},{now}),null);
assert.equal(verifiedSecondLiveDecision({...row,second_seen_at:new Date(now-24500)},{now}),null,
 'A second observation must be at least five seconds after the first proposal');
assert.equal(verifiedSecondLiveDecision({...row,second_seen_at:new Date(now-120000)},{now}),null,
 'No stale or out-of-order feed observation');
assert.equal(verifiedSecondLiveDecision({...row,provider_frame:{...frame,source:'aiscore'}},{now}),null);
assert.equal(verifiedSecondLiveDecision({...row,provider_frame:{...frame,
 teams:{...frame.teams,goal:{home:2,away:0}},coverage:{},
 events:[...frame.events.slice(0,1),{...frame.events[1],team:'home'}]}},{now}),null,
 'The two source observations must agree on the winner');
assert.equal(verifiedSecondLiveDecision({...row,live_contract:{...contract,target:3}},{now}),null,
 'Accepted contract may never be changed during settlement');
assert.equal(verifiedSecondLiveDecision({...row,proposed_status:'LOST'},{now}),null,
 'A stored verdict must agree with both live calculations');

const counted={source:'zizobet',clock:20,counts:{goal:1},teams:{goal:{home:1,away:0}},
 events:[],coverage:{},ended:false};
const firstOnly={version:1,kind:'sequence',event:'goal',target:1,side:'home',baseline:{home:0,away:0}};
const countersRow={...row,proposed_status:'WON',live_contract:firstOnly,
 payload:{contract:firstOnly,frame:counted,frameAt:row.payload.frameAt},
 provider_frame:counted};
assert.equal(primaryLiveDecision(firstOnly,counted),'WON',
 'Verified one-goal difference in PRIMARY counters is enough for Next Goal');
assert.equal(verifiedSecondLiveDecision(countersRow,{now}),'WON',
 'The retained PRIMARY per-team counters must survive the second verification');
const cornerRace={version:1,kind:'race',event:'corner',target:6,side:'home',baseline:{home:2,away:1}};
const cornerFrame={source:'zizobet',clock:50,counts:{corner:8},
 teams:{corner:{home:6,away:2}},events:[],coverage:{},ended:false};
assert.equal(primaryLiveDecision(cornerRace,cornerFrame),'WON',
 'Race to six corners can be proven by PRIMARY team counters without another API');
// Real money requires two independent snapshots AND a unique delta since
// purchase. A partial timeline alone may never select a first/next winner.
const cornerRow={...row,live_contract:cornerRace,proposed_status:'WON',
 payload:{contract:cornerRace,frame:cornerFrame,frameAt:row.payload.frameAt},
 provider_frame:cornerFrame};
assert.equal(verifiedSecondLiveDecision(cornerRow,{now}),'WON',
 'A safely reached Race-to-X corner threshold settles from two polls');
const ambiguousNext={...firstOnly,kind:'sequence',event:'goal',target:1,side:'home'};
const twoUnordered={...counted,counts:{goal:2},
 teams:{goal:{home:1,away:1}},events:[
  {id:'h',type:'goal',team:'home',minute:10,seconds:600},
  {id:'a',type:'goal',team:'away',minute:14,seconds:840}
 ],coverage:{goalThrough:20}};
const disputed={...row,live_contract:ambiguousNext,proposed_status:'WON',
 payload:{contract:ambiguousNext,frame:twoUnordered,frameAt:row.payload.frameAt},
 provider_frame:twoUnordered};
assert.equal(verifiedSecondLiveDecision(disputed,{now}),null,
 'Two events after acceptance must not be decided by final counters alone');
const timed={version:1,kind:'window',event:'goal',choice:true,from:10,to:20};
const timedFrame={...frame,teams:{goal:{home:1,away:1}}};
const timedRow={...row,live_contract:timed,proposed_status:'WON',
 payload:{contract:timed,frame:timedFrame,frameAt:row.payload.frameAt},
 provider_frame:timedFrame};
assert.equal(verifiedSecondLiveDecision(timedRow,{now}),null,
 'A past goal inside the quoted window is not proof of an event after LIVE purchase');
const player={version:1,kind:'player-goal',event:'goal',playerName:'Alice',choice:true};
const playerRow={...row,live_contract:player,proposed_status:'WON',
 payload:{contract:player,frame,frameAt:row.payload.frameAt},provider_frame:frame};
assert.equal(verifiedSecondLiveDecision(playerRow,{now}),null,
 'Score-only observations can never settle named-player wagers');


const calls=[];
const runQuery=async(sql)=>{assert.match(sql,/app_live_settlement_preview/);return {rows:[row,
 {...row,line_id:'line-b',open_recovery_gap:true}]};};
const updateLine=async(id,status,ticketId)=>{calls.push({id,status,ticketId});return 1;};
const closeTicket=async id=>({ticketId:id,status:'WON'});
const off=await settleVerifiedLiveProposals({runQuery:()=>{throw Error('Disabled should not query');},
 enabled:false,updateLine,closeTicket,now:()=>now});
assert.equal(off.enabled,false);
const result=await settleVerifiedLiveProposals({runQuery,enabled:true,now:()=>now,updateLine,closeTicket});
assert.deepEqual({examined:result.examined,graded:result.graded,closed:result.closed.length},
 {examined:2,graded:1,closed:1});
assert.deepEqual(calls,[{id:'line-a',status:'WON',ticketId:'ticket-a'}]);
console.log('PASS guarded double observation: primary-only, clock freshness, no recovery gaps, no stale contract and no duplicate writes');
