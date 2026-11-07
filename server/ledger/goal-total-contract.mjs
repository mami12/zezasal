/** Only explicit whole-match/whole-half goal totals may use goal counters.
 * Named player totals, clock windows and other props are separate contracts.
 */
const normalized=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export function goalTotalContract(market={},teams={}){
 let name=normalized(market.market_name??market.marketName??market.name);
 name=name.replace(/^(?:(?:full[ .-]*time|match)[ .:-]+|(?:first|1st|second|2nd)[ .-]*half[ .:-]+|(?:1h|2h|ht)[ .:-]+)/,'');
 name=name.replace(/\s*\(?\d+(?:[.,]\d+)?\)?\s*$/,'').replace(/[ .:-]+$/,'').trim();
 const base=value=>/^(?:total(?: goals?)?|goals? total|over\s*\/?\s*under|under\s*\/?\s*over|goal line|total(?: goals?)?\s*[-.:]?\s*(?:over\s*\/?\s*under|under\s*\/?\s*over))$/.test(value);
 if(base(name))return {scope:'total'};
 const home=normalized(teams.homeTeam??teams.home_team??teams.home),away=normalized(teams.awayTeam??teams.away_team??teams.away);
 const identities=[['home',['home','home team','team 1','1st team',home]],['away',['away','away team','team 2','2nd team',away]]];
 for(const [scope,labels] of identities)for(const label of labels.filter(Boolean)){
  if(name.startsWith(label+' ')&&base(name.slice(label.length).trim().replace(/^[.:-]+\s*/,'')))return {scope};
  if(name.endsWith(' '+label)&&base(name.slice(0,-label.length).trim().replace(/[.:-]+$/,'')))return {scope};
 }
 return null;
}
