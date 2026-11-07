import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { serializeMatch } from '../server/collector.mjs';
import { toClientMatch } from '../server/ledger/view.mjs';
import { liveBoardFacts, freshFeed } from '../server/feed-sync.mjs';
import { PGlite } from '@electric-sql/pglite';
import * as db from '../server/db.mjs';
import { SCHEMA_SQL } from '../server/schema.mjs';
import * as store from '../server/match-store.mjs';

const source=readFileSync(new URL('../web/src/api/matchSync.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const {mergeMatchFacts,liveMatch}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const at=n=>new Date(1700000000000+n*1000).toISOString();
const before={status:'LIVE',homeScore:0,awayScore:0,scoreAt:at(1),clockAt:at(1),currentMinute:20,currentSecond:0,snapshotAt:at(1)};
const goal={status:'LIVE',homeScore:1,awayScore:0,scoreAt:at(3),clockAt:at(3),currentMinute:21,currentSecond:0,snapshotAt:at(3)};
assert.equal(mergeMatchFacts(goal,before).homeScore,1,'late REST or collector snapshot cannot undo a pushed goal');
const stats={...goal,homeScore:0,scoreAt:at(1),snapshotAt:at(4),corners:{home:3,away:1}};
const merged=mergeMatchFacts(goal,stats);
assert.equal(merged.homeScore,1,'a newer stats-only frame cannot relabel a retained old score as fresh');
assert.deepEqual(merged.corners,{home:3,away:1});
const correction={...goal,homeScore:0,scoreAt:at(5),snapshotAt:at(5)};
assert.equal(mergeMatchFacts(goal,correction).homeScore,0,'provider-confirmed goal cancellation is accepted');
assert.equal(liveMatch(correction,goal).homeScore,0,'an older shared patch cannot override a newer REST correction');
const clock={...goal,clockAt:at(3),currentSecond:20,snapshotAt:at(23)};
assert.equal(mergeMatchFacts(clock,goal).currentSecond,20,'same-anchor clock snapshots are ordered by capture time');
assert.equal(mergeMatchFacts(goal,{...before,homeScore:undefined,awayScore:undefined}).homeScore,1);
assert.equal(mergeMatchFacts({...before,scoreAt:undefined,snapshotAt:at(10)},goal).homeScore,1,'confirmed score beats a newer unconfirmed placeholder');
assert.equal(mergeMatchFacts({...goal,scoreAt:undefined},{...before,scoreAt:undefined}).homeScore,1,'legacy snapshots without score anchors still use capture ordering');
assert.equal(mergeMatchFacts({...goal,period:'2H',phaseAt:at(5)},{...before,period:'1H',phaseAt:at(1),snapshotAt:at(8)}).period,'2H','a new stats capture cannot move an old phase forward');
assert.equal(mergeMatchFacts({...goal,snapshotAt:at(8)},{...before,scoreAt:goal.scoreAt,snapshotAt:at(2)}).homeScore,1,'equal millisecond score anchors use capture ordering');
assert.equal(mergeMatchFacts({...goal,phaseAt:at(4),period:'2H',snapshotAt:at(8)},{...before,phaseAt:at(4),period:'1H',snapshotAt:at(2)}).period,'2H','equal millisecond phase anchors use capture ordering');
assert.equal(liveMatch({...before,status:'PREMATCH'},{...goal,status:'LIVE'}).status,'LIVE');
assert.equal(mergeMatchFacts({...goal,isSuspended:true},{...before,isSuspended:false}).isSuspended,true,'old snapshots cannot reopen a match');

const now=1700000000000;
const row={match_id:7,home:'Home',away:'Away',service:'LIVE',start_at:new Date(now-150*60000),
  home_score:1,away_score:0,score_at:at(3),clock_at:at(3),match_time_ms:75*60000,
  updated_at:at(3),category_slug:'test',category_name:'England',tournament_id:1,tournament_name:'Premier League'};
const longMatch=serializeMatch(row,[],now);
assert.equal(longMatch.status,'live','a long/delayed upstream live match does not end on elapsed kickoff time');
assert.equal(longMatch.phase,'2H','estimated FT must not hide ongoing markets');
assert.equal(serializeMatch({...row,feed_status:'Finished'},[],now).status,'ended','provider-confirmed full time remains terminal');
assert.equal(serializeMatch({...row,service:'PREMATCH',feed_status:'Full Time'},[],now).status,'ended','provider full time closes even a stale prematch catalog classification');
assert.equal(serializeMatch({...row,has_open_odds:false},[],now).suspended,true,'a closed board cannot unlock the last odds after reconnect');
const nativeMarket={match_id:7,market_key:'result',market_name:'Full Time Result',outcome_key:'1',outcome_name:'1',price:2,line:'',suspended:false};
const client=toClientMatch(serializeMatch(row,[nativeMarket],now));
assert.equal(client.scoreAt,at(3));assert.equal(client.clockAt,at(3));
assert.equal(client.updatedAt,at(3));assert.equal(client.snapshotAt,new Date(now).toISOString());
assert.equal(client.markets[0].outcomes[0].quotedAt,client.snapshotAt,'price freshness survives REST translation');
const compact=liveBoardFacts([{...longMatch,marketCount:800,markets:Array.from({length:800},()=>({outcomes:[nativeMarket]}))}]);
assert.equal(compact[0].marketCount,800);assert.equal(compact[0].score.home,1);
assert.equal('markets' in compact[0],false,'each collector broadcast carries facts instead of unused full catalogs');
const headers={};let passed=false;
freshFeed({}, {setHeader:(name,value)=>{headers[name]=value;}},()=>{passed=true;});
assert.equal(passed,true);
for(const name of ['Cache-Control','CDN-Cache-Control','Cloudflare-CDN-Cache-Control'])assert.match(headers[name],/no-store/);
// Exercise the actual idempotent SQL migration and mutation, not a second model.
const sql=new PGlite(), originalQuery=db.pool.query;
try {
  await sql.exec(SCHEMA_SQL);await sql.exec(SCHEMA_SQL);
  db.pool.query=(text,params)=>sql.query(text,params);
  await sql.query(`insert into matches(match_id,sport_id,home,away,service,start_at,score_at,clock_at,feed_status,feed_status_at)
    values(7,18,'Home','Away','LIVE',now(),$1,$1,'1st Half',$1)`,[at(1)]);
  const statsOnly=await db.applyMatchInfo({matchId:7,stats:{home:{corners:2}}});
  assert.equal(new Date(statsOnly.score_at).toISOString(),at(1));
  assert.equal(new Date(statsOnly.clock_at).toISOString(),at(1));
  assert.equal(new Date(statsOnly.feed_status_at).toISOString(),at(1),'stats-only SQL write preserves source phase anchor');
  const phaseOnly=await db.applyMatchInfo({matchId:7,feedStatus:'2nd Half'});
  assert.equal(phaseOnly.feed_status,'2nd Half');
  assert.ok(new Date(phaseOnly.feed_status_at)>new Date(at(1)));
  assert.equal(new Date(phaseOnly.score_at).toISOString(),at(1),'phase-only update cannot freshen the old score');
  assert.ok(phaseOnly.updated_at,'DB match-info output retains capture ordering data');
  await sql.query(`insert into matches(match_id,sport_id,home,away,service,start_at,tournament_id,category_slug)
    values(8,18,'Earlier','Fixture','LIVE',now()-interval '1 hour',1,'other'),
          (9,18,'Selected','Fixture','LIVE',now(),2,'chosen')`);
  assert.equal((await db.getMatches({limit:1,tournamentId:'2',league:'chosen',sportId:'18'}))[0].match_id,9,'SQL filters selected competition before global limit');
  assert.deepEqual(await db.getMatches({limit:1,sportId:'99'}),[]);
  store.clear();store.upsert([{...row,sport_id:18}]);
  store.applyInfo({matchId:7,feedStatus:'2nd Half'});
  const phaseAt=store.getById(7).feed_status_at;
  store.applyInfo({matchId:7,stats:{home:{corners:3}}});
  assert.equal(store.getById(7).feed_status_at,phaseAt,'memory driver also preserves source phase freshness');
  store.upsert([{...row,match_id:9,sport_id:18,tournament_id:2,category_slug:'chosen'}]);
  assert.equal(store.getMatches({limit:1,tournamentId:'2',league:'chosen',sportId:'18'})[0].match_id,9,'memory filters selected competition before global limit');
  assert.deepEqual(store.getMatches({limit:1,sportId:'99'}),[]);
} finally {db.pool.query=originalQuery;await db.pool.end();await sql.close();store.clear();}
console.log('PASS match synchronization: stale snapshot ordering, source score/clock anchors, corrections, locks, long matches, quote timestamps and fresh compact feeds');
