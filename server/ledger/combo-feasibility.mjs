// Pure shared contract check: final scores can never be below confirmed live scores.
import { isResultBttsMarket, parseResultBttsOutcome } from './result-btts.mjs';
const resultSets = { '1':['1'], X:['X'], '2':['2'], '1X':['1','X'], '12':['1','2'], X2:['X','2'] };
export function canComboStillWin(legs, home, away) {
  if (!Array.isArray(legs) || legs.length !== 2 || ![home,away].every(n=>Number.isSafeInteger(n)&&n>=0)) return true;
  let results = ['1','X','2'], btts = null, low = -1, high = Infinity;
  for (const leg of legs) {
    if (leg.market === '1X2' || leg.market === 'DC') {
      const allowed = resultSets[leg.outcome];
      if (!allowed) return true;
      results = results.filter(result=>allowed.includes(result));
    } else if (leg.market === 'BTTS') {
      if (!['Yes','No'].includes(leg.outcome)) return true;
      btts = leg.outcome === 'Yes';
    } else if (leg.market === 'TOTAL') {
      const line = Number(leg.line);
      if (!Number.isFinite(line) || line < 0 || !['Over','Under'].includes(leg.outcome)) return true;
      if (leg.outcome === 'Over') low = Math.max(low,Math.floor(line));
      else high = Math.min(high,Math.ceil(line)-1);
    } else return true;
  }
  // No-BTTS has two branches: home stays at zero, or away stays at zero.
  const branches = btts === false ? [[home,away,true,false],[home,away,false,true]]
    : [[btts ? Math.max(1,home) : home,btts ? Math.max(1,away) : away,false,false]];
  for (const [h,a,zeroHome,zeroAway] of branches) {
    if ((zeroHome && h>0) || (zeroAway && a>0)) continue;
    for (const result of results) {
      let minH = h, minA = a;
      if (result === '1') minH = Math.max(h,a+1);
      else if (result === '2') minA = Math.max(a,h+1);
      else minH = minA = Math.max(h,a);
      if ((zeroHome && minH>0) || (zeroAway && minA>0)) continue;
      const minimum = minH+minA;
      if (minimum>high) continue;
      // A drawn No-BTTS score is only 0-0. Otherwise scores can grow;
      // draws grow in steps of two, other results in steps of one.
      const step = result === 'X' ? 2 : 1;
      const target = minimum>low ? minimum : minimum+Math.ceil((low+1-minimum)/step)*step;
      if ((result !== 'X' || (!zeroHome && !zeroAway) || target===0) && target<=high) return true;
    }
  }
  return false;
}

const fold = value=>String(value??'').toLowerCase().trim().replace(/\s+/g,' ');
const resultOf = (text,match)=> {
  const s=fold(text).replace(/^result\s*:?\s*/,'');
  if (['1','home','home win','w1',fold(match.homeTeam??match.home)].filter(Boolean).includes(s)) return '1';
  if (['2','away','away win','w2',fold(match.awayTeam??match.away)].filter(Boolean).includes(s)) return '2';
  if (['x','draw','tie'].includes(s)) return 'X';
  const dc=s.replace(/\s*\/\s*/g,'').toUpperCase();
  return ['1X','12','X2'].includes(dc)?dc:null;
};
const parseLeg = (text,match,line) => {
  const raw=String(text).trim(), explicit=raw.match(/^(1X2|DC|BTTS|TOTAL)\s+(.+)$/i);
  const kind=explicit?.[1].toUpperCase(), value=explicit?.[2]??raw;
  const result=resultOf(value,match);
  if ((!kind || kind==='1X2'||kind==='DC')&&result) return {market:result.length===2?'DC':'1X2',outcome:result,line:''};
  if (!kind || kind==='TOTAL') {
    const total=value.match(/^(over|under)\s*(\d+(?:[.,]\d+)?)?$/i);
    const threshold=total?.[2]??line;
    if(total&&threshold!=null&&String(threshold).trim()!==''&&Number.isFinite(Number(String(threshold).replace(',','.')))) return {market:'TOTAL',outcome:total[1][0].toUpperCase()+total[1].slice(1).toLowerCase(),line:String(threshold).replace(',','.')};
  }
  if ((!kind || kind==='BTTS')&&/^(yes|no|gg|ng|g\/g|n\/g)$/i.test(value)) return {market:'BTTS',outcome:/^(yes|gg|g\/g)$/i.test(value)?'Yes':'No',line:''};
  return null;
};

/** Decode only explicitly identified full-time combo contracts, never a plain total. */
export function comboOutcomeLegs(match,market) {
  const name=fold(market?.name??market?.market_name);
  if (Number(market?.period??0)!==0 || /\b(?:half|1st|2nd|ht|ft|corners?|cards?|players?|handicap|next|extra)\b/.test(name)) return null;
  if (Array.isArray(market?.comboLegs)&&market.comboLegs.length===2) return market.comboLegs;
  const labels=[market?.outcomeName,market?.outcomeCode,market?.outcome_name,market?.outcome_key];
  if(isResultBttsMarket(name)) {
    for(const text of labels) {
      const parsed=parseResultBttsOutcome(text,match.homeTeam??match.home,match.awayTeam??match.away);
      if(parsed) return [{market:'1X2',outcome:parsed.result,line:''},{market:'BTTS',outcome:parsed.bothScore?'Yes':'No',line:''}];
    }
  }
  const combo=/^bet builder\s*:/.test(name)||/\b(?:result|1x2|double chance|total|goals|btts|both teams)\b.*(?:\band\b|\bwith\b|[&+]).*(?:result|total|goals|btts|both teams|score)/.test(name);
  if (!combo) return null;
  for (const text of labels) {
    const parts=String(text??'').split(/\s*(?:\band\b|\bwith\b|[&+])\s*/i);
    if (parts.length!==2) continue;
    const legs=parts.map(part=>parseLeg(part,match,market?.line??market?.specifier));
    if (legs.every(Boolean)&&legs[0].market!==legs[1].market) return legs;
  }
  return null;
}

export function isImpossibleLiveCombination(match,market) {
  if (String(match?.service??match?.status).toUpperCase()!=='LIVE'&&match?.live!==true) return false;
  if (('score_at' in match&&!match.score_at)||('scoreAt' in match&&!match.scoreAt)) return false;
  const h=match.home_score??match.homeScore??match.score?.home, a=match.away_score??match.awayScore??match.score?.away;
  if(h==null||a==null||h===''||a==='') return false;
  const legs=comboOutcomeLegs(match,market);
  return !!legs&&!canComboStillWin(legs,Number(h),Number(a));
}
