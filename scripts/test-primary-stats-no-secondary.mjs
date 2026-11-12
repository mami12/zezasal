import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createStatsService} from '../server/stats-providers/service.mjs';

const database=new PGlite(),calls=[];
const row={
 match_id:101,home:'Home',away:'Away',
 start_at:'2026-11-12T15:00:00Z',service:'LIVE',feed_status:'FT',
 stats:{},raw:{homeTeam:{id:'home'},awayTeam:{id:'away'}}
};
try{
 await database.exec(`
  create table app_match_result(match_id bigint primary key,statistics jsonb,
    corners_home integer,corners_away integer,cards_home integer,cards_away integer);
  create table app_stat_review(match_id bigint primary key,payload jsonb not null,
    updated_at timestamptz default now());
 `);
 await database.query(
  'insert into app_match_result(match_id,statistics,corners_home,corners_away,cards_home,cards_away) values($1,$2::jsonb,$3,$4,$5,$6)',
  [101,JSON.stringify({
   shots:{home:10,away:7},shotsOnTarget:{home:4,away:2},fouls:{home:11,away:9}
  }),5,3,2,1]
 );
 const service=createStatsService({
  runQuery:(...args)=>database.query(...args),
  env:{STATS_PROVIDERS_ENABLED:'true',STATS_REALTIME_ENABLED:'false'},
  getWatchIds:async()=>['101'],
  now:()=>Date.parse('2026-11-12T17:00:00Z'),
  request:async url=>{calls.push(url);throw Error('Unexpected secondary HTTP request');}
 });
 await service.warmStatistics(row);
 assert.deepEqual(calls,[],'complete primary FT statistics require no secondary API');
 const data=(await database.query('select payload from app_stat_review where match_id=$1',[101])).rows[0]?.payload;
 assert.equal(data?.status,'VERIFIED');
 assert.deepEqual(data?.attempted,[]);
 assert.deepEqual(data?.sources.map(x=>x.provider),['primary']);
}finally{await database.close();}
console.log('PASS no secondary statistics request when Zizobet final stats are complete');
