export type QuoteFingerprint={
 price:number;validUntil?:number|null;
 suspended?:boolean;quoteSuspended?:boolean
};
export function materialQuoteChange(previous:QuoteFingerprint|undefined,current:QuoteFingerprint):boolean;
export function mergeChangedFlags<T extends Record<string,unknown>>(previous:T,patch:Partial<T>):T;
