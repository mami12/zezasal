import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {displayGoalIntervals,displayTeamStatistics,groupGoalsIntoIntervals} from '../server/stats-providers/display-stats.mjs';
import {createStatsService} from '../server/stats-providers/service.mjs';
import {teamStatisticsFromRow} from '../server/match-statistics.mjs';

const worldFixture={id:'world-1',league:'eng.1',start:'2026-11-03T17:00:00.000Z',raw:{}};
const worldStats={events:[{id:'world-1',date:'2026-11-03T17:00:00.000Z',competitions:[{competitors:[
 {id:'home-id',homeAway:'home',team:{displayName:'Alpha'},statistics:[{name:'Shots on target',displayValue:'4'},{name:'Fouls',displayValue:'7'}]},
 {id:'away-id',homeAway:'away',team:{displayName:'Beta'},statistics:[{name:'Shots on target',displayValue:'2'},{name:'Fouls committed',displayValue:'11'}]},
]}]}]};
assert.deepEqual(Object.fromEntries(Object.entries(displayTeamStatistics('worldcup26',worldStats,worldFixture)).filter(([key])=>['shotsOnTarget','fouls'].includes(key))),{
 shotsOnTarget:{home:4,away:2},fouls:{home:7,away:11},
},'team totals are read only from explicit provider statistics');
assert.equal(displayTeamStatistics('worldcup26',{events:[]},worldFixture).shotsOnTarget.home,null,'missing stats stay unknown');

const rawGoals=[
 {id:'g1',type:'goal',team:'home',minute:'15',phase:'H1'},
 {id:'g2',type:'goal',team:'away',minute:'45+2',phase:'H1'},
 {id:'g3',type:'goal',team:'home',minute:'63',phase:'H2'},
 {id:'g4',type:'goal',team:'away',minute:'90+4',phase:'H2'},
 {id:'g5',type:'goal',team:'away',minute:'105',phase:'extra'},
];
const intervals=groupGoalsIntoIntervals(rawGoals);
assert.deepEqual(intervals.map(x=>[x.home,x.away]),[[1,0],[0,0],[0,1],[0,0],[1,0],[0,1]],
 'stoppage-time goals stay in the reported 15-minute interval and extra time is excluded');
assert.equal(groupGoalsIntoIntervals([{id:'duplicate',type:'goal',team:'home',minute:12},{id:'duplicate',type:'goal',team:'away',minute:13}]),null,
 'ambiguous duplicate events do not produce an interval chart');
assert.equal(groupGoalsIntoIntervals([{id:'unknown',type:'goal',minute:12}]),null,'an unassigned team is not guessed');
assert.equal(displayGoalIntervals('apifootball',{response:[{type:'Goal',team:{id:'other'},time:{elapsed:12}}]},{
 raw:{teams:{home:{id:'home'},away:{id:'away'}}},
}),null,'a provider goal without an unambiguous fixture side stays unavailable');
assert.equal(displayGoalIntervals('bsd',{incidents:[{id:'cancelled',cancelled:true,is_home:true,minute:12}]},{} )[0].home,0,
 'cancelled goals are not counted');
assert.equal(displayGoalIntervals('goalapi',{success:true,data:[{id:'penalty',type:'GOAL',homeScorer:'A',time:'32',scoreInfoTime:'Penalty'}]},{} )[2].home,1,
 'a regulation penalty is kept in its match interval');

const database=new PGlite();
const calls=[];
const service=createStatsService({
 runQuery:(...args)=>database.query(...args),
 env:{STATS_PROVIDERS_ENABLED:'true',WORLDCUP26_LEAGUES:'eng.1'},
 getWatchIds:async()=>['101'],
 now:()=>Date.parse('2026-11-03T18:00:00.000Z'),
 request:async url=>{
  calls.push(url);
  if(url.includes('/scoreboard?'))return new Response(JSON.stringify(worldStats),{status:200});
  if(url.includes('/plays?'))return new Response(JSON.stringify({pageCount:1,items:[
   {id:'one',scoringPlay:true,valid:true,clock:{displayValue:"15'"},period:{number:1},team:{source_id:'home-id'}},
   {id:'two',scoringPlay:true,valid:true,clock:{displayValue:"31'"},period:{number:2},team:{source_id:'away-id'}},
   {id:'extra',scoringPlay:true,valid:true,clock:{displayValue:"105'"},period:{number:3},team:{source_id:'home-id'}},
  ]}),{status:200});
  throw new Error('Unexpected statistics endpoint: '+url);
 },
});
const row={match_id:101,home:'Alpha',away:'Beta',start_at:'2026-11-03T17:00:00.000Z',service:'LIVE',stats:{},raw:{
 homeTeam:{id:'home-id'},awayTeam:{id:'away-id'},
}};
try{
 await database.exec('create table app_match_result(match_id bigint primary key)');
 await service.warmStatistics(row);
 const stats=teamStatisticsFromRow({...row,stats:service.displayStatistics(row)});
 assert.equal(stats.home.shotsOnTarget,4);assert.equal(stats.away.shotsOnTarget,2);
 assert.equal(stats.home.fouls,7);assert.equal(stats.away.fouls,11);
 assert.deepEqual(service.displayGoalIntervalStats(row).map(x=>[x.home,x.away]),[[1,0],[0,0],[0,1],[0,0],[0,0],[0,0]]);
 const count=calls.length;await service.warmStatistics(row);assert.equal(calls.length,count,'the shared display cache avoids repeat provider requests');
 assert.ok(calls.every(url=>url.startsWith('https://worldcup26.ir/')),'the information-only provider is the only requested service');
}finally{await database.close();}
console.log('PASS information-only provider stats: shots on target, fouls, verified 15-minute goal intervals, missing/ambiguous data and cache');
