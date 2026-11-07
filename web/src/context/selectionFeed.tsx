import {createContext,useContext,useSyncExternalStore} from 'react';
import type {BetSelection} from '../types';
export function createSelectionStore(){let ids=new Set<string>(),signature='';const listeners=new Set<()=>void>();return{has:(id:string)=>ids.has(id),subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},publish(values:BetSelection[]){const next=values.map(s=>s.outcomeId).sort().join('\n');if(next===signature)return;signature=next;ids=new Set(values.map(s=>s.outcomeId));listeners.forEach(fn=>fn());}};}
export const SelectionFeedContext=createContext({store:createSelectionStore(),addSelection:(_s:BetSelection)=>{},removeSelection:(_id:string)=>{}});
export function useOutcomeSelection(id:string){const context=useContext(SelectionFeedContext),selected=useSyncExternalStore(context.store.subscribe,()=>context.store.has(id),()=>false);return {isSelected:selected,addSelection:context.addSelection,removeSelection:context.removeSelection};}
