/**
 * Financial idempotency keys must work on HTTP LAN/mobile sessions.
 * randomUUID() is only exposed in secure contexts on many browsers,
 * while getRandomValues() is available without HTTPS.
 *
 * NEVER fall back to Math.random: a predictable or colliding request key
 * must not be used to identify payments and bet-placement retries.
 */
export function createClientRequestId(source=globalThis.crypto){
  if(typeof source?.randomUUID==='function')return source.randomUUID();
  if(typeof source?.getRandomValues!=='function')
    throw new Error('This browser cannot generate secure payment request IDs. Open the site in a modern browser or through HTTPS.');
  const bytes=new Uint8Array(16);
  source.getRandomValues(bytes);
  bytes[6]=(bytes[6]&15)|64; // RFC 4122 version 4
  bytes[8]=(bytes[8]&63)|128; // variant 10
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
