import {fortuneFixture} from './fixtures/fortune-teller-env.mjs';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import puppeteer from 'puppeteer';
const f=await fortuneFixture(),errors=[],remote=[],artifacts=fileURLToPath(new URL('../test-artifacts/fortune-teller-native/',import.meta.url));let http,browser;
try{
 http=f.app.listen(0,'127.0.0.1');await new Promise(r=>http.once('listening',r));const origin='http://127.0.0.1:'+http.address().port;
 browser=await puppeteer.launch({headless:true});const page=await browser.newPage();await page.setViewport({width:1366,height:900});
 page.on('pageerror',e=>errors.push(e.message));page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith(origin))remote.push(request.url());});
 const launch=async()=>{
  await page.goto(origin);const url=await page.evaluate(async()=>{const r=await fetch('/app/api/casino/original/fortune-teller/session',{method:'POST',headers:{'x-test-player':'isolated-player'}});if(!r.ok)throw Error('Launch failed');return (await r.json()).gameUrl;});
  await page.goto(origin+url);await page.waitForFunction(()=>window.desktop_Entry?.walletRuntime?.().game.initializationStage===3&&desktop_Entry.walletRuntime().round.balance>0,{timeout:30000});
  await new Promise(r=>setTimeout(r,1000));await page.mouse.click(680,770,{delay:80});await new Promise(r=>setTimeout(r,800));
 };
 const state=()=>page.evaluate(()=>{const r=desktop_Entry.walletRuntime();return {bet:r.bet.betAmount,coins:r.bet.coins,lines:r.bet.lines,denom:r.bet.denomination,balance:r.round.balance,win:r.round.win,running:r.round.running};});
 const settled=()=>page.waitForFunction(()=>!desktop_Entry.walletRuntime().round.running,{timeout:30000});
 const balanceIs=async amount=>{await page.waitForFunction(value=>desktop_Entry.walletRuntime().round.balance===Math.round(value*100),{timeout:10000},amount);};
 const click=async(x,y)=>{await page.mouse.click(x,y,{delay:80});await new Promise(r=>setTimeout(r,100));};
 await mkdir(artifacts,{recursive:true});await launch();assert.equal((await state()).balance,1000000);assert.equal(await page.$('select'),null,'original canvas controls replace the handcrafted selector');
 await page.screenshot({path:artifacts+'desktop.png'});
 // Original coin, denomination and line buttons. No synthetic DOM controls.
 await click(740,840);assert.equal((await state()).coins,2);assert.equal((await state()).bet,4000);
 await click(625,840);assert.equal((await state()).coins,1);
 await click(790,840);assert.equal((await state()).lines,19);assert.ok((await state()).bet>=2000,'original bet menu honors total minimum');
 await click(910,840);assert.equal((await state()).lines,20);
 await click(450,840);assert.equal((await state()).denom,100);console.log('PASS native bet controls');
 f.scenario('normal');await click(1110,805);await page.waitForFunction(()=>desktop_Entry.walletRuntime().round.running);
 const during=await page.screenshot();await new Promise(r=>setTimeout(r,200));const later=await page.screenshot();assert.notDeepEqual(during,later,'original reel animation changes rendered frames');
 await page.screenshot({path:artifacts+'spinning.png'});await settled();await balanceIs(9980);assert.equal(await f.count(),1);assert.equal(await f.balance(),9980);console.log('PASS native animated paid spin');
 // Three stages with FOUR original animated cards per stage.
 f.scenario();await click(1110,805);
 for(let stage=0;stage<3;stage++){
  await page.waitForFunction(index=>{const b=desktop_Entry.walletRuntime().bonus();return b.currentStage===index&&b._waitingInteraction;},{timeout:30000},stage);
  if(stage===0)await page.screenshot({path:artifacts+'tarot-four-cards.png'});
  await click(200,590);
 }
 await settled();await balanceIs(9965);assert.equal(await f.balance(),9965);assert.equal(await f.count(),2);console.log('PASS native Tarot');
 // Awarded free spins are requested by the original controller, with one real stake.
 f.scenario('free');await click(1110,805);
 await page.waitForFunction(()=>desktop_Entry.walletRuntime().freespin()._waiter,{timeout:30000});await page.screenshot({path:artifacts+'free-spins-intro.png'});await click(1110,805);
 await page.waitForFunction(()=>desktop_Entry.walletRuntime().bonus()._waitingInteraction,{timeout:30000});
 for(let stage=0;stage<3;stage++){
  await page.waitForFunction(index=>{const b=desktop_Entry.walletRuntime().bonus();return b.currentStage===index&&b._waitingInteraction;},{timeout:30000},stage);await click(200,590);
 }
 await page.waitForFunction(()=>desktop_Entry.walletRuntime().freespin()._waiter,{timeout:110000});await click(1110,805);await settled();
 const expected=10000-60+5+65;await balanceIs(expected);assert.equal(await f.balance(),expected);assert.equal(await f.count(),3);
 for(const [width,height]of [[844,390],[844,320],[390,844]]){
  await page.setViewport({width,height});await new Promise(r=>setTimeout(r,300));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight),'original renderer fits '+width+'x'+height);
  await page.screenshot({path:artifacts+`native-${width}x${height}.png`});
 }
 await page.setViewport({width:1366,height:900});await new Promise(r=>setTimeout(r,500));
 // Reopening during a committed bonus settles the frozen result exactly once.
 f.scenario();await click(1110,805);await page.waitForFunction(()=>desktop_Entry.walletRuntime().round.running);
 await page.waitForFunction(()=>desktop_Entry.walletRuntime().bonus().currentStage===0,{timeout:30000});
 const before=await f.balance();await page.reload();await page.waitForFunction(()=>window.desktop_Entry?.walletRuntime?.().round.balance>0,{timeout:30000});await balanceIs(before+5);assert.equal(await f.balance(),before+5);
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[],'all graphics/audio/animation requests stay on this site');
 console.log('PASS complete original Fortune Teller: native canvas controls, coin/line/denomination selectors, real changing spin frames, three four-card Tarot stages, full 15-free-spin feature, one stake per round, refresh settlement, desktop/mobile, no external services');
}catch(error){
 console.error('Native browser errors:',errors);
 if(browser){const pages=await browser.pages(),page=pages.at(-1);await page.screenshot({path:artifacts+'failure.png'});console.error(await page.evaluate(()=>{const r=window.desktop_Entry?.walletRuntime?.();return r?{coins:r.bet.coins,lines:r.bet.lines,denom:r.bet.denomination,balance:r.round.balance,running:r.round.running}:null;}));}
 throw error;
}finally{if(browser)await browser.close();if(http)await new Promise(r=>http.close(r));await f.close();}
