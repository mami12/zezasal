import { createCtProtocolRouter } from './clover-ct-router.mjs';
import { ctConfig, DENOMS } from './clover-ct-config.mjs';
import { DATA, PAY, SPRITES, spin, spinRound } from './vikings-engine.mjs';
import {walletCtDenoms} from './bet-limits.mjs';
const symbol=s=>SPRITES[s-1];
const rows=grid=>Array.from({length:3},(_,y)=>grid.map(r=>symbol(r[y])));
export function vikingsConfig(grid,options={}){
 const requested=options.mathProfile?options.mathProfile.rtp:DATA.defaultRtp,key=Object.keys(DATA.reels).find(value=>Number(value)===Number(requested));if(!key)throw Error('Unknown Vikings reel profile');
 const config=ctConfig(grid,{walletLimits:options.walletLimits,selectedLines:25}),paytable={};
 for(let s=1;s<=11;s++){if(s===2)continue;paytable[symbol(s)]={};PAY[s-1].forEach((factor,n)=>{if(factor)paytable[symbol(s)][n+1]={factor};});}
 const scatter=Object.fromEntries([3,4,5].map(n=>[n,{factor:[0,0,7,20,100][n-1],bonus_type:'free_games',bonus_value:15}]));
 const table=wilds=>({paytable,paytable_wilds:Object.fromEntries(wilds.map(s=>[symbol(s),paytable[symbol(s)]])),paytable_scatters:{1:scatter}});
 Object.assign(config,{app_name:"Viking's Fun",directory_name:'VikingsFun',init_screen:rows(grid),
  subgames_labels:{main:{subgame_id:'main'},free:{subgame_id:'free'}},
  reels_sets:Object.fromEntries(['main','free'].map(k=>[k,{reels:DATA.reels[key].map(r=>r.map(symbol)),symbols:Array.from({length:11},(_,i)=>i+1)}])),
  paytables:{main:table([1]),free:table([1,3,4])},
  lines:DATA.lines.slice(0,25),lines_min_number:25,lines_max_number:25,lines_step_numbers:[25],
  RTP:Object.fromEntries((options.walletLimits?walletCtDenoms(25):DENOMS).map(d=>[d.label,[{percent:String(options.mathProfile?.customMath?.rtp??key)}]]))});
 return config;
}
export function mapVikingsRound(round,c,d){
 return round.games.map((game,i)=>({
  type:'slot_subgame',type_descr:game.free?'FREE GAME':'NORMAL GAME',step_number:i,subgame_label:game.free?'free':'main',reels_sets_name:game.free?'free':'main',subgame_label_game_number:game.freeGameNumber,subgame_label_game_total:game.free?game.freeGameTotal:1,
  stop_reels:game.grid.map(r=>r.map(symbol)),result_reels:rows(game.grid),
  lines_win:game.wins.filter(w=>w.line).map(w=>({line_number:w.line-1,symbol:symbol(w.symbol),symbols:w.cells.map(([x,y])=>symbol(game.grid[x][y])),symbol_count:w.count,win:w.amount/d.cents,positions:w.cells.map(([x])=>x),subgame_win_factor:1,paytable_factor:w.factor,wilds:[1,3,4].filter(s=>s===1||game.free).flatMap(s=>{const positions=w.cells.filter(([x,y])=>game.grid[x][y]===s).map(([x])=>x);return positions.length?[{symbol:symbol(s),factor:1,positions}]:[];})})),
  scatters_win:game.wins.filter(w=>!w.line).map(w=>({symbol:1,count:w.count,symbol_count:w.count,win:w.amount/d.cents,positions:w.cells.map(([x,y])=>[y,x]),paytable_factor:w.factor,subgame_win_factor:1,bonus_type:'free_games',bonus_value:15})),
  subgame_bonus:[],expanded_wilds:[],win:game.winCents/d.cents,total_win:game.totalWin/d.cents,subgame_factor:1,is_free:game.free?1:0,is_last:i===round.games.length-1,
  free_games:game.freeSpins,free_game_number:game.freeGameNumber,free_game_total:game.free?game.freeGameTotal:0,
 }));
}
export function createVikingsRouter(options={}){
 return createCtProtocolRouter({spinFn:spinRound,configFn:vikingsConfig,initialGrid:()=>spin(25).grid,selectedLines:25,cookieName:'ct_vikings_demo',apiPath:'/app/api/casino/vikingsfun',mapRound:mapVikingsRound,...options});
}
