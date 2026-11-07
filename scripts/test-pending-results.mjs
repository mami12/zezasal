import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { createPendingResultTracker } from '../server/pending-results.mjs';
import { isFinished } from '../server/ledger/results.mjs';
import { startPusher } from '../server/pusher.mjs';
import { createIdleMonitor } from '../server/idle-mode.mjs';

let ids=Array.from({length:260},(_,index)=>index+1),archived=[],signals=0;
const tracker=createPendingResultTracker({query:async()=>({rows:ids.map(match_id=>({match_id}))}),isFinished,
  archive:async row=>{archived.push(structuredClone(row));return {recorded:true};},onArchived:()=>{signals++;}});
await tracker.refresh();assert.equal(tracker.ids().length,260);
const now=Date.now();
assert.equal(await tracker.observe({matchId:200,feedStatus:'FT',homeScore:null,awayScore:null},null,now),false);
assert.equal(await tracker.observe({matchId:200,homeScore:2,awayScore:1},null,now+1000),true,'a pending fixture absent from the board can still preserve a real final score');
assert.equal(archived[0].match_id,200);assert.equal(archived[0].home_score,2);assert.equal(signals,1);
assert.equal(await tracker.observe({matchId:200,homeScore:2,awayScore:1},null,now+2000),false,'duplicate final snapshots do not trigger repeated writes');
await tracker.observe({matchId:201,feedStatus:'1H',homeScore:0,awayScore:0},null,now);
assert.equal(await tracker.observe({matchId:201,feedStatus:'FT'},null,now+3600000),false,'a stale first-half score cannot become a fabricated full-time result');
assert.equal(await tracker.observe({matchId:201,homeScore:3,awayScore:1},null,now+3601000),true);
assert.equal(await tracker.observe({matchId:999,feedStatus:'FT',homeScore:9,awayScore:9},null,now),false,'unrelated unknown matches are not stored');
ids=ids.filter(id=>id!==200);await tracker.refresh();assert.ok(!tracker.ids().includes(200));

const sent=[];let socket,pusher;
class FakeSocket extends EventEmitter {
  readyState=WebSocket.OPEN;
  send(frame){sent.push(frame);if(frame==='40')queueMicrotask(()=>this.emit('message',Buffer.from('40')));}
  close(){this.readyState=WebSocket.CLOSED;this.emit('close');}
}
try {
  pusher=startPusher({getIds:async()=>({live:[1],prematchSoon:[],prematchLater:[],pendingResults:tracker.ids()}),
    verbose:false,socketFactory:()=>{socket=new FakeSocket();queueMicrotask(()=>{socket.emit('open');socket.emit('message',Buffer.from('0{}'));});return socket;}});
  const until=Date.now()+2000;while(!pusher.stats().pendingResultIds&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,5));
  const packets=sent.filter(frame=>frame.startsWith('42')).map(frame=>JSON.parse(frame.slice(2))[1]);
  const infoIds=packets.filter(packet=>packet.messageType==='subscribe-match-info').flatMap(packet=>packet.data.matchIds);
  assert.equal(new Set(infoIds).size,259);assert.ok(infoIds.includes(260),'pending result subscriptions must reach beyond the normal LIVE limit');
  assert.ok(packets.every(packet=>packet.data.matchIds.length<=50));
  assert.deepEqual(packets.filter(packet=>packet.messageType==='subscribe-match-odds').flatMap(packet=>packet.data.matchIds),[1],'result recovery must not publish old betting odds');
  const monitor=createIdleMonitor({enabled:true,idleAfterMs:1,onIdle:()=>pusher.pause()});
  assert.equal(monitor.evaluate(),false);assert.equal(pusher.stats().paused,false);
  assert.equal(socket.readyState,WebSocket.OPEN);
  console.log('PASS pending result recovery: 260 tracked IDs, old snapshots excluded, off-board confirmed FT archived, duplicate guards and real subscription frames continue without visitors');
} finally {pusher?.close();}
