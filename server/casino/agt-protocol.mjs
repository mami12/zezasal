import {randomInt} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DATA,spin} from './agt-engine.mjs';
import {CASINO_MIN_CENTS,casinoStakeCents,walletAgtBets} from './bet-limits.mjs';
const META=Object.fromEntries(Object.keys(DATA.games).map(id=>[id,JSON.parse(readFileSync(new URL('./agt-metadata/'+id+'.json',import.meta.url),'utf8'))]));
const money=cents=>cents/100;
export function formatAgtSpin(id,result,options={}){
 const d=DATA.games[id],linesMask=Array(d.lines.length+1).fill(0),linesValue=Array(d.lines.length+1).fill(0);
 for(const w of result.wins){
  linesMask[w.line]=w.line?parseInt('1'.repeat(w.count).padEnd(d.sx,'0'),2):w.cells.reduce((bits,[x,y])=>bits+2**(d.sx*d.sy-1-(y*d.sx+x)),0);
  linesValue[w.line]=w.amount/100;
 }
 const profile=result.mathProfile??options.mathProfile,requested=profile?profile.rtp:d.rtp,key=Object.keys(d.reels).find(value=>Number(value)===Number(requested));if(!key)throw Error('Unknown AGT reel profile');
 return {extracomb:d.reels[key].map(r=>r.map(s=>d.symbols[s-1])),comb:Array.from({length:d.sy},(_,y)=>result.grid.map(col=>d.symbols[col[y]-1])).flat(),linesMask,linesValue};
}
export function createAgtProtocol({spinFn=spin,cardRandom=randomInt}={}){
 return {
 initialState(id,options={}){const d=DATA.games[id];return ({cash:200000,pending:0,lines:d.lines.length,denom:1,bet:options.walletLimits?CASINO_MIN_CENTS:50,remaining:0,totalFree:0,bonusWin:0,history:Array.from({length:5},()=>cardRandom(4)),round:0,last:formatAgtSpin(id,spinFn(id,50,d.lines.length,options),options),...(options.walletLimits?{walletLimits:true}:{}),...(options.mathProfile?{mathProfile:{...options.mathProfile}}:{})});},
 run(s,params,options={}){const id=String(params.gamename||''),d=DATA.games[id],originalMeta=META[id];if(!d)throw Error('Invalid game');
  const meta=s.walletLimits?{...originalMeta,start:{...originalMeta.start,full_bets:walletAgtBets(originalMeta.start.full_bets)}}:originalMeta;
  const settle=()=>{s.cash+=s.pending;s.pending=0;};
  const snapshot=()=>({...meta.restore,...s.last,balance:money(s.cash),win:money(s.pending),li:s.lines,di:s.denom,amount:money(s.bet),bonus:s.remaining,bonus_all:s.totalFree,bonus_win:0,session_total_win_free:money(s.bonusWin),gamble_suit_history:s.history,last_bet_id:s.round});

   switch(String(params.action)){
    case 'start':return ({...meta.start,lang:'en',not_use_navigator_lang:true,balance:money(s.cash),user_id:'local-demo',currency:s.currency||meta.start.currency});
    case 'restore':case 'balance':return (snapshot());
    case 'save':settle();return (snapshot());
    case 'spin':case 'freespin':{
     const free=s.remaining>0,lines=Number(params.li),bet=Number(params.amount),cents=Math.round(bet*100),denom=Number(params.di);
     if((free?params.action!=='freespin':params.action!=='spin')||!Number.isSafeInteger(lines)||lines<1||lines>d.lines.length||!Number.isSafeInteger(denom)||denom<0||denom>=meta.start.k_list.length||!Number.isFinite(bet)||!Number.isSafeInteger(cents)||Math.abs(cents/100-bet)>1e-8||(!free&&!meta.start.full_bets?.[lines]?.includes(bet))||(free&&(lines!==s.lines||cents!==s.bet||denom!==s.denom)))throw Error('Invalid bet');
     if(s.walletLimits&&!free)casinoStakeCents(bet);
     if(!free&&s.cash+s.pending<cents)throw Error('Insufficient credits');
     // Keep the paid round's immutable reel profile throughout its free games.
     const mathProfile=free?s.mathProfile:(options.mathProfile??s.mathProfile),spinOptions={mathProfile};
     let result;
     if(!free&&options.customRound){
      const spins=structuredClone(options.customRound.spins);
      if(!spins.length)throw Error('Custom round is incomplete');
      result=spins.shift();s.customRound={version:options.customRound.version,spins};
     }else if(free&&s.customRound){
      result=s.customRound.spins.shift();if(!result)throw Error('Awarded custom bonus is incomplete');
     }else result=spinFn(id,cents,lines,spinOptions);
     if(mathProfile)s.mathProfile={...mathProfile};
     settle();if(!free){s.cash-=cents;s.totalFree=0;s.bonusWin=0;}else s.remaining--;
     s.pending=result.winCents;s.lines=lines;s.denom=denom;s.bet=cents;s.round++;
     s.remaining+=result.freeSpins;s.totalFree+=result.freeSpins;if(free)s.bonusWin+=result.winCents;
     if(s.customRound&&s.remaining===0){if(s.customRound.spins.length)throw Error('Unexpected custom bonus remainder');s.customRound=null;}
     s.last=formatAgtSpin(id,result,spinOptions);
     return ({...snapshot(),bonus_win:result.freeSpins});
    }
    case 'double':{
     if(s.remaining||s.totalFree||s.pending<=0)throw Error('Gamble unavailable');
     const choice=/^[0-3]$/.test(String(params.color))?'suit'+params.color:String(params.color);if(!['red','black','suit0','suit1','suit2','suit3'].includes(choice))throw Error('Invalid gamble');
     const suit=cardRandom(4),red=suit<2,hit=choice==='red'?red:choice==='black'?!red:choice==='suit'+suit;
     s.pending=hit?s.pending*(choice.startsWith('suit')?4:2):0;s.history.unshift(suit);s.history=s.history.slice(0,5);s.round++;
     return (snapshot());
    }
    case 'fscheck':case 'stats':return ({});
    default:throw Error('Unsupported command');
   }

 }
 };
}
