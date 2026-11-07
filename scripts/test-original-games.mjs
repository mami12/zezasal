import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import {evaluate as gradeVikings,spinRound} from '../server/casino/vikings-engine.mjs';
import {evaluate as gradeAgt,DATA} from '../server/casino/agt-engine.mjs';
import {createAgtRouter} from '../server/casino/agt-router.mjs';
import {createVikingsRouter,mapVikingsRound} from '../server/casino/vikings-ct-router.mjs';
let checked=0;
for(const kind of ['agt','vikings'])for(const r of JSON.parse(readFileSync(new URL('./fixtures/'+kind+'-slotopol-golden.json',import.meta.url),'utf8'))){
 const actual=kind==='agt'?gradeAgt(r.game,r.grid,r.bet,r.lines):gradeVikings(r.grid,r.bet,r.lines,r.free);
 assert.equal(actual.winCents,Math.round(r.expected.gain));
 assert.deepEqual(actual.wins.map(w=>[w.line,w.symbol,w.count,w.amount,w.freeSpins||0]),(r.expected.wins||[]).map(w=>[w.li||0,w.sym,w.num,w.pay*w.mp,w.fs||0]));checked++;
}
const trigger=[[2,7,8],[2,8,7],[2,6,7],[5,6,7],[8,10,11]],normal=[[5,6,7],[7,8,9],[9,10,11],[3,4,5],[6,7,8]];
let calls=0;
const round=spinRound(25,25,(bet,lines,free)=>{const grid=!free||calls++===0?trigger:normal;return {grid,...gradeVikings(grid,bet,lines,free)};});
assert.equal(round.games.length,31);assert.equal(round.games.at(-1).freeGameNumber,30);
assert.equal(round.winCents,round.games.reduce((sum,g)=>sum+g.winCents,0));
const mapped=mapVikingsRound(round,{}, {cents:1});assert.equal(mapped[0].free_games,15);assert.equal(mapped[0].free_game_total,0);assert.equal(mapped[1].subgame_label,'free');assert.equal(mapped.at(-1).free_game_total,30);
assert.equal(mapped[1].subgame_label_game_number,1);assert.equal(mapped.at(-1).subgame_label_game_total,30);
assert(mapped.every(g=>Array.isArray(g.expanded_wilds)&&g.lines_win.every(w=>w.wilds.every(x=>x.factor===1&&Array.isArray(x.positions)))));
const app=express();
app.use('/agt',createAgtRouter({spinFn:(id,bet,lines)=>{const d=DATA.games[id],grid=Array.from({length:d.sx},()=>Array(d.sy).fill(id==='fruitqueen'?8:1));return {grid,...gradeAgt(id,grid,bet,lines)};},cardRandom:()=>0}));
app.use('/ct',createVikingsRouter({spinFn:()=>round,cardRandom:()=>0}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;
let cookies={};
async function agt(action,fields={},game='fruitqueen'){
 const url=new URL(origin+'/agt/dinit.php');url.search=new URLSearchParams({action,gamename:game,...fields});
 const response=await fetch(url,{headers:cookies[game]?{cookie:cookies[game]}:{}});cookies[game]||=response.headers.get('set-cookie')?.split(';')[0];return response.json();
}
try{
 const start=await agt('start');assert.equal(start.balance,2000);assert.deepEqual(Object.keys(start.langs),['en']);
 const restored=await agt('restore');assert.equal(restored.extracomb.length,5);assert.equal(restored.comb.length,30);assert.equal(restored.gamble_suit_history.length,5);
 assert.equal((await agt('spin',{li:0,amount:.5,di:1})).error,1);
 assert.equal((await agt('spin',{li:18,amount:.51,di:1})).error,1);
 const paid=await agt('spin',{li:18,amount:.5,di:1});assert.equal(paid.balance,1999.5);assert.equal(paid.win,40);
 const doubled=await agt('double',{color:'red'});assert.equal(doubled.win,80);assert.equal(doubled.gamble_suit_history[0],0);
 const suited=await agt('double',{color:0});assert.equal(suited.win,320);
 assert.equal((await agt('save')).balance,2319.5);assert.equal((await agt('save')).balance,2319.5);
 assert.equal((await agt('start',{},'sevenhot20')).balance,2000);
 let cookie,seq=0;async function ct(command,fields={}){const url=new URL(origin+'/ct/rgsm');url.searchParams.set('request',JSON.stringify([{command,sequence_number:++seq,...fields}]));const response=await fetch(url,{headers:cookie?{cookie}:{}});cookie||=response.headers.get('set-cookie')?.split(';')[0];return(await response.json())[0];}
 await ct('create_session');const init=await ct('init_game');assert.equal(init.game_config.lines.length,25);assert.equal(init.game_config.directory_name,'VikingsFun');
 const play=await ct('play',{lines:25,line_bet:1,total_bet:25,game_denom:1});assert.equal(play.status.status,'ok');assert.equal(play.result.length,32);assert.equal(play.account_status.credit,10000000-25);
 const wait=play.result.at(-1);assert.equal(wait.type,'can_play_red_black_double');
 await ct('continue',{gameplay_id:play.gameplay_id,step_number:wait.step_number,continue_params:{double_betpart:'skip'}});
 const end=await ct('game_finished',{gameplay_id:play.gameplay_id});assert.equal(end.account_status.credit,10000000-25+round.winCents);
 assert.equal((await ct('game_finished',{gameplay_id:play.gameplay_id})).account_status.credit,end.account_status.credit);
 console.log(`PASS ${checked} Go golden cases; original paytables; CT free-game retriggers; AGT x2/x4, validation, session isolation and single collection`);
}finally{await new Promise(r=>server.close(r));}
