// Wallet presentation/transport adapter. Archived provider sources and math stay unchanged.
(()=>{
 const config=window.casinoWalletConfig||{};
 const embedded=window.parent!==window;
 const notify=(type,data={})=>{if(embedded)window.parent.postMessage({type,...data},window.location.origin);};
 let pending=0;
 let pixiUnit=0,pixiCash=0,pixiAwaitingSpin=false;
 function pixiResponse(data){
  const unit=data.init?Number(data.denomination):(pixiUnit||Number(data.denomination)||1);
  if(!(unit>0)||!data.balance)return {data,pending:0};
  pixiUnit=unit;
  pixiCash=Number(data.balance.after);
  if(data.spin)pixiAwaitingSpin=false;
  const result=JSON.parse(JSON.stringify(data)),credits=value=>Number((Number(value)/unit).toFixed(8));
  result.denomination=unit;
  const wins=value=>{
   if(!value)return;
   for(const key of ['total','win_before_chain','win_before_bonus'])if(value[key]!=null)value[key]=credits(value[key]);
   for(const line of Object.values(value.line_wins||{}))if(line.amount!=null)line.amount=credits(line.amount);
  };
  for(const spin of [result.spin,result.initspin,result.initfreespin])if(spin){wins(spin.wins);wins(spin.freespins?.wins);}
  wins(result.freespins?.wins);wins(result.macro_round?.wins);
  if(result.gamble)for(const key of ['start_bet','bet','win'])if(result.gamble[key]!=null)result.gamble[key]=credits(result.gamble[key]);
  if(result.collect?.total!=null)result.collect.total=credits(result.collect.total);
  const amount=Number(data.macro_round?.wins?.total??data.freespins?.wins?.total??data.initfreespin?.freespins?.wins?.total??data.gamble?.bet??0);
  // The native model expects the post-collect balance and subtracts the pending
  // award while the reels/count-up run. The ledger endpoint reports cash that
  // has actually been credited. Adapt presentation only; no wallet writes.
  result.balance.after=Number((Number(result.balance.after)+amount).toFixed(2));
  notify('casino:pending',{amount});
  return {data:result,pending:amount};
 }
 // A fast second press can otherwise enter the original controller before its
 // first response changes the Start button to Stop. Never queue a second wager.
 const accepted=new Set(),blocked=new Set();
 const guard=event=>{
  const type=event.type,key=type.startsWith('key')?'key:'+event.key:type.startsWith('pointer')?'pointer:'+event.pointerId:type.startsWith('touch')?'touch':'mouse';
  const down=['pointerdown','mousedown','touchstart','keydown'].includes(type),up=['pointerup','pointercancel','mouseup','touchend','touchcancel','keyup'].includes(type);
  if(type.startsWith('key')&&![' ','Space','Spacebar','Enter','ArrowUp','ArrowDown'].includes(event.key))return;
  if(up){
   // Let the first accepted gesture release its native pressed state. A new
   // rejected gesture must also lose its release-only handler, even if the
   // HTTP request completes between its down and up events.
   if(blocked.delete(key)){accepted.delete(key);event.preventDefault();event.stopImmediatePropagation();return;}
   if(accepted.delete(key))return;
  }
  if(!pending){if(down){blocked.delete(key);accepted.add(key);}return;}
  if(down)blocked.add(key);
  event.preventDefault();event.stopImmediatePropagation();
 };
 for(const name of ['pointerdown','pointerup','pointercancel','mousedown','mouseup','touchstart','touchend','touchcancel','click','dblclick','keydown','keyup'])
  window.addEventListener(name,guard,{capture:true,passive:false});

 const installed=new WeakSet(),watched=new WeakSet();
 function presentation(){
  // The desktop cabinet's default text checkers show credits (balance / coin
  // value). A real-money wallet must show currency, including two decimal
  // places, while the underlying native bet/line/coin controls retain units.
  if(['sizzling','bookofra'].includes(config.game)){
   const moneyKeys=new Set(['GET_LAST_WIN','GET_ALL_LINES_WIN_AMOUNT','GET_ONLY_LINES_WIN','GET_ONLY_SCATTERS_WIN','GET_GAMBLE_TOTAL_WIN','GET_NOT_PAID_WIN_CREDIT','GET_CURRENT_LINE_WIN_AMOUNT','GET_CURRENT_WIN_TEXT','GET_CURRENT_LINES_WIN_AMOUNT_NUMBER','GET_CURRENT_LINES_WIN_AMOUNT','GET_DROPS_WIN','GET_DROPS_PREVIOUS_WIN','GET_FREESPINS_DROP_WINS','GET_FREESPINS_WINS_BEFORE_DROP','GET_CHAIN_BEFORE_RESPIN_WIN','GET_WINNER_FIELD_VALUE','GET_BONUS_TEMP_TOTAL_WINS','GET_BONUS_TOTAL_WINS','GET_PAYTABLE_WINS','GET_GAMBLE_FUTURE_WIN','GET_FREESPINS_TOTAL_WINS','GET_FREESPINS_MUD_WIN_AMOUNT','GET_PREVIOUS_WIN']);
   for(const controller of Object.values(window.game?.subControllers||{})){
    const proto=controller?.prototype,check=proto?.checkText;
    if(typeof check!=='function'||installed.has(check))continue;
    const wrapped=function(key,...args){
     const model=this.slots?.model,cash=value=>Number(value).toFixed(2);
     if(['GET_CREDIT_AMOUNT','GET_CREDIT_AFTER_AMOUNT','GET_CASH_AMOUNT','GET_CASH_AFTER_AMOUNT'].includes(key))return cash(pixiCash);
     if(['GET_CREDIT_AFTER_SPIN_AMOUNT','GET_CASH_AFTER_SPIN_AMOUNT'].includes(key))return cash(pixiAwaitingSpin?pixiCash-model.totalBetCash:pixiCash);
     if(key==='GET_TOTAL_BET')return cash(model.totalBetCash);
     if(key==='GET_BET_PER_LINE')return cash(model.bet*model.denomination);
     const value=check.call(this,key,...args);
     // Native winner/bonus helpers perform arithmetic by calling each other
     // directly. Keep those units intact and convert only the final text.
     const fs=model?.freespins,collect=model?.collect;
     const winnerUsesCredits=key==='GET_WINNER_FIELD_VALUE'&&!collect?.isCollected&&!(fs?.isActiveStatus&&(fs.isPlayStatus||fs.isFinishStatus))&&(this.slots?.lines?.linesShowloopID!==0||collect?.isCollecting);
     const factor=(key==='GET_NOT_PAID_WIN_CREDIT'||winnerUsesCredits||window.c2d?.env?.isDesktop)?(model?.denomination||1):1;
     return moneyKeys.has(key)?String(value).replace(/(-?\d+(?:\.\d+)?)$/,amount=>cash(Number(amount)*factor)):value;
    };
    installed.add(wrapped);proto.checkText=wrapped;
   }
   const view=window.game?.src?.BigWin?.View?.prototype;
   for(const key of ['_countWinAmount','onCollectUpdate']){
    const original=view?.[key];if(typeof original!=='function'||installed.has(original))continue;
    const wrapped=function(value,...args){
     const factor=window.c2d?.env?.isDesktop?pixiUnit:1;
     if(key==='_countWinAmount')return original.call(this,{...value,startVal:Number(value.startVal)*factor,finishVal:Number(value.finishVal)*factor,decimals:2},...args);
     const result=original.call(this,value,...args);
     if(this._totalWinSum)this._totalWinSum.text=(Number(value)*factor).toFixed(2);
     return result;
    };
    installed.add(wrapped);view[key]=wrapped;
   }
  }
  const parser=window.game?.src?.Network?.Parsers?.ResponseParser;
  if(['sizzling','bookofra'].includes(config.game)&&parser&&typeof parser.parse==='function'&&!installed.has(parser.parse)){
   const original=parser.parse;
   const parse=function(data){
    const normalized=pixiResponse(data),parsed=original.call(this,normalized.data);
    // The archived mobile postprocessor handles spinData but omits the
    // separate restored-bonus structure. Its parser still consumes credits.
    if(!window.c2d?.env?.isDesktop&&parsed.initFreespinData){
     const restore=parsed.initFreespinData,unit=normalized.data.denomination;
     const amount=value=>Number((Number(value)*unit).toFixed(3));
     for(const key of ['lineWins','scatterWins','wayWins'])for(const win of restore[key]||[])if(win.amount!=null)win.amount=amount(win.amount);
     if(restore.totalWin!=null)restore.totalWin=amount(restore.totalWin);
     const fs=restore.freespins;
     if(fs){
      for(const key of ['totalWins','winsBefore'])if(fs[key]!=null)fs[key]=amount(fs[key]);
      for(const win of fs.mudWins||[])if(win.amount!=null)win.amount=amount(win.amount);
      for(const line of fs.mudLines||[])for(const win of line)if(win.amount!=null)win.amount=amount(win.amount);
     }
    }
    // The archived macro parser uses parseInt, which truncates fractional
    // credit wins. Pending cash has already been rounded by the ledger.
    parsed.nonCollectedWins=normalized.pending;
    return parsed;
   };
   installed.add(parse);parser.parse=parse;
  }
  const original=window.ammountString;
  if(typeof original==='function'&&!installed.has(original)){
   // The CT renderer uses cents % 100 and concatenates it as text. Fractional
   // credit units must first be rounded to the wallet's whole-cent precision.
   const format=function(cents){return original.call(this,Math.round(Number(cents)));};
   installed.add(format);window.ammountString=format;
  }
  if(!['lucky-clover-x3','vikings-fun'].includes(config.game)||!window.MutationObserver)return;
  // Use the provider's own total-stake renderer. Keep credit units and wager
  // commands unchanged; only the confusing per-line labels become totals.
  const total=()=>{
   if(!window._CTSlotApp||!Number.isFinite(window.currTotalBet))return;
   for(const [selector,render] of [['#frameGameName',window.replaceLineBetWithTotalBet],['#betNumber .menu_string1',window.replaceAllHtmlWithTotalBet]]){
    const element=document.querySelector(selector);
    if(!element||typeof render!=='function')continue;
    if(!watched.has(element)){
     watched.add(element);new MutationObserver(()=>render(element)).observe(element,{childList:true,subtree:true,characterData:true});
    }
    render(element);
   }
   const line=document.querySelector('#frameBetLabel');
   if(line&&!watched.has(line)){watched.add(line);line.style.visibility='hidden';}
   const label=document.querySelector('#betNumber .menu_string2');
   if(label&&label.textContent!=='TOTAL BET')label.textContent='TOTAL BET';
  };
  total();
 }
 // Dynamic assembler scripts can declare globals after DOMContentLoaded.
 document.addEventListener?.('load',presentation,true);
 document.addEventListener?.('DOMContentLoaded',presentation);
 if(window.MutationObserver&&document.documentElement)new MutationObserver(presentation).observe(document.documentElement,{childList:true,subtree:true});
 presentation();
 if(embedded){
  const fullscreen=()=>{notify('casino:fullscreen');return Promise.resolve();};
  for(const name of ['requestFullscreen','webkitRequestFullscreen','webkitRequestFullScreen','requestFullScreen','mozRequestFullScreen']){
   try{Object.defineProperty(Element.prototype,name,{configurable:true,writable:true,value:fullscreen});}catch{}
  }
  // Provider Exit links are handled by the same visible Back control.
  window.addEventListener('message',event=>{
   if(event.source===window&&event.origin===location.origin&&event.data?.type==='casino:exit')notify('casino:exit');
  });
 }
 {
  const open=XMLHttpRequest.prototype.open;
  const send=XMLHttpRequest.prototype.send;
  const retryIds=new Map();
  XMLHttpRequest.prototype.open=function(method,url,...rest){
   const target=new URL(String(url),document.baseURI);
   this.__casinoRetry=null;
   this.__casinoWallet=target.origin===location.origin&&/^\/app\/api\/casino\//.test(target.pathname);
   this.__casinoMutating=false;this.__casinoNotify=false;
   if(this.__casinoWallet){
    const action=target.searchParams.get('action');
    this.__casinoMutating=['spin','freespin','double','save'].includes(action);
    this.__casinoNotify=this.__casinoMutating||action==='start';
    try{
     const commands=JSON.parse(target.searchParams.get('request'));
     if(Array.isArray(commands)){
      this.__casinoMutating=commands.some(command=>['play','continue','game_finished'].includes(command.command));
      this.__casinoNotify=this.__casinoMutating||commands.some(command=>command.command==='create_session');
     }
    }catch{/* Other protocol URLs have no CT command list. */}
   }
   if(config.agtApi&&target.origin===location.origin&&target.pathname==='/app/api/casino/agt/dinit.php'){
    target.pathname=config.agtApi;
    if(['spin','freespin','double','save'].includes(target.searchParams.get('action'))){
     const fingerprint=target.pathname+'?'+['action','gamename','li','di','amount','color'].map(key=>key+'='+target.searchParams.get(key)).join('&');
     const entry=retryIds.get(fingerprint)||{requestId:crypto.randomUUID(),active:0,definitive:false};
     retryIds.set(fingerprint,entry);
     this.__casinoRetry={fingerprint,entry};
     target.searchParams.set('request_id',entry.requestId);
    }
    url=target.href;
   }
   return open.call(this,method,url,...rest);
  };
  if(send)XMLHttpRequest.prototype.send=function(...args){
   if(!this.__casinoWallet)return send.apply(this,args);
   if(['sizzling','bookofra'].includes(config.game)){
    try{
     const body=args[0],request=JSON.parse(typeof body?.get==='function'?body.get('data'):String(body));
     this.__casinoMutating=['spin','freespin','collect','get_double','set_double'].includes(request.action);
     this.__casinoNotify=this.__casinoMutating||request.action==='init';
     if(['spin','freespin'].includes(request.action)&&Number(request.denomination)>0){pixiUnit=Number(request.denomination);pixiAwaitingSpin=request.action==='spin';}
    }catch{/* Other provider transports do not send a Pixi FormData body. */}
   }
   const locked=this.__casinoMutating,retry=this.__casinoRetry,notifyWallet=this.__casinoNotify;
   if(locked)pending++;
   if(retry)retry.entry.active++;let complete=false;
   const finish=()=>{
    if(complete)return;complete=true;if(locked)pending=Math.max(0,pending-1);
    if(retry){
     const entry=retry.entry;entry.active=Math.max(0,entry.active-1);
     if(this.status>=200&&this.status<500)entry.definitive=true;
     if(entry.definitive&&!entry.active&&retryIds.get(retry.fingerprint)===entry)retryIds.delete(retry.fingerprint);
    }
    // The parent fetches the authenticated account; replayed provider replies
    // cannot overwrite it with an old response's balance.
    if(notifyWallet&&!pending)notify('casino:wallet-updated');
   };
   this.addEventListener('loadend',finish,{once:true});
   try{return send.apply(this,args);}catch(error){finish();throw error;}
  };
 }
})();
