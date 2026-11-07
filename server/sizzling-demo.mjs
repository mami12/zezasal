/**
 * Isolated, server-authoritative DEMO adapter for the original Novomatic
 * Sizzling Hot Deluxe browser client's init/spin/collect/gamble protocol.
 * Never reads/writes player ledgers, real funds, or account cookies.
 */
import { Router, raw } from 'express';
import { randomUUID, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const sizzlingDemoRouter=Router();
const sessions=new Map();
const MAX_SESSIONS=3000, TTL=60*60*1000;
const REEL_PATH=fileURLToPath(new URL('../web/dist/casino-original/sizzling/reels-demo.json',import.meta.url));
const LINES=[[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2]];
// 0 scatter; 1 seven; 2 watermelon; 3 grapes; 4 plum;
// 5 orange; 6 lemon; 7 cherry. See the archived SlotSettings paytable.
export const PAYTABLE={
  0:{3:2,4:10,5:50},
  1:{3:100,4:1000,5:5000},
  2:{3:50,4:200,5:500},
  3:{3:50,4:200,5:500},
  4:{3:20,4:50,5:200},
  5:{3:20,4:50,5:200},
  6:{3:20,4:50,5:200},
  7:{2:5,3:20,4:50,5:200},
};
let cachedReels=null;
const getReels=()=>{
  if(cachedReels)return cachedReels;
  const strips=JSON.parse(readFileSync(REEL_PATH,'utf8'));
  if(!Array.isArray(strips)||strips.length!==5||strips.some(s=>s.length<50||
    s.some(v=>!Number.isInteger(v)||v<0||v>7)))throw Error('Invalid reels-demo.json');
  cachedReels=strips;
  return strips;
};
const money=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const symbols=(grid)=>Object.fromEntries(grid.map((col,c)=>[c,
  Object.fromEntries(col.map((symbol,r)=>[r,{code:symbol}]))]));
const draw=(reels=getReels())=>reels.map(strip=>{
  const start=randomInt(strip.length);
  return [0,1,2].map(i=>strip[(start+i)%strip.length]);
});
export function calculateRound(grid,bet,lines=5){
  const lineWins=[];
  let sum=0;
  for(let i=0;i<lines;i++){
    const rows=LINES[i], first=grid[0][rows[0]];
    if(first===0)continue;
    let count=1;
    while(count<5&&grid[count][rows[count]]===first)count++;
    const factor=PAYTABLE[first]?.[count]??0;
    if(!factor)continue;
    const amount=money(bet*factor);
    sum+=amount;
    lineWins.push({idx:i+1,code:first,pos:rows.slice(0,count).map((row,col)=>[col,row]),
      multiplier:factor,amount:String(amount),type:'basic',extra:{}});
  }
  const scatters=[];
  for(let c=0;c<5;c++)for(let row=0;row<3;row++){
    if(grid[c][row]===0)scatters.push([c,row]);
  }
  if(scatters.length>=3){
    const factor=PAYTABLE[0][Math.min(5,scatters.length)]??50;
    const amount=money(factor*bet*lines);
    sum+=amount;
    lineWins.push({idx:0,code:0,pos:scatters,multiplier:factor,
      amount:String(amount),type:'scatter',extra:{}});
  }
  return{total:money(sum),line_wins:lineWins};
}
function decodeRequest(req){
  if(req.body&&typeof req.body==='object'&&!Buffer.isBuffer(req.body))return req.body;
  const input=Buffer.isBuffer(req.body)?req.body.toString('utf8'):'';
  if(input.length>32768)throw Error('Request too large');
  const ct=String(req.headers['content-type']||'');
  let data=input;
  if(ct.startsWith('multipart/form-data')){
    // The unmodified client uses FormData fields named "data"/"cookies".
    const match=input.match(/name="data"\s*\r?\n(?:Content-Type:[^\r\n]*\r?\n)?\r?\n([\s\S]*?)\r?\n--/);
    if(!match)throw Error('Missing multipart data field');
    data=match[1];
  }else if(ct.includes('application/x-www-form-urlencoded')){
    data=new URLSearchParams(input).get('data')||input;
  }
  const obj=JSON.parse(data||'{}');
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('Invalid request');
  return obj;
}
function getSession(req,res){
  const cookies=String(req.headers.cookie||'');
  const existing=/(?:^|;\s*)sizzling_demo_id=([a-f0-9-]{36})(?:;|$)/.exec(cookies)?.[1];
  let state=existing?sessions.get(existing):null;
  const now=Date.now();
  if(state&&now-state.lastSeen>TTL){sessions.delete(existing);state=null;}
  if(!state){
    if(sessions.size>=MAX_SESSIONS){
      for(const [id,s] of sessions)if(now-s.lastSeen>TTL)sessions.delete(id);
      if(sessions.size>=MAX_SESSIONS)sessions.delete(sessions.keys().next().value);
    }
    const id=randomUUID();
    state={credits:1000,pending:0,step:0,requestId:1,lastSeen:now};
    sessions.set(id,state);
    res.setHeader('Set-Cookie','sizzling_demo_id='+id+
      '; Path=/app/api/casino/sizzling; HttpOnly; SameSite=Lax; Max-Age=3600'+
      (req.secure||req.get('x-forwarded-proto')==='https'?'; Secure':''));
  }
  state.lastSeen=now;
  return state;
}
const base=(state,oldBalance=state.credits)=>({
  balance:{before:oldBalance,after:state.credits},
  denomination:1,
});
const actions=state=>state.pending>0?['collect','gamble','spin']:['spin'];
function init(state){
  const grid=draw();
  return{
    ...base(state),available_actions:actions(state),
    init:{
      bet:'1',lines:5,multiplier:1,currency:'EUR',restorestate:false,
      next_request_id:state.requestId,
      ranges:{bet:{'1':[1,2,3,5,10,20,30,50,100]},
        denomination:{'0':0.5,'1':1,'2':2,'3':5,'4':10}},
      directory:{lines:LINES.map(rows=>Object.fromEntries(rows.map((r,c)=>[c,r]))),
        paytable:PAYTABLE},
      start_symbols:symbols(grid),collect:1,
      extra:{symbol_types:{scatters:[0],wilds:[]}},
    },
  };
}
function spin(state,request){
  const bet=Number(request.bet),lines=Number(request.lines),denom=Number(request.denomination);
  if(!Number.isFinite(bet)||!Number.isInteger(lines)||lines<1||lines>5||
    ![1,2,3,5,10,20,30,50,100].includes(bet)||
    ![0.5,1,2,5,10].includes(denom)){
    throw Error('Invalid demo stake');
  }
  const stake=money(bet*lines*denom),before=state.credits;
  if(stake>state.credits)throw Error('Not enough demo credits');
  const grid=draw();
  const wins=calculateRound(grid,bet*denom,lines);
  state.credits=money(state.credits-stake+wins.total);
  state.pending=wins.total;
  state.step=0;
  return{
    ...base(state,before),
    macro_round:{wins:{total:String(wins.total)}},
    available_actions:actions(state),
    spin:{bet,lines,multiplier:1,next_multiplier:1,type:'spin',
      symbols:symbols(grid),wins:{...wins,total:String(wins.total)}},
  };
}
function collect(state){
  const before=state.credits;
  state.pending=0;
  return{...base(state,before),macro_round:{wins:{total:'0'}},
    available_actions:actions(state),collect:{win:0}};
}
function getDouble(state){
  if(state.pending<=0)throw Error('No winning demo spin to gamble');
  return{
    ...base(state),available_actions:actions(state),
    gamble:{start_bet:state.pending,bet:state.pending,
      win:money(state.pending*2),status:'idle',current_step:state.step,
      max_step:5,history:{items:{0:randomCard()}}}
  };
}
function randomCard(){
  const suits=['hearts','diamonds','spades','clubs'];
  return{rank:randomInt(2,15),suit:suits[randomInt(4)]};
}
function setDouble(state,request){
  if(state.pending<=0||state.step>=5)throw Error('No valid gamble state');
  const choice=Number(request.choice);
  if(choice!==0&&choice!==1)throw Error('Invalid color choice');
  const before=state.credits,player=randomCard(),dealer=randomCard();
  const red=dealer.suit==='hearts'||dealer.suit==='diamonds';
  const won=(choice===0)===red;
  state.step++;
  // The original spin already credited the win. Subtract it before adding
  // the doubled prize, or deduct it on loss, without affecting real wallets.
  state.credits=money(state.credits-state.pending+(won?state.pending*2:0));
  state.pending=won?money(state.pending*2):0;
  const status=won?'win':'lose';
  return{...base(state,before),available_actions:actions(state),
    gamble:{start_bet:before,bet:before,win:state.pending,status,
      current_step:state.step,max_step:5,
      history:{items:{0:player,1:dealer}}}};
}
sizzlingDemoRouter.post('/play',raw({type:'*/*',limit:'32kb'}),(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{
    const request=decodeRequest(req);
    const session=getSession(req,res);
    const action=String(request.action||'init');
    let payload;
    switch(action){
      case 'init':payload=init(session);break;
      case 'spin':payload=spin(session,request);break;
      case 'collect':payload=collect(session);break;
      case 'get_double':payload=getDouble(session);break;
      case 'set_double':payload=setDouble(session,request);break;
      default:return res.status(400).json({error:'Unknown demo action'});
    }
    session.requestId++;
    return res.json(payload);
  }catch(error){
    console.error('[sizzling demo]',error.message);
    return res.status(400).json({error:error.message,available_actions:['spin']});
  }
});
