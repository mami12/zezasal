import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {cleanTeam,teamsMatch,uniqueFixture} from '../server/stats-providers/adapters.mjs';
import {aiscoreFixtureMatches} from '../server/stats-providers/football-information.mjs';
for(const [a,b] of [
 ['FK Tirana','Tirana FC'],['FC Bayern München','Bayern Munich'],
 ['F.C. Barcelona','Barcelona'],['AC Milan','Milan'],
 ['Manchester Utd','Manchester United'],
 ['FC St. Pauli','Saint Pauli'],['Paris Saint-Germain','PSG'],
 ['1. FC Köln','Cologne'],['Internazionale Milano','Inter Milan'],
 ['FK Shkupi','Shkupi']
])assert.equal(teamsMatch(a,b),true,a+' / '+b);
for(const [a,b] of [
 ['Manchester United','Manchester City'],['Man Utd','Man City'],
 ['Real Madrid','Real Madrid Castilla'],['Arsenal','Arsenal U21'],
 ['Arsenal','Arsenal Women'],['Arsenal','Arsenal W'],
 ['Arsenal','Arsenal II'],['Arsenal','Arsenal B'],
 ['Arsenal U19','Arsenal U21'],['Arsenal','Arsenal Academy'],
 ['Inter Milan','Inter Miami'],['Club Brugge','Brugge B'],
 ['Napoli','Napoli Youth'],['River Plate','River Plate Montevideo'],
 ['Team United','Team City'],['Benfica','Benfica B'],
 ['FC Zürich','FC Zurich U19']
])assert.equal(teamsMatch(a,b),false,a+' / '+b);
assert.notEqual(cleanTeam('Manchester United'),cleanTeam('Manchester City'));
const primary={home:'FK Tirana',away:'Manchester Utd',start_at:'2026-11-11T19:00:00Z'};
const other=(id,home='Tirana FC',away='Manchester United',start='2026-11-11T19:01:00Z')=>({id,home,away,start});
assert.equal(uniqueFixture(primary,[other(321)])?.id,321);
assert.equal(uniqueFixture(primary,[other(321),other(322)]),null,
 'Two different IDs matching the same fixture are ambiguous');
assert.equal(uniqueFixture(primary,[other(321,'Manchester United','Tirana FC')]),null,
 'Swapped home/away is not an identity match');
assert.equal(uniqueFixture(primary,[other(321,'Tirana FC','Manchester City')]),null);
assert.equal(uniqueFixture(primary,[other(321,'Tirana FC','Manchester United','2026-11-12T19:00:00Z')]),null);
assert.equal(uniqueFixture({...primary,start_at:null},[other(321)]),null);
assert.equal(uniqueFixture(primary,[{id:321,home:'Tirana FC',away:'Manchester United'}]),null,
 'Missing independent kickoff must not authorize payout evidence');
const payload={data:{match:{id:'abc',home_team:{name:'Tirana FC'},
 away_team:{name:'Manchester United'},start_at:'2026-11-11T19:01:00Z'}}};
assert.equal(aiscoreFixtureMatches(payload,'abc',primary),true);
assert.equal(aiscoreFixtureMatches(payload,'wrong-id',primary),false);
assert.equal(aiscoreFixtureMatches(payload,'abc',{...primary,away:'Manchester City'}),false);
assert.equal(aiscoreFixtureMatches(payload,'abc',{...primary,start_at:'2026-11-12T19:00:00Z'}),false);
console.log('PASS safe FC/FK aliases, full team identity, home/away, kickoff, unique fixture, AiScore');
