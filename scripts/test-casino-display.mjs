import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../web/src/components/Layout/casinoDisplay.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const exports={};vm.runInNewContext(compiled,{exports,Promise});
const {createCasinoDisplayController}=exports;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const promptly=async promise=>{
 let timeout;
 try{await Promise.race([promise,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Display release blocked on a browser promise')),100);})]);}
 finally{clearTimeout(timeout);}
};
function fixture({fullscreen=false,landscape=false,deny=false}={}){
 const calls={fullscreen:0,lock:0,unlock:0,exit:0};
 const state={fullscreen,landscape,deny};
 const target={
  isFullscreen:()=>state.fullscreen,isLandscape:()=>state.landscape,
  requestFullscreen:async()=>{calls.fullscreen++;if(state.deny)throw Error('Denied');state.fullscreen=true;},
  lockLandscape:async()=>{calls.lock++;if(state.deny)throw Error('Denied');state.landscape=true;},
  unlock:()=>{calls.unlock++;state.landscape=false;},
  exitFullscreen:async()=>{calls.exit++;state.fullscreen=false;},
 };
 return {calls,state,target,controller:createCasinoDisplayController(target)};
}

// Original AGT emits a fullscreen message for every Android tap, even after denial.
const denied=fixture({deny:true});
for(let i=0;i<20;i++)await denied.controller.request();
assert.equal(denied.calls.fullscreen,1);assert.equal(denied.calls.lock,1);
await denied.controller.request({retry:true});
assert.equal(denied.calls.fullscreen,2);assert.equal(denied.calls.lock,2,'Toolbar retries a denied orientation request');
await denied.controller.request();assert.equal(denied.calls.fullscreen,2,'Provider taps stay coalesced after explicit retry');

// Card click, component mount and provider taps share the same in-flight promise.
const concurrent=fixture(),entry=deferred();
concurrent.target.requestFullscreen=async()=>{concurrent.calls.fullscreen++;await entry.promise;concurrent.state.fullscreen=true;};
const pending=concurrent.controller.request();
for(let i=0;i<20;i++)assert.equal(concurrent.controller.request(),pending);
assert.equal(concurrent.controller.request({retry:true}),pending);
assert.equal(concurrent.calls.fullscreen,1);entry.resolve();await pending;
assert.equal(concurrent.calls.lock,1);

const native=fixture({fullscreen:true,landscape:true});
await native.controller.request();await native.controller.request({retry:true});
assert.equal(native.calls.fullscreen,0);assert.equal(native.calls.lock,0,'Already satisfied native state is left alone');
const landscape=fixture({landscape:true});await landscape.controller.request();
assert.equal(landscape.calls.fullscreen,1);assert.equal(landscape.calls.lock,0,'Landscape devices need no orientation lock');

const retry=fixture({deny:true});await retry.controller.request();retry.state.deny=false;
await retry.controller.request({retry:true});
assert.equal(retry.state.fullscreen,true);assert.equal(retry.state.landscape,true,'Explicit retry can enter native display after denial');

await denied.controller.release();
await denied.controller.request();
assert.equal(denied.calls.fullscreen,3);assert.equal(denied.calls.lock,3,'A new game receives one fresh automatic attempt');

// Back/manual exit never waits for a native entry, lock, or exit promise.
const stuckEntry=fixture();stuckEntry.target.requestFullscreen=()=>new Promise(()=>{});
void stuckEntry.controller.request();await promptly(stuckEntry.controller.release({keepSession:true}));
assert.equal(stuckEntry.calls.unlock,1);
const stuckLock=fixture({fullscreen:true});stuckLock.target.lockLandscape=()=>new Promise(()=>{});
void stuckLock.controller.request();await promptly(stuckLock.controller.release({keepSession:true}));
assert.equal(stuckLock.calls.unlock,1);assert.equal(stuckLock.calls.exit,1,'Exit starts immediately while orientation lock hangs');
const stuckExit=fixture({fullscreen:true,landscape:true});
stuckExit.target.exitFullscreen=()=>{stuckExit.calls.exit++;return new Promise(()=>{});};
await promptly(stuckExit.controller.release());assert.equal(stuckExit.calls.exit,1);

// Manual Exit Fullscreen suppresses automatic provider taps; the toolbar can
// reenter, while closing the game resets automatic entry for the next game.
const manual=fixture();await manual.controller.request();
await manual.controller.release({keepSession:true});
for(let i=0;i<20;i++)await manual.controller.request();
assert.equal(manual.calls.fullscreen,1);assert.equal(manual.state.fullscreen,false);
await manual.controller.request({retry:true});assert.equal(manual.calls.fullscreen,2);
await manual.controller.release();await manual.controller.request();
assert.equal(manual.calls.fullscreen,3,'A new game can automatically enter after cleanup');

const abandoned=fixture(),lateEntry=deferred();
abandoned.target.requestFullscreen=async()=>{abandoned.calls.fullscreen++;await lateEntry.promise;abandoned.state.fullscreen=true;};
const abandonedRequest=abandoned.controller.request();await promptly(abandoned.controller.release({keepSession:true}));
lateEntry.resolve();await abandonedRequest;
assert.equal(abandoned.calls.lock,0,'Released entry cannot lock orientation');
assert.equal(abandoned.calls.exit,1);assert.equal(abandoned.state.fullscreen,false,'Late native entry cleans itself after exit intent');

const race=fixture(),late=deferred();
race.target.requestFullscreen=async()=>{race.calls.fullscreen++;if(race.calls.fullscreen===1)await late.promise;race.state.fullscreen=true;};
const oldRequest=race.controller.request();await promptly(race.controller.release());
await race.controller.request();
assert.equal(race.calls.fullscreen,2,'The new game does not wait for abandoned entry');
late.resolve();await oldRequest;
assert.equal(race.calls.exit,0);assert.equal(race.calls.lock,1);
assert.equal(race.state.fullscreen,true,'Late old entry cannot exit native display wanted by the new game');

const oldLock=fixture({fullscreen:true}),lateLock=deferred();
oldLock.target.lockLandscape=async()=>{oldLock.calls.lock++;await lateLock.promise;oldLock.state.landscape=true;};
const locking=oldLock.controller.request();await promptly(oldLock.controller.release({keepSession:true}));
lateLock.resolve();await locking;
assert.equal(oldLock.state.landscape,false,'A late orientation lock is undone when the latest intent is exit');

const nextLock=fixture({fullscreen:true}),firstLock=deferred();
nextLock.target.lockLandscape=async()=>{nextLock.calls.lock++;if(nextLock.calls.lock===1)await firstLock.promise;nextLock.state.landscape=true;};
const previousLock=nextLock.controller.request();await nextLock.controller.release();await nextLock.controller.request();
firstLock.resolve();await previousLock;
assert.equal(nextLock.calls.unlock,1);assert.equal(nextLock.state.landscape,true,'Late old lock cannot undo the new game landscape intent');

// A new request waits only for a native exit already in progress, ensuring it
// cannot mistake the old fullscreen element for its own successful entry.
const exiting=fixture({fullscreen:true}),exitDone=deferred();
exiting.target.exitFullscreen=async()=>{exiting.calls.exit++;await exitDone.promise;exiting.state.fullscreen=false;};
await promptly(exiting.controller.release());const entering=exiting.controller.request();
assert.equal(exiting.calls.fullscreen,0);exitDone.resolve();await entering;
assert.equal(exiting.calls.fullscreen,1);assert.equal(exiting.state.fullscreen,true);

const component=readFileSync(new URL('../web/src/components/Layout/CasinoFullscreen.tsx',import.meta.url),'utf8');
assert(component.includes('requestCasinoLandscape({retry:true})'),'Visible Fullscreen control must opt in to retry');
assert(component.includes('casino-game-rotated')&&component.includes('Kthehu te kazinoja'),'CSS landscape and Back remain present');

// Execute the actual toolbar handlers and fullscreen listener with persistent
// hook state. The toolbar label follows the real native event, including when
// an exit promise is still pending and another click must not resend the exit.
const exitGate=deferred(),listeners=new Map(),hooks=[],effects=[];
let hookIndex=0,effectIndex=0,enterCalls=0,exitCalls=0;
const browserWindow={innerWidth:1200,innerHeight:800,location:{origin:'http://local'},addEventListener(){},removeEventListener(){}};
const browserScreen={orientation:{type:'landscape-primary',addEventListener(){},removeEventListener(){},unlock(){}}};
const frameMessages=[];
const browserFrame={contentWindow:{postMessage:(message,origin)=>frameMessages.push({message,origin})}};
const fireNative=()=>listeners.get('fullscreenchange')?.();
const browserDocument={
 fullscreenElement:{},body:{style:{overflow:''}},
 querySelector:selector=>selector==='.casino-game-content iframe'?browserFrame:null,
 addEventListener:(type,listener)=>listeners.set(type,listener),
 removeEventListener:(type,listener)=>{if(listeners.get(type)===listener)listeners.delete(type);},
 documentElement:{requestFullscreen:async()=>{enterCalls++;browserDocument.fullscreenElement={};fireNative();}},
 exitFullscreen:async()=>{exitCalls++;await exitGate.promise;browserDocument.fullscreenElement=null;fireNative();},
};
const react={
 useState(initial){const index=hookIndex++;if(!(index in hooks))hooks[index]=typeof initial==='function'?initial():initial;return [hooks[index],value=>{hooks[index]=typeof value==='function'?value(hooks[index]):value;}];},
 useRef(initial){const index=hookIndex++;return hooks[index]??=( {current:initial} );},
 useEffect(effect,deps){
  const index=effectIndex++,old=effects[index];
  if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps[i])))effects[index]={deps,run:effect,cleanup:old?.cleanup};
 },
};
const jsx=(type,props,key)=>({type,props,key});
const componentCode=ts.transpileModule(component,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const componentExports={};
vm.runInNewContext(componentCode,{
 exports:componentExports,Promise,window:browserWindow,screen:browserScreen,document:browserDocument,
 require:name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='./casinoDisplay'?{createCasinoDisplayController}:name==='../../context/LanguageContext'?{useLanguage:()=>({t:text=>text})}:{ArrowLeft:'ArrowLeft',Maximize2:'Maximize2',Minimize2:'Minimize2',RotateCw:'RotateCw'},
});
const render=()=>{
 hookIndex=0;effectIndex=0;
 const tree=componentExports.default({children:{type:'iframe'},title:'Test game',onExit(){}});
 for(const entry of effects)if(entry.run){entry.cleanup?.();entry.cleanup=entry.run();entry.run=null;}
 return tree;
};
const findButton=(tree,label)=>{
 if(!tree||typeof tree!=='object')return null;
 if(tree.type==='button'&&tree.props['aria-label']===label)return tree;
 for(const child of [tree.props?.children].flat(Infinity)){const found=findButton(child,label);if(found)return found;}
 return null;
};
let tree=render();await Promise.resolve();
findButton(tree,'Dil nga ekrani i plotë').props.onClick();
tree=render();assert(findButton(tree,'Dil nga ekrani i plotë'),'A pending exit keeps the actual browser fullscreen label');
findButton(tree,'Dil nga ekrani i plotë').props.onClick();
assert.equal(exitCalls,1,'A second click while native exit is pending must not resend the exit');
exitGate.resolve();await new Promise(resolve=>setImmediate(resolve));
tree=render();
assert(findButton(tree,'Ekran i plotë horizontal'),'The native exit event updates the toolbar to offer fullscreen entry');
findButton(tree,'Ekran i plotë horizontal').props.onClick();
await new Promise(resolve=>setImmediate(resolve));tree=render();
assert.equal(exitCalls,1,'The delayed native exit event must not issue a second release');
assert.equal(enterCalls,1,'An explicit click after the native exit must enter fullscreen once');
assert(findButton(tree,'Dil nga ekrani i plotë'),'Native entry updates the toolbar to offer fullscreen exit');
browserDocument.fullscreenElement=null;fireNative();
tree=render();
assert(findButton(tree,'Ekran i plotë horizontal'),'A later browser Escape still returns to windowed mode');
assert.equal(frameMessages.length,3,'Native exit, entry and Escape each notify the active iframe');
assert(frameMessages.every(({message,origin})=>message.type==='casino:viewport-changed'&&origin===browserWindow.location.origin),'Viewport notifications only target the same-origin provider frame');
for(const entry of effects)entry.cleanup?.();
console.log('PASS casino display coalescing, explicit retry, nonblocking exit, suspended provider taps and late native races');
