import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {auditQuotedMarket,summarizeMarketCoverage} from '../server/ledger/market-coverage.mjs';
const quote=(native_market_id,market_name,outcome_name,line='')=>({
 native_market_id,native_market_name:market_name,market_name,outcome_name,line,
 outcome_key:outcome_name,market_key:'zz'+native_market_id,period:0
});
for(const [offer,expected] of [
 [quote(101,'Full Time Result','1'),'RULE_MAPPED'],
 [quote(102,'Next Goal','1'),'RULE_MAPPED'],
 [quote(103,'Total Fouls','Over','10.5'),'RULE_MAPPED'],
 [quote(104,'Home Team To Score In Both Halves','Yes'),'RULE_MAPPED'],
 [quote(105,'Last Corner','2'),'RULE_MAPPED'],
 [quote(106,'Asian Handicap','Home','1.25'),'NEEDS_RULE'],
 [quote(107,'Player Shots On Target','Over','2.5'),'NEEDS_RULE'],
 [quote(108,'Provider Mystery Special','Option A'),'NEEDS_RULE']
])assert.equal(auditQuotedMarket(offer).status,expected,offer.market_name);
const dictionary=[
 {native_market_id:'101',native_market_name:'Full Time Result',scope:'PREMATCH'},
 {native_market_id:'102',native_market_name:'Next Goal',scope:'LIVE'},
 {native_market_id:'999',native_market_name:'Unquoted Market',scope:'PREMATCH'}
];
const quoted=[quote('101','Full Time Result','1'),quote('101','Full Time Result','1'),
 quote('102','Next Goal','1'),quote('102','Next Goal','Unsupported Choice')];
const report=summarizeMarketCoverage(dictionary,quoted);
assert.equal(report.summary.marketFamilies,3);
assert.equal(report.summary.sampledQuoteRows,4);
const result=report.markets.find(x=>x.nativeMarketId==='101');
assert.equal(result.quotedOutcomes,1,'Repeated same provider outcome must be audited once');
assert.equal(result.status,'ALL_SAMPLED_RULES_MAPPED');
assert.equal(report.markets.find(x=>x.nativeMarketId==='999').status,'NOT_QUOTED_IN_SAMPLE');
assert.equal(report.markets.find(x=>x.nativeMarketId==='102').status,'PARTIALLY_MAPPED');
console.log('PASS actual quoted native market variants are grouped without claiming unobserved markets are supported');
