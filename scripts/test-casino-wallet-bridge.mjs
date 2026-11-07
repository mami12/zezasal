import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const bridge=readFileSync(new URL('../web/public/casino-original/wallet-bridge.js',import.meta.url),'utf8');
function fixture(config={}){
 const events=new Map(),docEvents=new Map(),messages=[];let ids=0;
 class XHR {
  constructor(){this.events=new Map();this.status=0;}
  open(method,url){this.method=method;this.url=url;}
  send(){this.sent=true;}
  addEventListener(name,fn){this.events.set(name,fn);}
  finish(status=200){this.status=status;this.events.get('loadend')?.();}
 }
 class Element{}
 const origin='https://wallet.example';
 const browser={casinoWalletConfig:config,location:{origin},parent:{postMessage:(payload,target)=>messages.push({payload,target})},
  addEventListener:(name,fn)=>events.set(name,fn),Element,XMLHttpRequest:XHR,URL,Promise,WeakSet,Math,Number,
  crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++ids).padStart(12,'0')}`},
  document:{baseURI:origin+'/app/casino-original/sizzling/',addEventListener:(name,fn)=>docEvents.set(name,fn)}};
 browser.window=browser;
 const context=vm.createContext(browser);vm.runInContext(bridge,context);
 return {context,events,docEvents,messages,XHR,origin};
}

// Exercise the original archived amount/cash renderers, including fractional
// cents. The old implementation produced e.g. "0.00.8" and long float tails.
for(const [id,unit,lines] of [['lucky-clover-x3',4,5],['vikings-fun',.8,25]]){
 const source=readFileSync(new URL(`../web/public/casino-original/${id}/vendor/html-20200413-stable/rgs/second2.min.js`,import.meta.url),'utf8');
 const parsed=ts.createSourceFile('native.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const named=name=>{let result;for(const statement of parsed.statements)if(ts.isFunctionDeclaration(statement)&&statement.name?.text===name)result=statement.getText(parsed);assert(result,name);return result;};
 const f=fixture();Object.assign(f.context,{digits_after_decimal_separator:2,currSession:{use_currency_locale:1},playerAccount:{decimal_separator:'.',thousands_separator:','},CurrencySign:'',cashOnly:true,currDenom:{cents:unit},cashReg:''});
 vm.runInContext(named('ammountString')+';'+named('addThousendSeparators'),f.context);
 const cash=source.match(/this\.cash=(function\(e,t\)\{return t\|cashOnly\?ammountString\(e\*currDenom\.cents\)\+cashReg:addThousendSeparators\(e\)\})/);
 assert(cash);f.context.cash=vm.runInContext('('+cash[1]+')',f.context);
 f.docEvents.get('load')();
 assert.equal(f.context.cash(lines),'0.20');
 assert.equal(f.context.cash(500*lines),'100.00');
 assert.equal(f.context.cash(25000*lines),'5,000.00');
 assert.equal(f.context.cash(99999/unit),'999.99');
 assert.equal(f.context.cash(6/unit),'0.06');
 assert.equal(f.context.ammountString(20.000000000000004),'0.20');
 f.docEvents.get('load')();assert.equal(f.context.cash(500*lines),'100.00','repeated dynamic loads do not stack formatting side effects');
}

const f=fixture({agtApi:'/app/api/casino/original/fruit-queen/dinit.php'});
const stopped=type=>{const event={type,key:' ',blocked:false,preventDefault(){this.blocked=true;},stopImmediatePropagation(){this.stopped=true;}};f.events.get(type)(event);return event.blocked;};
assert.equal(stopped('pointerdown'),false);
const request=new f.XHR();request.open('GET','/app/api/casino/agt/dinit.php?action=spin&gamename=fruitqueen&li=18&di=1&amount=100');request.send();
const key=new URL(request.url).searchParams.get('request_id');
assert(key);for(const type of ['pointerdown','mousedown','touchstart','click','dblclick','keydown','pointerup','mouseup','touchend','keyup'])assert.equal(stopped(type),true,`${type} cannot start a second wager while transport is pending`);
request.finish();assert.equal(stopped('pointerdown'),false,'Stop/quick-spin remains available immediately after response');
assert.equal(f.messages.at(-1).payload.type,'casino:wallet-updated');assert.equal(f.messages.at(-1).target,f.origin);
const failed=new f.XHR();failed.open('GET','/app/api/casino/agt/dinit.php?action=spin&gamename=fruitqueen&li=18&di=1&amount=100');failed.send();failed.finish(0);
const failedKey=new URL(failed.url).searchParams.get('request_id');assert.notEqual(key,failedKey,'a new user spin gets a new id');
const retry=new f.XHR();retry.open('GET','/app/api/casino/agt/dinit.php?action=spin&gamename=fruitqueen&li=18&di=1&amount=100&cachebust=123');retry.send();
assert.equal(new URL(retry.url).searchParams.get('request_id'),failedKey,'a transport retry cannot double-charge a committed but lost response');
retry.finish();assert.equal(stopped('click'),false);
// The provider can retry inside onerror, before the old attempt's loadend.
const first=new f.XHR();first.open('GET','/app/api/casino/agt/dinit.php?action=spin&gamename=fruitqueen&li=18&di=1&amount=100');first.send();
const early=new f.XHR();early.open('GET','/app/api/casino/agt/dinit.php?action=spin&gamename=fruitqueen&li=18&di=1&amount=100');early.send();
assert.equal(new URL(early.url).searchParams.get('request_id'),new URL(first.url).searchParams.get('request_id'));
early.finish(200);first.finish(0);
const next=new f.XHR();next.open('GET','/app/api/casino/agt/dinit.php?action=spin&gamename=fruitqueen&li=18&di=1&amount=100');next.send();
assert.notEqual(new URL(next.url).searchParams.get('request_id'),new URL(first.url).searchParams.get('request_id'),'late failed loadend cannot resurrect the completed wager identity');
assert.equal(stopped('mousedown'),true);next.finish();assert.equal(stopped('mouseup'),true,'a rejected press cannot execute its release-only action after a response');
const unrelated=new f.XHR();unrelated.open('GET','https://other.example/asset');unrelated.send();assert.equal(stopped('click'),false,'asset requests never lock game controls');
const reads=f.messages.length;
for(const url of ['/app/api/casino/original/fruit-queen/dinit.php?action=credits','/app/api/casino/original/vikings-fun/rgsm?request='+encodeURIComponent(JSON.stringify([{command:'poll',sequence_number:1}]))]){
 const status=new f.XHR();status.open('GET',url);status.send();assert.equal(stopped('click'),false,'read-only casino polls never lock controls');status.finish();
}
assert.equal(f.messages.length,reads,'unchanged read-only polls do not trigger account refreshes');
console.log('PASS archived Clover/Viking native cash renderers, .20/100/5000 total stakes, whole-cent account meter, dynamic scripts, all input types, immediate Stop release, authoritative parent refresh and AGT retry identity');
