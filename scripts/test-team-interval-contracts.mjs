import assert from 'node:assert/strict';
import {resolveMarketTitle} from '../server/zizobet/normalize.mjs';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';

const line=(market_name,outcome_name='Over',raw='0.5')=>({market_name,outcome_name,line:raw});
const q={p1:16,p2:20,h:0.5};
const rawHome='Total [total] Corners HomeTeam in 5 minutes interval [from]-[to]';
const rawAway='Total [total] Corners AwayTeam in 5 minutes interval [from]-[to]';
const homeName=resolveMarketTitle(rawHome,q,{intervalWidth:5});
const awayName=resolveMarketTitle(rawAway,q,{intervalWidth:5});
const totalName=resolveMarketTitle('Total [total] Corners in 5 minutes interval [from]-[to]',q,{intervalWidth:5});
assert.equal(homeName,'Total 0.5 home team corners in minutes 16-20 (5-minute interval)');
assert.equal(awayName,'Total 0.5 away team corners in minutes 16-20 (5-minute interval)');
assert.equal(resolveMarketTitle(rawHome,{...q,p2:21}),null);
const home=liveContract(line(homeName)),away=liveContract(line(awayName)),total=liveContract(line(totalName));
assert.deepEqual(home,{version:1,kind:'window-total',event:'corner',side:'home',from:16,to:20,choice:'over',threshold:0.5});
assert.equal(away?.side,'away');
assert.equal(total?.side,undefined);
assert.equal(liveContract(line(homeName,'Under'))?.choice,'under');
assert.equal(liveContract(line('Total home team corners in minutes 16-20 (5-minute interval)','Exactly 2',''))?.target,2);
assert.equal(liveContract(line('Total home team corners in minutes 16-20 (5-minute interval)','2+',''))?.choice,'atLeast');
assert.equal(liveContract(line('Total home team goals in minutes 16-20'))?.event,'goal');
assert.equal(liveContract(line('Total away team cards in minutes 16-20'))?.event,'card');
for(const example of [
 line('Total home team and away team corners in minutes 16-20'),
 line('Total home team corners in minutes 16-20 (10-minute interval)'),
 line(homeName,'Over','1.5'),
 line('Total home team corners in minutes 16-20 and penalties'),
 {...line('Total home team corners in minutes 16-20'),period:2},
 line(homeName,'Mystery'),
 line('30:00 - 45+ min. - Total home team corners (0.5)')
])assert.equal(liveContract(example),null,'Fail closed: '+example.market_name);

const at=Date.parse('2026-11-08T17:15:00Z');
const prematch={service:'PREMATCH',start_at:'2030-01-01T19:00:00Z',home:'Viktoria Plzen',away:'Sparta Prague'};
assert.deepEqual(frozenLiveContract(line(homeName),prematch,at),home);
const live={service:'LIVE',home:'Viktoria Plzen',away:'Sparta Prague',
 home_score:0,away_score:0,score_at:new Date(at).toISOString(),clock_at:new Date(at).toISOString(),
 match_time_ms:15*60000};
assert.deepEqual(frozenLiveContract(line(homeName),live,at),home);
for(const minute of [16,18,21])assert.throws(
 ()=>frozenLiveContract(line(homeName),{...live,match_time_ms:minute*60000},at),
 error=>error?.code==='MARKET_EVIDENCE_UNSUPPORTED','Interval already started: '+minute);
assert.throws(()=>frozenLiveContract(line(homeName),
 {...live,clock_at:new Date(at-120000).toISOString()},at),
 error=>error?.code==='MARKET_EVIDENCE_UNSUPPORTED');
assert.throws(()=>frozenLiveContract(line('Who takes most corners in minutes 16-20 (5-minute interval)','1',''),
 {...live,match_time_ms:18*60000},at),
 error=>error?.code==='MARKET_EVIDENCE_UNSUPPORTED','Leader must not accept an already started interval');

async function settle(contract,teams,through=21){
 const execute=async(sql,args)=>{
  assert.match(sql,/with covered as/);
  assert.match(sql,/team=\$5/,'SQL must filter by contract.side');
  assert.equal(args[4],contract.side??null);
  const h=teams.filter(x=>x==='home').length,a=teams.filter(x=>x==='away').length;
  const count=teams.filter(x=>args[4]==null||x===args[4]).length;
  return {rows:[{home:h,away:a,total:teams.length,count_home:h,count_away:a,
    through_minute:through,complete:false,open_recovery_gap:false,
    observed_at:'2026-11-08T17:22:00Z',confirmed_at:'2026-11-08T17:21:59Z',
    second_poll_at:'2026-11-08T17:22:00Z',window_count:count,color_window_count:0}]};
 };
 return gradeStoredEventContract({id:'test',match_id:1,live_contract:contract},null,{execute});
}
assert.equal(await settle(home,['home']),'WON');
assert.equal(await settle(home,['away']),'LOST','Away corner must never win a home corner bet');
assert.equal(await settle(total,['away']),'WON');
assert.equal(await settle(away,['away']),'WON');
assert.equal(await settle(home,[]),'LOST');
assert.equal(await settle(home,['home'],18),null,'Coverage gap must remain PENDING');
assert.equal(await settle(liveContract(line(homeName,'Under')),['away']),'WON');
console.log('PASS scoped interval market parsing, acceptance and settlement');
