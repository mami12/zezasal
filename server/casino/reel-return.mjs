/** Exact finite-reel expectation for the unchanged legacy adapter scanners. */
export function reelReturn(reels,paytable,lines,{wild=null,scatter=0,scatterPay={},expanding=null}={}){
 const models=reels.map(reel=>{
  const probabilities=Array.from({length:3},()=>new Map()),scatters=Array(4).fill(0);let expands=0;
  for(let stop=0;stop<reel.length;stop++){
   const cells=Array.from({length:3},(_,row)=>reel[(stop+row)%reel.length]);
   cells.forEach((symbol,row)=>probabilities[row].set(symbol,(probabilities[row].get(symbol)||0)+1/reel.length));
   scatters[cells.filter(s=>s===scatter).length]+=1/reel.length;
   if(expanding!=null&&cells.every(s=>s===expanding))expands+=1/reel.length;
  }
  return {probabilities,scatters,expands};
 });
 let lineReturn=0;
 for(const line of lines)for(const [symbolKey,pays]of Object.entries(paytable)){
  const symbol=Number(symbolKey);if(symbol===scatter)continue;let prefix=1,allWild=1;
  for(let length=1;length<=5;length++){
   const probabilities=models[length-1].probabilities[line[length-1]],pw=wild==null?0:(probabilities.get(wild)||0);
   prefix*=((probabilities.get(symbol)||0)+pw);allWild*=pw;
   const multiplier=pays[length]||0;if(!multiplier)continue;
   const next=length<5?models[length].probabilities[line[length]]:null;
   const stop=next?1-(next.get(symbol)||0)-(wild==null?0:(next.get(wild)||0)):1;
   lineReturn+=(prefix-allWild)*stop*multiplier;
  }
 }
 let distribution=[1],expanded=[1];
 for(const model of models){
  const next=Array(distribution.length+3).fill(0);
  distribution.forEach((p,n)=>model.scatters.forEach((q,m)=>{next[n+m]+=p*q;}));distribution=next;
  const extra=Array(expanded.length+1).fill(0);
  expanded.forEach((p,n)=>{extra[n]+=p*(1-model.expands);extra[n+1]+=p*model.expands;});expanded=extra;
 }
 const scatterReturn=distribution.reduce((sum,p,n)=>sum+p*(scatterPay[n]||0),0);
 const extra=expanding==null?0:expanded.reduce((sum,p,n)=>sum+p*(paytable[expanding]?.[n]||0),0);
 return {rtp:(lineReturn/lines.length+scatterReturn+extra)*100,triggerProbability:distribution.slice(3).reduce((a,b)=>a+b,0)};
}
