import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {fotMobKickoff,findFotMobFixture} from '../server/stats-providers/match-recovery.mjs';

const kickoff='2026-11-12T20:00:00.000Z',day='20261112';
const date={leagues:[{name:'Example League',matches:[
 {id:992011,home:{name:'FC Arsenal',shortName:'Arsenal'},
  away:{name:'Chelsea FC',shortName:'Chelsea'},time:'12.11.2026 21:00',
  status:{utcTime:kickoff,finished:false}},
 {id:992012,home:{name:'Chelsea',shortName:'CHE'},
  away:{name:'Arsenal',shortName:'ARS'},
  time:'12.11.2026 21:00',status:{utcTime:kickoff}},
 {id:992013,home:{name:'Arsenal Women'},
  away:{name:'Chelsea Women'},status:{utcTime:kickoff}}
]}]};
const dates=async()=>date;
assert.equal(fotMobKickoff(date.leagues[0].matches[0]),Date.parse(kickoff),
 'FotMob authoritative status.utcTime beats localized display-only time');
assert.equal(fotMobKickoff({time:{utcTime:kickoff}}),Date.parse(kickoff));
assert.equal(fotMobKickoff({time:{utc:'2026-11-12T21:00:00+01:00'}}),Date.parse(kickoff));
assert.equal(fotMobKickoff({time:'12.11.2026 21:00'}),null,
 'Never infer UTC from an ambiguous local-date display');
assert.equal(fotMobKickoff({time:'2026-11-12T21:00:00'}),null,
 'Timezone-free ISO text cannot confirm a financial fixture');
const found=await findFotMobFixture('Arsenal','Chelsea',[day],kickoff,{fetchDate:dates});
assert.equal(found.match.id,992011,'Home/away identities must retain order');
assert.equal(await findFotMobFixture('Chelsea','Arsenal',[day],kickoff,
 {fetchDate:dates}).then(f=>f?.match.id),992012);
assert.equal(await findFotMobFixture('Arsenal Women','Chelsea Women',[day],kickoff,
 {fetchDate:dates}).then(f=>f?.match.id),992013,
 'A women-team fixture is not interchangeable with the senior team');
assert.equal(await findFotMobFixture('Arsenal','Chelsea',[day],
 '2026-11-12T23:00:00Z',{fetchDate:dates}),null,
 'Three-hour kickoff mismatch cannot authorize the wrong fixture');
const duplicate={leagues:[{name:'One',matches:[
 date.leagues[0].matches[0],
 {...date.leagues[0].matches[0],id:111222}
]}]};
assert.equal(await findFotMobFixture('Arsenal','Chelsea',[day],kickoff,
 {fetchDate:async()=>duplicate}),null,'A second distinct ID must cause a hold');
const noNames={leagues:[{matches:[{id:22,home:{name:'Unrelated FC'},
 away:{name:'Chelsea FC'},status:{utcTime:kickoff}}]}]};
assert.equal(await findFotMobFixture('Arsenal','Chelsea',[day],kickoff,
 {fetchDate:async()=>noNames}),null,'Fuzzy unrelated team identity never matches');
assert.equal(await findFotMobFixture('Arsenal','Chelsea',[day],null,{fetchDate:dates}),null,
 'A missing original kickoff cannot authorize an external fixture');
assert.equal(await findFotMobFixture('Arsenal','Chelsea',[day],kickoff,
 {fetchDate:async()=>({leagues:[]})}),null);
console.log('PASS safe FotMob match discovery: UTC status time, aliases, home/away, kickoff, ambiguity and missing evidence');
