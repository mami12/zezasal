import { DATA,PAY,SPRITES } from './lucky-clover-engine.mjs';
import {CT_LINE_BETS,walletCtDenoms} from './bet-limits.mjs';
export const DENOMS=[{id:1,label:'0.01',cents:1},{id:2,label:'0.02',cents:2},{id:3,label:'0.05',cents:5},{id:4,label:'0.10',cents:10},{id:5,label:'0.20',cents:20},{id:6,label:'0.50',cents:50},{id:7,label:'1.00',cents:100}];
export const symbol=s=>SPRITES[s-1];
export const rows=grid=>Array.from({length:3},(_,y)=>grid.map(r=>symbol(r[y])));
export function ctConfig(grid,options={}){
 const denoms=options.walletLimits?walletCtDenoms(options.selectedLines??5):DENOMS;
 const requested=options.mathProfile?options.mathProfile.rtp:DATA.defaultRtp,key=Object.keys(DATA.reels).find(value=>Number(value)===Number(requested));if(!key)throw Error('Unknown Lucky Clover reel profile');
 const paytable={};for(let s=4;s<=11;s++){paytable[symbol(s)]={};PAY[s-1].forEach((p,i)=>{if(p)paytable[symbol(s)][i+1]={factor:p};});}
 const scatter=factor=>({factor,bonus_type:'none',bonus_value:0});
 return {
  app_name:'Lucky Clover x3',directory_name:'LuckyCloverX3',base_game_id:0,columns:5,rows:3,
  main_subgame_label:'main',main_subgame_reels_set:'main',subgames_labels:{main:{subgame_id:'main'}},
  reels_sets:{main:{reels:DATA.reels[key].map(r=>r.map(symbol)),symbols:Array.from({length:11},(_,i)=>i+1)}},
  paytables:{main:{paytable,paytable_wilds:{11:{}},paytable_scatters:{1:{3:scatter(3),4:scatter(20),5:scatter(100)},10:{3:scatter(20)}}}},
  lines:DATA.lines.slice(0,5),lines_mode:1,lines_per_credit:1,lines_min_number:5,lines_max_number:5,lines_step_numbers:[5],
  line_min_bet:options.walletLimits?CT_LINE_BETS[0]:1,line_max_bet:options.walletLimits?25000:100,line_default_bet:options.walletLimits?CT_LINE_BETS[0]:1,line_step_bet_numbers:options.walletLimits?[...CT_LINE_BETS]:[1,2,3,4,5,6,8,10,12,15,20,24,30,40,50,60,80,100],line_step_bet_numbers_quick:options.walletLimits?[100,500,2500,12500,25000]:[1,6,12,24],
  game_denoms:Object.fromEntries(denoms.map(d=>[d.label,true])),init_screen:rows(grid),
  double:{double_enable:1,double_enter_limit:10000000,double_limit:10000000},
  autoplay:1,autoplay_steps:[10,20,50,75,100],show_autoplay_settings:'show_game_and_main_screen',
  reel_rotate_mintime:1000,skill_stop_enabled:1,allow_client_demo_request:0,pjp_enabled:0,diamond_bonus_enabled:0,extra_bet_enabled:0,win_limit:0,
  RTP:Object.fromEntries(denoms.map(d=>[d.label,[{percent:String(options.mathProfile?.customMath?.rtp??key)}]]))
 };
}
