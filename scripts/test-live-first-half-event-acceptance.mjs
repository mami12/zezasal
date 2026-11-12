import assert from 'node:assert/strict';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';
const at=Date.parse('2026-11-12T20:00:00Z'),observed=new Date(at).toISOString();
const live=(minute,goalsHome=0,cornersHome=0,cardsHome=0)=>({
 service:'LIVE',match_id:102,home:'Alpha',away:'Beta',match_time_ms:minute*60000,
 clock_at:observed,score_at:observed,home_score:goalsHome,away_score:0,
 raw:{homeTeam:{id:'1'},awayTeam:{id:'2'}},
 stats:{home:{corners:cornersHome,yellow:cardsHome,red:0,
  _observedAt:{corners:observed,yellow:observed,red:observed}},
  away:{corners:0,yellow:0,red:0,_observedAt:{corners:observed,yellow:observed,red:observed}}}
});
const quote=(market_name,outcome_name='1')=>({market_name,outcome_name});
let tests=0;
for(const [market,result] of [
 ['1st half - Race to 3 Goals','half-race'],
 ['1st half - Race to 3 Corners','half-race'],
 ['1st half - Race to 3 Cards','half-race'],
 ['1st half - first goal','half-first-event'],
 ['1st half - first corner','half-first-event'],
 ['1st half - first card','half-first-event'],
 ['1st half - last goal','half-last-event'],
 ['1st half - last corner','half-last-event'],
 ['1st half - last card','half-last-event']
]){
 assert.equal(frozenLiveContract(quote(market),live(0),at)?.kind,result,market);
 tests++;
}
assert.equal(frozenLiveContract(quote('1st half - Race to 3 Corners'),
 live(18,0,2),at)?.baseline.home,2);
assert.throws(()=>frozenLiveContract(quote('1st half - Race to 3 Corners'),
 live(19,0,3),at),error=>error.code==='MARKET_DECIDED');
assert.throws(()=>frozenLiveContract(quote('1st half - Race to 3 Cards'),
 live(20,0,0,3),at),error=>error.code==='MARKET_DECIDED');
assert.equal(frozenLiveContract(quote('1st half - first corner'),
 {...live(10),score_at:null},at)?.kind,'half-first-event',
 'A corner race must not depend on an unrelated score timestamp');
assert.equal(frozenLiveContract(quote('1st half - first card'),
 {...live(10),score_at:null},at)?.kind,'half-first-event',
 'First card only needs confirmed card counters and the live clock');
assert.equal(frozenLiveContract(quote('1st half - last goal'),live(20,2),at)?.kind,
 'half-last-event','Last scorer remains unresolved before HT');
assert.throws(()=>frozenLiveContract(quote('1st half - last corner','None'),
 live(20,0,2),at),error=>error.code==='MARKET_DECIDED');
assert.throws(()=>frozenLiveContract(quote('1st half - Race to 3 Corners'),
 live(45),at),error=>error.code==='MARKET_EVIDENCE_UNSUPPORTED');
assert.throws(()=>frozenLiveContract(quote('2nd half - Race to 3 Corners'),
 live(60),at),error=>error.code==='MARKET_EVIDENCE_UNSUPPORTED',
 'No guessed 2H-only baseline from whole-match counter');
tests+=9;
console.log('PASS '+tests+' generic 1H LIVE PREMATCH race / first / last goal, corner and card market acceptance checks');
