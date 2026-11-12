/**
 * Exercise the production TypeScript UI-expiry policy without duplicating it.
 * TypeScript is already installed by the sportsbook CI workflow.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const sourceUrl = new URL('../web/src/utils/marketExpiry.ts', import.meta.url);
const file = readFileSync(sourceUrl, 'utf8');
const compilerOptions={ module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 };
const repairSource=new URL('../web/src/utils/repairDisplayText.ts',import.meta.url);
const repairModule=ts.transpileModule(readFileSync(repairSource,'utf8'),{compilerOptions}).outputText;
const repairDataUrl='data:text/javascript;base64,'+Buffer.from(repairModule).toString('base64');
const compiled = ts.transpileModule(file, {compilerOptions}).outputText
  .replace(/from\s+(['"])(\.[^'"]+)\1/g, (_match, quote, path) => {
    // Node cannot import an extensionless TypeScript module from a data: URL.
    const target=path==='./repairDisplayText'?repairDataUrl:new URL(path,sourceUrl).href;
    return `from ${quote}${target}${quote}`;
  });
const { isMarketExpired, filterDecidedOutcomes, isMarketVisible, isOutcomeAvailable, isOutcomeDisplayable, isCompletedCombinationOutcome } =
  await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

const outcome = (name, code = name, odds = 1.8) =>
  ({ name, code, id: name, odds, status: 'ACTIVE' });
const twoWay = (name, line = '', opts = {}) =>
  ({ name, line, status: 'ACTIVE', marketType: 'OVER_UNDER',
    outcomes: [outcome('Over'), outcome('Under')], ...opts });
const btts = (name = 'Both Teams to Score') =>
  ({ name, status: 'ACTIVE', marketType: 'OTHER',
    outcomes: [outcome('Yes'), outcome('No')] });
const match = (h, a, options = {}) =>
  ({ status: 'LIVE', period: '1H', currentMinute: 30,
    homeScore: h, awayScore: a, corners: null, cards: null, ...options });
const expired = (m, market) => isMarketExpired(m, market);
const visible = (m, market) => isMarketVisible(m, market);
const open = (m, market) => assert.equal(visible(m, market), true, market.name + ' must remain');
const closed = (m, market) => assert.equal(visible(m, market), false, market.name + ' must be hidden');

// Goals: 2-0 irrevocably settles both Over 0.5 and Under 0.5,
// but not over/under 2.5 or the eventual match winner.
for (const line of ['0.5', '1.5']) closed(match(2,0), twoWay('Total',line));
open(match(2,0),twoWay('Total','2.5'));
open(match(2,0),twoWay('Total','2.0'));
closed(match(2,0),twoWay('Total Goals 1.5'));
closed(match(3,0),twoWay('Total Goals','1.5',{outcomes:[outcome('Over','1'),outcome('Under','2')]}));
closed(match(3,0),twoWay('Total (1.5)','',{outcomes:[outcome('Over','101'),outcome('Under','102')]}));
open(match(0,0,{period:'1H',currentMinute:49}),twoWay('1st Half Total','1.5',{period:1}));
open(match(3,0,{homeTeam:'Arsenal',awayTeam:'Chelsea'}),twoWay('Chelsea Total Goals','1.5'));
closed(match(3,0,{homeTeam:'Arsenal',awayTeam:'Chelsea'}),twoWay('Arsenal Total Goals','1.5'));
open(match(2,0),twoWay('Total Goals 2.5'));
open(match(2,0),{ name:'1X2',marketType:'1X2',outcomes:[outcome('1'),outcome('X'),outcome('2')] });
open(match(2,0),{ name:'Double Chance',outcomes:[outcome('1X')] });

// BTTS is terminal once each side scores, even though the 1X2 result can change.
closed(match(1,1),btts());
closed(match(1,2),btts('BTTS'));
open(match(2,0),btts());
open(match(0,0),btts());
closed(match(1,1),btts('1st Half Both Teams to Score'));
open(match(1,1,{period:'2H',currentMinute:65}),btts('2nd Half Both Teams to Score'));
closed(match(1,1),{name:'1X2&BTTS',outcomes:[outcome('1&Yes'),outcome('X&No')]});

// Alternate feed shape: several explicitly named totals in ONE market.
const bundled = {name:'Total Goals',marketType:'OVER_UNDER',outcomes:[
  outcome('Over 0.5'),outcome('Under 0.5'),outcome('Over 1.5'),
  outcome('Under 1.5'),outcome('Over 2.5'),outcome('Under 2.5')
]};
assert.deepEqual(filterDecidedOutcomes(bundled.outcomes,bundled,match(2,0)).map(o=>o.name),
  ['Over 2.5','Under 2.5']);

// Synthetic Bet Builders also expire when ANY constituent has been decided.
// They keep the provider's original price, but the completed contract is hidden.
const builder = (name, label, links = []) => ({
  id: 'BB|123|template|market', name: 'Bet Builder: ' + name,
  status: 'ACTIVE', marketType: 'OTHER', builderLegs: links,
  outcomes: [{ id: 'BB|123|template', name: label, odds: 4.5, status: 'ACTIVE' }],
});
const dcGoals = builder('X/2&P_2.5', 'DC X2 + TOTAL Under 2.5');
open(match(1,0), dcGoals);
closed(match(2,0), dcGoals); // X2 now requires at least 2-2, beyond Under 2.5.
closed(match(2,1), dcGoals);
closed(match(3,0), builder('1/2&L_2.5', 'DC 12 + TOTAL Over 2.5'));
open(match(1,0), builder('1&G/G', '1X2 1 + BTTS Yes'));
closed(match(1,1), builder('1&G/G', '1X2 1 + BTTS Yes'));
open(match(1,1), builder('1X2 only', '1X2 1 + DC 1X'));
open({status:'PREMATCH',homeScore:3,awayScore:1},dcGoals);
const bound = builder('X2+2.5', 'DC X2 + TOTAL Over 2.5',
  [{marketId:'123|gTotal|2.5',outcomeId:'123|gTotal|2.5|Over'}]);
open(match(0,0), bound);
assert.equal(isMarketVisible(match(0,0), bound, {}, {}, {'123|gTotal|2.5|Over': true}),false,
  'risk lock on an underlying price hides the builder immediately');
assert.equal(isMarketVisible(match(0,0), bound, {'123|gTotal|2.5':true}),false,
  'market-wide provider suspension hides the builder immediately');
assert.equal(isMarketVisible(match(0,0), bound, {}, {'123|gTotal|2.5|Over':true}),false,
  'provider price suspension hides the builder immediately');
assert.equal(isMarketVisible(match(0,0), bound, {}, {}, {'123|gTotal|2.5|Over':false}),true,
  'a reversible risk suspension must not permanently erase the builder');

// Provider-defined combos also need per-OUTCOME live expiry. These were
// previously left fully open even after Total 2.5 or BTTS was decided.
const providerCombo = (name, labels) => ({
  name, marketType:'OTHER', status:'ACTIVE', period:0,
  outcomes: labels.map((label, i)=>({id:'combo'+i, name:label, code:label, odds:2.5, status:'ACTIVE'})),
});
const resultTotal = providerCombo('Result and Total', [
  'Home And Over 2.5','Draw And Under 2.5',
  'Away And Over 3.5','Draw And Under 3.5',
]);
assert.deepEqual(filterDecidedOutcomes(resultTotal.outcomes,resultTotal,match(2,1)).map(o=>o.name),
  ['Away And Over 3.5'],
  '2.5 lines are settled and Draw + Under 3.5 is impossible at 2-1; Away + Over 3.5 remains');
assert.deepEqual(filterDecidedOutcomes(resultTotal.outcomes,resultTotal,match(3,1)),[],
  'every settled line disappears at four goals');
closed(match(3,1),resultTotal);
const totalBtts = providerCombo('Total and both teams to score',[
  'Over 2.5 And Yes','Under 2.5 And No'
]);
open(match(2,0),totalBtts);
closed(match(1,1),totalBtts);
const resultBtts = providerCombo('Result and both teams to score',[
  'Home And Yes','Draw And No','Away And Yes',
  'Lyon And Both To Score','Lyon To Nil', 'Both Teams Not To Score And Draw',
]);
open(match(2,0),resultBtts);
closed(match(1,1),resultBtts);
const compactBtts = providerCombo('1X2 & BTTS',['2&G/G','X&N/G']);
closed(match(1,1),compactBtts);
const compactGoal = providerCombo('Double Chance & Total', ['X/2&P_2.5','1/X&L_2.5']);
open(match(2,0),compactGoal);
closed(match(2,1),compactGoal);
const compactBoth = providerCombo('G/G & Total',['G/G&+2.5','G/G&P_2.5']);
closed(match(1,1),compactBoth); // BTTS is settled even below the 2.5 goal line
const unrelatedCombo = providerCombo('Result and Total', ['Home And Over 3.5']);
open(match(2,1),unrelatedCombo);
open({status:'PREMATCH', homeScore:4, awayScore:2},resultTotal);
const halfResult = providerCombo('1st Half Result and Total',['Home And Over 2.5']);
closed(match(3,0,{period:'2H',currentMinute:65}),halfResult);
closed(match(3,0,{period:'1H',currentMinute:37}),halfResult);
open(match(2,0,{period:'1H',currentMinute:29}),halfResult);
// Unknown provider labels must not be suppressed using only the match score.
const unknownCombo = providerCombo('Other Market',['Option A','Option B']);
open(match(4,4),unknownCombo);
assert.equal(isCompletedCombinationOutcome(match(1,1),resultBtts,resultBtts.outcomes[0]),true);
assert.equal(isCompletedCombinationOutcome(match(2,0),resultBtts,resultBtts.outcomes[0]),false);

// Risk Management and provider locks display exactly like other suspended
// prices: a disabled grey-lock button, not a missing market or fake "—" cell.
const riskLockedPrice = { ...outcome('1'), status: 'SUSPENDED', riskSuspended: true };
const providerLockedPrice = { ...outcome('X'), status: 'SUSPENDED', feedSuspended: true };
const riskMarket = {
  name: '1X2', marketType: '1X2', status: 'ACTIVE',
  outcomes: [outcome('2'), riskLockedPrice, providerLockedPrice],
};
assert.equal(isOutcomeAvailable(riskLockedPrice), false);
assert.equal(isOutcomeAvailable(providerLockedPrice), false);
assert.equal(isOutcomeDisplayable(riskLockedPrice), true);
assert.equal(isOutcomeDisplayable(providerLockedPrice), true);
assert.equal(isMarketVisible(match(1,0), riskMarket), true);
const onlyRiskLocked = { name: '1X2', status: 'ACTIVE', outcomes: [riskLockedPrice] };
assert.equal(isMarketVisible(match(1,0), onlyRiskLocked), true,
  'an entirely risk-locked market displays a grey lock rather than vanishing');
assert.equal(isMarketVisible(match(1,0), {
  name:'1X2',status:'ACTIVE',outcomes:[outcome('1')],
}, {}, {}, {'1':true}), true,
'Socket risk lock must not hide the market containing its selection');
assert.equal(isMarketVisible(match(2,1),{
  name:'Total',line:'2.5',marketType:'OVER_UNDER',outcomes:[{...outcome('Over'),status:'SUSPENDED',feedSuspended:true}],
}),false,'a decided total still disappears even if provider locked it');
assert.equal(isOutcomeDisplayable({...outcome('2'),status:'SETTLED'}),false);
assert.equal(isOutcomeDisplayable({...outcome('2'),status:'VOID'}),false);
assert.equal(isOutcomeDisplayable({...outcome('2'),odds:0}),false);
assert.equal(isOutcomeDisplayable({...outcome('2'),odds:0,riskSuspended:true}),true);

// Corners/cards use their own stats, NOT goals.
closed(match(0,0,{corners:{home:4,away:1}}), twoWay('Total Corners','3.5',{marketType:'CORNERS'}));
open(match(0,0,{corners:{home:4,away:1}}), twoWay('Total Corners','5.5',{marketType:'CORNERS'}));
closed(match(0,0,{cards:{home:2,away:1}}), twoWay('Total Cards','1.5',{marketType:'CARDS'}));
open(match(2,2,{cards:null}),twoWay('Total Cards','1.5',{marketType:'CARDS'}));
closed(match(0,0,{corners:{home:4,away:0}}),twoWay('Home Team Total Corners','2.5',{marketType:'CORNERS'}));
open(match(0,0,{corners:{home:4,away:0}}),twoWay('Away Team Total Corners','2.5',{marketType:'CORNERS'}));
open(match(0,0,{corners:null}),twoWay('Total Corners','0.5',{marketType:'CORNERS'}));

// First/second half rules: don't use full-match goals for a second-half line.
closed(match(2,0,{period:'HT',currentMinute:45}),twoWay('First Half Total','1.5',{period:1}));
closed(match(2,0,{period:'HT',currentMinute:45}),{name:'Halftime/Fulltime',outcomes:[outcome('1/1')]});
closed(match(2,0,{period:'2H',currentMinute:65}),twoWay('1st Half Total','4.5',{period:1}));
open(match(2,0,{period:'2H',currentMinute:65}),twoWay('2nd Half Total','0.5',{period:2}));
closed(match(2,0,{period:'1H',currentMinute:27}),twoWay('1st Half Total','1.5',{period:1}));

// First/ordinal events, races and elapsed time windows.
closed(match(1,0),{name:'First Goal',outcomes:[outcome('Home'),outcome('Away')]});
closed(match(1,0),{name:'Time of First Goal',outcomes:[outcome('1-10'),outcome('11-20')]});
closed(match(1,0),{name:'Next Goal',outcomes:[outcome('Home'),outcome('Away')]});
closed(match(2,1),{name:'3rd Goal',outcomes:[outcome('Home')]});
closed(match(3,0),{name:'Race to 3 Goals',outcomes:[outcome('Home')]});
closed(match(0,0,{corners:{home:3,away:1}}),{name:'Race to 3 Corners',outcomes:[outcome('Home')]});
closed(match(0,0,{corners:{home:1,away:0}}),{name:'First Corner',outcomes:[outcome('Home')]});
closed(match(0,0,{currentMinute:21}),{name:'Goal before 20 minutes',outcomes:[outcome('Yes')]});
closed(match(0,0,{currentMinute:19}),{name:'Goal before 20 minutes',outcomes:[outcome('Yes')]});

// Native Zizobet sequence offers must use their exact contract:
 // bare NEXT is relative to purchase, numbered NEXT is absolute, and
 // a player can still score regardless of the full match's team tally.
const native=(name,options=['1','2'])=>({
 name,key:'zz777@e30',marketType:'OTHER',status:'ACTIVE',
 outcomes:options.map(label=>outcome(label))
});
open(match(1,0),native('Next Goal'));
open(match(1,0),native('Next Goal 2nd'));
closed(match(2,0),native('Next Goal 2nd'));
open(match(0,0),native('Who scores first'));
closed(match(1,0),native('Who scores first'));
open(match(0,0),native('Who scores goal 1 in minutes 6-10 (5-minute interval)'));
closed(match(1,0,{currentMinute:2}),native('Who scores goal 1 in minutes 6-10 (5-minute interval)'));
open(match(90,0,{currentMinute:60}),native('Total goals in minutes 61-70 (10-minute interval)',['Over','Under']));
open(match(90,0,{currentMinute:65}),native('Will there be a goal in minutes 61-70',['Yes','No']));
open(match(90,0,{currentMinute:65}),native('Player to score 2 or more goals',['Alice']));
open(match(0,0,{corners:{home:6,away:2}}),native('Race to 7 Corners'));
closed(match(0,0,{corners:{home:7,away:2}}),native('Race to 7 Corners'));

// Scoring-once contracts, but not anytime/next-goalscorer propositions.
closed(match(1,0),btts('Home Team to Score'));
open(match(1,0),btts('Away Team to Score'));
closed(match(1,0),{name:'Player to Score Anytime',outcomes:[outcome('Player A')]});

// Impossible exact scores/goals disappear *individually*, not the entire market.
const correct = {name:'Correct Score',outcomes:[
  outcome('0:0'), outcome('1:0'), outcome('2:0'), outcome('2:1'),
  outcome('3:0'), outcome('Other')
]};
const scores = filterDecidedOutcomes(correct.outcomes,correct,match(2,0)).map(o=>o.name);
assert.deepEqual(scores,['2:0','2:1','3:0','Other']);
const exact = {name:'Number of Goals',outcomes:[outcome('0'),outcome('1'),outcome('2'),outcome('3')]};
assert.deepEqual(filterDecidedOutcomes(exact.outcomes,exact,match(2,0)).map(o=>o.name),['2','3']);
open(match(2,0),correct);

// No guessing: unknown markets, absent stats, and prematch must stay visible.
closed(match(3,3),{name:'Player Shots on Target',outcomes:[outcome('Over')]});
open(match(3,3),{name:'Other Market',outcomes:[outcome('Yes')]});
open({status:'PREMATCH',homeScore:2,awayScore:2}, btts());
closed({status:'ENDED',homeScore:1,awayScore:0},btts());
assert.equal(expired(match(2,0),twoWay('Total','1.5')),true);
assert.equal(expired(match(2,0),twoWay('Total','3.5')),false);

console.log('Decided live market visibility tests passed');
