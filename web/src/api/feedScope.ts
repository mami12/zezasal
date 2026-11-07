import {useEffect} from 'react';
import type {Socket} from 'socket.io-client';
type Scope={boardIds?:string[];detail?:{id:string;category:string}|null;selectionIds?:string[]};
const owners=new Map<string,Scope>();let socket:Socket|undefined;
let queued=false;function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;send();});}
export function hasFeedInterest(id:string){return [...owners.values()].some(v=>v.boardIds?.includes(id)||v.detail?.id===id||v.selectionIds?.some(key=>key.startsWith(id+'|')));}
export function hasDetailFeedInterest(id:string){return [...owners.values()].some(v=>v.detail?.id===id);}
function send(){if(!socket?.connected)return;const values=[...owners.values()];socket.emit('feed:scope',{boardIds:[...new Set(values.flatMap(v=>v.boardIds??[]))],detail:values.map(v=>v.detail).filter(Boolean).slice(-1)[0]??null,selectionIds:[...new Set(values.flatMap(v=>v.selectionIds??[]))]});}
export function bindFeedScope(next:Socket){socket=next;next.on('connect',send);send();return()=>{next.off('connect',send);if(socket===next)socket=undefined;};}
export function useFeedScope(owner:string,scope:Scope){const value=JSON.stringify(scope);useEffect(()=>{owners.set(owner,JSON.parse(value));schedule();return()=>{owners.delete(owner);schedule();};},[owner,value]);}
