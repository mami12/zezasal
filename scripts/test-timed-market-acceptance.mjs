import assert from 'node:assert/strict';
import {liveContract,parseClockWindowTotal,parseIntervalCount,parseTimedResultMarket} from '../server/ledger/live-contract-rules.mjs';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';

const pick=(market_name,outcome_name,line='')=>({market_name,outcome_name,line});
const match={service:'PREMATCH',start_at:'2030-01-01T15:00:00.000Z',home:'Inter Milan',away:'Como 1907'};
const at=Date.parse('2026-11-08T14:00:00.000Z');

// Minutes are bucket aligned and do not overlap either half's stoppage time.
for(const [title,selection,raw,event,from,to,choice,threshold] of [
 ['30:00 - 44:59 min. - Total corners (0.5)','Over','0.5','corner',30,44,'over',0.5],
 ['00:00 - 09:59 min. - Total goals (1.5)','Under','1.5','goal',0,9,'under',1.5],
 ['20:00 - 29:59 min. - Total cards (2.5)','Over','2.5','card',20,29,'over',2.5]
]){
 const line=pick(title,selection,raw);
 const parsed=parseClockWindowTotal(line);
 assert.deepEqual([parsed?.kind,parsed?.event,parsed?.from,parsed?.to,parsed?.choice,parsed?.threshold],
  ['window-total',event,from,to,choice,threshold],title);
 assert.deepEqual(frozenLiveContract(line,match,at),parsed,'Same terms must freeze before debit');
}

// Provider symbols like 45+ denote added time, not the ordinary minute 45.
for(const line of [
 pick('30:00 - 45+ min. - Total corners (0.5)','Over','0.5'),
 pick('85:00 - 90+ min. - Total goals (0.5)','Over','0.5'),
 pick('44:00 - 45:59 min. - Total corners (0.5)','Over','0.5'),
 pick('20:30 - 29:59 min. - Total corners (0.5)','Over','0.5'),
 pick('30:00 - 39:59 min. - Total corners (1.5)','Over','0.5')
]){
 assert.equal(parseClockWindowTotal(line),null,'Must not invent an unverified clock contract');
 assert.throws(()=>frozenLiveContract(line,match,at),error=>error?.code==='MARKET_EVIDENCE_UNSUPPORTED',
  'Unverifiable timeline must fail before the wallet is debited');
}
assert.equal(parseIntervalCount(pick('Total corners in minutes 30-45 (15-minute interval)','Over','0.5'))?.kind,
 'window-total','Existing provider-minute windows must keep working');
assert.equal(parseTimedResultMarket(pick('00:00 - 09:59 min. - Result','1'))?.kind,'interval-result');
assert.equal(liveContract(pick('Next Goal 2nd','2'),{counts:{goal:{home:1,away:0}}})?.target,2);
assert.equal(liveContract(pick('Which team wins race to 3 corners','1'))?.kind,'race');
assert.equal(liveContract(pick('Total Yellow Cards','Under','3.5'))?.cardColor,'yellow');
assert.equal(liveContract(pick('Total Goals','Over','2.5'))?.kind,'over');
assert.equal(frozenLiveContract(pick('1X2','1'),match,at),null,
 'Standard full-time result is graded by legacy confirmed score, not a fabricated event contract');
assert.throws(()=>frozenLiveContract(pick('Anytime Goalscorer','Yes'),match,at),
 error=>error?.code==='MARKET_EVIDENCE_UNSUPPORTED',
 'Never guess the scorer identity');
console.log('PASS quote acceptance families and stop-time fail-closed cases');
