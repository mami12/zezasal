import {FORTUNE_DATA} from './fortune-teller-engine.mjs';
export const FORTUNE_NATIVE_SYMBOLS=[9,11,10,8,7,6,5,4,3,2,1,0];
export const FORTUNE_NATIVE_DENOMS=[100,200,500,1000,2000,2500,5000,10000,20000,25000,50000,100000,200000,500000];
const fault=message=>Object.assign(Error(message),{status:400});
const packet=lines=>'d=\r\n'+lines.join('\r\n')+'\r\n';
const symbol=name=>FORTUNE_NATIVE_SYMBOLS[Number(String(name).replace('symbol',''))];
export function decodeFortuneNative(body){
 if(typeof body!=='string'||body.length>8192)throw fault('Invalid native packet');
 const rows=body.trim().split(/\r?\n/),sequence=Number(rows.shift()?.replace(/^d=/,''));rows.shift();
 if(!Number.isSafeInteger(sequence)||sequence<0)throw fault('Invalid packet ID');
 const calls=rows.filter(Boolean).map(line=>line.trim().split(/\s+/).map(Number));
 if(!calls.length||calls.length>20||calls.some(call=>call.some(n=>!Number.isSafeInteger(n))||![0,1,2,6,7,52,102,103,104].includes(call[0])))throw fault('Invalid native command');
 const active=calls.filter(call=>![0,52].includes(call[0]));if(active.length>1)throw fault('Send each native action separately');
 const data=active[0]??[0],type=data[0],action=({1:'spin',2:'card',6:'collect',7:'free',102:'logout',103:'session',104:'init'})[type]??'poll';
 const native={action,data,calls};
 if(action==='spin'){
  const [,coins,lines,denom]=data;
  if(data.length<4||coins<1||coins>5||lines<1||lines>20||!FORTUNE_NATIVE_DENOMS.includes(denom))throw fault('Invalid native bet');
  return {command:'play',sequence_number:sequence,game_denom:1,lines,line_bet:coins*denom,total_bet:coins*denom*lines,native};
 }
 return {command:'poll',sequence_number:sequence,native};
}
function spinPacket(game,state){
 const {coins,lines,denom}=state,grid=Array.from({length:5},(_,reel)=>game.result_reels.map(row=>symbol(row[reel]))).flat();
 const wins=[...game.lines_win.map(win=>[win.line_number+1,symbol(win.symbol),win.symbol_count,0,win.win/denom]),
  ...game.scatters_win.filter(win=>win.win>0).map(win=>[-1,symbol(win.symbol),win.symbol_count,0,win.win/denom])];
 return '1 '+[coins,lines,denom,...grid,(game.win-(game.cards_bonus?.win??0))/denom,wins.length,...wins.flat()].join(' ');
}
function endPacket(state){
 const game=state.games[state.cursor];
 return '3 '+[0,game.total_win/state.denom,game.total_win,game.free_game_total-game.free_game_number,1].join(' ');
}
function gamePacket(state){
 const game=state.games[state.cursor],out=[spinPacket(game,state)];
 state.card=0;
 if(game.cards_bonus){
  out.push('2 0 0 10 3 0');
  for(const card of game.cards_bonus.cards)out.push('2 2 6 '+(4-card));
  out.push('2 2 0 '+game.cards_bonus.win/state.denom,'2 5 0');
 }
 if(!game.cards_bonus)out.push(endPacket(state));return out;
}
export function withFortuneNativeProtocol(base,runSpin){
 return {...base,run(state,commands,options={}){
  if(!commands.some(c=>c.native))return base.run(state,commands,options);
  return commands.map(command=>{
   const native=command.native;if(!native)return base.run(state,[command],options)[0];
   let reply,out=[],current=state.native;
   const finish=()=>base.run(state,[{command:'game_finished',gameplay_id:state.round}],options)[0];
   const poll=()=>base.run(state,[{command:'poll',sequence_number:command.sequence_number}],options)[0];
   switch(native.action){
    case 'init':{
     reply=base.run(state,[{command:'create_session',sequence_number:command.sequence_number}],options)[0];state.native=null;
     out=['104 1','54 '+[FORTUNE_NATIVE_DENOMS.length,...FORTUNE_NATIVE_DENOMS,100].join(' '),'52 '+state.credit+' 0','109'];break;
    }
    case 'session':reply=poll();out=['103 wallet'];break;
    case 'spin':{
     if(current&&current.cursor<current.games.length-1)throw fault('Finish the awarded free games first');
     if(state.pending||state.phase!=='finished')finish();
     const key=String(Number(options.mathProfile?.rtp??FORTUNE_DATA.defaultRtp)),r=FORTUNE_DATA.returns[key];
     const actualRtp=r.twentyLines.rtp+(r.oneLine.rtp-r.twentyLines.rtp)*(1/command.lines-1/20)/(1-1/20);
     if(!Number.isFinite(actualRtp)||actualRtp<1||actualRtp>1000)throw fault('Select a supported reel profile for this line count');
     reply=runSpin(state,command,options);
     if(reply.status.status!=='ok')return reply;
     state.mathProfile={...state.mathProfile,theoreticalRtp:actualRtp,selectedLines:command.lines};
     current=state.native={coins:native.data[1],lines:command.lines,denom:native.data[3],cursor:0,games:reply.result};out=gamePacket(current);break;
    }
    case 'free':{
     if(!current||native.data[1]!==current.cursor)throw fault('Invalid free-spin checkpoint');
     if(current.cursor===current.games.length-1){reply=poll();break;}
     if(current.games[current.cursor].cards_bonus&&current.card<3)throw fault('Finish the Tarot selection first');
     current.cursor++;reply=poll();out=gamePacket(current);break;
    }
    case 'card':{
     const bonus=current?.games[current.cursor]?.cards_bonus;
     if(!bonus||native.data[1]!==4||current.card>=3||native.data[2]<0||native.data[2]>3)throw fault('Invalid Tarot selection');
     current.card++;reply=poll();out=['2 4 '+native.data.slice(2).join(' ')];if(current.card===3)out.push(endPacket(current));break;
    }
    case 'collect':case 'logout':{
     if(state.round&&state.phase!=='finished')finish();reply=poll();out=['52 '+state.credit+' 0'];if(native.action==='logout')out.push('102');break;
    }
    default:reply=poll();out=['52 '+(state.credit+(state.pending||0))+' 0'];
   }
   reply.native_packet=packet(out);return reply;
  });
 }};
}
