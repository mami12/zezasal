import {marketDiagnosticAll} from '../market-diagnostic.mjs';
import {selectBoardMarkets} from '../board-markets.mjs';
import {isDecidedLiveMarket} from './decided-markets.mjs';
import {marketIsEnabled} from '../market-catalog.mjs';
export function isBoardOddsRow(o){
 if(Number(o.period??0)!==0)return false;
 const name=String(o.market_name??'').trim().toLowerCase();
 return /^(?:1\s*x\s*2|match result|full[ .-]*time[ .-]*result|match winner|winner|moneyline|result|3way|3-way|double chance|dc|both teams (?:to )?score|btts|both score|next goal|next team to score|first team to score|team to score(?: first)?|first goal|goli i radh[eÃ«ë]s|total(?: goals?)?|over\s*\/?\s*under|under\s*\/?\s*over|goals(?: over\s*\/?\s*under)?|goal line)(?:\s*(?:\([^)]+\)|\d+(?:[.,]\d+)?))?$/.test(name);
}
/** Keep the small set of full-time board contracts, including alternate goal
 * lines and double chance. The browser chooses a visible line; removing those
 * contracts here would make its fallback impossible. Full markets stay on detail.
 */
export function projectBoardMatches(matches) {
  if(marketDiagnosticAll())return matches.map(match=>({...match,markets:(match.markets??[]).filter(market=>marketIsEnabled(market,match))}));
  return matches.map(match=> {
    const chosen=new Map();
    for(const market of match.markets??[]) {
      if(Number(market.period??0)!==0) continue;
      const name=String(market.name??'').trim().toLowerCase().replace(/\s+/g,' ');
      let kind;
      // The team-level next-goal column is a board contract of its own, and the
      // filter below exists to drop half-time, player and team-total markets.
      // It matches words like "first", "next" and "team", so the column has to
      // be claimed before that filter can discard it. Goal-timing markets
      // ("when will goal N be scored") and player markets stay out here.
      const nextGoalType=/NEXT_GOAL|NEXTGOAL|NEXT_TEAM_TO_SCORE|GOAL_NEXT|FIRST_TEAM_TO_SCORE|TEAM_TO_SCORE/.test(String(market.marketType??'').trim().toUpperCase());
      const nextGoalName=!/when\s+will|interval|goalscorer|scorer|player/.test(name)&&/next\s+goal|next\s+team\s+to\s+score|first\s+team\s+to\s+score|team\s+to\s+score|goli\s+i\s+radh/.test(name);
      if(nextGoalType||nextGoalName){if(!chosen.has('nextgoal'))chosen.set('nextgoal',market);continue;}
      if(/\b(?:half|halves|quarter|period|extra[ -]?time|overtime|first|last|next|min(?:ute)?s?|corners?|cards?|bookings?|handicap|asian|home|away|team)\b|\+|&/.test(name)) continue;
      if(/^(?:1\s*x\s*2|match result|full[ .-]*time[ .-]*result|match winner|winner|moneyline|result|3way|3-way)(?:\s*(?:\(1x2\)|\(xup\)|\([^)]+\)))?$/.test(name)) kind='result';
      else if(/^(?:full[ .-]*time[ .-]*)?(?:double chance|dc)$/.test(name)) kind='dc';
      else if(/^(?:full[ .]*time[ .]*)?(?:both teams (?:to )?score|btts|both score)$/.test(name)) kind='btts';
      else if(/^(?:full[ .-]*time[ .-]*)?(?:total(?: goals?)?|over\s*\/?\s*under|under\s*\/?\s*over|goals(?: over\s*\/?\s*under)?|goal line)(?:\s*\(?\d+(?:[.,]\d+)?\)?)?$/.test(name)) {
        // Keep every actual goal line, even if currently suspended. A locked
        // primary must remain identifiable instead of silently changing contract.
        kind='total:'+chosen.size;
      }
      if(kind&&!chosen.has(kind)) chosen.set(kind,market);
      // A provider can label the same full-time contract differently, so one
      // extra candidate per kind survives this projection and reaches the
      // browser. Selection order in board-markets.mjs decides whether it is
      // actually displayed; nothing here can override a strict match.
      if(!kind&&!/\b(?:ht|ft)\b/.test(name)){
        const type=String(market.marketType??'').trim().toUpperCase();
        const fallback=/^(?:1X2)$/.test(type)?'result-extra':/^(?:OVER_UNDER|TOTAL|TOTALS|TOTAL_GOALS)$/.test(type)?'total-extra:'+chosen.size:null;
        if(fallback&&!chosen.has(fallback)) chosen.set(fallback,market);
      }
    }
    return {...match,marketCount:match.marketCount??match.markets?.length??0,markets:[...chosen.values()]};
  });
}

/** Run after account-independent visibility rules so a globally hidden main
 * market cannot prevent the configured DC/BTTS fallback. */
export function projectClientBoardMatches(matches){return matches.map(match=>{
 const markets=match.markets??[],available=m=>!isDecidedLiveMarket(match,m)&&(m.outcomes??[]).some(o=>o.decided!==true&&o.odds!=null),suspended=m=>!isDecidedLiveMarket(match,m)&&(m.status==='SUSPENDED'||(m.outcomes??[]).some(o=>o.feedSuspended||o.riskSuspended));
 const selected=selectBoardMarkets(markets,available,suspended,match);
 return {...match,marketCount:match.marketCount??markets.length,markets:[selected.primary,selected.total,selected.nextGoal].filter(Boolean)};
});}
