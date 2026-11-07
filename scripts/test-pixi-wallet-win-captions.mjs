import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {freespinResponse} from '../server/casino/bookofra.mjs';

const bridge=readFileSync(new URL('../web/public/casino-original/wallet-bridge.js',import.meta.url),'utf8');
for(const [id,file,unit] of [['sizzling','bundle-51f846f01a.js',.04],['bookofra','bundle-60f2610b1f.js',.02]]){
 const source=readFileSync(new URL(`../web/public/casino-original/${id}/scripts/${file}`,import.meta.url),'utf8');
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),methods=new Map();
 function visit(node){
  if(ts.isObjectLiteralExpression(node)){
   const key=node.properties.find(property=>ts.isPropertyAssignment(property)&&property.name.getText(ast)==='key');
   const value=node.properties.find(property=>ts.isPropertyAssignment(property)&&property.name.getText(ast)==='value');
   if(key&&value&&ts.isStringLiteral(key.initializer)&&ts.isFunctionExpression(value.initializer)&&!methods.has(key.initializer.text)){
    const name=key.initializer.text,text=value.initializer.getText(ast);
    if((name!=='showBigWin'||text.includes('_isOpened'))&&(name!=='onCollectUpdate'||text.includes('_totalWinSum')))methods.set(name,text);
   }
  }
  ts.forEachChild(node,visit);
 }
 visit(ast);
 for(const desktop of [true,false]){
  const calls=[],events=new Map();class XHR{open(){}send(){}addEventListener(){}}
  const sandbox={window:null,document:{baseURI:'https://test.example/app/',addEventListener:(name,fn)=>events.set(name,fn)},location:{origin:'https://test.example'},parent:null,casinoWalletConfig:{game:id},XMLHttpRequest:XHR,URL,Element:class{},addEventListener(){},c2d:{env:{isDesktop:desktop},call:(fn,_delay,args,scope)=>fn?.apply(scope,args||[])},y:{default:{BIG_WIN_DID_FINISH_COUNTING:'done'}},v:{default:{BIG_WIN_DID_FINISH_COUNTING:'done'}}};
  sandbox.window=sandbox;sandbox.parent=sandbox;
  const context=vm.createContext(sandbox);
  vm.runInContext('Math.countDecimals=value=>(String(value).split(".")[1]||"").length;String.prototype.ls=function(){return String(this)};',context);
  const native=name=>{assert(methods.has(name),`${id} native ${name}`);return vm.runInContext('('+methods.get(name)+')',context);};
  const check=methods.get('checkText'),nan=check.match(/if\(\(0,(\w+)\["default"\]\)\(s\)\)throw/)[1],parse=check.match(/var n=\(0,(\w+)\["default"\]\)\(s\)/)[1];
  context[nan]={default:Number.isNaN};context[parse]={default:parseFloat};
  class UI{};UI.prototype._setUpCheckers=native('_setUpCheckers');UI.prototype.checkText=native('checkText');
  class BigWinView{};BigWinView.prototype._countWinAmount=native('_countWinAmount');BigWinView.prototype.onCollectUpdate=native('onCollectUpdate');
  sandbox.game={subControllers:{desktopUI:UI},src:{BigWin:{View:BigWinView},Network:{Parsers:{ResponseParser:{parse:data=>({...data})}}}}};
  // Exercise the exact provider desktop-credit/mobile-cash postprocessor.
  const post=native('_postProcessing');
  const data=post({denomination:unit,nonCollectedWins:20,spinData:{lineWins:[{amount:6}],scatterWins:[],totalWin:6,freespins:{totalWins:20,winsBefore:0}},gambleData:{win:12,bet:6,startBet:6,extra:{}}});
  const factor=desktop?unit:1;
  const lines={currentWinLine:{idx:0,code:7,amount:data.spinData.lineWins[0].amount,positions:[1,2]},alreadyShownLines:[{amount:data.spinData.lineWins[0].amount}],linesShowloopID:0};
  const model={denomination:unit,totalBetCash:unit*(id==='bookofra'?10:5),totalBetCredit:id==='bookofra'?10:5,bet:1,totalWin:data.spinData.totalWin,lineWins:data.spinData.lineWins,allWins:data.spinData.lineWins,scatterWins:[],respin:{isReady:false,chainBeforeWin:0},dropWins:desktop?20:20*unit,hasDropWins:false,collect:{isCollected:false,isCollecting:false,nonCollectedWins:20*unit,collectedWins:0},gamble:{status:'idle',win:data.gambleData.win,isFinishStatus:false},freespins:{isActiveStatus:true,isPlayStatus:true,isFinishStatus:false,totalWins:data.spinData.freespins.totalWins,hasMudWins:false,mudWins:[]},getLinesWin:value=>Array.isArray(value)?value.reduce((sum,item)=>sum+item.amount,0):value?.amount||0,getWinMultiplier:()=>100};
  const ui=new UI();ui.slots={model,lines,ui:{}};ui._setUpCheckers();
  const winnerBefore=ui._text_checkers.GET_WINNER_FIELD_VALUE();assert.equal(winnerBefore,desktop?20:20*unit);
  vm.runInContext(bridge,context);
  sandbox.game.src.Network.Parsers.ResponseParser.parse({init:{},denomination:unit,balance:{before:1000,after:1000}});
  assert.equal(ui._text_checkers.GET_WINNER_FIELD_VALUE(),winnerBefore,'internal winner arithmetic remains in original units');
  assert.equal(ui._text_checkers.GET_ONLY_LINES_WIN(),data.spinData.lineWins[0].amount,'internal line helpers are never converted');
  assert.equal(ui.checkText('GET_WINNER_FIELD_VALUE'),(20*unit).toFixed(2));
  assert.equal(ui.checkText('GET_CURRENT_LINE_WIN_AMOUNT'),(6*unit).toFixed(2));
  assert.equal(ui.checkText('GET_FREESPINS_TOTAL_WINS'),(20*unit).toFixed(2));
  assert.equal(ui.checkText('GET_GAMBLE_FUTURE_WIN'),(24*unit).toFixed(2));
  context.o={default:JSON.stringify};
  model.symbolsConfig=native('_correctPaytableConfig').call(model,[{id:7,combinations:[{symbolsCount:2,coefficient:3}]}]);
  assert.equal(ui.checkText('GET_PAYTABLE_WINS',{id:7,symbolsCount:2}),(3*unit).toFixed(2),'native mobile paytable getter already converts coefficients to cash');
  assert.equal(ui.checkText('GET_CREDIT_AFTER_AMOUNT'),'1000.00');
  assert.equal(ui.checkText('GET_TOTAL_BET'),model.totalBetCash.toFixed(2));
  assert.equal(ui.checkText('GET_CURRENT_WIN_TEXT',{prefix_scatter:'Scatter: ',prefix_line:'Line: '}),'Line: '+(6*unit).toFixed(2));
  model.freespins.isActiveStatus=false;model.collect.isCollecting=true;
  assert.equal(ui.checkText('GET_WINNER_FIELD_VALUE'),(20*unit).toFixed(2),'native counting branch stays cash, including mobile credit-based pending helper');
  model.freespins.isActiveStatus=true;model.collect.isCollecting=false;
  const view=new BigWinView();view.options={winAmount:{showWithoutCollect:false}};view._amountText={text:''};view._totalWinSum={text:''};view.dispatch=()=>{};
  view._collector={start:(options,update,complete)=>{calls.push(options);update(options.finishVal/2);options.intermediateText=view._amountText.text;complete(options.finishVal);}};
  view.showBigWinScreen=(_level,options,complete)=>view._countWinAmount(options,complete);
  const controller={slotModel:model,model:{defaultCollectDuration:100,startingCoefficient:10,preciseCollectDuration:100,delayBeforeShow:0,delayAfterCollect:0},view,bigWinShouldPlay:true,_isOpened:false,hideBigWin(){}};
  if(methods.has('_getFinishValue'))controller._getFinishValue=native('_getFinishValue');
  native('showBigWin').call(controller);
  assert.equal(calls.at(-1).finishVal,20*unit,`${id} ${desktop?'desktop':'mobile'} BigWin cash finish`);
  assert.equal(calls.at(-1).intermediateText,(10*unit).toFixed(2));assert.equal(Number(view._amountText.text),20*unit);
  view.onCollectUpdate(desktop?20:20*unit);assert.equal(view._totalWinSum.text,(20*unit).toFixed(2));
  assert.equal(model.totalWin*factor,6*unit,'display does not mutate native win model');
  console.log(`PASS ${id} ${desktop?'desktop credits':'mobile cash'}: actual native parser postprocessing, FS winner arithmetic, current line/prefix, Gamble, cash/stake fields and BigWin animated/final captions`);
 }
}
const lost=freespinResponse({credits:100,payout:.4,bet:1,lines:10,grid:Array.from({length:5},()=>[1,2,3]),grading:{total:0,line_wins:[]},left:8,done:2,mud:1,requestId:9});
assert.equal(lost.spin.wins.total,'0.00','a losing free spin must not replay earlier wins as its own');assert.equal(lost.freespins.wins.total,'0.40','pending bonus total remains available for once-only collection');
console.log('PASS Book losing free spin after positive bonus pending: zero current win, preserved cumulative award');
