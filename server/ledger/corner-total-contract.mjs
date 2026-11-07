/** Only explicit corner OVER/UNDER totals can use aggregate corner counters.
 * Race, next corner, corner winner and interval markets require event evidence.
 * Never use the sum of both teams for a home/away contract.
 */
const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export function cornerTotalContract(line={},teams={}){
 let name=norm(line.market_name??line.marketName??line.name);
 if(!/\bcorners?\b/.test(name)||
    /\b(?:race|next|first|last|which|who|most|winner|result|1x2|chance|handicap|asian|odd|even|exact|range|between|minute|minutes|interval|period|half|card|booking|player|extra|time)\b|[&+]/.test(name))return null;
 name=name.replace(/\s*\(?\d+(?:[.,]\d+)?\)?\s*$/,'').replace(/^[ .:-]+|[ .:-]+$/g,'').trim();
 const strip=value=>value.replace(/^\s*[.:-]+\s*|\s*[.:-]+\s*$/g,'').trim();
 const base=value=>/^(?:total corners?|corners? total|corners?|total corner kicks?|corner kicks? total)$/.test(strip(value));
 if(base(name))return {scope:'total'};
 const home=norm(teams.home_team??teams.homeTeam??teams.home);
 const away=norm(teams.away_team??teams.awayTeam??teams.away);
 for(const [scope,aliases] of [['home',['home team','home','team 1','1st team',home]],['away',['away team','away','team 2','2nd team',away]]]){
  for(const alias of [...new Set(aliases.filter(Boolean))]){
   if(name.startsWith(alias+' ')&&base(strip(name.slice(alias.length))))return {scope};
   if(name.endsWith(' '+alias)&&base(strip(name.slice(0,-alias.length))))return {scope};
   if(name.startsWith('total '+alias+' ')&&base('total '+strip(name.slice(('total '+alias).length))))return {scope};
   if(name.startsWith('corners '+alias+' ')&&base(strip(name.slice(('corners '+alias).length))))return {scope};
  }
 }
 return null;
}
