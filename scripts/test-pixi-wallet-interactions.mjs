import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import express from 'express';
import puppeteer from 'puppeteer';
import jwt from 'jsonwebtoken';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {config} from '../server/config.mjs';
import {originalClientShell} from '../server/casino/original-client-shell.mjs';
import {createSizzlingRealRouter} from '../server/casino/sizzling-real.mjs';
import {createBookOfRaRealRouter,freespinResponse,initResponse as bookInit} from '../server/casino/bookofra.mjs';

// Actual pinned browser bundles and real HTTP adapters; disposable test funds
// are supplied via the router's existing dependency boundary, never a live DB.
const app=express(),state={balance:1000,spins:[],pending:0};
const grid=Array.from({length:5},(_,x)=>Array.from({length:3},(_,y)=>1+(x+y)%7));
const symbols=Object.fromEntries(grid.map((column,x)=>[x,Object.fromEntries(column.map((code,y)=>[y,{code}]))]));
const user=async()=>({id:'test-only',role:'PLAYER',status:'ACTIVE',balance:state.balance});
const place=async args=>{
 state.spins.push(args);await new Promise(resolve=>setTimeout(resolve,500));
 const stake=Number((args.bet*args.lines*args.denomination).toFixed(2));state.balance=Number((state.balance-stake).toFixed(2));
 return {balance:state.balance,stake,payout:0,grid,graded:{line_wins:[],total:0},result:{symbols,line_wins:[]},free:null};
};
const dependencies={isLedgerReady:()=>true,getUserById:user,settlePendingWin:async()=>state.balance,placeCasinoSpin:place,placeBookOfRaSpin:place,bookOfRaFreeState:async()=>null};
app.use('/app/api/casino/sizzlinghotdeluxe/real',createSizzlingRealRouter(dependencies));
app.use('/app/api/casino/bookofra/real',createBookOfRaRealRouter(dependencies));
for(const id of ['sizzling','bookofra'])app.get(`/app/casino-original/${id}/index-real.html`,(_req,res)=>res.type('html').send(originalClientShell(readFileSync(`web/public/casino-original/${id}/index-real.html`,'utf8'),`/app/casino-original/${id}/`,{game:id})));
app.use('/app',express.static('web/public'));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const origin='http://127.0.0.1:'+server.address().port;let browser;
try{
 browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
 for(const id of ['sizzling','bookofra']){
  state.balance=1000;state.spins=[];
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewport({width:1024,height:768});
  // Capture the actual native text checkers, rather than a duplicate renderer.
  await page.evaluateOnNewDocument(()=>document.addEventListener('load',()=>{
   for(const type of Object.values(window.game?.subControllers||{})){
    const proto=type?.prototype,setup=proto?._setUpCheckers;if(typeof setup!=='function'||setup.__testCaptured)continue;
    const captured=function(...args){const answer=setup.apply(this,args);window.__walletCheckers=this;return answer;};captured.__testCaptured=true;proto._setUpCheckers=captured;
   }
  },true));
  const name=id==='sizzling'?'casino_pixi_wallet_session':'casino_bookofra_session',kind=id==='sizzling'?'casino-pixi-wallet':'casino-bookofra-wallet';
  await page.setCookie({name,value:jwt.sign({sub:'test-only',jti:randomUUID(),kind},config.jwtSecret),url:origin});
  await page.goto(origin+`/app/casino-original/${id}/index-real.html`,{waitUntil:'domcontentloaded'});
  try{await page.waitForFunction(()=>window.__walletCheckers?._text_checkers&&window.c2d?.env?.screenParams?.canvasScaleCoef>0&&!document.querySelector('#preloaderContainer'),{timeout:60000});}
  catch(error){console.error(id,errors,await page.evaluate(()=>({loader:document.querySelector('#preloaderText')?.textContent,subs:Object.entries(window.game?.subControllers||{}).map(([key,type])=>[key,Object.getOwnPropertyNames(type?.prototype||{})]),captured:!!window.__walletCheckers,body:document.body.innerText.slice(0,400)})));throw error;}
  const initial=await page.evaluate(()=>{const c=window.__walletCheckers;return{balance:c.checkText('GET_CREDIT_AFTER_AMOUNT'),total:c.checkText('GET_TOTAL_BET'),unit:c.slots.model.denomination};});
  assert.equal(initial.balance,'1000.00',`${id} displays account currency instead of coin credits`);assert.equal(initial.total,'0.20');
  await page.waitForFunction(()=>window.__walletCheckers.state?.btn_spin?.enabled===true&&window.__walletCheckers.state.btn_spin.visible!==false,{timeout:20000});
  const press=async()=>{
   const point=await page.evaluate(()=>{const p=c2d.env.screenParams,r=document.querySelector('#slotCanvas').getBoundingClientRect();return{x:r.x+(1570+p.paddingLeft)*p.canvasScaleCoef/p.pixelRatio,y:r.y+(1025+p.paddingTop)*p.canvasScaleCoef/p.pixelRatio};});
   await page.mouse.click(point.x,point.y);
  };
  await page.evaluate(()=>{window.__quickStops=[];document.addEventListener(c2d.documentEvents.TIMESCALE_WAS_CHANGED,e=>window.__quickStops.push(e.detail?.timescale));});
  await press();await press();
  await page.waitForFunction(()=>Number(window.__walletCheckers.slots.model._balanceAfter)<1000,{timeout:10000});
  assert.equal(state.spins.length,1,`${id}: rapid double Start sends one paid spin`);assert.equal(state.balance,999.8);
  assert.equal(await page.evaluate(()=>window.__walletCheckers.checkText('GET_CREDIT_AFTER_AMOUNT')),'999.80');
  assert.equal(state.spins.length,1,'rapid second Start never becomes an extra wager');

  // Parse a fractional-currency win through the original native parser and
  // apply it to its actual model. No collect has credited the account yet.
  const pending=await page.evaluate(({symbols,id})=>{
   const controller=window.__walletCheckers,model=controller.slots.model,unit=model.denomination;
   const payload={balance:{before:1000,after:999.8},denomination:id==='bookofra'?1:unit,available_actions:['collect','gamble','spin'],macro_round:{wins:{total:'0.12'}},spin:{bet:1,lines:id==='sizzling'?5:10,multiplier:1,next_multiplier:1,type:'spin',next_request_id:8,symbols,wins:{total:'0.12',line_wins:[{idx:0,code:7,pos:[[0,1],[1,1]],multiplier:2,amount:'0.12',type:'basic',extra:{}}]}}};
   const parsed=game.src.Network.Parsers.ResponseParser.parse(payload);model.setData(parsed);
   const before={unit:model.denomination,pending:parsed.nonCollectedWins,winCash:parsed.spinData.totalWin*unit,lineCash:parsed.spinData.lineWins[0].amount*unit,balance:controller.checkText('GET_CREDIT_AFTER_AMOUNT'),total:controller.checkText('GET_TOTAL_BET')};
   const collected=game.src.Network.Parsers.ResponseParser.parse({balance:{before:999.8,after:999.92},denomination:1,available_actions:['spin'],macro_round:{wins:{total:'0'}},collect:{total:'0.12'}});model.setData(collected);
   return {before,after:controller.checkText('GET_CREDIT_AFTER_AMOUNT')};
  },{symbols,id});
  assert.equal(pending.before.unit,initial.unit);assert.equal(pending.before.pending,.12);assert.equal(pending.before.winCash,.12);assert.equal(pending.before.lineCash,.12);assert.equal(pending.before.balance,'999.80','pending award is separate from cash');assert.equal(pending.after,'999.92','cash increases only after Collect');
  if(id==='bookofra'){
   const payload=freespinResponse({credits:999.92,payout:.4,bet:1,lines:10,grid,grading:{total:0,line_wins:[]},left:8,done:2,mud:1,requestId:9});
   const restore={...bookInit({credits:999.92,requestId:10,walletLimits:true}),available_actions:['freespin'],initfreespin:{symbols,freespins:{left:8,done:2,add:0,mud:1,wins:{total:.4,win_before_chain:0},type:'freespins'}}};
   const counters=await page.evaluate(({payload,restore})=>{
    let owner=c2d.env;while(owner&&!Object.getOwnPropertyDescriptor(owner,'isDesktop'))owner=Object.getPrototypeOf(owner);
    const descriptor=Object.getOwnPropertyDescriptor(owner,'isDesktop'),answers=[];
    try{for(const desktop of [true,false]){
     Object.defineProperty(owner,'isDesktop',{configurable:true,get:()=>desktop});
     const parsed=game.src.Network.Parsers.ResponseParser.parse(payload),fs=parsed.spinData.freespins,factor=desktop?parsed.denomination:1;
     const resumed=game.src.Network.Parsers.ResponseParser.parse(restore),bonus=resumed.initFreespinData.freespins;
     answers.push({desktop,actualDesktop:c2d.env.isDesktop,left:fs?.leftCount,done:fs?.doneCount,current:parsed.spinData.totalWin*factor,total:fs?.totalWins*factor,pending:parsed.nonCollectedWins,restored:bonus.totalWins*factor,restoredLeft:bonus.leftCount});
    }}finally{Object.defineProperty(owner,'isDesktop',descriptor);}
    return answers;
   },{payload,restore});
   for(const result of counters)assert.deepEqual(result,{desktop:result.desktop,actualDesktop:result.desktop,left:8,done:2,current:0,total:.4,pending:.4,restored:.4,restoredLeft:8},'actual native parser consumes live/restored FS counters and does not animate prior pending as a new win');
  }
  assert.deepEqual(errors,[]);
  console.log(`PASS ${id}: actual native loader, .20 total, account currency, delayed double Start, fractional win and line win, preserved denomination and balance before/after Collect`);
  await page.close();
 }
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
