import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {quoteValidUntil,quoteExpired} from '../server/ledger/quote-validity.mjs';
import {buildMarkets} from '../server/collector.mjs';
import {toClientMatch} from '../server/ledger/view.mjs';
import {resolveSelection} from '../server/ledger/bets.mjs';
import * as matches from '../server/match-store.mjs';
import * as odds from '../server/odds-store.mjs';
import {setFeedMode,FEED_LIVE,FEED_WAKING} from '../server/idle-mode.mjs';
import {config} from '../server/config.mjs';
import {pool} from '../server/db.mjs';
const now=Date.now(),old=new Date(now-121000),fresh=new Date(now-1000);
assert.equal(quoteValidUntil(fresh,{status:'LIVE'}),fresh.getTime()+120000);
assert.equal(quoteValidUntil(fresh,{status:'PREMATCH'},300000),fresh.getTime()+300000);
assert.equal(quoteExpired(null),true);assert.equal(quoteExpired(undefined),false);
assert.equal(quoteValidUntil('invalid',{live:true}),null);
assert.equal(quoteExpired(1000,1000),false);assert.equal(quoteExpired(1000,1001),true);
const row=(outcome_key,updated_at)=>({market_key:'total',market_name:'Total Goals',line:'5.5',outcome_key,outcome_name:outcome_key,price:2,suspended:false,updated_at});
const project=(rows,live=true)=>toClientMatch({id:881,home:'Home',away:'Away',live,status:live?'live':'scheduled',snapshotAt:new Date().toISOString(),markets:buildMarkets(rows)});
const shown=project([row('Over',old),row('Under',fresh)]);
const choices=Object.fromEntries(shown.markets[0].outcomes.map(o=>[o.code,o]));
assert.equal(choices.Over.status,'SUSPENDED');assert.equal(choices.Over.quoteSuspended,true);assert.equal(choices.Over.feedSuspended,false);
assert.equal(choices.Over.priceValidUntil,old.getTime()+120000,'list/score snapshot cannot renew quote lifetime');
assert.equal(choices.Under.status,'ACTIVE','stale sibling does not suspend fresh sibling');
assert.equal(project([row('Over',null)]).markets[0].outcomes[0].status,'SUSPENDED','unknown timestamp never active');
assert.equal(project([row('Over',new Date(now-45*60000))],false).markets[0].outcomes[0].status,'ACTIVE');
assert.equal(project([row('Over',new Date(now-91*60000))],false).markets[0].outcomes[0].status,'SUSPENDED');
config.matchStore='memory';config.oddsStore='memory';setFeedMode(FEED_LIVE);
matches.upsert([{match_id:881,home:'Home',away:'Away',service:'LIVE',active:true,start_at:new Date(now-90*60000),raw:{}}]);
matches.applyInfo({matchId:881,homeScore:0,awayScore:0,matchTimeMs:90*60000,feedStatus:'Second Half'});
odds.applyRows([{matchId:881,marketKey:'total',marketName:'Total Goals',line:'5.5',outcomeKey:'Over',outcomeName:'Over',price:2}]);
const saved=odds.getOddsForMatches([881])[0];
try{
 saved.updated_at=old;
 await assert.rejects(resolveSelection({outcomeId:'881|total|5.5|Over',oddsAtPlacement:2}),e=>e.code==='QUOTE_STALE'&&e.outcomeId==='881|total|5.5|Over');
 saved.updated_at=fresh;
 assert.equal((await resolveSelection({outcomeId:'881|total|5.5|Over',oddsAtPlacement:2})).price,2);
 setFeedMode(FEED_WAKING);
 assert.equal(project([row('Over',fresh)]).markets[0].outcomes[0].status,'SUSPENDED');
 await assert.rejects(resolveSelection({outcomeId:'881|total|5.5|Over'}),e=>e.code==='FEED_REFRESHING');
 setFeedMode(FEED_LIVE);
 assert.equal(project([row('Over',fresh)]).markets[0].outcomes[0].status,'ACTIVE','fresh quotes can reopen');
 for(const name of ['Goal before 10 minutes','Player to score within 10 minutes','Time of Scoring']){
  assert.equal(toClientMatch({id:881,home:'Home',away:'Away',live:true,minute:90,markets:[{key:'timed',name,outcomes:[{key:'Yes',name:'Yes',price:2,priceUpdatedAt:fresh.toISOString()}]}]}).markets.length,0,'past/unsupported time contract never advertised');
 }
 console.log('PASS quote validity: shared live/prematch bounds, per-outcome age, fresh snapshots do not renew old quotes, missing age, fresh siblings, resolver parity, global refresh, reopening and timed-market protection');
}finally{setFeedMode(FEED_LIVE);matches.clear();odds.clearMatch(881);await pool.end();}
