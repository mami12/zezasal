import {useSyncExternalStore} from 'react';
import {quoteExpired} from '../../../server/ledger/quote-validity.mjs';
// A single light clock services every button. React only rerenders a subscriber
// when its expired/not-expired snapshot changes, not on every clock tick.
const listeners=new Set<()=>void>();
let timer:ReturnType<typeof setInterval>|undefined;
const check=()=>listeners.forEach(listener=>listener());
function subscribe(listener:()=>void){
 listeners.add(listener);
 if(!timer){timer=setInterval(check,1000);window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);}
 return()=>{listeners.delete(listener);if(!listeners.size&&timer){clearInterval(timer);timer=undefined;window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);}};
}
export const useQuoteExpiry=(deadline:number|null|undefined)=>useSyncExternalStore(subscribe,()=>quoteExpired(deadline),()=>quoteExpired(deadline));
