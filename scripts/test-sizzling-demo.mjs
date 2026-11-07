import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import {
  REELS, paylines, paytable, gradeGrid, randomGrid, symbolMatrix, createSizzlingDemoRouter,
} from '../server/casino/sizzling-demo.mjs';

// Production plays Sizzling Hot Deluxe with the player's real wallet: the
// real endpoint must be mounted BEFORE the demo router, the HttpOnly session
// router must exist, and the casino page must embed CasinoOriginalWallet
// (never the demo iframe, never a redirect to the demo entry).
const production=readFileSync(new URL('../server/index.mjs',import.meta.url),'utf8');
const casinoPage=readFileSync(new URL('../web/src/pages/CasinoPage.tsx',import.meta.url),'utf8');
assert.match(production,/app\.use\('\/app\/api\/casino\/sizzlinghotdeluxe\/real', createSizzlingRealRouter\(\)\)/);
assert.match(production,/app\.use\('\/app\/api', casinoSessionRouter\)/);
assert.match(production,/import \{createSizzlingRealRouter, casinoSessionRouter\} from '\.\/casino\/sizzling-real\.mjs'/);
assert.match(production,/app\.use\('\/app\/api\/casino\/sizzlinghotdeluxe',createSizzlingDemoRouter\(\)\)/);
assert.doesNotMatch(production,/redirect\(302, '\/app\/casino\/sizzling'\)/);
assert.match(casinoPage,/CasinoOriginalWallet/);
assert.doesNotMatch(casinoPage,/src="\/app\/casino-original\/sizzling\/index\.html"/);

assert.equal(REELS.length, 5);
assert.ok(REELS.every(reel => reel.length === 75), 'each Goldsvet Sizzling strip has 75 stops');
assert.equal(paylines.length, 5);
assert.equal(paytable[7][2], 2, 'cherry pays 2 on two adjacent symbols (original table)');
assert.equal(paytable[1][5], 5000, 'five 7s pay correctly');
assert.equal(paytable[0][3], 2, '3+ scatters pay with total stake');

const first = randomGrid(() => 0);
assert.equal(first.length, 5);
assert.ok(first.every(column => column.length === 3));
assert.equal(Object.keys(symbolMatrix(first)).length, 5);
assert.equal(Object.keys(symbolMatrix(first)[0]).length, 3);

const all7 = Array.from({length:5},()=>[1,1,1]);
const jackpot = gradeGrid(all7,1,1);
assert.equal(jackpot.line_wins.length,5);
assert.equal(jackpot.total,25_000);
assert.deepEqual(jackpot.line_wins[0].pos,[[0,1],[1,1],[2,1],[3,1],[4,1]]);
const pair = [[7,1,1],[7,2,2],[2,3,3],[4,4,4],[5,5,5]];
assert.equal(gradeGrid(pair,1).line_wins.some(win=>win.code===7&&win.pos.length===2),true);
const scat = [[0,1,1],[1,0,1],[1,1,0],[1,1,1],[1,1,1]];
assert.equal(gradeGrid(scat,1).line_wins.some(win=>win.code===0&&win.type==='scatter'),true);

const app=express();
app.use(express.json());
app.use('/app/api/casino/sizzlinghotdeluxe',createSizzlingDemoRouter());
const server=await new Promise(done=>{
  const listener=app.listen(0,'127.0.0.1',()=>done(listener));
});
try {
  const base='http://127.0.0.1:'+server.address().port+'/app/api/casino/sizzlinghotdeluxe/play';
  let cookie='';
  const post=async (value,kind='form')=>{
    const params=new FormData();
    params.append('data',JSON.stringify(value));
    params.append('cookies',JSON.stringify({'':null}));
    const response=await fetch(base,{
      method:'POST',headers:cookie?{Cookie:cookie}:undefined,
      body:kind==='form'?params:JSON.stringify(value),
    });
    const setCookie=response.headers.get('set-cookie');
    if(setCookie)cookie=setCookie.split(';')[0];
    return { status:response.status, body:await response.json() };
  };
  const init=await post({action:'init',request_id:'0'});
  assert.equal(init.status,200);
  assert.equal(init.body.balance.after,100000);
  assert.deepEqual(init.body.available_actions,['spin']);
  assert.equal(init.body.init.extra.symbol_types.scatters[0],0);
  assert.equal(init.body.init.directory.lines.length,5);
  assert.equal(Object.keys(init.body.init.start_symbols).length,5);
  assert.equal(init.body.init.ranges.bet[1].length,9);
  assert.equal(init.body.init.currency,'EUR');
  assert.ok(cookie.startsWith('sizzling_demo_session='));
  const before=init.body.balance.after;
  const request={action:'spin',bet:1,lines:5,denomination:1,request_id:'2'};
  const spin=await post(request);
  assert.equal(spin.status,200);
  assert.equal(Object.keys(spin.body.spin.symbols).length,5);
  assert.equal(spin.body.spin.wins.line_wins.length>=0,true);
  assert.ok(spin.body.balance.after<=before-5+0.001,'spin debits only the stake');
  assert.ok(spin.body.balance.after>=before-5-0.001,'spin never credits the win early');
  assert.equal(typeof spin.body.macro_round.wins.total,'string');
  const replay=await post(request);
  assert.deepEqual(replay.body,spin.body,'identical retry must not debit twice');
  const pendingWin=Number(spin.body.spin.wins.total);
  const collected=await post({action:'collect',request_id:'3'});
  assert.equal(collected.status,200);
  assert.deepEqual(collected.body.available_actions,['spin']);
  assert.equal(Number(collected.body.balance.after),
    Number((spin.body.balance.after+pendingWin).toFixed(2)),
    'collect credits exactly the pending win');
  const other=await fetch(base,{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({data:JSON.stringify({action:'init'})}),
  });
  const otherData=await other.json();
  assert.equal(otherData.balance.after,100000,'different cookies have isolated credits');
  assert.ok(await other.headers.get('set-cookie'),'anonymous session must have own cookie');
  const bad=await post({action:'spin',bet:-5,lines:5,denomination:1,request_id:'4'});
  assert.equal(bad.status,400);

  // A winning demo spin must offer the ORIGINAL red/black Gamble action.
  // Use the browser protocol and isolated cookie, never the sports wallet.
  let winning=null;
  let nextRequestId=5;
  for(let attempt=0;attempt<600;attempt++){
    const round=await post({action:'spin',bet:1,lines:5,denomination:1,
      request_id:String(nextRequestId++)});
    assert.equal(round.status,200);
    if(Number(round.body.spin.wins.total)>0){winning=round.body;break;}
  }
  assert.ok(winning,'Expected at least one winning demo spin in 600 attempts');
  assert.ok(winning.available_actions.includes('gamble'),'Demo wins must enable Gamble');
  assert.ok(Number(winning.spin.wins.total)>0,'Winning symbols must show positive winnings');
  const initialPending=Number(winning.spin.wins.total);
  const gamble=await post({action:'get_double',request_id:String(nextRequestId++)});
  assert.equal(gamble.status,200);
  assert.ok(gamble.body.available_actions.includes('set_double'));
  assert.equal(Number(gamble.body.gamble.bet),initialPending);
  const balanceBefore=gamble.body.balance.after;
  const gambleChoice=await post({action:'set_double',choice:0,request_id:String(nextRequestId++)});
  assert.equal(gambleChoice.status,200);
  assert.ok(['win','lose'].includes(gambleChoice.body.gamble.status));
  assert.equal(Number(gambleChoice.body.balance.after),balanceBefore,
    'gambling moves only the pending win, never the meter');
  const collectedGamble=await post({action:'collect',request_id:String(nextRequestId++)});
  assert.equal(collectedGamble.status,200);
  assert.deepEqual(collectedGamble.body.available_actions,['spin']);
  assert.equal(Number(collectedGamble.body.collect.total),
    Number(gambleChoice.body.gamble.bet),'collect pays the doubled/forfeited pending win');
  const status=await fetch('http://127.0.0.1:'+server.address().port+
    '/app/api/casino/sizzlinghotdeluxe/status');
  assert.equal((await status.json()).realMoney,false);
  console.log('Original Sizzling demo API: real reel strips, paylines, init, spin, retry, collect, cookies, invalid bet passed');
} finally {
  await new Promise(done=>server.close(done));
}
