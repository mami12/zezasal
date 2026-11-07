/** Independent expectation from symbol counts and scatter stop distributions. */
export function classicReelReturn(reels,pay,scatterPay,{wild=1,scatter=2,height=3}={}){
 const probabilities=reels.map(reel=>Array.from({length:pay.length},(_,i)=>reel.filter(s=>s===i+1).length/reel.length));
 let lined=0;const row=[];
 function visit(x,probability){
  if(x<reels.length){for(let symbol=1;symbol<=pay.length;symbol++){const p=probabilities[x][symbol-1];if(p){row[x]=symbol;visit(x+1,probability*p);}}return;}
  // Independently compare every possible paying target against its wild prefix.
  let best=0;
  for(let target=1;target<=pay.length;target++){
   if(target===scatter)continue;let count=0;
   while(count<row.length&&(row[count]===target||target!==wild&&row[count]===wild))count++;
   best=Math.max(best,pay[target-1][count-1]??0);
  }
  lined+=probability*best;
 }
 visit(0,1);
 let distribution=[1];
 for(const reel of reels){
  const counts=Array(height+1).fill(0);
  for(let stop=0;stop<reel.length;stop++){let count=0;for(let y=0;y<height;y++)if(reel[(stop+y)%reel.length]===scatter)count++;counts[count]++;}
  const next=Array(distribution.length+height).fill(0);
  for(let a=0;a<distribution.length;a++)for(let b=0;b<counts.length;b++)next[a+b]+=distribution[a]*counts[b]/reel.length;
  distribution=next;
 }
 const scattered=distribution.reduce((sum,p,count)=>sum+p*(scatterPay[count-1]??0),0);
 return {lined:lined*100,scatter:scattered*100,rtp:(lined+scattered)*100};
}
