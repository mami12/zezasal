/** One freshness contract for publication, sockets and real bet acceptance. */
export const LIVE_QUOTE_MAX_AGE_MS=120000;
export const PREMATCH_QUOTE_MAX_AGE_MS=90*60000;
export function quoteValidUntil(updatedAt,match={},prematchMaxAgeMs=PREMATCH_QUOTE_MAX_AGE_MS){
 const at=updatedAt instanceof Date?updatedAt.getTime():typeof updatedAt==='number'?updatedAt:Date.parse(String(updatedAt??''));
 if(!Number.isFinite(at)||at<=0)return null;
 const live=match.live===true||String(match.service??match.status??'').toUpperCase()==='LIVE';
 return at+(live?LIVE_QUOTE_MAX_AGE_MS:Number(prematchMaxAgeMs)||PREMATCH_QUOTE_MAX_AGE_MS);
}
/** undefined is a legacy response; explicit null means an unverified quote. */
export function quoteExpired(deadline,now=Date.now()){
 return deadline===null||(deadline!==undefined&&(!Number.isFinite(deadline)||now>deadline));
}
