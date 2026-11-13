import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {isRetiredPlayerOfferMarket,isExcludedOfferMarket} from '../server/market-policy.mjs';
import {oddsOf} from '../server/zizobet/normalize.mjs';
import {detailProjection} from '../server/market-delivery.mjs';
import {getOddsForMatches,applyRows,clearMatch} from '../server/odds-store.mjs';
import {serializeMatch} from '../server/collector.mjs';

const retired=[
 'Jungdal, Andreas to be sent off (sure sub)',
 'Kristensen, Rasmus to be yellow carded',
 'Mora, Rodrigo to score in 1st half',
 'Silva, Bernardo - Shots on goal (incl. extra time)',
 'Silva, Fabio - Shots on target',
 'Player - shots on goal',
 'Player to commit a foul',
 'Jungdal, Andreas - fouls',
 'Player tackles',
 'Player assists',
 'Jungdal, Andreas - assists',
 'Goalkeeper saves',
 'Player to be booked',
 'Player to score a headed goal',
 'Player first goalscorer',
 'Player last goalscorer',
 'First Goalscorer',
 'Last Goalscorer',
 'Player to score in minutes 31-40',
 'Player to score in extra time',
 'Player to score 2 goals',
 'Player to score in 2nd half',
 'Player - red cards',
 'Player - yellow cards',
];
const kept=[
 'Total corners','1st half - Total corners','Race to 7 corners',
 'Corner in first 5 min. (00:00 - 04:59)',
 '1st half - Home team total corners',
 'Total shots on goal',
 'Team fouls','Total yellow cards','Total red cards',
 'Double chance & 1st half both teams score',
 '1st / 2nd half both teams to score',
 'Halftime/Fulltime & exact goals',
 'Halftime/Fulltime correct score',
 'Home team to score in 1st half',
 'Away team to be carded',
 'Anytime Goalscorer',
 'Next Goal','First Goal','Last Goal',
 'First corner','Last corner',
 '1st half - First corner',
];
for(const name of retired)assert.equal(isRetiredPlayerOfferMarket({name}),true,'Retire named prop '+name);
for(const name of kept)assert.equal(isRetiredPlayerOfferMarket({name}),false,'Keep aggregate market '+name);
const meta={preMarkets:new Map(),liveMarkets:new Map(),positions:new Map()};
const quotes=[];
let mid=9000;
for(const name of [...retired,...kept]){
 mid++;
 const def={Name:name};
 meta.preMarkets.set(mid,def);meta.liveMarkets.set(mid,def);
 const id=mid*10;
 quotes.push({mid,id,pid:'yes',pn:'Yes',v:2.1,coef:2.1,pl:name==='Anytime Goalscorer'?'Anytime Test':undefined});
}
const row={match_id:8999000999},pre=oddsOf(row,quotes,meta,false),live=oddsOf(row,quotes,meta,true);
assert.equal(pre.length,kept.length,'PREMATCH player specials must not reach storage');
assert.equal(live.length,kept.length,'LIVE player specials must not reach storage');
for(const quote of [...pre,...live])assert.equal(isExcludedOfferMarket({market_name:quote.marketName}),false);
const marketId=8999000999;
try{
 applyRows([...pre,...live]);
 const stored=getOddsForMatches([marketId]);
 assert.ok(stored.every(entry=>!retired.includes(entry.market_name)));
 const base=serializeMatch({
  match_id:marketId,home:'Home',away:'Away',service:'PREMATCH',
  start_at:new Date(Date.now()+60000).toISOString(),status:'prematch',raw:{},
 },stored);
 assert.ok(base.markets.every(m=>!retired.includes(m.name)));
 const projected=detailProjection({markets:[
  ...pre.map(q=>({key:q.marketKey,name:q.marketName,line:q.line,outcomes:[{key:q.outcomeKey,name:q.outcomeName,price:q.price}]})),
  ...retired.map((name,i)=>({key:'legacy'+i,name,outcomes:[{key:'yes',name:'Yes',price:2.1}]}))
 ]},'all',{offset:0,limit:100});
 assert.equal(projected.markets.length,kept.length,
  'Even previously cached retired quotes stay out of all market tabs and REST projection');
}finally{clearMatch(marketId);}
console.log('PASS player market removals in LIVE/PREMATCH normalization, cached rows, display projection; retained aggregate and team markets.');
