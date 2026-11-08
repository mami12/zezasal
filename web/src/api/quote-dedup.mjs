/** Ignore a repeated identical quote without losing expiry or suspension changes.
 * In particular, an unchanged price with a newer validity time is material.
 */
export function materialQuoteChange(previous,current){
 if(!previous)return true;
 return !Object.is(previous.price,current.price)||
  !Object.is(previous.validUntil,current.validUntil)||
  !Object.is(previous.suspended,current.suspended)||
  !Object.is(previous.quoteSuspended,current.quoteSuspended);
}
export function mergeChangedFlags(previous,patch){
 if(!patch||!Object.keys(patch).length)return previous;
 for(const [key,value] of Object.entries(patch))
  if(!Object.is(previous[key],value))return {...previous,...patch};
 return previous;
}
