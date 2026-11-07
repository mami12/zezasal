// TEMPORARY MARKET DIAGNOSTIC SWITCH
// MARKET_DIAGNOSTIC_ALL=1 disables every presentation-side market filter so
// the board shows exactly what the original feed returns.
const TRUE = new Set(['1','true','yes','on','all']);
export function marketDiagnosticAll(){
  return TRUE.has(String(typeof process !== 'undefined' ? process.env.MARKET_DIAGNOSTIC_ALL ?? '' : '').trim().toLowerCase());
}
