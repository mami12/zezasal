import assert from 'node:assert/strict';
import{selectPublishedMatches,validateBoardSettings,competitionPriority,filterBoardSubscriptionPlan}from'../server/board-settings.mjs';
import * as store from '../server/match-store.mjs';
const row=(id,country,name,service='PREMATCH')=>({match_id:id,active:true,status:service,service,category_slug:country,category_name:country,tournament_id:id,tournament_name:name,first_seen_at:new Date(2026,0,1),home:'Home',away:'Away',sport_id:18});
const rows=[row(1,'england','League One'),row(2,'sweden','Superettan'),row(3,'england','Premier League'),row(4,'italy','Serie A'),row(5,'germany','Bundesliga'),row(6,'spain','La Liga'),row(7,'france','Ligue 1'),row(8,'world','World Cup'),row(9,'sweden','Allsvenskan'),row(10,'italy','Coppa Italia'),row(11,'england','Championship','LIVE'),{...row(12,'england','Premier League'),active:false},{...row(13,'england','Premier League'),status:'ended'}];
assert.equal(competitionPriority(rows[0]).protected,true);assert.equal(competitionPriority(rows[2]).protected,true);
const selected=selectPublishedMatches(rows,{prematchLimit:2});
assert.equal(selected.summary.protectedPrematch,7);assert.equal(selected.summary.visiblePrematch,2);assert.equal(selected.summary.protectedExceedsLimit,false);assert.equal(selected.summary.live,1);
assert.equal(selected.rows[0].match_id,11);assert.equal(selected.rows[1].match_id,3);assert.equal(selected.rows[2].match_id,4);
assert.deepEqual(selected.rows.map(x=>x.match_id),selectPublishedMatches([...rows].reverse(),{prematchLimit:2}).rows.map(x=>x.match_id),'same set independent of client/provider arrival order');
const filled=selectPublishedMatches(rows,{prematchLimit:8});assert.equal(filled.summary.visiblePrematch,8);assert.equal(filled.summary.hiddenPrematch,2);
assert.equal(selectPublishedMatches(rows,{prematchLimit:0}).summary.visiblePrematch,10);
assert.equal(rows[0].listing_priority,undefined,'stored facts never mutated by presentation policy');
for(const invalid of [null,[],{},true,{prematchLimit:'20'},{prematchLimit:-1},{prematchLimit:1.1},{prematchLimit:10001},{prematchLimit:NaN},{prematchLimit:20,liveLimit:5}])assert.throws(()=>validateBoardSettings(invalid));
for(const n of [0,1,200,10000])assert.deepEqual(validateBoardSettings({prematchLimit:n}),{prematchLimit:n});
const huge=Array.from({length:2100},(_,i)=>row(i+100,'england','Championship'));huge.push(row(5000,'italy','Serie A'));
store.clear();store.upsert(huge);
assert.equal(store.getMatches({limit:2000}).length,2000);assert.equal(store.getMatches({catalog:true}).length,2101);
assert.equal(selectPublishedMatches(store.getMatches({catalog:true}),{prematchLimit:1}).rows[0].match_id,5000,'protected league beyond historical 2000-row slice retained');
store.clear();console.log('PASS board policy: canonical order, main leagues retained beyond cap and 2000 rows, LIVE untouched, 0 unlimited, strict settings, no fact mutation');

for(const [country,name]of [['portugal','Primeira Liga'],['portugal','Segunda Liga'],['portugal','Liga 3']])assert.equal(competitionPriority(row(900,country,name)).protected,true);
for(const [country,name]of [['japan','J1 League'],['brazil','Serie A'],['asia','AFC Champions League'],['world','FIFA World Cup'],['italy','Coppa Italia']])assert.equal(competitionPriority(row(901,country,name)).protected,false);
assert.equal(competitionPriority(row(902,'europe','UEFA Champions League')).protected,true);
const capped=selectPublishedMatches([row(1,'england','Premier League'),row(2,'japan','J1 League'),row(3,'brazil','Serie A')],{prematchLimit:2});assert.equal(capped.rows.length,2);assert.equal(capped.rows.filter(r=>r.protected_prematch).length,1);
const plan={prematch:[1,2,3],prematchSoon:[1,3],prematchLater:[2],unpriced:[3],live:[99],boosted:[3],pendingResults:[3]};const filtered=filterBoardSubscriptionPlan(plan,capped.rows);assert.equal(filtered.prematch.length,2);assert.deepEqual(filtered.live,[99]);assert.deepEqual(filtered.boosted,[3]);assert.deepEqual(filtered.pendingResults,[3]);assert.equal(plan.prematch.length,3);
console.log('PASS explicit administrator limit, preserved source fixtures, priority ordering and independent pending-result subscriptions');

const rankedPlan=filterBoardSubscriptionPlan({prematch:[2],live:[99],full:[3],pendingResults:[3]},capped.rows,{prematchLimit:1,soonMs:60000});assert.deepEqual(rankedPlan.prematch,[1,2]);assert.deepEqual(rankedPlan.full,[3]);assert.deepEqual(rankedPlan.pendingResults,[3]);
store.clear();store.upsert(Array.from({length:2501},(_,i)=>row(i+1,'world','FIFA World Cup')));
assert.equal(store.getSubscriptionIds({prematchLimit:0}).prematch.length,2501,'all eligible subscriptions survive legacy limits');store.clear();
console.log('PASS protected publication/subscriptions: every eligible fixture remains visible, independent of legacy caps');

const fullCatalog=[...Array.from({length:1420},(_,i)=>row(i+1,'world','World Cup')),...Array.from({length:10},(_,i)=>row(i+5000,'world','World Cup','LIVE'))];
const hundred=selectPublishedMatches(fullCatalog,{prematchLimit:100});assert.equal(hundred.summary.availablePrematch,1420);assert.equal(hundred.summary.visiblePrematch,100);assert.equal(hundred.summary.hiddenPrematch,1320);assert.equal(hundred.summary.live,10);assert.equal(hundred.rows.length,110);assert.equal(selectPublishedMatches(fullCatalog,{prematchLimit:0}).rows.length,1430);console.log('PASS 1420 source prematches → exactly100 active +10 live; 0 restores1430 total, no source mutation');
