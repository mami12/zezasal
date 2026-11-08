import assert from 'node:assert/strict';
import {shouldConnectSportsFeed} from '../server/feed-route-interest.mjs';

for(const route of ['/','/match/42','/match/42/','/admin','/manager','/agent','/my-bets']){
 assert.equal(shouldConnectSportsFeed(route,true),true,'Expected live feed on '+route);
}
for(const route of ['/login','/casino','/casino/ice-fruits-6x3',
 '/transactions','/nonsense','/app/api','/match/abc','/casino/42']){
 assert.equal(shouldConnectSportsFeed(route,true),false,'Unexpected socket on '+route);
}
for(const route of ['/','/match/42','/admin']){
 assert.equal(shouldConnectSportsFeed(route,false),false,
  'Unauthenticated route must not open sports socket');
}
assert.equal(shouldConnectSportsFeed(null,true),true);
console.log('PASS: route-scoped sportsbook websocket only for authenticated sports views');
