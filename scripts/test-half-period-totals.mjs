import assert from 'node:assert/strict';
import {liveContract,parseHalfTotal} from '../server/ledger/live-contract-rules.mjs';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';
import {gradeHalfTotalFacts,gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';

const bet=(market_name,outcome_name='Over',line='2.5',period=1)=>({market_name,outcome_name,line,period});
const home=bet('1st half - Total corners Home team (2.5)');
const away=bet('1st half - Total corners Away team (2.5)');
assert.deepEqual(parseHalfTotal(home),{version:1,kind:'half-total',event:'corner',
  half:1,side:'home',choice:'over',threshold:2.5});
assert.equal(liveContract(away)?.side,'away');
assert.equal(liveContract(bet('1st half - Total corners (3.5)','Over','3.5'))?.side,undefined);
assert.equal(liveContract(bet('2nd half - Corners Away team (1.5)','Under','1.5',2))?.half,2);
assert.equal(liveContract(bet('1st half - Yellow cards Home team (1.5)','Over','1.5'))?.cardColor,'yellow');
for(const [title,half,kind,side,color] of [
 ['1st Half Total Corners',1,'corner',null,null],
 ['2nd Half Corners',2,'corner',null,null],
 ['First Half Home Team Corners',1,'corner','home',null],
 ['2nd Half Yellow Cards',2,'card',null,'yellow'],
 ['1st Half Corners (2.5)',1,'corner',null,null],
 ['2nd Half Team 2 Cards',2,'card','away',null],
 ['1st Half Cards Team 1',1,'card','home',null]
]){
 const contract=liveContract({market_name:title,outcome_name:'Over',line:'2.5',period:half});
 assert.equal(contract?.kind,'half-total',title);
 assert.equal(contract.half,half);
 assert.equal(contract.event,kind);
 assert.equal(contract.side??null,side);
 assert.equal(contract.cardColor??null,color);
}
assert.equal(liveContract({market_name:'2nd Half Corners',outcome_name:'Over',
 line:'2.5',period:1}),null,'A contradictory period cannot be settled');

for(const impossible of [
 bet('1st half - Total corners Home team Away team (2.5)'),
 bet('1st half - Total corners Home team (2.5)','Over','3.5'),
 bet('1st half - Total corners Home team (2.25)','Over','2.25'),
 bet('1st half - Total corners Home team (2.5)','Over','2.5',2),
 bet('1st half - Total corners Home team and cards (2.5)'),
 bet('1st half - Total corners Home team (2.5)','Mystery'),
])assert.equal(liveContract(impossible),null,'Ambiguous/invalid quote must not be interpreted: '+impossible.market_name);

const at=Date.parse('2026-11-08T17:25:00Z');
const scheduled={service:'PREMATCH',start_at:'2030-01-01T16:00:00Z'};
assert.equal(frozenLiveContract(home,scheduled,at)?.kind,'half-total');
const live={service:'LIVE',feed_status:'First Half',clock_at:new Date(at).toISOString(),
  score_at:new Date(at).toISOString(),match_time_ms:25*60000};
assert.equal(frozenLiveContract(home,live,at)?.kind,'half-total',
  'The first-half market may be bet during an open first half');
for(const phase of ['Half Time','Second Half','Finished'])
 assert.throws(()=>frozenLiveContract(home,{...live,feed_status:phase},at),
   e=>e.code==='MARKET_EVIDENCE_UNSUPPORTED',
   'Expired first half must not be sold, phase '+phase);

const corners=[
 {team:'home',minute:12,phase:'H1',seconds:null},
 {team:'away',minute:18,phase:'First Half',seconds:null},
 {team:'home',minute:42,phase:null,seconds:null},
 {team:'home',minute:47,phase:'First Half',seconds:null}, // 45+2
 {team:'away',minute:61,phase:'Second Half',seconds:null},
 {team:'away',minute:92,phase:'H2',seconds:null} // 90+2
];
const h1=liveContract(home),h2=liveContract(bet('2nd half - Total corners Away team (1.5)','Over','1.5',2));
const selected=(line)=>liveContract(line);
assert.equal(gradeHalfTotalFacts(h1,corners,{complete:true}),'WON',
  '45+2 belongs to the first half, not the second');
assert.equal(gradeHalfTotalFacts(selected(away),corners,{complete:true}),'LOST',
  'Away corners must NOT win home corners');
assert.equal(gradeHalfTotalFacts(selected({...home,outcome_name:'Under'}),corners,{complete:true}),'LOST');
assert.equal(gradeHalfTotalFacts(h2,corners,{complete:true}),'WON',
  '90+2 belongs to the second half');
assert.equal(gradeHalfTotalFacts(h1,corners,{complete:false}),null);
assert.equal(gradeHalfTotalFacts(h1,[...corners,{team:'away',minute:46,phase:null}],{complete:true}),null,
  'Minute 46 without phase may be 45+1 and cannot be guessed');
assert.equal(gradeHalfTotalFacts(h1,[],{complete:true}),'LOST');
assert.equal(gradeHalfTotalFacts(selected({...home,outcome_name:'Under'}),[],{complete:true}),'WON');

const cards=[
 {team:'home',minute:8,phase:'1st half',card_color:'yellow'},
 {team:'home',minute:47,phase:'H1',card_color:'yellow'},
 {team:'away',minute:50,phase:'2nd half',card_color:'red'}
];
const yellow=liveContract(bet('1st half - Yellow cards Home team (1.5)','Over','1.5'));
assert.equal(gradeHalfTotalFacts(yellow,cards,{complete:true,cardColorsVerified:true}),'WON');
assert.equal(gradeHalfTotalFacts(yellow,cards,{complete:true,cardColorsVerified:false}),null,
  'Color-scoped cards require independently verified card color');

const makeDB=({facts=corners,complete=true,verified=true,event='corner'}={})=>{
 const count=side=>facts.filter(f=>f.team===side).length;
 const execute=async(sql,args=[])=>{
  if(sql.startsWith('with covered as'))return {rows:[{
    home:count('home'),away:count('away'),count_home:count('home'),count_away:count('away'),
    total:facts.length,complete,through_minute:92,card_colors_verified:verified,
    confirmed_at:'2026-11-08T19:42:00Z',observed_at:'2026-11-08T19:42:01Z',
    second_poll_at:'2026-11-08T19:42:01Z',open_recovery_gap:false
  }]};
  if(sql.includes('select minute,seconds,team,phase,card_color')){
    assert.equal(args[2],event);
    return {rows:facts};
  }
  if(sql.includes('from app_match_half_result'))return {rows:[]};
  if(sql.includes('select 1 from app_match_event_coverage'))return {rows:[]};
  if(sql.includes('select provider from app_match_event_coverage'))return {rows:[]};
  throw Error('Unexpected SQL '+sql.slice(0,100));
 };
 const result=event==='corner'
  ?{home_score:0,away_score:0,corners_home:count('home'),corners_away:count('away'),cards_home:0,cards_away:0}
  :{home_score:0,away_score:0,corners_home:0,corners_away:0,cards_home:count('home'),cards_away:count('away')};
 return {execute,result};
};
const db=makeDB();
assert.equal(await gradeStoredEventContract({id:'ticket',match_id:1,live_contract:h1},
  db.result,{execute:db.execute}),'WON','SQL-based grade uses verified 1H home incidents');
assert.equal(await gradeStoredEventContract({id:'ticket',match_id:1,live_contract:selected(away)},
  db.result,{execute:db.execute}),'LOST');
const missing=makeDB({complete:false});
assert.equal(await gradeStoredEventContract({id:'ticket',match_id:1,live_contract:h1},
  missing.result,{execute:missing.execute}),null,'Incomplete coverage => PENDING');
const uncertain=makeDB({facts:[...corners,{team:'away',minute:46,phase:null}]});
assert.equal(await gradeStoredEventContract({id:'ticket',match_id:1,live_contract:h1},
  uncertain.result,{execute:uncertain.execute}),null,'Unlabelled 45+ event => PENDING');
const colored=makeDB({facts:cards,event:'card'});
assert.equal(await gradeStoredEventContract({id:'ticket',match_id:1,live_contract:yellow},
  colored.result,{execute:colored.execute}),'WON');
console.log('PASS strict half totals 1H/2H corners/cards, home/away, 45+/90+, expiry, reconciled DB facts and PENDING');
