import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {gradeLine,hasRequiredSettlementEvidence,unverifiedCompositeLine} from '../server/ledger/settler.mjs';
import {isRetiredPlayerOfferMarket} from '../server/market-policy.mjs';

const result={
 home_team:'Portugal',away_team:'Denmark',
 home_score:2,away_score:1,half_home_score:1,half_away_score:0,
 corners_home:6,corners_away:5,cards_home:2,cards_away:1,
};
const row=(market_name,outcome_name,line='',period=0)=>({
 market_name,outcome_name,outcome_key:outcome_name,line:String(line),
 period,builder_legs:null,
});
// These markets contain two or more independently testable period/score
// conditions. Never classify them as a single full-time BTTS or DC outcome.
const incomplete=[
 ['Double chance & 1st half both teams score','1X / Yes'],
 ['Double chance & 2nd half both teams score','12 / No'],
 ['1st / 2nd half both teams to score','Yes / No'],
 ['Halftime/fulltime & exact goals','1/1 & 3'],
 ['Halftime/Fulltime & 1st half total goals','1/1 & Over 1.5'],
 ['Halftime/Fulltime correct score','1/1'],
 ['Corners Halftime/Fulltime','1/1'],
];
for(const [name,selection] of incomplete){
 const item=row(name,selection);
 assert.equal(unverifiedCompositeLine(item,result),true,
  'The mixed-scope compound contract must be recognized as unsafe: '+name);
 assert.equal(hasRequiredSettlementEvidence(item,result),false);
 assert.equal(gradeLine(item,result),null,
  'FT result cannot accidentally win a compound half or corner market: '+name);
}
// Second-half corners and first/last corner require PERIOD or SEQUENCE
// evidence. Full-time aggregate 6+5 is not enough to verify the outcome.
for(const [name,selection] of [
 ['1st half - First corner','Home'],
 ['1st half - Last corner','Away'],
 ['1st half - Most corners','Home'],
 ['2nd half - Most corners','Away'],
 ['1st half - Total corners','Over'],
 ['2nd half - Total corners','Under'],
 ['1st half - Home team exact corners','2'],
 ['1st half - Away team exact corners','2'],
 ['30:00 - 45+ min. - Total corners','Over'],
 ['75:00 - 90+ min. - Total corners','Under'],
 ['Race to 7 corners','Home'],
 ['First corner','Home'],
 ['Last corner','Away'],
]){
 const item=row(name,selection,'2.5');
 assert.equal(gradeLine(item,result),null,
  'Do not fabricate a historical minute/half/corner sequence from FT totals: '+name);
}
// Existing simple FT corner and normal goal combos retain their proven rules.
assert.equal(gradeLine(row('Total corners','Over','10.5'),result),'WON');
assert.equal(gradeLine(row('Home team total corners','Over','5.5'),result),'WON');
assert.equal(gradeLine(row('Away team total corners','Under','4.5'),result),'LOST');
assert.equal(gradeLine(row('Total goals','Over','2.5'),result),'WON');
assert.equal(gradeLine(row('Matchbet and Totals (2.5)','Home and over'),result),'WON');
for(const name of [
 'Mora, Rodrigo to score in 1st half',
 'Silva, Bernardo - Shots on goal (incl. extra time)',
 'Mora, Rodrigo to be yellow carded',
 'Mora, Rodrigo to be sent off (sure sub)'
]){
 assert.equal(isRetiredPlayerOfferMarket({name}),true);
}
console.log('PASS provider-listed half/HTFT/corner safety: no partial legs or invented period evidence; regular goals and team corners still settle.');
