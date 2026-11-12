import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';
import {normalizeLiveFrame} from '../server/ledger/live-observation-store.mjs';
import {primaryLiveDecision,verifiedSecondLiveDecision} from '../server/ledger/verified-live-settlement.mjs';

const now=Date.now();
const bet={market_name:'Total corners in minutes 10-20 (10-minute interval)',outcome_name:'Yes'};
function fixture(minute){return {
 service:'LIVE',home:'Home FC',away:'Away FC',home_score:0,away_score:0,
 match_time_ms:minute*60000,clock_at:new Date(now).toISOString(),score_at:new Date(now).toISOString()
};}
assert.equal(frozenLiveContract(bet,fixture(9),now).kind,'window');
assert.equal(frozenLiveContract(bet,fixture(10),now).kind,'window',
 'A started window is not automatically settled for a new ticket');
assert.equal(frozenLiveContract(bet,fixture(15),now).kind,'window',
 'A new LIVE ticket watches future incidents after its own frozen acceptance');
assert.throws(()=>frozenLiveContract(bet,fixture(21),now),/përfunduar/);

const original={Match:{Score:'0:0',MatchTimeExtended:'21:00',
 CornersTeam1:1,CornersTeam2:0,YellowCardsTeam1:0,YellowCardsTeam2:0,
 RedCardsTeam1:0,RedCardsTeam2:0,EventStatus:6},TimeLines:[
 {id:'c1',type:'corner_kick',team:1,gt:15},
 {id:'bad',type:'corner_kick',team:2,gt:16,cancelled:true}]};
const frame=normalizeLiveFrame(original);
assert.equal(frame.counts.corner,1);
assert.equal(frame.coverage.cornerThrough,21);
const contract=frozenLiveContract(bet,fixture(9),now);
assert.equal(primaryLiveDecision(contract,frame),'WON');
assert.equal(primaryLiveDecision({...contract,choice:false},frame),'LOST');
const missing=normalizeLiveFrame({...original,Match:{...original.Match,CornersTeam1:2}});
assert.equal(missing.coverage.cornerThrough,undefined);
assert.equal(primaryLiveDecision({...contract,choice:false},missing),'LOST','Positive evidence proves NO loses even if earlier events missing');
const absent={...missing,events:[]};
assert.equal(primaryLiveDecision(contract,absent),null,'No event cannot be inferred from truncated timeline');
assert.equal(primaryLiveDecision({...contract,choice:false},absent),null,'NO cannot be paid from truncated timeline');

const placed=new Date(now-40000),first=new Date(now-30000),stored=new Date(now-25000);
const current=new Date(now-10000),seen=new Date(now-9000);
const row={payload:{contract,frame,frameAt:first.toISOString()},
 live_contract:contract,provider_frame:frame,placed_at:placed.toISOString(),
 preview_at:stored.toISOString(),frame_at:current.toISOString(),
 second_seen_at:seen.toISOString(),proposed_status:'WON',open_recovery_gap:false};
assert.equal(verifiedSecondLiveDecision(row,{now}),null,
 'A fixed time window cannot be paid from a provider-frame preview alone: SQL incident and frozen baseline required');
assert.equal(verifiedSecondLiveDecision({...row,open_recovery_gap:true},{now}),null);
assert.equal(verifiedSecondLiveDecision({...row,second_seen_at:stored.toISOString()},{now}),null);
assert.equal(verifiedSecondLiveDecision({...row,proposed_status:'LOST'},{now}),null);
assert.equal(verifiedSecondLiveDecision({...row,provider_frame:absent},{now}),null);
console.log('PASS: freeze acceptance, cancelled incident exclusion, missing timeline protection, double confirmation, recovery gaps');
