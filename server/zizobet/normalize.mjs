import {competitionDecision,isSyntheticFootballMatch} from '../football-competitions.mjs';
export const OFFSET=8_000_000_000_000;
export const zId=id=>{if(!Number.isSafeInteger(Number(id))||Number(id)<=0||Number(id)>100000000000)throw Error('Invalid Zizobet ID');return OFFSET+Number(id);};
export const isZizoId=id=>Number(id)>OFFSET&&Number(id)<OFFSET+100000000000;
const text=v=>String(v??'').trim();
const slug=s=>text(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const pair=s=>{const m=text(s).match(/^(\d+):(\d+)$/);return m?m.slice(1).map(Number):null;};
const stamp=s=>{if(!s)return null;const n=Date.parse(/[zZ]|[+]\d\d:\d\d$/.test(s)?s:s+'Z');return Number.isFinite(n)?new Date(n):null;};
/** Full live dictionaries contain display placeholders different from prematch
 * templates. Read their actual quote parameters; never infer a time window
 * from the current clock or from its advertised five/ten/fifteen-minute size. */
export function resolveMarketTitle(raw,q,{intervalWidth}={}){
 let name=text(raw).replace(/^\*\s*/,'');
 // Race-to-X is a quote parameter, NOT the literal letter X. Refuse an
 // ambiguous offer instead of showing a misleading threshold on the ticket.
 const race=name.match(/^((?:(?:1st|first|2nd|second) half\s*[-–.:]\s*)?)(?:(?:which team wins (?:the )?)?race to x (corners?|goals?)\??)$/i);
 if(race){
  const kind=/goals?/i.test(race[2])?'goals':'corners';
  const rawVals=[q.h,q.p3,q.p1,q.p2,q.total,q.handicap,q.line];
  const validVals=rawVals
    .filter(v=>v!==null&&v!==undefined&&String(v).trim()!=='')
    .map(v=>Number(v))
    .filter(v=>Number.isSafeInteger(v)&&v>=1&&v<=100);
  if(validVals.length){
    name=race[1]+'Which team wins race to '+validVals[0]+' '+kind;
  }
 }
 if(/^When will next goal be scored/i.test(name)&&/^\d+$/.test(text(q.p3))){
  const explicit=name.match(/in (\d+) minutes interval/i)?.[1];
  const width=explicit??intervalWidth;
  return 'When will goal '+q.p3+' be scored'+(width?' ('+width+'-minute intervals)':'');
 }
 const interval=name.match(/^(Who scores most goals|Who takes most Corners|Total \[total\](?: Corners)?|Who scores the \[goal!\] goal) in (\d+) minutes interval \[from\]-\[to\]$/i);
 if(interval){
  const from=Number(q.p1),to=Number(q.p2);
  if(q.p1==null||q.p2==null||!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<from)return null;
  let subject=/^Who scores most/i.test(interval[1])?'Who scores most goals':/^Who takes/i.test(interval[1])?'Who takes most corners':/Corners$/i.test(interval[1])?'Total corners':'Total goals';
  if(/^Who scores the/i.test(interval[1])){if(!/^\d+$/.test(text(q.p3)))return null;subject='Who scores goal '+q.p3;}
  return subject+' in minutes '+from+'-'+to+' ('+interval[2]+'-minute interval)';
 }
 if(/^Correct score \[\{score\}\]$/i.test(name)){
  if(!pair(q.p3))return null;
  return 'Correct score rest of match (from '+q.p3+')';
 }
 if(/^(?:(?:1st|2nd) half - )?Correct score AAMS-logic$/i.test(name))name=name.replace(/ AAMS-logic$/i,'');
 const values=Object.fromEntries(Object.entries({...q,from:q.p1,to:q.p2,total:q.h,handicap:q.h,player:q.pl,score:q.p3,'goal!':q.p3,'!scorenr':q.p3}).map(([k,v])=>[k.toLowerCase(),v]));
 name=name.replace(/\{([^{}]+)\}|\[([^\[\]]+)\]/g,(token,a,b)=>{const field=String(a??b).trim().toLowerCase().replace(/_r$/,'');return values[field]!=null?String(values[field]):token;});
 // An unresolved token describes an unknown contract, not a display label.
 // Keep numeric score/range notation, but never offer guessed minutes/players.
 if(/[{}]|\[[^\[\]]*[a-z!_][^\[\]]*\]/i.test(name))return null;
 return name;
}
export function rowOf(game,meta,live){
 game={...game,ID:game.ID??game.GameID??game.id};
 const home=meta.teams.get(Number(game.Team1??game.t1))?.Name,away=meta.teams.get(Number(game.Team2??game.t2))?.Name;
 if(!home||!away)return null;
 const country=meta.regions.get(Number(game.Region??game.region)),champ=meta.champs.get(Number(game.Champ??game.ch));
 if(isSyntheticFootballMatch({home,away,tournament_name:champ?.Name,category_name:country?.Name,category_slug:slug(country?.Name),isEsport:game.IsEsport??game.isEsport,isSimulated:game.IsSimulated??game.isSimulated,isVirtual:game.IsVirtual??game.isVirtual}))return null;
 if(!live&&!competitionDecision({name:champ?.Name},{slug:slug(country?.Name)}).allowed)return null;
 return{match_id:zId(game.ID??game.id),sport_id:18,sport_tag:'football',category_id:Number(country?.ID??game.Region??game.region),category_name:country?.Name,category_slug:slug(country?.Name),tournament_id:Number(champ?.ID??game.Champ??game.ch),tournament_name:champ?.Name,tournament_slug:slug(champ?.Name),home,away,service:live?'LIVE':'PREMATCH',start_at:stamp(game.StartTime??game.st),status:'scheduled',phase:null,is_real:true,is_hot:false,raw:{provider:'ZIZOBET',nativeId:game.ID??game.id,homeTeam:{id:'home'},awayTeam:{id:'away'}}};
}
export function infoOf(row,game,meta){
 const status=Number(game.EventStatus??game.MatchStatusID),phase=meta.statuses.get('1_'+status),score=pair(game.Score);
 const hasOpenOdds=row.service==='LIVE'
  ? game.LiveBetStatus==null?undefined:game.LiveBetStatus===true&&status!==40
  : typeof game.s==='boolean'?game.s:undefined;
 const info={matchId:row.match_id,feedStatus:status===40&&score?'Finished':status===40?'Result Pending':phase==='1st half'?'First Half':phase==='2nd half'?'Second Half':phase??(row.service==='LIVE'?'Live':'Not Started'),...(hasOpenOdds===undefined?{}:{hasOpenOdds})};
 if(score){info.homeScore=score[0];info.awayScore=score[1];}
 try{const periods=typeof game.SetScores==='string'?JSON.parse(game.SetScores):game.SetScores;if(Array.isArray(periods)&&periods.length>=2){const values=periods.map(pair);if(values[0]&&values[1]){info.periodsScore=values.slice(0,2).map(p=>({t1:p[0],t2:p[1]}));if(periods.length>2){info.homeScore=values[0][0]+values[1][0];info.awayScore=values[0][1]+values[1][1];}}else if(status===40&&periods.length>2){delete info.homeScore;delete info.awayScore;info.feedStatus='Result Pending';}}}catch{if(status===40&&/extra|penalt/i.test(phase??''))info.feedStatus='Result Pending';}
 const clock=text(game.MatchTimeExtended).match(/^(\d+):(\d{2})$/),minute=Number(game.MatchTime);
 if(clock)info.matchTimeMs=(Number(clock[1])*60+Number(clock[2]))*1000;else if(game.MatchTime!=null&&text(game.MatchTime)!==''&&Number.isFinite(minute))info.matchTimeMs=minute*60000;
 const stats={home:{},away:{}};
 for(const [name,field]of[['Corners','corners'],['YellowCards','yellow'],['RedCards','red']])for(const [i,side]of[[1,'home'],[2,'away']]){const v=game[name+'Team'+i];if(v!=null&&Number.isInteger(Number(v))&&Number(v)>=0)stats[side][field]=Number(v);}
 if(Object.keys(stats.home).length||Object.keys(stats.away).length)info.stats=stats;
 return info;
}
export function oddsOf(row,quotes,meta,live,open=true){
 const rows=[];
 const widths=new Map();for(const q of quotes??[]){const p=text(meta.positions?.get(String(q.pid))??q.pn).match(/^min\s+(\d+)-(\d+)$/i);if(!p)continue;const width=Number(p[2])-Number(p[1])+1;if(width<=0)continue;const counts=widths.get(Number(q.mid))??new Map();counts.set(width,(counts.get(width)??0)+1);widths.set(Number(q.mid),counts);}
 for(const q of quotes??[]){const id=Number(q.mid),def=(live?meta.liveMarkets:meta.preMarkets).get(id);if(!def)continue;
  if(id===27073)continue;
  const rawName=def.Name??def.name;if(!rawName)continue;
  if((def.IsOverUnder===true||def.ou===true)&&q.h!=null&&Math.abs(Number(q.h)*4)%2===1)continue;
  const params=Object.fromEntries(['p1','p2','p3','pl','comp','seq'].filter(k=>q[k]!=null).map(k=>[k,q[k]]));
  const key='zz'+id+'@'+Buffer.from(JSON.stringify(params)).toString('base64url'),line=q.h!=null?String(q.h):'';
  const position=live?(meta.positions.get(String(q.pid))??q.pn??q.pname):def.pos?.find(p=>Number(p.id)===Number(q.pos))?.nm;
  if(!position)continue;
  const measuredWidth=[...(widths.get(id)??[])].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0];
  let name=resolveMarketTitle(live&&id===18639?'Correct score [{score}]':rawName,q,{intervalWidth:measuredWidth});if(!name)continue;
  if(live&&id===602)name='1X2';
  name=name.replace(/\bHometeam\b/gi,'Home team').replace(/\bAwayteam\b/gi,'Away team');
  if(q.pl&&!name.includes(String(q.pl)))name+=' · '+q.pl;
  const fullResult=(live&&id===602)||(!live&&id===448);
  const fullTotal=(live&&id===603)||(!live&&id===537);
  const label=resolveMarketTitle(position,q);if(!label)continue;
  const canonical=/^(?:1|x|2|1x|12|x2)$/i.test(label)?label.toUpperCase():/^(?:over|o)$/i.test(label)?'Over':/^(?:under|u)$/i.test(label)?'Under':/^(?:yes|no)$/i.test(label)?label[0].toUpperCase()+label.slice(1).toLowerCase():null;
  const price=Number(live?q.v:q.coef),suspended=!open||q.visible===false||q.lock===true||q.res!=null&&q.res!==0||!Number.isFinite(price)||price<=1;
  // Preserve the untouched public API name/selection and quote parameters
  // for the durable PostgreSQL archive. Browser labels are a separate layer.
  const nativeQuote=Object.fromEntries(
   ['mid','id','pid','pos','pn','h','p1','p2','p3','pl','comp','seq','v','coef','visible','lock','res']
    .filter(k=>q[k]!==undefined).map(k=>[k,q[k]]));
  rows.push({matchId:row.match_id,marketKey:key,marketName:name,line,outcomeKey:'z'+String(q.id),
   outcomeName:label,price:Number.isFinite(price)&&price>1?price:null,suspended,
   providerId:'ZIZOBET',nativeMarketId:String(id),nativeOutcomeId:String(q.id),
   nativeMarketName:String(rawName),nativeOutcomeName:String(position),
   nativeParameters:params,nativeQuote,isBase:fullResult||fullTotal,
   column:fullResult?'result':fullTotal?'total':'other',order:Number(def.N??def.n??0),
   period:/\b(?:1st|first) half\b/i.test(name)?1:/\b(?:2nd|second) half\b/i.test(name)?2:0});
  // Canonical result/total keys are needed by existing builder and settlement rules.
  if(canonical)rows.at(-1).outcomeKey=canonical;
 }
 return dedupeMarketRows(rows);
}

/** Keep one complete provider contract, never mix its component prices with
 * another quote family. Different periods, subjects, lines and goal ranges
 * remain separate even if a translation happens to look similar. */
export function dedupeMarketRows(rows){
 const groups=new Map();for(const r of rows){const key=r.marketKey+'|'+r.line;const group=groups.get(key)??[];group.push(r);groups.set(key,group);}
 const accepted=[],signatures=new Set(),correctScores=new Map();
 const norm=s=>String(s).trim().toLowerCase().replace(/\s+/g,' ');
 for(const group of [...groups.values()].sort((a,b)=>a[0].marketKey.localeCompare(b[0].marketKey,undefined,{numeric:true}))){
  const r=group[0],base=[norm(r.marketName),r.period,r.line].join('|');
  const labels=[...new Set(group.map(q=>norm(q.outcomeName)))].sort();
  if(/^(?:(?:1st|2nd) half - )?correct score$/i.test(r.marketName)){
   const existing=correctScores.get(base);
   // These variants quote the same score contract with different grids.
   // Prefer the most complete grid, including its own "other score" quote.
   if(!existing||group.length>existing.length)correctScores.set(base,group);
   continue;
  }
  const signature=base+'|'+r.marketKey.split('@')[1]+'|'+JSON.stringify(labels);
  if(!signatures.has(signature)){signatures.add(signature);accepted.push(...group);}
 }
 for(const group of correctScores.values())accepted.push(...group);
 return accepted;
}
