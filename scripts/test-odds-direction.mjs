import assert from'node:assert/strict';import puppeteer from'puppeteer';import{startPreview,fixtures,writes}from'./zshop-preview-fixture.mjs';
const match=fixtures[3],at=new Date(Date.now()-1000).toISOString();match.markets.push({id:'BB|4|color|market',matchId:'4',name:'Bet Builder: 1X2 + Total Goals',marketType:'OTHER',status:'ACTIVE',period:0,sortOrder:1,builderQuotedAt:at,builderLegs:[{marketId:'4|result|',outcomeId:'4|result||1',odds:5,priceValidUntil:Date.now()+600000},{marketId:'4|goals|3.5',outcomeId:'4|goals|3.5|Over',odds:2.1,priceValidUntil:Date.now()+600000}],outcomes:[{id:'BB|4|color',marketId:'BB|4|color|market',name:'1X2 1 + TOTAL Over 3.5',odds:10.5,status:'ACTIVE',priceValidUntil:Date.now()+600000}]});
let instance,browser;const errors=[];
try{instance=await startPreview();browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.evaluateOnNewDocument(()=>localStorage.setItem('token','fixture'));
 const native='[data-outcome-id="4|result||1"]',combo='[data-outcome-id="BB|4|color"]';
 const send=(price,key='1')=>instance.io.emit('odds:update',{matchId:'4',at:new Date().toISOString(),markets:[{key:'result',line:'',outcomes:[{key,price,suspended:false,priceValidUntil:Date.now()+600000}]}]});
 const reset=()=>page.waitForFunction(selector=>!document.querySelector(selector)?.hasAttribute('data-odds-direction'),{timeout:4500},native);
 for(const width of [1366,390]){
  await page.setViewport({width,height:900});await page.goto(instance.url+'/match/4',{waitUntil:'networkidle0',timeout:60000});await page.waitForSelector(combo);await page.waitForSelector(native);
  assert.equal(await page.$eval(native,e=>e.getAttribute('data-odds-direction')),null,'no flash on initial snapshot');await page.click(native);
  send(6);await page.waitForFunction(selector=>document.querySelector(selector)?.dataset.oddsDirection==='up',{},native);await page.waitForFunction(selector=>getComputedStyle(document.querySelector(selector+' [data-odds-value]')).color==='rgb(48, 209, 88)',{},native);
  assert.equal(await page.$eval(combo,e=>e.dataset.oddsDirection),'up','source price change flashes the synthetic quote too');
  await new Promise(r=>setTimeout(r,1800));send(3.3,'X');send(6);assert.equal(await page.$eval(native,e=>e.dataset.oddsDirection),'up','same-price and other-outcome updates cannot erase flash');await reset();
  assert.ok((await page.$eval(native+' [data-odds-value]',e=>getComputedStyle(e).color)).includes('255, 181, 0'),'selected quote returns to yellow');
  send(4);await page.waitForFunction(selector=>document.querySelector(selector)?.dataset.oddsDirection==='down',{},native);await page.waitForFunction(selector=>getComputedStyle(document.querySelector(selector+' [data-odds-value]')).color==='rgb(255, 69, 58)',{},native);assert.equal(await page.$eval(combo,e=>e.dataset.oddsDirection),'down');await reset();
  assert.ok((await page.$eval(native+' [data-odds-value]',e=>getComputedStyle(e).color)).includes('255, 181, 0'));console.log('PASS odds colors '+width+': initial yellow, rise green, fall red, 3-second reset, selected/native/combo, no reset by unrelated or unchanged prices');
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
}finally{await browser?.close();await instance?.close();}
