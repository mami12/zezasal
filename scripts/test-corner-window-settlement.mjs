import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import { resolveMarketTitle } from '../server/zizobet/normalize.mjs';
import { cornerTotalContract } from '../server/ledger/corner-total-contract.mjs';
import { eventContract } from '../server/ledger/event-contract.mjs';
import { normalizeEvents, gradeClosedCornerWindow } from '../server/ledger/event-evidence.mjs';
import { gradeLine, hasRequiredSettlementEvidence, settleClosedCornerWindows } from '../server/ledger/settler.mjs';

assert.equal(resolveMarketTitle('Which team wins race to X corners', {h:5}), 'Which team wins race to 5 corners');
assert.equal(resolveMarketTitle('Which team wins race to X goals', {h:6}), 'Which team wins race to 6 goals');
assert.equal(resolveMarketTitle('Which team wins race to X goals', {}),null);
assert.equal(resolveMarketTitle('Which team wins race to X goals', {h:6,p3:7}),null);
assert.equal(resolveMarketTitle('Which team wins race to X corners', {}), null);
assert.equal(resolveMarketTitle('Which team wins race to X corners', {h:5,p3:7}), null);
assert.equal(resolveMarketTitle('Which team wins race to X corners', {h:1.5}), null);

const result={home_team:'Home',away_team:'Away',home_score:1,away_score:0,
  corners_home:1,corners_away:7,cards_home:0,cards_away:0};
const pick=(market_name,line='3.5',outcome_name='Over')=>({
  market_name,line,outcome_name,outcome_key:outcome_name,builder_legs:null
});
assert.deepEqual(cornerTotalContract(pick('Home Team Total Corners'),result),{scope:'home'});
assert.deepEqual(cornerTotalContract(pick('Away Team Total Corners'),result),{scope:'away'});
assert.deepEqual(cornerTotalContract(pick('Total Corners'),result),{scope:'total'});
for(const name of ['Race to 3 Corners','Next Corner','Who takes most corners',
  'Total Corners in minutes 11-15 (5-minute interval)']) {
 assert.equal(cornerTotalContract(pick(name),result),null);
 assert.equal(hasRequiredSettlementEvidence(pick(name),result),false);
}
assert.equal(gradeLine(pick('Home Team Total Corners'),result),'LOST');
assert.equal(gradeLine(pick('Away Team Total Corners'),result),'WON');
assert.equal(gradeLine(pick('Total Corners'),result),'WON');
assert.equal(hasRequiredSettlementEvidence(pick('Home Team Total Corners'),result),true);
assert.equal(hasRequiredSettlementEvidence(pick('Home Team Total Corners'),{...result,corners_home:null}),false);

const window='Will there be a corner in minutes 11-15 (5-minute interval)';
assert.equal(eventContract(pick(window)).valid,true);
assert.equal(eventContract(pick('5 minutes - Corner from 10:00 to 15 min')).valid,true);
assert.equal(eventContract(pick('Corner in next 5 minutes')).valid,false);
const observation=(clock,home,away,rows)=>normalizeEvents({
 Match:{MatchTimeExtended:clock,CornersTeam1:home,CornersTeam2:away},
 TimeLines:rows
},'zizobet');
const corner={id:'c12',type:'corner_kick',team:1,gt:12};
const won=observation('16:02',1,0,[corner]);
assert.equal(gradeClosedCornerWindow(pick(window,'','Yes'),won),'WON');
assert.equal(gradeClosedCornerWindow(pick(window,'','No'),won),'LOST');
assert.equal(gradeClosedCornerWindow(pick(window,'','No'),observation('16:02',0,0,[])),'WON');
assert.equal(gradeClosedCornerWindow(pick(window,'','Yes'),observation('16:02',0,0,[])),'LOST');
assert.equal(gradeClosedCornerWindow(pick(window,'','Yes'),observation('15:59',1,0,[corner])),null);
assert.equal(gradeClosedCornerWindow(pick(window,'','Yes'),observation('16:02',2,0,[corner])),null);
assert.equal(gradeClosedCornerWindow(pick(window,'','Yes'),observation('16:02',null,0,[])),null);
assert.equal(gradeClosedCornerWindow(pick(window,'','Unknown'),won),null);

const lines=[
 {id:'one',ticket_id:'ticket1',match_id:'101',status:'PENDING',market_name:window,outcome_name:'Yes'},
 {id:'two',ticket_id:'ticket2',match_id:'102',status:'PENDING',market_name:window,outcome_name:'No'},
 {id:'three',ticket_id:'ticket3',match_id:'103',status:'PENDING',market_name:window,outcome_name:'Yes'},
];
const updates=[],paid=[];
const settled=await settleClosedCornerWindows({
 runQuery:async()=>({rows:lines}),
 loadEvidence:async id=>id==='101'?won:id==='102'?observation('16:02',0,0,[]):null,
 update:async(id,status,ticketId)=>{updates.push({id,status,ticketId});return 1;},
 recalc:async id=>{paid.push(id);return {ticketId:id};},
});
assert.equal(settled.graded,2);
assert.deepEqual(updates.map(item=>[item.id,item.status]),[['one','WON'],['two','WON']]);
assert.deepEqual(paid,['ticket1','ticket2']);
console.log('PASS race thresholds, corner-team totals, timed YES/NO decisions and unverified-pending safety');
