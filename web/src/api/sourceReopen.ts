type State={locked:boolean;at:number};
/** Only a newer, explicit source reopening can restore omitted REST markets.
 * Price movements and first-time snapshots do not cause catalog refetches. */
export function createSourceReopenTracker(onReopen:(matchId:string)=>void){
 const states=new Map<string,State>();
 return {
  observe(matchId:string,key:string,locked:boolean,at:number,announce=false,canOpen=true){
   if(!Number.isFinite(at)||at<=0||(!locked&&!canOpen))return;
   const previous=states.get(key);if(previous&&(at<previous.at||(at===previous.at&&locked!==previous.locked)))return;
   states.set(key,{locked,at});
   if(states.size>30000)states.delete(states.keys().next().value!);
   if(announce&&previous?.locked===true&&!locked&&at>previous.at)onReopen(matchId);
  },
 };
}
