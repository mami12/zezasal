import assert from 'node:assert/strict';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import express from 'express';
import puppeteer from 'puppeteer';
import {createServer} from 'vite';

// Real React controls and wallet launcher, using isolated HTTP fixtures only.
const root=fileURLToPath(new URL('../web',import.meta.url));
process.chdir(root);
const definitions=[['lucky-clover-x3','Lucky Clover X3'],['vikings-fun',"Viking's Fun"],['fruit-queen','Fruit Queen'],['seven-hot','Seven Hot'],['sizzling','Sizzling Hot Deluxe'],['bookofra','Book of Ra Deluxe']];
const nativeBounds={'lucky-clover-x3':[2,390],'vikings-fun':[.225,123.95],'fruit-queen':[5,200],'seven-hot':[2,170],sizzling:[.425,100],bookofra:[.225,1002.425]};
const makeGame=([gameId,title])=>({gameId,title,profile:'p95',theoreticalRtp:95,profiles:[{id:'p90',label:'90%',theoreticalRtp:90},{id:'p95',label:'95%',theoreticalRtp:95}],configurationError:null,configurationWarning:null,controls:{mode:'original',rtp:95,hitFrequency:20},effectiveRtp:95,effectiveHitFrequency:null,mathVersion:gameId+'-original',customLimits:{minWinMultiplier:nativeBounds[gameId][0],maxWinMultiplier:nativeBounds[gameId][1]},controlLimits:{rtp:{min:0,max:1000},hitFrequency:{min:0,max:100}}});
const settings={enabled:true,warning:null,games:definitions.map(makeGame),stakeLimits:{min:20,max:5000,currency:'ALL'}};
const html=`<!doctype html><html><body><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';
import CasinoSettings from '/src/components/Admin/CasinoSettings.tsx';
import CasinoOriginalWallet from '/src/pages/CasinoOriginalWallet.tsx';import '/src/index.css';
const root=createRoot(document.getElementById('root'));
window.mountAdmin=()=>root.render(React.createElement(CasinoSettings));
window.mountWallet=(game)=>root.render(React.createElement('div',{className:'casino-game-stage'},React.createElement('div',{className:'casino-game-toolbar'},'Fixture toolbar'),React.createElement('div',{className:'casino-game-content'},React.createElement(CasinoOriginalWallet,{key:game,game}))));
window.mountAdmin();</script></body></html>`;
let server,vite,browser,changeOnSession=false;
const saved=[],sessions=[],errors=[];
const setCustom=(gameId,rtp,hit)=>{
 const game=settings.games.find(item=>item.gameId===gameId);
 Object.assign(game,{controls:{mode:'custom',rtp,hitFrequency:hit},effectiveRtp:rtp,effectiveHitFrequency:hit,mathVersion:gameId+'-custom-'+rtp+'-'+hit});
};
try{
 vite=await createServer({root,configFile:false,cacheDir:fileURLToPath(new URL('../node_modules/.vite-casino-controls',import.meta.url)),plugins:[(await import('@vitejs/plugin-react')).default()],server:{middlewareMode:true,hmr:false,fs:{allow:[fileURLToPath(new URL('..',import.meta.url))]}},appType:'custom',optimizeDeps:{include:['react','react-dom/client','axios','lucide-react']}});
 const app=express();app.use(express.json());
 app.get(['/app/api/admin/casino/settings','/app/api/casino/status'],(_req,res)=>res.json(settings));
 app.get('/app/api/admin/casino/finance',(_req,res)=>res.json({totals:{casinoStake:0,casinoPayout:0,casinoSpins:0}}));
 app.patch('/app/api/admin/casino/controls',(req,res)=>{
  saved.push(req.body);const game=settings.games.find(item=>item.gameId===req.body.gameId);
  if(req.body.mode==='custom')setCustom(game.gameId,req.body.rtp,req.body.hitFrequency);
  else Object.assign(game,{controls:{...req.body},effectiveRtp:game.theoreticalRtp,effectiveHitFrequency:null,mathVersion:game.gameId+'-original'});
  res.json(settings);
 });
 app.patch('/app/api/admin/casino/profile',(req,res)=>{const game=settings.games.find(item=>item.gameId===req.body.gameId);game.profile=req.body.profile;game.theoreticalRtp=game.profiles.find(item=>item.id===req.body.profile).theoreticalRtp;res.json(settings);});
 const session=(gameId,req,res)=>{
  sessions.push({gameId,...req.body});
  if(changeOnSession){changeOnSession=false;setCustom(gameId,75,25);}
  const game=settings.games.find(item=>item.gameId===gameId);
  if(req.body.mathVersion!==game.mathVersion)return res.status(409).json({message:'Game settings changed. Review the current terms.'});
  res.json({ready:true,mathVersion:game.mathVersion,gameUrl:['sizzling','bookofra'].includes(gameId)?'/app/casino-original/'+gameId+'/index-real.html':'/app/api/casino/original/'+gameId+'/launch'});
 };
 for(const [gameId] of definitions){
  const path=gameId==='sizzling'?'/app/api/casino/session':gameId==='bookofra'?'/app/api/casino/bookofra/session':'/app/api/casino/original/'+gameId+'/session';
  app.post(path,(req,res)=>session(gameId,req,res));
 }
 app.post(['/app/api/casino/sizzlinghotdeluxe/real/play','/app/api/casino/bookofra/real/play'],(_req,res)=>res.json({init:{start_symbols:[1,2,3]},balance:{after:1000}}));
 app.get(['/app/api/casino/original/:game/launch','/app/casino-original/:game/index-real.html'],(_req,res)=>res.type('html').send('<!doctype html><html><body style="background:#174"><div id="gameContainer">ISOLATED GAME</div><canvas id="slotCanvas" width="1600" height="900"></canvas></body></html>'));
 app.get('/fixture',async(_req,res,next)=>{try{res.type('html').send(await vite.transformIndexHtml('/fixture',html));}catch(error){next(error);}});
 app.use(vite.middlewares);server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
 const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
 // Speed up only the status refresh in this fixture; real launch uses 30 seconds.
 await page.evaluateOnNewDocument(()=>{const interval=window.setInterval;window.setInterval=(callback,delay,...args)=>interval(callback,delay===30000?200:delay,...args);});
 await page.setViewport({width:1100,height:820});
 await page.goto('http://127.0.0.1:'+server.address().port+'/fixture',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForSelector('article',{timeout:60000});
 const changeSelect=async(selector,value)=>page.select(selector,value);
 const setNumber=async(selector,value)=>{await page.click(selector,{clickCount:3});await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.type(String(value));};
 const clickSave=async(index)=>page.evaluate(index=>document.querySelectorAll('article')[index].querySelector('button').click(),index);
 for(let index=0;index<definitions.length;index++){
  const [gameId,title]=definitions[index];
  await changeSelect(`select[aria-label="${title}: modaliteti"]`,'custom');
  await setNumber(`input[aria-label="${title}: RTP"]`,0);
  assert.equal(await page.$eval(`article:nth-child(${index+1}) button`,element=>element.disabled),true,'inconsistent zero pair cannot be saved');
  await setNumber(`input[aria-label="${title}: Shpeshtësia e fitimit"]`,0);
  await clickSave(index);
  await page.waitForFunction(index=>{const article=document.querySelectorAll('article')[index];return article.textContent.includes('Aktive: E personalizuar')&&!article.querySelector('input').disabled&&article.querySelector('button').disabled;},{timeout:10000},index);
  assert.deepEqual(saved.at(-1),{gameId,mode:'custom',rtp:0,hitFrequency:0});
 }
 assert.equal(saved.length,6,'all six games have independent 0% controls');
 assert.ok((await page.$eval('body',element=>element.textContent)).includes('20.00–5,000 lekë'));

 // All games can reach full hit frequency through an explicit, sufficiently
 // funded RTP choice. An impossible 100/100 pair is explained, never forced.
 for(const [index,[gameId,title]] of definitions.entries()){
  await page.setViewport({width:index%2?320:1366,height:900});
  assert.equal(await page.$eval(`input[aria-label="${title}: RTP"]`,el=>el.max),'1000');
  assert.equal(await page.$eval(`input[aria-label="${title}: Shpeshtësia e fitimit"]`,el=>el.max),'100');
  await setNumber(`input[aria-label="${title}: RTP"]`,100);
  await setNumber(`input[aria-label="${title}: Shpeshtësia e fitimit"]`,100);
  if(nativeBounds[gameId][0]>1){
   assert.equal(await page.$eval(`article:nth-child(${index+1}) button`,el=>el.disabled),true);
   assert.ok((await page.$eval(`article:nth-child(${index+1})`,el=>el.textContent)).includes(`RTP të paktën ${nativeBounds[gameId][0]*100}%`));
  }
  assert.equal(await page.$eval(`input[aria-label="${title}: RTP"]`,el=>el.value),'100','incompatible drafts do not silently raise RTP');
  await setNumber(`input[aria-label="${title}: RTP"]`,600);
  assert.equal(await page.$eval(`article:nth-child(${index+1}) button`,el=>el.disabled),false);
  await clickSave(index);
  await page.waitForFunction(index=>{const article=document.querySelectorAll('article')[index];return article.textContent.includes('RTP 600%')&&article.querySelector('button').disabled&&!article.querySelector('input').disabled;},{timeout:10000},index);
  assert.deepEqual(saved.at(-1),{gameId,mode:'custom',rtp:600,hitFrequency:100});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'extended controls fit mobile and desktop');
 }
 for(const [gameId] of definitions)setCustom(gameId,0,0);
 await page.setViewport({width:1100,height:820});

 // No session, game frame, or paid-round API is opened before custom terms.
 await page.evaluate(()=>window.mountWallet('lucky-clover-x3'));
 await page.waitForSelector('section[aria-label="Kushtet e lojës"]');
 assert.equal(sessions.length,0);assert.equal(await page.$('iframe'),null);
 assert.ok((await page.$eval('body',element=>element.textContent)).includes('Çdo bast i ri do të humbet.'));
 await page.click('section[aria-label="Kushtet e lojës"] button');
 await page.waitForSelector('iframe');
 assert.equal(sessions.at(-1).mathVersion,'lucky-clover-x3-custom-0-0');
 const bounds=await page.$eval('iframe',element=>{const r=element.getBoundingClientRect(),parent=element.closest('.casino-game-content').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,parent:{x:parent.x,y:parent.y,right:parent.right,bottom:parent.bottom}};});
 assert.ok(bounds.x>=bounds.parent.x-1&&bounds.y>=bounds.parent.y-1&&bounds.right<=bounds.parent.right+1&&bounds.bottom<=bounds.parent.bottom+1,'game remains within space reserved below terms');
 setCustom('lucky-clover-x3',50,25);
 await page.waitForFunction(()=>document.body.textContent.includes('Cilësimet ndryshuan · Kontrolloji para rrotullimit tjetër me pagesë'));
 assert.ok(await page.$('iframe'),'changed settings preserve the accepted frame for owed bonus/collect');
 await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Cilësimet ndryshuan')).click());
 await page.waitForSelector('section[aria-label="Kushtet e lojës"]');
 assert.ok((await page.$eval('body',element=>element.textContent)).includes('50%'));
 assert.equal(await page.$('iframe'),null);
 changeOnSession=true;
 await page.click('section[aria-label="Kushtet e lojës"] button');
 await page.waitForSelector('p[role="alert"]');
 assert.equal(await page.$('iframe'),null,'racing settings update cannot launch under stale acknowledgement');
 await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Rilidhu')).click());
 await page.waitForSelector('section[aria-label="Kushtet e lojës"]');
 assert.ok((await page.$eval('body',element=>element.textContent)).includes('75%'));
 await page.click('section[aria-label="Kushtet e lojës"] button');await page.waitForSelector('iframe');
 assert.equal(sessions.at(-1).mathVersion,'lucky-clover-x3-custom-75-25');

 // All original cabinets also receive the disclosed version and bet limits.
 for(const [gameId,title] of definitions){
  const game=settings.games.find(item=>item.gameId===gameId);game.controls.mode='original';game.effectiveRtp=95;game.effectiveHitFrequency=null;game.mathVersion=gameId+'-original';
  if(gameId==='lucky-clover-x3'){await page.evaluate(()=>window.mountAdmin());await page.waitForSelector('article');}
  await page.evaluate(gameId=>window.mountWallet(gameId),gameId);await page.waitForSelector(`iframe[title="${title} · bilanci i llogarisë"]`);
  assert.equal(sessions.at(-1).gameId,gameId);assert.equal(sessions.at(-1).mathVersion,gameId+'-original');
  assert.equal(await page.$('section[aria-label="Kushtet e lojës"]'),null);
  assert.ok((await page.$eval('body',element=>element.textContent)).includes('Basti: 20.00–5,000 lekë'));
 }
 // Compact in-game information keeps the canvas clear and remains available
 // without reconnecting or changing the accepted session on all six adapters.
 for(const [index,[gameId]] of definitions.entries()){
  await page.setViewport({width:[320,390,1366][index%3],height:820});
  setCustom(gameId,8.28,10);
  await page.evaluate(gameId=>window.mountWallet(gameId),gameId);
  await page.waitForSelector('section[aria-label="Kushtet e lojës"]');
  const intro=await page.$eval('section[aria-label="Kushtet e lojës"]',element=>({text:element.textContent,detailsOpen:element.querySelector('details').open}));
  assert.ok(intro.text.includes('8.28%')&&intro.text.includes('10%'));
  assert.equal(intro.detailsOpen,false,'long explanation stays collapsed');
  await page.click('section[aria-label="Kushtet e lojës"] button');await page.waitForSelector('iframe');
  const frameUrl=await page.$eval('iframe',element=>element.src),sessionCount=sessions.length;
  const bar=await page.$eval('.casino-session-terms',element=>element.textContent);
  assert.ok(!bar.includes('8.28%')&&!bar.includes('Shpeshtësia'),'no repeated numeric badge during play');
  await page.click('button[aria-haspopup="dialog"]');
  await page.waitForSelector('section[role="dialog"]');
  const info=await page.$eval('section[role="dialog"]',element=>({text:element.textContent,rect:element.getBoundingClientRect().toJSON(),width:innerWidth}));
  assert.ok(info.text.includes('8.28%')&&info.text.includes('10%')&&info.text.includes('RTP origjinale e ofruesit nuk zbatohet'));
  assert.ok(info.rect.left>=0&&info.rect.right<=info.width,'information fits phone and desktop');
  await page.click('section[role="dialog"] summary');
  assert.equal(await page.$eval('section[role="dialog"] details',element=>element.open),true);
  await page.keyboard.press('Escape');await page.waitForSelector('section[role="dialog"]',{hidden:true});
  assert.equal(await page.$eval('button[aria-haspopup="dialog"]',element=>document.activeElement===element),true);
  assert.equal(await page.$eval('iframe',element=>element.src),frameUrl);assert.equal(sessions.length,sessionCount);
 }
 assert.deepEqual(errors,[]);
 console.log('casino controls browser: six0% settings, above100% RTP/100% hit on all six, impossible-pair guidance/no silent adjustment, mobile/desktop fit, disclosure/version race/bonus preservation and all six launch contracts PASS');
}finally{
 await browser?.close();await vite?.close();
 if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
}

