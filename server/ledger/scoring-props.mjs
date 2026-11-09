/**
 * Score-based football props whose rules require the verified HT and FT
 * scoreboards, not a heuristic event list. Only explicit complete market
 * titles are recognized. Unknown provider nomenclature stays PENDING.
 *
 * Soccer sportsbook rules: 90 minutes plus stoppage, not extra time;
 * half-specific and either/both-halves selections are distinct contracts.
 */
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[.–—:-]+/g,' ').replace(/\s+/g,' ').trim();
const YES=new Set(['yes','po']),NO=new Set(['no','jo']);
const resultChoice=v=>YES.has(norm(v))?true:NO.has(norm(v))?false:null;
const int=v=>v!==null&&v!==undefined&&v!==''&&Number.isSafeInteger(Number(v))&&
 Number(v)>=0&&Number(v)<=100?Number(v):null;
const halfOf=v=>/^(?:1st|first)$/.test(v)?1:/^(?:2nd|second)$/.test(v)?2:null;
const exactName=(value,label)=>label&&norm(value)===norm(label);
const sideOf=(label,result)=>{
 const n=norm(label);
 if(['1','home','home team','team 1'].includes(n)||exactName(n,result?.home_team))return 'home';
 if(['2','away','away team','team 2'].includes(n)||exactName(n,result?.away_team))return 'away';
 if(['x','draw','tie','equal','same','neither','none'].includes(n))return 'none';
 return null;
};
const subject=(name,result)=>{
 const labels=[
  ['home',['home team','team 1','home',result?.home_team]],
  ['away',['away team','team 2','away',result?.away_team]]
 ];
 for(const [side,aliases] of labels)for(const alias of aliases.filter(Boolean)){
  const prefix=norm(alias)+' ';
  if(name.startsWith(prefix))return {side,rest:name.slice(prefix.length)};
 }
 return {side:null,rest:name};
};
const titleOf=line=>{
 let s=norm(line?.market_name??line?.marketName??line?.name);
 // The native feed uses both "1st half - Home Team to score" and
 // "Home Team to score in 1st half". They are equivalent only here.
 const pref=s.match(/^(1st|first|2nd|second) half (.+)$/);
 if(pref&&/^(?:home team|away team|team [12]|home|away) to score$/.test(pref[2]))
  s=pref[2]+' in '+pref[1]+' half';
 return s;
};
export function scoringPropFamily(line){
 const name=titleOf(line);
 if(/^both teams to score in both halves$/.test(name))return 'both-teams-both';
 if(/^(?:a |at least one )?goals? in both halves$|^score in both halves$/.test(name))return 'goal-both';
 if(/^highest scoring half$|^half with (?:the )?most goals$/.test(name))return 'high-half';
 if(/^win both halves$|^to win both halves$/.test(name))return 'win-both';
 if(/^win either half$|^to win either half$/.test(name))return 'win-either';
 if(/^win to nil$/.test(name))return 'win-nil';
 const withoutPrefix=name.replace(/^(?:home team|away team|team [12]|home|away) /,'');
 if(/^(?:(?:to )?score in both halves|to win both halves|to win either half|(?:to )?win to nil|highest scoring half|goals? odd\s*\/?\s*even|exact goals?)$/.test(withoutPrefix))
  return /^to score in both halves$|^score in both halves$/.test(withoutPrefix)?'team-score-both':
   /^to win both halves$/.test(withoutPrefix)?'team-win-both':
   /^to win either half$/.test(withoutPrefix)?'team-win-either':
   /^(?:to )?win to nil$/.test(withoutPrefix)?'team-win-nil':
   /^highest scoring half$/.test(withoutPrefix)?'team-high-half':
   /^goals? odd\s*\/?\s*even$/.test(withoutPrefix)?'team-parity':'team-exact';
 if(/^(?:home team|away team|team [12]|home|away) to score(?: a goal)?$/.test(name))return 'team-score';
 if(/^(?:home team|away team|team [12]|home|away) to score in (?:1st|first|2nd|second) half$/.test(name))return 'team-score-half';
 // Full team names are supported only when the rest of the title is an
 // exact recognised grammar. A substring match against a team is unsafe.
 if(/ (?:to score(?: a goal)?|to score in (?:1st|first|2nd|second) half|to score in both halves|to win (?:both|either) halves|win to nil|highest scoring half|goals? odd\s*\/?\s*even|exact goals?)$/.test(name)&&
    !/\b(?:both teams|either team|any team)\b/.test(name))return 'team-named';
 return null;
}
export const isScoringPropMarket=line=>scoringPropFamily(line)!==null;

export function gradeScoringPropMarket(line,result){
 if(!result)return null;
 const family=scoringPropFamily(line);
 if(!family)return null;
 const ftHome=int(result.home_score),ftAway=int(result.away_score);
 if(ftHome===null||ftAway===null)return null;
 const halfHome=int(result.half_home_score),halfAway=int(result.half_away_score);
 const halvesKnown=halfHome!==null&&halfAway!==null&&halfHome<=ftHome&&halfAway<=ftAway;
 const secondHome=halvesKnown?ftHome-halfHome:null,secondAway=halvesKnown?ftAway-halfAway:null;
 const selection=norm(line.outcome_name??line.outcomeName??line.outcome_key??line.outcomeKey);
 const binary=resultChoice(selection);
 const title=titleOf(line);
 const named=subject(title,result);
 const side=named.side;
 const first=(s)=>s==='home'?halfHome:halfAway;
 const second=(s)=>s==='home'?secondHome:secondAway;
 const full=(s)=>s==='home'?ftHome:ftAway;
 const yesNo=(v)=>binary===null?null:(binary===v?'WON':'LOST');
 const pickSide=()=>side??sideOf(selection,result);
 const namedOnly=(v)=>side?yesNo(v):null;
 if(family==='both-teams-both')
  return halvesKnown?yesNo(halfHome>0&&halfAway>0&&secondHome>0&&secondAway>0):null;
 if(family==='goal-both')
  return halvesKnown?yesNo(halfHome+halfAway>0&&secondHome+secondAway>0):null;
 if(family==='high-half'||family==='team-high-half'||/highest scoring half$/.test(title)){
  if(!halvesKnown)return null;
  const h=family==='high-half'?halfHome+halfAway:first(side);
  const a=family==='high-half'?secondHome+secondAway:second(side);
  if(h===null||a===null)return null;
  const expected=h>a?'home':a>h?'away':'none';
  const label=selection;
  const picked=['first half','1st half','1st','first','1','home'].includes(label)?'home':
   ['second half','2nd half','2nd','second','2','away'].includes(label)?'away':
   ['draw','same','equal','tie','x','none'].includes(label)?'none':null;
  return picked===null?null:picked===expected?'WON':'LOST';
 }
 const kind=family==='team-named'
  ? /to score in both halves$/.test(title)?'team-score-both':
    /to win both halves$/.test(title)?'team-win-both':
    /to win either half$/.test(title)?'team-win-either':
    /win to nil$/.test(title)?'team-win-nil':
    /to score in (?:1st|first|2nd|second) half$/.test(title)?'team-score-half':
    /to score(?: a goal)?$/.test(title)?'team-score':
    /goals? odd\s*\/?\s*even$/.test(title)?'team-parity':
    /exact goals?$/.test(title)?'team-exact':null
  :family;
 if(kind==='team-score'){
  const s=pickSide();
  return s&&s!=='none'?(side?yesNo(full(s)>0):null):null;
 }
 if(kind==='team-score-half'){
  if(!halvesKnown||!side)return null;
  const h=title.match(/(?:1st|first|2nd|second) half$/)?.[0];
  const period=halfOf(h?.split(' ')[0]);
  return period===1?yesNo(first(side)>0):period===2?yesNo(second(side)>0):null;
 }
 if(kind==='team-score-both')return halvesKnown&&side?yesNo(first(side)>0&&second(side)>0):null;
 if(kind==='team-win-both'||kind==='team-win-either'||kind==='win-both'||kind==='win-either'){
  if(!halvesKnown)return null;
  const s=pickSide();
  if(s==='none')return null;
  if(!s)return null;
  const a=s==='home',wonFirst=a?halfHome>halfAway:halfAway>halfHome;
  const wonSecond=a?secondHome>secondAway:secondAway>secondHome;
  const met=kind.endsWith('both')?wonFirst&&wonSecond:wonFirst||wonSecond;
  return side?yesNo(met):met?'WON':'LOST';
 }
 if(kind==='team-win-nil'||kind==='win-nil'){
  const s=pickSide();
  if(!s||s==='none')return null;
  const met=s==='home'?ftHome>ftAway&&ftAway===0:ftAway>ftHome&&ftHome===0;
  return side?yesNo(met):met?'WON':'LOST';
 }
 if(kind==='team-parity'){
  if(!side||!['odd','even','tek','cift'].includes(selection))return null;
  const odd=full(side)%2===1;
  return ((selection==='odd'||selection==='tek')===odd)?'WON':'LOST';
 }
 if(kind==='team-exact'){
  if(!side||!/^\d{1,3}$/.test(selection))return null;
  return full(side)===Number(selection)?'WON':'LOST';
 }
 return null;
}
