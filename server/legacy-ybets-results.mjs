import {YbetsHttpClient} from './ybets/client.mjs';
import {isYbetsMatchId,nativeMatchId,normalizeMatch,normalizeInfo} from './ybets-normalize.mjs';
/** Existing accepted tickets retain their original provider. This never
 * publishes fixtures or odds to the new board and never remaps a ticket ID. */
export function startLegacyYbetsResults({getIds,onFinal,http=new YbetsHttpClient({timeoutMs:10000,retries:0})}){
 let stopped=false,paused=false,running=null,controller=null,timer=null;
 async function tick(){if(stopped||paused||running)return;const activeController=controller=new AbortController();running=(async()=>{
  for(const id of getIds().filter(isYbetsMatchId)){
     if(stopped||paused)break;
     try{const match=await http.getMatch(nativeMatchId(id),{signal:activeController.signal}),info=normalizeInfo(match);
    if(stopped||info.feedStatus!=='Finished'||info.homeScore==null||info.awayScore==null)continue;
    const row=normalizeMatch(match),now=new Date();row.raw.ybetsFinalScoreVerified=true;
    await onFinal(info,{...row,home_score:info.homeScore,away_score:info.awayScore,score_at:now,feed_status:'Finished',feed_status_at:now,periods_score:info.periodsScore??null});
   }catch{/* Missing final evidence remains pending for the existing review path. */}
  }
 })();try{await running;}finally{running=null;if(controller===activeController)controller=null;}}
 const arm=()=>{clearInterval(timer);timer=setInterval(()=>void tick(),60000);timer.unref?.();};
 arm();void tick();
 return{pause(){if(stopped||paused)return false;paused=true;clearInterval(timer);timer=null;controller?.abort();return true;},resume(){if(stopped||!paused)return false;paused=false;arm();void tick();return true;},stop(){stopped=true;clearInterval(timer);timer=null;controller?.abort();},async drain(){await running;}};
}
