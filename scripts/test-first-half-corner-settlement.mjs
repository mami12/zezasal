import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {liveContract,parseFirstHalfCorner} from '../server/ledger/live-contract-rules.mjs';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';
import {gradeFirstHalfCornerFacts,gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
import {normalizeEvents} from '../server/ledger/event-evidence.mjs';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';

const title='1st half - First corner';
const first=(outcome_name)=>({market_name:title,outcome_name,line:'',market_key:'zz123@e30'});
for(const [label,side] of [['None','none'],['No corner','none'],['1','home'],['2','away']]){
 assert.deepEqual(parseFirstHalfCorner(first(label)),
  {version:1,kind:'half-first-event',event:'corner',half:1,side});
}
assert.equal(parseFirstHalfCorner({market_name:'2nd half - First corner',outcome_name:'None'}),null);
assert.equal(parseFirstHalfCorner({market_name:'1st half - Last corner',outcome_name:'None'}),null);
assert.equal(parseFirstHalfCorner(first('Unrecognized')),null);
const prematch={service:'PREMATCH',start_at:'2030-01-01T20:00:00Z',home:'Inter Milan',away:'Como 1907'};
const at=Date.parse('2026-11-08T14:00:00Z');
assert.equal(frozenLiveContract(first('None'),prematch,at)?.side,'none');
assert.equal(frozenLiveContract(first('Inter Milan'),prematch,at)?.side,'home');
assert.equal(frozenLiveContract(first('Como 1907'),prematch,at)?.side,'away');

const proven=(side)=>({kind:'half-first-event',event:'corner',half:1,side});
const facts=[
 {team:'home',minute:10,phase:null,seconds:null},
 {team:'away',minute:30,phase:'First Half',seconds:null},
 {team:'away',minute:55,phase:'Second Half',seconds:null}
];
assert.equal(gradeFirstHalfCornerFacts(proven('home'),facts,{complete:true}),'WON');
assert.equal(gradeFirstHalfCornerFacts(proven('away'),facts,{complete:true}),'LOST');
assert.equal(gradeFirstHalfCornerFacts(proven('none'),facts,{complete:true}),'LOST');
assert.equal(gradeFirstHalfCornerFacts(proven('none'),facts,{complete:false}),null);
const allSecond=[
 {team:'home',minute:55,phase:'Second Half',seconds:null},
 {team:'away',minute:67,phase:'H2',seconds:null}
];
assert.equal(gradeFirstHalfCornerFacts(proven('none'),allSecond,{complete:true}),'WON',
 'A first corner in the second half must not count as first half');
assert.equal(gradeFirstHalfCornerFacts(proven('home'),allSecond,{complete:true}),'LOST');
assert.equal(gradeFirstHalfCornerFacts(proven('none'),[],{complete:true}),'WON');
assert.equal(gradeFirstHalfCornerFacts(proven('none'),[
 {team:'away',minute:46,phase:null,seconds:null}],{complete:true}),null,
 'An unlabelled 46th minute may be 45+1 and must not pay None');
const tied=[
 {team:'home',minute:10,phase:'H1',seconds:null},
 {team:'away',minute:10,phase:'H1',seconds:null}
];
assert.equal(gradeFirstHalfCornerFacts(proven('home'),tied,{complete:true}),null);
assert.equal(gradeFirstHalfCornerFacts(proven('none'),tied,{complete:true}),'LOST');

const zizo=normalizeEvents({
 TimeLines:[{id:'c-stoppage',type:'corner_kick',team:1,gt:'45+2'}],
 Match:{MatchTimeExtended:'47:00',CornersTeam1:1,CornersTeam2:0}
},'zizobet');
assert.equal(zizo.events[0].phase,'1st half');
assert.equal(gradeFirstHalfCornerFacts(proven('none'),
 [{team:'home',minute:zizo.events[0].minute,phase:zizo.events[0].phase,seconds:null}],
 {complete:true}),'LOST','A 45+2 corner belongs to the first half');

const db=new PGlite();
try{
 await db.exec(LEDGER_SQL);
 const query=(sql,params=[])=>db.query(sql,params);
 const id=95008001;
 const final={home_score:1,away_score:0,corners_home:2,corners_away:1,cards_home:0,cards_away:0};
 await query(`insert into app_match_result(match_id,home_team,away_team,home_score,away_score,corners_home,corners_away,cards_home,cards_away,source)
   values($1,'Inter Milan','Como 1907',1,0,2,1,0,0,'RECOVERY')`,[id]);
 await query(`insert into app_match_event_coverage
  (match_id,provider,kind,through_minute,count_home,count_away,complete,observed_at,confirmed_at)
  values($1,'fotmob','corner',91,2,1,true,now(),now())`,[id]);
 for(const [eventId,team,minute,phase] of [['c1','home',10,'First Half'],['c2','away',30,'First Half'],['c3','home',60,'Second Half']]){
  await query(`insert into app_match_event_fact(match_id,provider,provider_event_id,kind,team,minute,phase)
   values($1,'fotmob',$2,'corner',$3,$4,$5)`,[id,eventId,team,minute,phase]);
 }
 const check=async (side, expected)=>{
  const line={id:'00000000-0000-4000-8000-000000000001',match_id:id,
    live_contract:{version:1,kind:'half-first-event',event:'corner',half:1,side}};
  const outcome=await gradeStoredEventContract(line,final,{execute:query});
  assert.equal(outcome,expected,side+' must use reconciled SQL facts');
 };
 await check('home','WON');
 await check('away','LOST');
 await check('none','LOST');
 // An incomplete or unconfirmed coverage never authorizes the negative proposition.
 await query("update app_match_event_coverage set confirmed_at=null where match_id=$1",[id]);
 await check('none',null);
 console.log('PASS 1H first corner: None, home/away, stoppage, unknown phase, FT SQL coverage and no-premature-grade');
}finally{await db.close();}
