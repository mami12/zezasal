import assert from 'node:assert/strict';
import {DATA as CLOVER,spin as cloverSpin,evaluate as cloverGrade} from '../server/casino/lucky-clover-engine.mjs';
import {DATA as VIKINGS,spin as vikingsSpin,spinRound,evaluate as vikingsGrade} from '../server/casino/vikings-engine.mjs';
import {DATA as AGT,spin as agtSpin,evaluate as agtGrade} from '../server/casino/agt-engine.mjs';
import {createCtProtocol} from '../server/casino/ct-protocol.mjs';
import {createAgtProtocol,formatAgtSpin} from '../server/casino/agt-protocol.mjs';
import {ctConfig} from '../server/casino/clover-ct-config.mjs';
import {vikingsConfig} from '../server/casino/vikings-ct-router.mjs';

const profile=(id,rtp)=>({id:`test-${id}-${rtp}`,rtp:Number(rtp),theoreticalRtp:Number(rtp)});
const games=[
 {id:'lucky-clover-x3',data:CLOVER,sy:3,spin:(random,options)=>cloverSpin(100,5,random,options),grade:grid=>cloverGrade(grid,100,5)},
 {id:'vikings-fun',data:VIKINGS,sy:3,spin:(random,options)=>vikingsSpin(100,25,false,random,options),grade:grid=>vikingsGrade(grid,100,25,false)},
 ...Object.entries(AGT.games).map(([id,data])=>({id,data,sy:data.sy,spin:(random,options)=>agtSpin(id,100,data.lines.length,random,options),grade:grid=>agtGrade(id,grid,100,data.lines.length)})),
];
let profilesChecked=0;
for(const game of games){
 const snapshots=[];
 for(const key of Object.keys(game.data.reels)){
  const mathProfile=profile(game.id,key);let counter=0;
  const result=game.spin(length=>(counter++*13+7)%length,{mathProfile});
  const expected=game.data.reels[key].map((reel,x)=>Array.from({length:game.sy},(_,y)=>reel[(result.stops[x]+y)%reel.length]));
  assert.deepEqual(result.grid,expected,`${game.id} must use the selected original reel set ${key}`);
  assert.deepEqual(result.wins,game.grade(expected).wins,'profile selection must not change the paytable');
  assert.equal(result.winCents,game.grade(expected).winCents);
  assert.deepEqual(result.mathProfile,mathProfile);assert.notEqual(result.mathProfile,mathProfile);
  snapshots.push(JSON.stringify(result.grid));profilesChecked++;
 }
 assert.notEqual(snapshots[0],snapshots.at(-1),`${game.id} low and high reel sets must produce different seeded stops`);
 assert.throws(()=>game.spin(()=>0,{mathProfile:profile(game.id,1)}),/Unknown .*reel profile/);
 assert.throws(()=>game.spin(()=>0,{mathProfile:{id:'missing-rtp'}}),/Unknown .*reel profile/);
 const standard=game.data.defaultRtp??game.data.rtp;
 assert.deepEqual(game.spin(()=>0,{}).grid,game.spin(()=>0,{mathProfile:profile(game.id,standard)}).grid,'default must remain unchanged');
}

const cloverLow=profile('lucky-clover-x3',Object.keys(CLOVER.reels)[0]),cloverHigh=profile('lucky-clover-x3',Object.keys(CLOVER.reels).at(-1));
const cloverGrid=cloverSpin(100,5,()=>0,{mathProfile:cloverLow}).grid;
assert.deepEqual(ctConfig(cloverGrid,{mathProfile:cloverLow}).reels_sets.main.reels,CLOVER.reels[String(cloverLow.rtp)].map(reel=>reel.map(value=>[11,1,10,9,8,7,6,5,4,3,2][value-1])));
assert.equal(ctConfig(cloverGrid,{mathProfile:cloverHigh}).RTP['0.01'][0].percent,String(cloverHigh.rtp));

const vikingsLow=profile('vikings-fun',Object.keys(VIKINGS.reels)[0]);
const grid=[[5,6,7],[7,8,9],[9,10,11],[3,4,5],[6,7,8]],seen=[];
const fullRound=spinRound(25,25,(_bet,_lines,free,options)=>{seen.push(options.mathProfile.id);return {grid,wins:[],winCents:0,freeSpins:free?0:15};},{mathProfile:vikingsLow});
assert.equal(fullRound.games.length,16);assert.deepEqual(seen,Array(16).fill(vikingsLow.id));
assert.equal(vikingsConfig(grid,{mathProfile:vikingsLow}).RTP['0.01'][0].percent,String(vikingsLow.rtp));

// Protocol callers can still inject the historical custom spin function; the
// additional final options argument carries only server-selected reel metadata.
const ctSeen=[],ct=createCtProtocol({spinFn:(bet,lines,options)=>{ctSeen.push(options.mathProfile.id);return cloverSpin(bet,lines,()=>0,options);}});
const state=ct.initialState(undefined,{mathProfile:cloverLow});
ct.run(state,[{command:'create_session',sequence_number:1}]);
const paid=ct.run(state,[{command:'play',sequence_number:2,game_denom:1,lines:5,line_bet:1,total_bet:5}],{mathProfile:cloverHigh})[0];
assert.equal(paid.status.status,'ok');assert.deepEqual(ctSeen,[cloverHigh.id]);assert.equal(state.mathProfile.id,cloverHigh.id);

const d=AGT.games.fruitqueen,low=profile('fruitqueen',Object.keys(d.reels)[0]),high=profile('fruitqueen',Object.keys(d.reels).at(-1));
let count=0;const agtSeen=[];
const agt=createAgtProtocol({spinFn:(id,bet,lines,options)=>{count++;agtSeen.push(options.mathProfile?.id);const result=agtSpin(id,bet,lines,()=>0,options);return {...result,winCents:0,wins:[],freeSpins:count===2?2:0};}});
const agtState=agt.initialState('fruitqueen',{mathProfile:low}),params={gamename:'fruitqueen',li:d.lines.length,di:1,amount:.5};
agt.run(agtState,{...params,action:'spin'},{mathProfile:low});assert.equal(agtState.remaining,2);
agt.run(agtState,{...params,action:'freespin'},{mathProfile:high});
agt.run(agtState,{...params,action:'freespin'},{mathProfile:high});
assert.equal(agtState.remaining,0);assert.equal(agtState.mathProfile.id,low.id);
agt.run(agtState,{...params,action:'spin'},{mathProfile:high});assert.equal(agtState.mathProfile.id,high.id);
assert.deepEqual(agtSeen,[low.id,low.id,low.id,low.id,high.id]);
assert.deepEqual(agtState.last.extracomb,formatAgtSpin('fruitqueen',agtSpin('fruitqueen',50,d.lines.length,()=>0,{mathProfile:high})).extracomb);
console.log(`PASS ${profilesChecked} immutable original reel profiles, deterministic stops, unchanged paytables, protocol metadata, and frozen free-game math`);
