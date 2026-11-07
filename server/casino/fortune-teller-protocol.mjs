import {createCtProtocol} from './ct-protocol.mjs';
import {CT_LINE_BETS,walletCtDenoms} from './bet-limits.mjs';
import {FORTUNE_DATA,FORTUNE_LINES,FORTUNE_PAY,FORTUNE_SCATTER,FORTUNE_FREE_SPINS,initialFortuneGrid,spinFortuneRound} from './fortune-teller-engine.mjs';
import {withFortuneNativeProtocol} from './fortune-teller-native.mjs';
const symbol=value=>'symbol'+(Number(value)-1);
const rows=grid=>Array.from({length:3},(_,row)=>grid.map(reel=>symbol(reel[row])));
export function fortuneTellerConfig(grid,options={}){
 const rtp=Number(options.mathProfile?.rtp??FORTUNE_DATA.defaultRtp),reels=FORTUNE_DATA.reels[String(rtp)];
 if(!reels)throw Error('Unsupported Fortune Teller reels');
 const paytable=Object.fromEntries(FORTUNE_PAY.map((p,index)=>[symbol(index+1),Object.fromEntries(p.flatMap((factor,index)=>factor?[[index+1,{factor}]]:[]))]));
 const denoms=walletCtDenoms(20);
 return {app_name:'Fortune Teller',columns:5,rows:3,init_screen:rows(grid),lines:FORTUNE_LINES.map(line=>line.map(row=>row+1)),
  lines_min_number:20,lines_max_number:20,lines_step_numbers:[20],line_step_bet_numbers:[...CT_LINE_BETS],line_min_bet:100,line_max_bet:25000,line_default_bet:100,
  game_denoms:Object.fromEntries(denoms.map(d=>[d.label,true])),paytables:{main:{paytable,paytable_wilds:{symbol0:{}},paytable_scatters:{symbol1:Object.fromEntries([2,3,4,5].map(count=>[count,{factor:FORTUNE_SCATTER[count-1],bonus_value:FORTUNE_FREE_SPINS[count-1]}]))}},
   free:{paytable,paytable_wilds:{symbol0:{},symbol1:{}},paytable_scatters:{}}},
  double:{double_enable:0},reels_sets:{main:{reels:reels.map(reel=>reel.map(symbol))}},
  theoretical_rtp:FORTUNE_DATA.returns[String(rtp)].twentyLines.rtp,source_reel_profile:rtp};
}
export function mapFortuneRound(round,_command,denom){
 let total=0;
 return round.games.map((game,index)=>{
  total+=game.winCents;
  return {type:'slot_subgame',step_number:index,subgame_label:game.free?'free':'main',is_free:game.free?1:0,is_last:index===round.games.length-1,
   result_reels:rows(game.grid),stop_reels:game.grid.map(reel=>reel.map(symbol)),win:game.winCents/denom.cents,total_win:total/denom.cents,
   lines_win:game.wins.filter(win=>win.line).map(win=>({line_number:win.line-1,symbol:symbol(win.symbol),symbol_count:win.count,win:win.amountCents/denom.cents,positions:win.cells, paytable_factor:win.multiplier})),
   scatters_win:game.wins.filter(win=>!win.line).map(win=>({symbol:symbol(win.symbol),symbol_count:win.count,win:win.amountCents/denom.cents,positions:win.cells,bonus_value:win.freeSpins??0})),
   free_games:game.freeSpins,free_game_number:game.freeGameNumber,free_game_total:game.freeGameTotal,
   ...(game.cardsBonus?{cards_bonus:{cards:game.cardsBonus.cards,multiplier:game.cardsBonus.multiplier,win:game.cardsBonus.amountCents/denom.cents}}:{})};
 });
}
export function createFortuneTellerProtocol({random}={}){
 const make=lines=>createCtProtocol({selectedLines:lines,allowGamble:false,configFn:fortuneTellerConfig,mapRound:mapFortuneRound,walletDenoms:()=>walletCtDenoms(20),walletMaxLineBet:Math.floor(500000/lines),
  initialGrid:options=>initialFortuneGrid({...options,...(random?{random}:{})}),
  spinFn:(stakeCents,lines,options)=>spinFortuneRound({stakeCents,lines,mathProfile:options.mathProfile,...(random?{random}:{})})});
 return withFortuneNativeProtocol(make(20),(state,command,options)=>make(command.lines).run(state,[command],options)[0]);
}
