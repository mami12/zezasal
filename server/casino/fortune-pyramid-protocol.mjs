import {createCtProtocol} from './ct-protocol.mjs';
import {ctConfig,DENOMS} from './clover-ct-config.mjs';
import {walletCtDenoms} from './bet-limits.mjs';
import {DATA,symbol,rows,spin} from './fortune-pyramid-engine.mjs';
export function pyramidConfig(grid,options={}){
 const config=ctConfig(grid,{walletLimits:options.walletLimits,selectedLines:20});
 const key=String(options.mathProfile?.rtp??DATA.defaultRtp),reels=DATA.reels[key];if(!reels)throw Error('Unknown Fortune Pyramid reel profile');
 const paytable={};for(let s=1;s<=8;s++){if(s===2)continue;paytable[symbol(s)]=Object.fromEntries(DATA.pay[s-1].flatMap((factor,i)=>factor?[[i+1,{factor}]]:[]));}
 return {...config,app_name:'Fortune Pyramid',directory_name:'FortunePyramid',init_screen:rows(grid),
  reels_sets:{main:{reels:reels.map(reel=>reel.map(symbol)),symbols:DATA.symbols}},
  lines:DATA.lines,lines_mode:20,lines_min_number:20,lines_max_number:20,lines_step_numbers:[20],
  paytables:{main:{paytable,paytable_wilds:{8:{factor:1,expanding:0,exclude:{1:{count:1},8:{count:1}}}},paytable_scatters:{1:Object.fromEntries(DATA.scatterPay.flatMap((factor,i)=>factor?[[i+1,{factor,bonus_type:'none',bonus_value:0}]]:[]))}}},
  game_denoms:Object.fromEntries((options.walletLimits?walletCtDenoms(20):DENOMS).map(d=>[d.label,d.label])),
  RTP:Object.fromEntries((options.walletLimits?walletCtDenoms(20):DENOMS).map(d=>[d.label,[{percent:key}]]))};
}
export function mapPyramidRound(round,command,denom){return round.games.map((game,index)=>({
 type:'slot_subgame',step_number:index,subgame_label:'main',reels_sets_name:'main',stop_reels:game.grid.map(col=>col.map(symbol)),result_reels:rows(game.grid),
 lines_win:game.wins.filter(w=>w.line).map(w=>({line_number:w.line-1,symbol:symbol(w.symbol),symbols:Array(w.count).fill(symbol(w.symbol)),symbol_count:w.count,win:w.amount/denom.cents,positions:w.cells.map(([x])=>x),paytable_factor:w.factor,subgame_win_factor:1,wilds:[]})),
 scatters_win:game.wins.filter(w=>!w.line).map(w=>({symbol:1,count:w.count,symbol_count:w.count,win:w.amount/denom.cents,positions:w.cells.map(([x,y])=>[y,x]),paytable_factor:w.factor,subgame_win_factor:1,bonus_type:'none',bonus_value:0})),
 subgame_bonus:[],expanded_wilds:[],win:game.winCents/denom.cents,total_win:game.totalWin/denom.cents,subgame_factor:1,is_free:0,is_last:true,
}));}
export function createFortunePyramidProtocol(options={}){
 const protocol=createCtProtocol({spinFn:spin,configFn:pyramidConfig,initialGrid:options=>spin(2000,20,options).grid,selectedLines:20,mapRound:mapPyramidRound,...options});
 return {...protocol,run(state,commands,settings){const replies=protocol.run(state,commands,settings);for(const r of replies)if(r._req_command==='create_session'){
  r.server_denom={id:'wallet-cent',label:'0.01',cents:1,value:.01};
  r.enabled_denoms=r.enabled_denoms.map(d=>({...d,value:d.cents/100}));
 }return replies;}};
}
