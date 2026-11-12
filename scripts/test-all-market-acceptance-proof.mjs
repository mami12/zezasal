import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {hasFinalSettlementRule} from '../server/ledger/market-settlement-preflight.mjs';
import {gradeLine} from '../server/ledger/settler.mjs';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';

const names={home:'Arsenal FC',away:'Chelsea FC'};
const offer=(market_name,outcome_name,{line='',period=0,outcome_key=outcome_name}={})=>
 ({market_name,outcome_name,outcome_key,line,period});
const supported=[
 offer('Full Time Result','1'),
 offer('Full Time Result','Arsenal FC'),
 offer('Full Time Result','X'),
 offer('Double Chance','1X'),
 offer('Double Chance','X2'),
 offer('Both Teams To Score','Yes'),
 offer('Both Teams To Score','No'),
 offer('Total Goals','Over',{line:'2.5'}),
 offer('Total Goals','Under',{line:'3.0'}),
 offer('1st half - Total Goals','Over',{line:'1.5',period:1}),
 offer('2nd half - Total Goals','Under',{line:'2.5',period:2}),
 offer('1st half - Result','1',{period:1}),
 offer('HT/FT','1/X'),
 offer('Correct Score','2:1'),
 offer('Draw No Bet','1'),
 offer('Clean Sheet Home Team','Yes'),
 offer('Total Corners','Over',{line:'5.5'}),
 offer('Cards Total','Under',{line:'4.5'}),
 offer('Total Fouls','Over',{line:'10.5'}),
 offer('Total Shots','Under',{line:'30.5'}),
 offer('Home Team To Score In Both Halves','Yes'),
 offer('1st Half Result + BTTS','1 & Yes',{period:1}),
];
for(const q of supported){
 if(!hasFinalSettlementRule(q,names))
  throw Error('Previously gradeable quote rejected '+JSON.stringify(q));
}
const unsupported=[
 offer('Full Time Result','User Invented Team'),
 offer('Double Chance','AX'),
 offer('Both Teams To Score','Maybe'),
 offer('Total Goals','Unknown',{line:'2.5'}),
 offer('Correct Score','Mystery'),
 offer('Provider Mystery Special','Option A'),
 offer('Player Shots On Target','Over',{line:'1.5'}),
 offer('Undocumented Market','Over',{line:'3.5'}),
 offer('Last Team To Receive A Red Card','Mystery')
];
for(const q of unsupported)
 assert.equal(hasFinalSettlementRule(q,names),false,
  'A valid odds quote cannot justify charging for an ungradeable outcome '+JSON.stringify(q));
const final={home_team:names.home,away_team:names.away,
 home_score:2,away_score:1,half_home_score:1,half_away_score:0};
assert.equal(gradeLine(offer('Full Time Result','1'),final),'WON');
assert.equal(gradeLine(offer('Full Time Result','User Invented Team'),final),null);
const next=liveContract(offer('Next Goal','1'),{
 counts:{goal:{home:1,away:0}},clock:23,teams:names
});
assert.equal(next?.kind,'sequence');
assert.equal(next?.target,2,
 'Real incident contracts use frozen LIVE baselines rather than fake synthetic FT scores');
console.log('PASS all-market pre-debit proof: existing gradeable FT/HT/statistics and documented event contracts; unsupported outcomes blocked');
