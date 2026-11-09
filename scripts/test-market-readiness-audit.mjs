import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {auditOffer} from './audit-market-settlement-readiness.mjs';

const row=(market_name,outcome_name,line='',period=0)=>({
 market_name,outcome_name,line,period,native_market_id:'test-native'
});
const expectCategory=(title,selection,line,period,category)=>{
 const finding=auditOffer(row(title,selection,line,period));
 assert.equal(finding.category,category,
  title+' / '+selection+': '+JSON.stringify(finding));
};
expectCategory('1st half - Away team exact corners','2','',1,'INCIDENT_EVIDENCE_REQUIRED');
expectCategory('2nd half - Corners Away team (1.5)','Under','1.5',2,'INCIDENT_EVIDENCE_REQUIRED');
expectCategory('1st half - Total corners Home team (2.5)','Over','2.5',1,'INCIDENT_EVIDENCE_REQUIRED');
expectCategory('1st half - exact goals','2','',1,'SCORE_GRADEABLE');
expectCategory('2nd half - exact goals','4','',2,'SCORE_GRADEABLE');
expectCategory('2nd half result','1','',2,'SCORE_GRADEABLE');
expectCategory('Half Time / Full Time','1/X','',0,'SCORE_GRADEABLE');
expectCategory('Half Time / Full Time','mystery','',0,'UNSUPPORTED_OR_SPECIAL');
expectCategory('Total Goals','Over','2.5',0,'SCORE_GRADEABLE');
expectCategory('Total Corners','Over','2.5',0,'STATS_EVIDENCE_REQUIRED');
expectCategory('Which team wins race to 7 cards','None','',0,'INCIDENT_EVIDENCE_REQUIRED');
expectCategory('Asian Handicap','Home','1.25',0,'DANGER_WRONG_RESULT');
assert.notEqual(auditOffer(row('1st Half - Total Booking Points','Over','2.5',1)).category,
 'SCORE_GRADEABLE','Booking points must never be graded as ordinary cards');
assert.notEqual(auditOffer(row('Goal in next 10 minutes','Yes')).category,
 'SCORE_GRADEABLE','An unanchored rolling window must not be marked score-ready');
console.log('PASS audit recognizes supported half/event and HT/FT rules without certifying unknown markets');
