/**
 * Native correlated result/total, BTTS/total and double-chance combinations.
 * Each HALF is a separate game-scoring scope. 2H is (FT - HT), not FT.
 * No provider outcome is guessed; unknown labels stay ungraded.
 */
const fold=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/\s+/g,' ').trim();
const nonnegative=v=>v!==null&&v!==undefined&&v!==''&&Number.isSafeInteger(Number(v))&&
 Number(v)>=0&&Number(v)<200?Number(v):null;
const outcome=value=>String(value??'').trim();
const termResult=(value,home='',away='')=>{
 const n=fold(value);
 if(['1','home','home team','home win','w1'].includes(n)||fold(home)&&n===fold(home))return '1';
 if(['2','away','away team','away win','w2'].includes(n)||fold(away)&&n===fold(away))return '2';
 if(['x','draw','tie','barazim'].includes(n))return 'X';
 return null;
};
const btts=value=>{
 const s=fold(value).replace(/[^a-z0-9]/g,'');
 if(['yes','gg','po','bttsyes','bothteamstoscoreyes'].includes(s))return true;
 if(['no','ng','jo','bttsno','bothteamsnotoscore','bothteamstoscoreno'].includes(s))return false;
 return null;
};
const total=(value,quotedLine=null)=>{
 // Zizobet can supply "12 / Over" while 1.5 is frozen separately as
 // market.line OR as a numeric suffix in the native market title.
 const m=fold(value).match(/^(over|under|mbi|nen|lart|poshte)(?:\s*(\d{1,3}(?:[.,]\d+)?))?$/);
 if(!m)return null;
 const inline=m[2]==null?null:Number(m[2].replace(',','.'));
 if(inline!==null&&quotedLine!==null&&inline!==quotedLine)return null;
 const line=inline??quotedLine;
 return line!==null&&Number.isFinite(line)&&line>=0&&line<=50&&Number.isSafeInteger(line*2)?
  {direction:['over','mbi','lart'].includes(m[1])?'over':'under',line}:null;
};
const chance=value=>{
 const n=fold(value).replace(/[^a-z0-9]/g,'');
 if(['1x','homeordraw','draworhome','homeordraw'].includes(n))return '1X';
 if(['12','homeoraway','awayorhome'].includes(n))return '12';
 if(['x2','2x','awayordraw','draworaway'].includes(n))return 'X2';
 return null;
};
const parts=label=>{
 // "/" is a real quoted separator: "12 / Over", "1X / Under".
 // Normalize DC selections such as "1 / X" BEFORE splitting them.
 const s=outcome(label).replace(/\b1\s*\/\s*x\b/gi,'1X')
  .replace(/\bx\s*\/\s*2\b/gi,'X2').replace(/\b1\s*\/\s*2\b/gi,'12');
 if(!s)return null;
 const pieces=s.split(/\s*(?:&|\+|\||\band\b|\bwith\b|;|\/)\s*/i)
  .map(v=>v.trim()).filter(Boolean);
 return pieces.length===2?pieces:null;
};
const namedLine=raw=>{
 const match=String(raw??'').trim().match(/(?:\s*\(\s*(\d{1,3}(?:[.,]\d+)?)\s*\)|\s+(\d{1,3}(?:[.,]\d+)?))\s*$/);
 return match?Number((match[1]??match[2]).replace(',','.')):null;
};
const stripLine=name=>name.replace(/(?:\s*\(\s*\d{1,3}(?:[.,]\d+)?\s*\)|\s+\d{1,3}(?:[.,]\d+)?)\s*$/,'').trim();
const quoteLine=line=>{
 const name=line?.market_name??line?.marketName??line?.name??'';
 const nameLine=namedLine(name),raw=line?.line??line?.marketLine??
  line?.market_line??line?.accepted_contract?.providerLine;
 const specified=raw==null||String(raw).trim()===''?null:Number(String(raw).replace(',','.'));
 if(specified!==null&&(!Number.isFinite(specified)||specified<0||specified>50))return {conflict:true};
 if(nameLine!==null&&specified!==null&&nameLine!==specified)return {conflict:true};
 return {line:nameLine??specified};
};
const names={
 'result-total':/^(?:result|1x2|match result|full time result)\s+(?:and|&|\+)\s+(?:total|total goals?|goals? over\s*\/\s*under)$/,
 'result-btts':/^(?:result|1x2|match result|full time result)\s+(?:and|&|\+)\s+(?:both teams? (?:to )?score|btts)$/,
 'total-btts':/^(?:total|total goals?)\s+(?:and|&|\+)\s+(?:both teams? (?:to )?score|btts)$/,
 'dc-btts':/^double chance\s+(?:and|&|\+)\s+(?:both teams? (?:to )?score|btts)$/,
 'dc-total':/^double chance\s+(?:and|&|\+)\s+(?:total|total goals?)$/
};
export function isHalfComboFamily(line){
 const name=stripLine(fold(line?.market_name??line?.marketName??line?.name));
 const rest=name.replace(/^(?:(?:1st|first|2nd|second) half|full time|match)\s*[-:.\s]*/,'');
 return Object.values(names).some(regex=>regex.test(rest));
}
export function parseHalfCombination(line,teams={}){
 const original=stripLine(fold(line?.market_name??line?.marketName??line?.name));
 const quote=quoteLine(line);
 if(quote.conflict)return null; // Two contradictory advertised thresholds.
 const match=original.match(/^(1st|first|2nd|second) half\s*[-:.]?\s*(.+)$/);
 let half=0,name=original;
 if(match){half=/^(?:1st|first)$/.test(match[1])?1:2;name=match[2];}
 else name=name.replace(/^(?:full time|match)\s*[-:.]?\s*/,'');
 const explicit=Number(line?.period??0);
 if(!Number.isSafeInteger(explicit)||![0,1,2].includes(explicit)||
    (half===0&&explicit!==0)||(half!==0&&explicit!==0&&explicit!==half))return null;
 const family=Object.entries(names).find(([,regex])=>regex.test(name))?.[0];
 if(!family)return null;
 const candidates=[line?.outcome_name,line?.outcomeName,line?.outcome_key,line?.outcomeKey];
 for(const raw of candidates){
  const split=parts(raw);
  if(!split)continue;
  const [a,b]=split;
  if(family==='result-total'||family==='dc-total'){
   for(const [resultPart,totalPart]of [[a,b],[b,a]]){
    const choice=family==='dc-total'?chance(resultPart):
     termResult(resultPart,teams.home??teams.home_team,teams.away??teams.away_team);
    const summed=total(totalPart,quote.line);
    if(choice&&summed)return {version:1,kind:'half-combo',half,family,choice,
      totalDirection:summed.direction,totalLine:summed.line};
   }
  }else if(family==='result-btts'||family==='dc-btts'){
   for(const [winnerPart,bttsPart]of [[a,b],[b,a]]){
    const choice=family==='dc-btts'?chance(winnerPart):
     termResult(winnerPart,teams.home??teams.home_team,teams.away??teams.away_team);
    const yes=btts(bttsPart);
    if(choice&&yes!==null)return {version:1,kind:'half-combo',half,family,choice,btts:yes};
   }
  }else{
   for(const [totalPart,bttsPart]of [[a,b],[b,a]]){
    const summed=total(totalPart,quote.line),yes=btts(bttsPart);
    if(summed&&yes!==null)return {version:1,kind:'half-combo',half,family,
      totalDirection:summed.direction,totalLine:summed.line,btts:yes};
   }
  }
 }
 return null;
}
export function gradeHalfCombination(contract,result){
 if(!contract||contract.kind!=='half-combo'||!result)return null;
 const [h,a,hh,ha]=[result.home_score,result.away_score,result.half_home_score,
   result.half_away_score].map(nonnegative);
 if(h===null||a===null||contract.half&&
    (hh===null||ha===null||hh>h||ha>a))return null;
 const home=contract.half===1?hh:contract.half===2?h-hh:h;
 const away=contract.half===1?ha:contract.half===2?a-ha:a;
 const winner=home>away?'1':away>home?'2':'X';
 const dc=contract.choice==='1X'?winner!=='2':
  contract.choice==='X2'?winner!=='1':
  contract.choice==='12'?winner!=='X':null;
 let met=null;
 if(contract.family==='result-total'||contract.family==='result-btts')
  met=winner===contract.choice;
 else if(contract.family==='dc-btts'||contract.family==='dc-total')met=dc;
 const both=home>0&&away>0;
 if(contract.family==='result-btts'||contract.family==='dc-btts'){
  if(met===null||typeof contract.btts!=='boolean')return null;
  return met&&both===contract.btts?'WON':'LOST';
 }
 if(contract.family==='total-btts'&&typeof contract.btts!=='boolean')return null;
 const target=Number(contract.totalLine);
 if(!Number.isFinite(target)||target<0||target>50||!Number.isSafeInteger(target*2)||
    !['over','under'].includes(contract.totalDirection))return null;
 // A bookmaker's correlated quote containing an exact integer push is not
 // a full loss. Keep its existing all-void correlated-combo policy.
 if(home+away===target&&Number.isInteger(target))return 'VOID';
 const totalWins=contract.totalDirection==='over'?home+away>target:home+away<target;
 return (totalWins&&
   (contract.family==='total-btts'?both===contract.btts:met===true))?'WON':'LOST';
}
