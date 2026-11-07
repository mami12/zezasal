import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {favoriteIds,archivedFavorite,recentFinishedFavorites,FINISHED_FAVORITE_RETENTION_MS} from '../server/ledger/favorite-history.mjs';
import {snapshotRow} from '../server/ledger/match-snapshots.mjs';

const now=Date.parse('2026-11-05T20:00:00Z');
const base={
 match_id:90001,home_team:'Home',away_team:'Away',home_score:2,away_score:1,
 finished_at:new Date(now-1000).toISOString(),
 statistics:{shotsOnTarget:{home:4,away:3}},
 snapshot:{home:'Home',away:'Away',category_name:'Europe',tournament_name:'League',
  start_at:'2026-11-05T18:00:00Z',raw:{eventTimeline:[
   {type:'goal',minute:16,minuteLabel:'16',team:'home'},
   {type:'goal',minute:45,minuteLabel:'45+2',team:'away'},
  ]}},
};
const archived=archivedFavorite(base,now);
assert.equal(archived.status,'ENDED');
assert.equal(archived.homeScore,2);
assert.equal(archived.awayScore,1);
assert.deepEqual(archived.shotsOnTarget,{home:4,away:3});
assert.equal(archived.events[1].minuteLabel,'45+2');
assert.deepEqual(archived.markets,[],'finished favorites must never offer odds');
assert.equal(archived.isSuspended,true);
assert.equal(archivedFavorite({...base,finished_at:new Date(now-FINISHED_FAVORITE_RETENTION_MS+1000).toISOString()},now)?.status,'ENDED');
assert.equal(archivedFavorite({...base,finished_at:new Date(now-FINISHED_FAVORITE_RETENTION_MS).toISOString()},now),null);
assert.equal(archivedFavorite({...base,finished_at:new Date(now-FINISHED_FAVORITE_RETENTION_MS-1000).toISOString()},now),null);
assert.equal(archivedFavorite({...base,home_score:null},now),null);
assert.equal(archivedFavorite({...base,statistics:{}},now).shotsOnTarget,null,
 'missing shots must remain unknown, never 0-0');

const stored=snapshotRow({match_id:90001,home:'Home',away:'Away',home_score:2,away_score:1,
 category_name:'Europe',tournament_name:'League',raw:{eventTimeline:base.snapshot.raw.eventTimeline}});
assert.equal(stored.tournament_name,'League');
assert.equal(stored.raw.eventTimeline[1].minuteLabel,'45+2');
assert.deepEqual(favoriteIds('90001,invalid,90001,-3,90002'),['90001','90002']);
let sql='',ids=[];
const history=await recentFinishedFavorites(['90001'],{
 now,runQuery:async (statement,params)=>{sql=statement;ids=params[0];return {rows:[base]};}
});
assert.deepEqual(ids,[90001]);
assert.match(sql,/finished_at >= now\(\)-interval '48 hours'/);
assert.equal(history.length,1);
console.log('PASS finished favorites: 48-hour cutoff, verified final score, optional stats/minutes, no odds, bounded IDs');
