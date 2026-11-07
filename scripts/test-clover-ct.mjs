import express from 'express';import assert from 'node:assert/strict';
import {createCtProtocolRouter} from '../server/casino/clover-ct-router.mjs';
import {evaluate} from '../server/casino/lucky-clover-engine.mjs';
const fixed=[[4,4,4],[1,8,8],[1,9,9],[1,10,10],[4,4,4]];
const app=express();app.use(createCtProtocolRouter({spinFn:bet=>({grid:fixed,...evaluate(fixed,bet)}),cardRandom:()=>0}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}/rgsm`;let cookie,sequence=1;
const send=async(command,fields={})=>{const url=new URL(base);url.searchParams.set('request',JSON.stringify([{command,sequence_number:sequence++,...fields}]));const r=await fetch(url,{headers:cookie?{cookie}:{}});cookie||=r.headers.get('set-cookie')?.split(';')[0];return(await r.json())[0];};
try{
 const session=await send('create_session');assert.equal(session.account_status.credit,10000000);
 const init=await send('init_game');assert.equal(init.game_config.directory_name,'LuckyCloverX3');assert.equal(init.game_config.lines.length,5);
 const play=await send('play',{game_denom:1,lines:5,line_bet:1,total_bet:5});assert.equal(play.status.status,'ok');assert.equal(play.result[0].stop_reels.length,5);assert.equal(play.result[0].result_reels.length,3);assert.equal(play.result[0].subgame_factor,3);assert.equal(play.result[1].type,'can_play_red_black_double');
 const win=play.result[0].win;assert.equal(win,45000);
 const bad=await send('continue',{gameplay_id:play.gameplay_id,step_number:1,continue_params:{double_key:'forged',double_betpart:'all'}});assert.equal(bad.status.status,'user_error');
 const double=await send('continue',{gameplay_id:play.gameplay_id,step_number:1,continue_params:{double_key:'red',double_betpart:'all'}});assert.equal(double.result[0].double_result,'win');assert.equal(double.result[0].win,win*2);
 const replaySeq=sequence-1;const url=new URL(base);url.searchParams.set('request',JSON.stringify([{command:'continue',sequence_number:replaySeq,gameplay_id:play.gameplay_id,step_number:1,continue_params:{double_key:'red',double_betpart:'all'}}]));assert.deepEqual((await(await fetch(url,{headers:{cookie}})).json())[0],double);
 await send('continue',{gameplay_id:play.gameplay_id,step_number:3,continue_params:{double_betpart:'skip'}});
 const end=await send('game_finished',{gameplay_id:play.gameplay_id});assert.equal(end.account_status.credit,10000000-5+win*2);
 const end2=await send('game_finished',{gameplay_id:play.gameplay_id});assert.equal(end2.account_status.credit,end.account_status.credit);
 console.log('PASS original CT protocol: symbol orientation, x3, x2 gamble, validation, collect, idempotency');
}finally{await new Promise(r=>server.close(r));}
