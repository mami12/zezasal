import {createContext,useContext,useRef,useSyncExternalStore} from 'react';
type State={oddsDeltas:Record<string,any>;lockedOutcomes:Record<string,boolean>;riskLockedOutcomes:Record<string,boolean>;lockedMarkets:Record<string,boolean>;lockedMatches:Record<string,boolean>;combosEnabled:boolean;feedMode:string;refreshVersion:number};
const empty:State={oddsDeltas:{},lockedOutcomes:{},riskLockedOutcomes:{},lockedMarkets:{},lockedMatches:{},combosEnabled:true,feedMode:'live',refreshVersion:0};
export function createOutcomeStore(){let state=empty;const listeners=new Set<()=>void>();return{get:()=>state,subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},publish(next:State){state=next;for(const fn of listeners)fn();}};}
const fallback=createOutcomeStore();export const OutcomeFeedContext=createContext(fallback);
export function useOutcomeFeed(matchId:string,marketId:string,outcomeId:string,legs:{marketId:string;outcomeId:string}[]=[]){
 const store=useContext(OutcomeFeedContext),cache=useRef<{values:any[];slice:State}>();
 const get=()=>{const state=store.get(),outcomes=[outcomeId,...legs.map(l=>l.outcomeId)],markets=[marketId,...legs.map(l=>l.marketId)];const values=[matchId,outcomes.join(),markets.join(),state.feedMode,state.combosEnabled,state.refreshVersion,state.lockedMatches[matchId],...outcomes.flatMap(id=>[state.oddsDeltas[id],state.lockedOutcomes[id],state.riskLockedOutcomes[id]]),...markets.map(id=>state.lockedMarkets[id])];
  if(cache.current&&values.length===cache.current.values.length&&values.every((v,i)=>Object.is(v,cache.current!.values[i])))return cache.current.slice;
  const pick=(source:Record<string,any>,keys:string[])=>Object.fromEntries(keys.map(id=>[id,source[id]]));const slice={...state,oddsDeltas:pick(state.oddsDeltas,outcomes),lockedOutcomes:pick(state.lockedOutcomes,outcomes),riskLockedOutcomes:pick(state.riskLockedOutcomes,outcomes),lockedMarkets:pick(state.lockedMarkets,markets),lockedMatches:pick(state.lockedMatches,[matchId])};cache.current={values,slice};return slice;};
 return useSyncExternalStore(store.subscribe,get,get);
}
