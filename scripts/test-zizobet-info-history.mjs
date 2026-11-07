import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {providerTimeline} from '../server/live-event-timeline.mjs';
import {normalizeLiveFrame} from '../server/ledger/live-observation-store.mjs';
import {oddsOf,resolveMarketTitle} from '../server/zizobet/normalize.mjs';

const raw=Array.from({length:12},(_,i)=>({
 id:'c'+i,type:'corner_kick',team:i%2===0?1:2,gt:i*6+1
}));
const displayed=providerTimeline('123',raw);
assert.equal(displayed.length,12,'Provider timeline retains all 12 events, never last eight');
assert.equal(displayed[0].minute,1);
assert.equal(displayed.at(-1).minute,67);
const frame=normalizeLiveFrame({
 Match:{Score:'0:0',MatchTimeExtended:'79:00',CornersTeam1:6,CornersTeam2:6},
 TimeLines:raw
});
assert.equal(frame.events.filter(e=>e.type==='corner').length,12,
 'All first-to-last corners remain in the evidence used for ticket grading');
assert.equal(frame.coverage.cornerThrough,79,'All twelve corners reconcile to scoreboard');
const ui=readFileSync(new URL('../web/src/components/Tracker/PitchTracker.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../web/src/styles/zshop.css',import.meta.url),'utf8');
assert.doesNotMatch(ui,/\.slice\(0,\s*8\)/,
 'Eight visible rows must not delete old events from the match-history UI');
assert.match(ui,/className="zshop-tracker-events" role="region" tabIndex=\{0\}/,
 'History must be a scrollable, keyboard-accessible region');
assert.match(css,/\.zshop-tracker-events\{[^}]*max-height:[^}]*overflow-y:auto/,
 'Show approximately eight entries and allow scrolling all the way to minute one');

assert.equal(resolveMarketTitle('Next Goal 1st',{}),'Next Goal 1st');
assert.equal(resolveMarketTitle('Next Goal 2nd',{}),'Next Goal 2nd');
const providerMeta={
 liveMarkets:new Map([[75001,{Name:'Next Goal 1st'}],[75002,{Name:'Next Goal 2nd'}]]),
 preMarkets:new Map(),
 positions:new Map([['h','1'],['a','2']]),
};
const quotes=[
 {mid:75001,id:901,pid:'h',v:2.1,seq:1},
 {mid:75002,id:902,pid:'a',v:3.2,seq:2},
];
const original=oddsOf({match_id:8080},quotes,providerMeta,true);
assert.equal(original.length,2);
assert.deepEqual(original.map(o=>o.marketName),['Next Goal 1st','Next Goal 2nd'],
 'Zizobet quote titles must not be collapsed into one generic Next Goal');
assert.notEqual(original[0].marketKey,original[1].marketKey);
assert.deepEqual(original.map(o=>o.price),[2.1,3.2],
 'Different goal ordinals retain their own quoted prices');
assert.deepEqual(original.map(o=>o.outcomeKey),['1','2'],
 'Original selection team identity is retained');
assert.equal(original[0].marketKey.split('@').length,2,
 'Unmodified provider market parameters are encoded in the native key');

console.log('PASS Zizobet full event chronology; eight-row scroll viewport does not cut settling evidence');
