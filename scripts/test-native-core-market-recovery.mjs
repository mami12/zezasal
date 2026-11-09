import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {isHalfComboFamily,parseHalfCombination,gradeHalfCombination} from '../server/ledger/half-combinations.mjs';
import {isHtFtMarket,parseHtFtOutcome,gradeHtFt} from '../server/ledger/ht-ft.mjs';
import {isHtFtTotalMarket,isUnverifiedHtFtFamily,parseHtFtTotal,gradeHtFtTotal}
 from '../server/ledger/ht-ft-total.mjs';
import {gradeMixedTotal} from '../server/ledger/mixed-combos.mjs';
import {parseCornerComparison,isCornerHtFtMarket} from '../server/ledger/corner-comparisons.mjs';
import {gradeResultBtts} from '../server/ledger/result-btts.mjs';
import {gradeLine,hasRequiredSettlementEvidence} from '../server/ledger/settler.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
import titles from './fixtures/native-market-titles-20261108.json' with {type:'json'};

const score={home_team:'Home',away_team:'Away',home_score:3,away_score:2,
 half_home_score:1,half_away_score:0,corners_home:7,corners_away:5,
 cards_home:2,cards_away:2};
const quote=(market_name,outcome_name,line='',period=0)=>({
 market_name,outcome_name,outcome_key:outcome_name,line,period});
const originalNames=new Set(titles.markets.map(row=>row.title));
for(const name of [
 '1st Half - Matchbet and both teams to score',
 '2nd Half - Matchbet and Totals',
 'First Half - Matchbet and Totals 1.5',
 'Double chance (1X - 12 - X2) and both teams to score',
 'Double chance (1X - 12 - X2) and Totals',
 'Matchbet and Totals','Total & both teams to score',
 'Halftime/Fulltime','Halftime/fulltime & exact goals',
 'Halftime/Fulltime & 1st half total goals',
 'Halftime/fulltime & total goals',
 'Corners Halftime/Fulltime',
 'Halftime/Fulltime correct score'
])assert.ok(originalNames.has(name),'Test title is NOT among 577 real captured titles: '+name);

for(const [name,answer,expected,line] of [
 ['1st Half - Matchbet and both teams to score','1 and No','WON',''],
 ['2nd Half - Matchbet and Totals','X & Over 3.5','WON',''],
 ['2nd Half - Matchbet and both teams to score','X & Yes','WON',''],
 ['First Half - Matchbet and Totals 1.5','1 & Under','WON','1.5'],
 ['1st half - Result & total','1 & Over 0.5','WON',''],
 ['1st half - Double chance & both teams to score','1X and No','WON',''],
 ['Matchbet and both teams to score','1 and Yes','WON',''],
 ['Matchbet and Totals','1 & Over 4.5','WON',''],
 ['Double chance (1X - 12 - X2) and both teams to score','1X & Yes','WON',''],
 ['Double chance (1X - 12 - X2) and Totals','1X & Over 4.5','WON',''],
 ['Double chance & total goals','1X & Over 4.5','WON',''],
 ['Total & both teams to score','Over 4.5 & Yes','WON',''],
 ['2nd Half - Matchbet and Totals','2 & Over 3.5','LOST','']
]){
 const q=quote(name,answer,line),contract=parseHalfCombination(q,score);
 assert.equal(isHalfComboFamily(q),true,'Native combo was not recognized: '+name);
 assert.ok(contract,'Native combo did not parse: '+name+' '+answer);
 assert.equal(gradeHalfCombination(contract,score),expected);
 assert.equal(gradeLine(q,score),expected,'Legacy code path '+name);
 assert.equal(hasRequiredSettlementEvidence(q,score),true,'Quote missing evidence '+name);
 assert.equal(await gradeStoredEventContract({live_contract:contract},score),expected,
  'Frozen contract must agree with historical grading');
}
for(const q of [
 quote('First Half - Matchbet and Totals 1.5','1 and Over 2.5','1.5'),
 quote('First Half - Matchbet and Totals 1.5','1 and Over','2.5'),
 quote('Matchbet and Totals','1 & Over',''),
 quote('Double chance (1X - 12 - X2) and Totals','None and Over 2.5',''),
 quote('2nd Half - Matchbet and Totals','X & Over 3.5','',1),
]){
 assert.equal(isHalfComboFamily(q),true);
 assert.equal(parseHalfCombination(q,score),null,'Never infer a mismatched market line or period');
 assert.equal(gradeLine(q,score),null,'Unsupported selection must not win/lose/refund');
}
for(const [name,selection,expected] of [
 ['Halftime/fulltime & total goals','1/1 & Over 4.5','WON'],
 ['Halftime/Fulltime & 1st half total goals','1/1 + Over 0.5','WON'],
 ['Halftime/fulltime & exact goals','1/1 & Exactly 5','WON'],
 ['Halftime/fulltime & exact goals','1/1 & Exactly 4','LOST'],
 ['Halftime/fulltime & total goals','2/X and Under 3.5','LOST']
]){
 const q=quote(name,selection),contract=parseHtFtTotal(q);
 assert.equal(isHtFtTotalMarket(q),true);
 assert.ok(contract,'HT/FT + native total quote rejected '+name);
 assert.equal(gradeHtFtTotal(contract,score),expected);
 assert.equal(gradeLine(q,score),expected,'Score path must preserve HT/FT conjunct');
 assert.equal(hasRequiredSettlementEvidence(q,score),true);
 assert.equal(await gradeStoredEventContract({live_contract:contract},score),expected);
}
for(const q of [
 quote('Halftime/fulltime & total goals','1/1 & Over 2.5','3.5'),
 quote('Halftime/fulltime & exact goals','1/1 & Exactly 3','5'),
 quote('Halftime/fulltime & total goals','1/1'),
 quote('Halftime/Fulltime & 1st half total goals','1/1 & Over'),
 quote('Halftime/fulltime & total goals','1/1 & Over 0.25')
]){
 assert.equal(parseHtFtTotal(q),null,'Bad/missing independent total must be rejected');
 assert.equal(gradeLine(q,score),null,'Bad HTFT total is not a VOID');
}
for(const name of ['Corners Halftime/Fulltime','Halftime/Fulltime correct score']){
 const q=quote(name,'1/1');
 assert.equal(isHtFtMarket(name),false,'Other statistic mistaken for goal HT/FT');
 assert.equal(gradeLine(q,score),null,'Do NOT grade corners/score grid by goals HT/FT');
 assert.equal(hasRequiredSettlementEvidence(q,score),false);
 if(isCornerHtFtMarket(q)){
  assert.equal(isUnverifiedHtFtFamily(q),false);
  assert.equal(parseCornerComparison(q)?.mode,'ht-ft');
 }else assert.equal(isUnverifiedHtFtFamily(q),true);
}
assert.equal(isHtFtMarket('Halftime/Fulltime'),true);
assert.equal(isHtFtMarket('HT/FT'),true);
assert.equal(gradeHtFt(parseHtFtOutcome('1/X'),1,0,1,1),'WON');
assert.equal(gradeHtFt(parseHtFtOutcome('1/1'),1,0,3,2),'WON');
assert.equal(gradeHtFt(parseHtFtOutcome('1/1'),null,0,3,2),null);
assert.equal(gradeHtFt(parseHtFtOutcome('1/1'),4,0,3,2),null);

for(const [title,choice,line,want] of [
 ['Match result','1','', 'WON'],
 ['Double Chance','1X','','WON'],
 ['Both teams to score','Yes','','WON'],
 ['Total goals','Over','4.5','WON'],
 ['Total corners','Over','11.5','WON'],
 ['Total cards','Over','3.5','WON'],
]){
 const q=quote(title,choice,line);
 assert.equal(gradeLine(q,score),want,'Basic market must survive cleanup: '+title);
}
assert.equal(gradeMixedTotal('Result and Total',null,3,2),null);
assert.equal(gradeResultBtts(null,3,2),null);
assert.equal(gradeLine(quote('Matchbet and Totals','1 & Over 4.5'),{
 ...score,half_home_score:null,half_away_score:null}), 'WON',
 'Full-time quoted combo does not require an unrelated 1H scoreboard');
assert.equal(gradeLine(quote('2nd Half - Matchbet and Totals','X & Over 3.5'),{
 ...score,half_home_score:null,half_away_score:null}),null);
console.log('PASS captured real HT/FT, 1H/2H and FT native combos, 1X2, goals, corners, cards, fail-closed unknowns');
