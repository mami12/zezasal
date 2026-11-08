/**
 * Double Chance + Both Teams To Score: an accepted two-part proposition.
 * An opaque/unknown provider outcome is NOT an automatic losing bet.
 * Supported quote labels explicitly identify BOTH the DC side and BTTS.
 */
export function isDcBttsMarket(value){
 const s=String(value??'').toLowerCase();
 return /double\s*chance.*(?:both.*score|\bbtts\b|\bgg\b)|(?:both.*score|\bbtts\b|\bgg\b).*double\s*chance|\bdc\b.*\bbtts\b|\bbtts\b.*\bdc\b/.test(s);
}
const fold=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[^a-z0-9]/g,'');
const sides=[
 ['homeordraw','1X'],['draworhome','1X'],['awayordraw','X2'],
 ['draworaway','X2'],['homeoraway','12'],['awayorhome','12'],
 ['1x','1X'],['x2','X2'],['12','12']
];
const answers=new Map([
 ['yes',true],['gg',true],['po',true],['bttsyes',true],
 ['bothteamsscoreyes',true],['bothteamstoscoreyes',true],
 ['bothteamsscore',true],['bothteamstoscore',true],
 ['no',false],['ng',false],['jo',false],['bttsno',false],
 ['bothteamsscoreno',false],['bothteamstoscoreno',false],
 ['bothteamsnottoscore',false]
]);
export function parseDcBttsOutcome(...values){
 for(const value of values){
  const raw=fold(value);
  if(!raw||raw.length>160)continue;
  for(const [label,dc] of sides){
   const suffix=raw.startsWith(label)?raw.slice(label.length):null;
   const prefix=raw.endsWith(label)?raw.slice(0,-label.length):null;
   for(const remainder of [suffix,prefix]){
    if(!remainder||!answers.has(remainder))continue;
    return {dc,btts:answers.get(remainder)};
   }
  }
 }
 return null;
}
export function gradeDcBtts(selection,home,away){
 if(!selection||!Number.isSafeInteger(home)||home<0||
    !Number.isSafeInteger(away)||away<0)return null;
 const homeWin=home>away,awayWin=away>home,draw=home===away;
 const dcSatisfied=selection.dc==='1X'?homeWin||draw:
  selection.dc==='12'?homeWin||awayWin:
  selection.dc==='X2'?awayWin||draw:null;
 if(dcSatisfied===null||typeof selection.btts!=='boolean')return null;
 return dcSatisfied&&(home>0&&away>0)===selection.btts?'WON':'LOST';
}
