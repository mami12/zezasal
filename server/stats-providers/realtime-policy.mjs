/** Bounded, match-aware cadence for secondary information (never bookmaker odds).
 * No REST provider can guarantee a per-incident push without its own push API.
 * Poll live missing facts quickly, preflight lineups before kickoff, and back
 * off for FT and on rate-limited or unavailable sources.
 */
const int=(value,fallback,min,max)=>{
 const n=Number(value);
 return value!=null&&String(value).trim()!==''&&Number.isFinite(n)?
  Math.max(min,Math.min(max,Math.round(n))):fallback;
};
export const fixtureFinished=row=>row?.final===true||
 [row?.status,row?.feed_status].some(value=>
 /^(?:ft|full.?time|finished|ended|cancelled|canceled)(?:\b|$)/i.test(String(value??'')));
export const fixtureLive=row=>!fixtureFinished(row)&&
 String(row?.service??row?.status??'').toUpperCase()==='LIVE';
export const prematchSoon=(row,now=Date.now(),env={})=>{
 if(fixtureFinished(row)||String(row?.service??'').toUpperCase()!=='PREMATCH')return false;
 const kickoff=Date.parse(row?.start_at??row?.startAt??'');
 const ahead=int(env.STATS_PREMATCH_WINDOW_MS,2*60*60*1000,5*60*1000,24*60*60*1000);
 return Number.isFinite(kickoff)&&kickoff>=now-5*60*1000&&kickoff-now<=ahead;
};
export const supplementalRefreshMs=(row,env={})=>{
 if(env.STATS_REALTIME_ENABLED==='false')return 10*60*1000;
 if(fixtureLive(row))return int(env.STATS_LIVE_REFRESH_MS,30000,15000,5*60*1000);
 if(prematchSoon(row,Date.now(),env))return int(env.STATS_PREMATCH_REFRESH_MS,300000,60000,30*60*1000);
 return 10*60*1000;
};
/** Ignore advancing clocks: only material result/incident count changes wake enrichment. */
export function sportingFingerprint(row){
 const s=row?.stats??{};
 const raw=row?.raw??{};
 return JSON.stringify([
  row?.home_score??null,row?.away_score??null,
  row?.feed_status??row?.status??null,
  raw?.eventTimeline?.length??null,
  raw?.eventTimeline?.at?.(-1)?.id??null,
  row?.corners_home??s?.home?.corners??null,
  row?.corners_away??s?.away?.corners??null,
  row?.cards_home??null,row?.cards_away??null
 ]);
}
