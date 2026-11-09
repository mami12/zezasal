import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditOffer} from './audit-market-settlement-readiness.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/native-market-titles-20261108.json',import.meta.url),'utf8'));
assert.equal(fixture.count,577);
assert.equal(fixture.markets.length,577);
assert.equal(new Set(fixture.markets.map(x=>x.title.toLowerCase())).size,577);
const labels=['1','2','X','Over','Under','Yes','No','None'];
const categoryCounts=new Map();
for(let i=0;i<fixture.markets.length;i++){
 const entry=fixture.markets[i];
 assert.equal(entry.position,i+1);
 for(const outcome_name of labels){
  const row={market_name:entry.title,outcome_name,line:'2.5',period:0};
  const finding=auditOffer(row);
  assert.ok(typeof finding.category==='string'&&finding.category.length>0,
   entry.position+': '+entry.title+' / '+outcome_name);
  categoryCounts.set(finding.category,(categoryCounts.get(finding.category)??0)+1);
  // Never promote an unqualified hazardous/actor-specific proposition into
  // a simple FT-score market just because a fake generic outcome was passed.
  if(/\\b(?:handicap|asian|shootout|overtime|extra time|player.+(?:shots?|assists?|tackles?|passes?|offsides?|cards?))\\b|\\bot only\\b/i.test(entry.title))
   assert.notEqual(finding.category,'SCORE_GRADEABLE',
    'Unsafe synthetic quote was incorrectly treated as FT-score ready: '+entry.title);
 }
}
assert.equal([...categoryCounts.values()].reduce((a,b)=>a+b,0),577*labels.length);
console.log('PASS 577 captured native market titles x 8 synthetic labels: no parser crashes or unsafe score promotion');
console.log('NOTICE: synthetic labels are not real provider selections; settlement support MUST be audited against captured offers and final evidence.');
