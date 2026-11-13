import assert from 'node:assert/strict';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';
import {verifyLiveIntervalAcceptance} from '../server/ledger/live-interval-acceptance.mjs';

const now=Date.parse('2026-11-13T10:00:00Z');
const missing={
  match_id:8001,service:'LIVE',home:'Alpha',away:'Beta',
  home_score:null,away_score:null,match_time_ms:null,clock_at:null,score_at:null,
  stats:null,start_at:new Date(now-3600000)
};
const offer=(market_name,outcome_name,nativeQuoteVerified)=>({
  market_name,outcome_name,nativeQuoteVerified
});
const cases=[
 ['Race to 7 Corners','1','race',7],
 ['Race to 9 Goals','2','race',9],
 ['Race to 3 Cards','None','race',3],
 ['First Goal','1','sequence',1],
 ['Next Goal 2nd','2','sequence',2],
 ['Who scores second','1','sequence',2],
 ['Who scores goal 1 in minutes 6-10 (5-minute interval)','1','nth-time',1],
 ['Who scores goal 3 in minutes 30-45 (15-minute interval)','2','nth-time',3],
];
for(const [market,choice,kind,target]of cases){
 const verified=offer(market,choice,true);
 const frozen=frozenLiveContract(verified,missing,now);
 assert.equal(frozen?.kind,kind,market);
 assert.equal(frozen.target,target,market);
 assert.ok(!frozen.baseline,'Never invent pre-purchase counters when none were reported');
 if(kind==='nth-time'){
  const accepted=await verifyLiveIntervalAcceptance(frozen,missing,{
    nativeQuoteVerified:true,at:now,
    execute:()=>{throw Error('Native offer must not require history at placement');}
  });
  assert.equal(accepted?.target,target);
 }else{
  assert.equal((await verifyLiveIntervalAcceptance(frozen,missing,{at:now})).target,target);
 }
 assert.throws(()=>frozenLiveContract(offer(market,choice,false),missing,now),
  error=>error.code==='MARKET_EVIDENCE_UNSUPPORTED',
  market+' cannot bypass evidence without a validated native Zizobet quote');
}
// A quote for a FUTURE minute band needs no old counter history: all
// incidents in that band occur after this bet. But an already-started band
// cannot ignore its purchase baseline, because pre-bet incidents exist.
const future={...missing,match_time_ms:5*60000,clock_at:new Date(now)};
const futureOffer=offer('Total corners in minutes 11-20 (10-minute interval)','Over',true);
futureOffer.line='0.5';
const futureRule=frozenLiveContract(futureOffer,future,now);
assert.equal(futureRule?.kind,'window-total');
assert.equal(futureRule?.event,'corner');
const futureAccepted=await verifyLiveIntervalAcceptance(futureRule,future,{
  nativeQuoteVerified:true,at:now,
  execute:()=>{throw Error('No pre-band coverage at minute 5');}
});
assert.equal(futureAccepted?.kind,'window-total');
assert.ok(!futureAccepted.entryBaseline,'No fictitious zero corner baseline');
const running=await verifyLiveIntervalAcceptance(futureRule,
  {...future,match_time_ms:15*60000},{
    nativeQuoteVerified:true,at:now,execute:()=>{throw Error('No history fetch at placement');}
  });
assert.equal(running?.entryEvidenceMissing,true,
  'A live running interval without entry counters is accepted for later settlement review');

// Bare NEXT has no absolute ordinal: without current provider counters its
// target CANNOT be identified, even though a named Next Goal 2nd can.
assert.equal(frozenLiveContract(offer('Next Goal','1',true),missing,now),null,
  'Bare Next Goal with unknown current ordinal is an unmapped settlement hold, not a placement veto');
const liveReady={
 ...missing,home_score:1,away_score:0,match_time_ms:12*60000,
 clock_at:new Date(now),score_at:new Date(now)
};
const liveNext=frozenLiveContract(offer('Next Goal','1',true),liveReady,now);
assert.equal(liveNext?.target,2);
assert.deepEqual(liveNext.baseline,{home:1,away:0});
const upcoming={...missing,service:'PREMATCH',start_at:new Date(now+3600000)};
const scheduled=frozenLiveContract(offer('Race to 7 Corners','1',false),upcoming,now);
assert.deepEqual(scheduled.baseline,{home:0,away:0});
console.log('PASS native Zizobet live explicit ordinal and race quote acceptance, zero-invention safety, bare-next and prematch');
