import {liveContract} from './live-contract-rules.mjs';
import {teamStatisticsFromRow} from '../match-statistics.mjs';
const safe=v=>v!=null&&v!==''&&Number.isSafeInteger(Number(v))&&Number(v)>=0?Number(v):null;
const time=v=>v!=null&&Number.isFinite(new Date(v).getTime())?new Date(v).getTime():null;
const fail=message=>Object.assign(new Error(message),{status:400,code:'MARKET_EVIDENCE_UNSUPPORTED'});
const eventish=name=>/\b(?:next|race to|reaches\s+\d+|(?:first|last|[1-9]\d*(?:st|nd|rd|th))\s+(?:goal|corner)|minutes?|mins?|within|before|after)\b|\b(?:yellow|red)\s+cards?\b|\b(?:second\s+yellow|yellow\s+red)\b|\b(?:goalscorer|goal\s+scorer)s?\b|\bplayer\s+to\s+score\b/i.test(name);
/** Freeze what was actually offered at purchase, never derive a live target
 * from the scoreboard when the bet is paid or the page is refreshed.
 */
export function frozenLiveContract(line,match={},at=Date.now()){
 const teams=teamStatisticsFromRow(match);
 const service=String(match.service??'').toUpperCase();
 const kickoff=time(match.start_at??match.startAt);
 // A genuinely unstarted PREMATCH fixture has a verified zero baseline even
 // when the upstream scoreboard does not yet include a score/corner snapshot.
 // Never guess the zero baseline on a past-due or unidentified fixture.
 const scheduled=service==='PREMATCH'&&kickoff!==null&&kickoff>at;
 const clockMs=match.match_time_ms;
 const clock=scheduled?null:Number.isFinite(Number(clockMs))&&clockMs!=null?Number(clockMs)/60000:null;
 const goals={home:scheduled?0:safe(match.home_score),away:scheduled?0:safe(match.away_score)};
 const corners={home:scheduled?0:safe(teams.home?.corners),away:scheduled?0:safe(teams.away?.corners)};
 // Resolve team-name outcomes against this exact fixture, never by fuzzy
 // prefixes or a team's position in another match.
 const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 const label=norm(line.outcome_name??line.outcomeName);
 const home=norm(match.home??match.home_team),away=norm(match.away??match.away_team);
 const selected=label&&home&&label===home?'1':label&&away&&label===away?'2':null;
 const market=norm(line.market_name??line.marketName);
 const hasTeam=name=>name&&(' '+market.replace(/[^\p{L}\p{N}]+/gu,' ')+' ').includes(' '+name.replace(/[^\p{L}\p{N}]+/gu,' ')+' ');
 const homeNamed=hasTeam(home),awayNamed=hasTeam(away);
 const windowMarket=/\b(?:minutes?|mins?|within|before|until)\b/.test(market)&&['yes','no','po','jo'].includes(label);
 if(windowMarket&&homeNamed&&awayNamed)throw fail('Nuk identifikohet një skuadër e vetme për intervalin.');
 const windowSide=windowMarket&&(homeNamed||awayNamed)?(homeNamed?'home team':'away team'):null;
 const namedLine=windowSide?{...line,market_name:windowSide+' '+market}:line;
 const prepared=selected?{...line,outcome_name:selected,outcomeName:selected}:namedLine;
 const contract=liveContract(prepared,{clock,counts:{goal:goals,corner:corners},teams:match});
 const name=String(line.market_name??line.marketName??'');
 if(service==='PREMATCH'&&!scheduled)throw fail('Ndeshja prematch nuk ka fillim të ardhshëm të verifikuar.');
 if(!contract){
  if(eventish(name))throw fail('Ky treg nuk ka kusht të verifikueshëm në këtë moment.');
  return null;
 }
 const live=String(match.service??'').toUpperCase()==='LIVE';
 const current=contract.event==='goal'?goals:contract.event==='corner'?corners:null;
 if(live&&(contract.kind==='sequence'||contract.kind==='race'||contract.kind==='window')){
  const observedAt=time(match.score_at);
  const clockAt=time(match.clock_at);
  if((contract.event==='goal'&&(goals.home==null||goals.away==null||observedAt===null))||
      clock===null||clockAt===null||at-clockAt>45000||clockAt-at>5000||
      (observedAt!==null&&(at-observedAt>90000||observedAt-at>5000)))throw fail('Të dhënat live nuk janë mjaftueshëm të freskëta.');
 }
 if(contract.kind==='sequence'&&current?.home!=null&&current?.away!=null&&
    contract.target<=current.home+current.away)throw fail('Goli/korneri i kërkuar ka ndodhur tashmë.');
 if(contract.kind==='nth-time'&&current?.home!=null&&current?.away!=null&&
    contract.target<=current.home+current.away)throw fail('Goli i kërkuar ka ndodhur tashmë.');
 if(contract.kind==='race'&&current?.home!=null&&current?.away!=null&&
    (current.home>=contract.target||current.away>=contract.target))throw fail('Gara e golave/kornerave ka përfunduar.');
 if(contract.kind==='window'&&clock!=null&&clock>contract.to)throw fail('Intervali i këtij tregu ka përfunduar.');
 // A fixed interval already in progress may contain events before purchase.
 // Without a verified acceptance-time incident baseline, accepting it would
 // allow a customer to bet on a goal/corner/card that has already happened.
 if(live&&contract.kind==='window'&&!contract.startExclusive&&clock!=null&&clock>=contract.from)
  throw fail('Intervali ka nisur; nuk mund të pranohet bast për ngjarje të kaluara.');
 if(contract.kind==='interval-result'&&clock!=null&&clock*60>=contract.toExclusiveSeconds)
  throw fail('Intervali i rezultatit ka përfunduar.');
 // Live "Next Goal" needs *exactly* the current confirmed cumulative count.
 // Never infer it from the displayed odds or the browser's score.
 if(contract.kind==='sequence'&&/next/i.test(name)&&
    (current?.home==null||current?.away==null))throw fail('Mungon numri i konfirmuar i golave/kornerave.');
 return (contract.kind==='sequence'||contract.kind==='race')&&current?.home!=null&&current?.away!=null
  ?{...contract,baseline:{home:current.home,away:current.away}}:contract;
}
