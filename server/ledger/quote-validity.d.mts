export const LIVE_QUOTE_MAX_AGE_MS:number;
export const PREMATCH_QUOTE_MAX_AGE_MS:number;
export function quoteValidUntil(updatedAt:unknown,match?:unknown,prematchMaxAgeMs?:number):number|null;
export function quoteExpired(deadline:number|null|undefined,now?:number):boolean;
