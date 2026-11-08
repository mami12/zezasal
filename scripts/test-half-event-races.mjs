import assert from 'node:assert/strict';
import {parseHalfEventContract,liveContract} from '../server/ledger/live-contract-rules.mjs';
import {gradeHalfEventFacts,gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';

const line=(market_name,outcome_name)=>({market_name,outcome_name});
const corners=[
 {team:'home',minute:10,phase:'H1',seconds:605},
 {team:'away',minute:14,phase:'H1',seconds:846},
 {team:'home',minute:25,phase:'H1',seconds:1504},
 {team:'away',minute:51,phase:'H2',seconds:3062},
 {team:'away',minute:61,phase:'H2',seconds:3662},
 {team:'home',minute:92,phase:'H2',seconds:null}
];
for(const [market,outcome,expected] of [
 ['1st half - Race to 2 corners','1','WON'],
 ['1st half - Race to 2 corners','2','LOST'],
 ['1st half - Race to 4 corners','None','WON'],
 ['2nd half - Race to 2 corners','2','WON'],
 ['2nd half - first corner','2','WON'],
 ['2nd half - last corner','1','WON'],
 ['1st half - last corner','1','WON']
]){
 const contract=parseHalfEventContract(line(market,outcome));
 assert.ok(contract,market+' was not parsed');
 assert.equal(gradeHalfEventFacts(contract,corners,{complete:true}),expected,market);
 assert.equal(gradeHalfEventFacts(contract,corners,{complete:false}),null);
}

const firstOnly=[{team:'home',minute:13,phase:'H1',seconds:null}];
for(const [market,choice,offered,expected] of [
 ['2nd half - first corner','1',false,'VOID'],
 ['2nd half - first corner','1',true,'LOST'],
 ['2nd half - last goal','2',false,'VOID'],
 ['2nd half - last goal','2',true,'LOST'],
 ['2nd half - first corner','None',false,'WON']
]){
 const contract=liveContract({...line(market,choice),halfNoneOffered:offered});
 assert.equal(contract?.noneOffered,offered||choice==='None',market+' frozen None');
 const actual=gradeHalfEventFacts(contract,firstOnly,{complete:true});
 assert.equal(actual,expected,market+' '+choice+' '+String(offered));
}
const ambiguous=[...corners,{team:'away',minute:46,phase:null}];
const race=liveContract(line('1st half - Race to 2 corners','1'));
assert.equal(gradeHalfEventFacts(race,ambiguous,{complete:true}),null,
 'An unlabeled 45+ event cannot be guessed into 2H');
assert.equal(liveContract(line('1st half - race to 3 corners','None')).noneOffered,true);
assert.equal(liveContract({...line('2nd half - first card','1'),period:1}),null,
 'The explicit quote period must agree with its title');
assert.equal(liveContract(line('1st half - race to 3 corners and goals','1')),null);
const at=Date.parse('2026-11-08T13:00:00Z');
const pre={service:'PREMATCH',start_at:'2030-01-01T20:00:00Z'};
assert.equal(frozenLiveContract(line('2nd half - Race to 2 corners','2'),pre,at)?.kind,'half-race');
assert.throws(()=>frozenLiveContract(line('2nd half - Race to 2 corners','2'),{
 service:'LIVE',match_time_ms:58*60000,clock_at:new Date(at).toISOString(),
 score_at:new Date(at).toISOString(),home_score:1,away_score:0},at),
 err=>err.code==='MARKET_EVIDENCE_UNSUPPORTED',
 'Do not sell LIVE half-races without a verified half-specific event baseline');

const execute=async(sql,args)=>{
 if(sql.startsWith('with covered as')){
  assert.equal(args[1],'corner');
  return {rows:[{
   home:3,away:3,count_home:3,count_away:3,total:6,
   through_minute:93,complete:true,open_recovery_gap:false,
   observed_at:'2026-11-08T13:30:00Z',confirmed_at:'2026-11-08T13:29:55Z',
   second_poll_at:'2026-11-08T13:30:00Z'
  }]};
 }
 if(sql.includes('select minute,seconds,team,phase')){
  assert.deepEqual(args,[2,'zizobet','corner']);
  return {rows:corners};
 }
 throw Error('Unexpected SQL: '+sql.slice(0,110));
};
const result={home_score:0,away_score:0,corners_home:3,corners_away:3,cards_home:0,cards_away:0};
assert.equal(await gradeStoredEventContract({
 id:'ticket',match_id:2,live_contract:race
},result,{execute}),'WON','A confirmed persisted chronology grades 1H Race');
console.log('PASS period-scoped first/last/races, 45+ uncertainty, FT coverage and SQL fact integration');
