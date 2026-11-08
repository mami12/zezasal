import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseFotMobPayload} from '../server/stats-providers/match-recovery.mjs';
import {archivedFavorite} from '../server/ledger/favorite-history.mjs';
import {emitScopedOdds} from '../server/market-delivery.mjs';

const empty=parseFotMobPayload({status:{finished:true},home:{name:'Alpha'},away:{name:'Beta'}});
assert.equal(empty.homeScore,null,'Missing FT home must never become zero');
assert.equal(empty.awayScore,null,'Missing FT away must never become zero');
assert.equal(empty.cardsHome,null,'Missing final card counts must not be invented');

const draw=parseFotMobPayload({status:{finished:true,scoreStr:'0 - 0'},home:{},away:{}});
assert.deepEqual([draw.homeScore,draw.awayScore],[0,0],'Explicit true 0-0 is accepted');
const minute=parseFotMobPayload({status:{finished:true,scoreStr:'1 - 0'}},{
 content:{matchFacts:{events:{events:[{type:'Goal',time:'90+2',isHome:true}]}}}
});
assert.equal(minute.goalEvents.length,1);
assert.equal(minute.goalEvents[0].minute,90);
assert.equal(minute.goalEvents[0].injury,2);
assert.equal(minute.goalEvents[0].player,null,'Goal is retained when the scorer is unknown');
assert.equal(minute.cardsHome,null,'No event-card count is not zero');

const now=Date.now();
const base={match_id:456,home_score:1,away_score:0,
 home_team:'Alpha',away_team:'Beta',finished_at:new Date(now-1000).toISOString(),
 snapshot:{start_at:new Date(now-9000000).toISOString(),raw:{}}};
const history={source:'fotmob',complete:true,final:true,events:[
 {id:'goal1',type:'goal',team:'home',minute:37,player:'Example Scorer'}
]};
assert.equal(archivedFavorite({...base,event_evidence:history},now)?.events?.[0]?.player,'Example Scorer');
assert.equal(archivedFavorite({...base,event_evidence:{...history,complete:false}},now)?.events.length,0,
 'Partial historical timeline must not be displayed as verified FT');

const messages=[];
const slip={data:{feedScope:{selectionIds:['123|corners||over']}},
 emit:(event,data)=>messages.push({room:'slip:client',event,data})};
const io={to:room=>({emit:(event,data)=>messages.push({room,event,data})}),
 sockets:{adapter:{rooms:new Map([['feed:slip:123',new Set(['client'])]])},
 sockets:new Map([['client',slip]])}};
const mk=(key,name)=>({key,line:'',name,
 outcomes:[{key:'over',price:2},{key:'under',price:2}]});
emitScopedOdds(io,{matchId:'123',markets:[
 mk('result','Full Time Result'),mk('corners','Total Corners')
]},new Set(['result|']));
assert.equal(messages.filter(item=>item.room==='feed:legacy').length,0,
 'Complete fixture markets must never go to all connected browsers');
assert.deepEqual(messages.find(item=>item.room==='feed:board:123')?.data.markets.map(m=>m.key),['result']);
assert.equal(messages.find(item=>item.room==='feed:detail:123:all')?.data.markets.length,2);
assert.deepEqual(messages.find(item=>item.room==='slip:client')?.data.markets[0].outcomes.map(x=>x.key),['over']);

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
assert.match(source('web/src/components/Betslip/TicketReceipt.tsx'),/createPortal\(/);
assert.match(source('web/src/components/Betslip/TicketReceipt.tsx'),/overscroll-contain/);
assert.match(source('web/src/index.css'),/\.ticket-print-panel\s*\{\s*position: static !important;/);
assert.match(source('web/src/components/Sports/MatchDetail.tsx'),/goal\.player/);
assert.doesNotMatch(source('web/src/components/Tracker/PitchTracker.tsx'),/\.slice\(0,8\)/);
assert.match(source('server/ledger/routes.mjs'),/const board = true;/);
console.log('PASS historical FT parsing, ticket evidence display, scoped quote delivery and long receipt layout');
