/* Wallet integration only. Every visible control and animation belongs to the original client. */
(()=>{
 'use strict';
 const base=new URL('provider-original/9.4.1-fortuneteller.238/',document.baseURI).href;
 const server=new URL('/app/api/casino/original/fortune-teller/native',location.origin).href;
 const sessionId=window.casinoWalletConfig?.nativeSessionId||'wallet';
 const config={gameId:196,pId:12,language:'en_GB',channel:'desktop',deviceType:'desktop',currency:'ALL',sessionId,server,baseURL:base,gameContainer:'gameContainer',defaultProtocol:'http',fps:30,resourceLevel:1,videoLevel:1,
  webp:false,jp2:false,avif:false,showSplash:true,hideExit:true,hideLobby:true,showPoweredBy:true,defaultSound:true,regularSpinTime:2500,denom:'1',lines:20,defaultLimit:1,bgColor:'black',availableModules:[],
  autoSpins:'10,20,50,75,100',defaultAutoSpins:'10',disableHyperSpin:true,useBrowserStorage:0,neverGamble:true,
  historyUrl:location.origin+'/app/transactions',helpUrl:location.origin+'/app/casino-original/fortune-teller/help',
  bundle:{bundle:[['bundleconfig','config_desktop.json'],['featurepreview','featurepreview_bundle.json'],['game','game_bundle.json'],['ui','ui_desktop_bundle.json']].map(([name,file])=>({name,url:'resources/games/videoslot/fortuneteller/'+file})).concat({name:'language',url:'resources/lang/en_GB/locale.json'})}};
 desktop_Entry.start(document.getElementById('gameContainer'),config,{ui:desktop_Entry});
 const runtime=desktop_Entry.walletRuntime(),notify=(type,data={})=>{if(parent!==window)parent.postMessage({type,...data},location.origin);};
 // Fullscreen changes the host iframe, rather than this document's fullscreen
 // element. Reflow the original scene after its container settles, then redraw
 // after layout (the native resize path first renders the previous transforms).
 // Focus also clears the original WebGL buffer, so it needs the same redraw.
 const container=document.getElementById('gameContainer');let layoutFrame=0,layoutRetry=0;
 const requestLayout=()=>{
  if(layoutFrame)return;
  clearTimeout(layoutRetry);
  layoutFrame=requestAnimationFrame(()=>{
   layoutFrame=0;
   if(runtime.game.initializationStage!==3){layoutRetry=setTimeout(requestLayout,100);return;}
   if(document.visibilityState==='hidden'||container.clientWidth===0||container.clientHeight===0)return;
   runtime.resize();
  });
 };
 new ResizeObserver(requestLayout).observe(container);
 window.addEventListener('resize',requestLayout);
 window.addEventListener('focus',requestLayout);
 document.addEventListener('visibilitychange',requestLayout);
 document.addEventListener('fullscreenchange',requestLayout);
 window.addEventListener('pageshow',requestLayout);
 window.addEventListener('message',event=>{
  if(event.source===parent&&event.origin===location.origin&&event.data?.type==='casino:viewport-changed')requestLayout();
 });
 requestLayout();
 const packetKey='fortune-packet:'+sessionId;let start=Date.now();
 try{start=Math.max(start,Number(sessionStorage.getItem(packetKey)||0)+1);}catch{}
 runtime.packetHandler._packetId=start;
 runtime.onClientPacket(event=>{try{sessionStorage.setItem(packetKey,String(Number(event.data.split(/\r?\n/)[0].slice(2))));}catch{}});
 const open=window.open;window.open=function(url,...args){if(String(url).startsWith(config.helpUrl)){runtime.help();return window;}return open.call(this,url,...args);};
 const units=[100,200,500,1000,2000,2500,5000,10000,20000,25000,50000,100000,200000,500000];let adjusting=false,queued=false;
 const constrain=()=>{
  queued=false;
  if(adjusting)return;adjusting=true;
  try{
   const quantity=runtime.bet.coins*runtime.bet.lines;
   const valid=units.filter(value=>value*quantity>=2000&&value*quantity<=500000);
   if(valid.length&&valid.join(',')!==runtime.bet.denominations.join(','))runtime.bet.setDenominations(valid,100);
  }finally{adjusting=false;}
 };
 // The native model reuses its change notification. Wait until its own controls
 // consume that notification before changing the allowed denomination range.
 runtime.bet.addListener(()=>{if(!adjusting&&!queued){queued=true;queueMicrotask(constrain);}});
 runtime.onRoundEnd(()=>{runtime.collect();notify('casino:pending',{amount:0});});
 runtime.onPacket(event=>{if(/^(?:1|52) /m.test(event.data))notify('casino:wallet-updated');});
 window.addEventListener('unhandledrejection',()=>notify('casino:wallet-updated'));
})();
