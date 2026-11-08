import {liveContract} from './live-contract-rules.mjs';
import {teamStatisticsFromRow} from '../match-statistics.mjs';
const safe=v=>v!=null&&v!==''&&Number.isSafeInteger(Number(v))&&Number(v)>=0?Number(v):null;
const time=v=>v!=null&&Number.isFinite(new Date(v).getTime())?new Date(v).getTime():null;
const fail=message=>Object.assign(new Error(message),{status:400,code:'MARKET_EVIDENCE_UNSUPPORTED'});
const eventish=name=>/\b(?:next|race to|reaches\s+\d+|(?:first|last|[1-9]\d*(?:st|nd|rd|th))\s+(?:goal|corner)|minutes?|mins?|within|before|after)\b|\b(?:yellow|red)\s+cards?\b|\b(?:second\s+yellow|yellow\s+red)\b|\b(?:goalscorer|goal\s+scorer)s?\b|\bplayer\s+to\s+score\b|\b(?:1st|first|2nd|second)\s+half\b.*\b(?:corners?|cards?)\b/i.test(name);
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
 // Numbered/next card bets require the same accepted card counters that
 // Race-to-Cards already uses. PREMATCH baseline is verified zero.
 const cardSnapshot=line.raceCardSnapshot;
 const verifiedCards=scheduled?{home:0,away:0}:cardSnapshot?{
  home:safe(cardSnapshot.count_home),away:safe(cardSnapshot.count_away)
 }:null;
 const contract=liveContract(prepared,{clock,counts:{goal:goals,corner:corners,card:verifiedCards},teams:match});
 const name=String(line.market_name??line.marketName??'');
 if(service==='PREMATCH'&&!scheduled)throw fail('Ndeshja prematch nuk ka fillim të ardhshëm të verifikuar.');
 if(!contract){
  if(/\b(?:45|90)\+\s*min\.?/i.test(name)&&/\b(?:corners?|goals?|cards?)\b/i.test(name))
    throw fail('Intervali përfshin 45+/90+ me kohë shtesë; mungon verifikimi i minutave sipas pjesës së ndeshjes.');
  if(eventish(name))throw fail('Ky treg nuk ka kusht të verifikueshëm në këtë moment.');
  return null;
 }
 const live=String(match.service??'').toUpperCase()==='LIVE';

 const current=contract.event==='goal'?goals:contract.event==='corner'?corners:
  contract.event==='card'?verifiedCards:null;
 if(live&&(contract.kind==='sequence'||contract.kind==='race'||contract.kind==='window')){
  const observedAt=time(match.score_at);
  const clockAt=time(match.clock_at);
  if((contract.event==='goal'&&(goals.home==null||goals.away==null||observedAt===null))||
      clock===null||clockAt===null||at-clockAt>45000||clockAt-at>5000||
      (observedAt!==null&&(at-observedAt>90000||observedAt-at>5000)))throw fail('Të dhënat live nuk janë mjaftueshëm të freskëta.');
 }
 if(live&&contract.kind==='player-ordinal-goal'){
  const scoreAt=time(match.score_at),clockAt=time(match.clock_at);
  if(clock===null||goals.home===null||goals.away===null||
     scoreAt===null||clockAt===null||scoreAt>at+5000||
     at-scoreAt>90000||clockAt>at+5000||at-clockAt>45000)
    throw fail('Mungon ora ose rezultati LIVE i konfirmuar për golashënuesin.');
  if(contract.position==='first'&&goals.home+goals.away>0)
    throw Object.assign(new Error('Goli i parë ka ndodhur tashmë.'),{
      status:400,code:'MARKET_DECIDED'});
 }
 if(live&&contract.kind==='player-card'){
  const snapshot=line.playerCardSnapshot;
  const observed=time(snapshot?.observed_at),confirmed=time(snapshot?.confirmed_at);
  const through=snapshot?.through_minute==null?null:Number(snapshot.through_minute);
  if(clock===null||!snapshot||observed===null||confirmed===null||
     confirmed>observed||at-observed>45000||observed-at>5000||
     !Number.isFinite(through)||through<Math.floor(clock))
    throw fail('Mungon historiku i freskët dhe i konfirmuar i kartonëve për lojtarin LIVE.');
  if(snapshot.booked===true)
    throw Object.assign(new Error('Lojtari e ka marrë kartonin; tregu ka përfunduar.'),{
      status:400,code:'MARKET_DECIDED'});
 }
 if(live&&(contract.kind==='race'||contract.kind==='sequence')){
  if(contract.event==='card'){
   const observed=time(cardSnapshot?.observed_at);
   const confirmed=time(cardSnapshot?.confirmed_at);
   const through=cardSnapshot?.through_minute==null?null:Number(cardSnapshot.through_minute);
   // Never sell an already-decided card race from stale/missing aggregates.
   if(!current||current.home===null||current.away===null||
      observed===null||confirmed===null||confirmed>observed||
      at-observed>45000||observed-at>5000||
      through===null||!Number.isFinite(through)||clock===null||
      through<Math.floor(clock))
     throw fail('Mungon historiku i freskët dhe i konfirmuar i kartonëve për këtë garë LIVE.');
  }
  if(current?.home==null||current?.away==null)
   throw fail('Mungojnë numëruesit e konfirmuar të garës LIVE.');
 }
 if(live&&(contract.kind==='half-total'||contract.kind==='half-parity'||
  (contract.kind==='corner-comparison'&&contract.mode==='period-result'))){
  const clockAt=time(match.clock_at);
  const phase=norm(match.feed_status??match.phase??'');
  // Half totals may be offered while that half is underway. They must not
  // remain for sale after the verified HT/2H/FT transition.
  const finished=/^(?:ft|full time|finished|ended|result pending|cancelled|abandoned)\b/.test(phase);
  const firstEnded=/^(?:ht|half time|halftime|break time|2h|2nd half|second half)\b/.test(phase);
  if(clock===null||clockAt===null||at-clockAt>45000||clockAt-at>5000||
     !phase||finished||(contract.half===1&&firstEnded))
   throw fail('Periudha e marketit nuk është e hapur ose ora LIVE nuk është e konfirmuar.');
 }
 // The current match-wide scoreboard does not establish a 2H-only
 // race/ordinal baseline. Do not sell a half market on a guessed history.
 if(live&&(contract.kind==='half-race'||contract.kind==='half-last-event'))
  throw fail('Kërkohet historik i konfirmuar sipas pjesës për këtë treg LIVE.');
 if(live&&contract.kind==='corner-comparison'&&contract.mode==='wins-both'&&
    clock!==null&&clock>=45)
  throw fail('Ky treg LIVE kërkon verifikimin e rezultatit të kornerave në pjesën e parë.');
 if(live&&contract.kind==='half-first-event'){
  if(contract.half!==1)
   throw fail('Mungon numëruesi i verifikuar i ngjarjeve të pjesës së dytë LIVE.');
  const count=contract.event==='goal'?goals:contract.event==='corner'?corners:null;
  const clockAt=time(match.clock_at),scoreAt=time(match.score_at);
  if(clock===null||clock>=45||clockAt===null||at-clockAt>45000||clockAt-at>5000||
     scoreAt===null||at-scoreAt>90000||scoreAt-at>5000||
     count?.home==null||count?.away==null)
    throw fail('Mungon numri ose ora LIVE e konfirmuar për ngjarjen e parë të pjesës së parë.');
  if(count.home+count.away>0)
    throw fail('Ngjarja e parë e pjesës së parë ka ndodhur tashmë.');
 }
 if(contract.kind==='sequence'&&current?.home!=null&&current?.away!=null&&
    contract.target<=current.home+current.away)throw fail('Goli/korneri i kërkuar ka ndodhur tashmë.');
 if(contract.kind==='nth-time'&&current?.home!=null&&current?.away!=null&&
    contract.target<=current.home+current.away)throw fail('Goli i kërkuar ka ndodhur tashmë.');
 if(contract.kind==='race'&&current?.home!=null&&current?.away!=null&&
    (current.home>=contract.target||current.away>=contract.target))throw fail('Gara e golave/kornerave ka përfunduar.');
 // Fixed interval totals/leader/result cannot be bought after their
 // opening minute: the customer may already know some or all incidents.
 // Unlike PREMATCH, LIVE requires a recent, confirmed match clock.
 if(live&&['window-total','interval-leader','interval-result'].includes(contract.kind)){
  const clockAt=time(match.clock_at);
  if(clock===null||clockAt===null||at-clockAt>45000||clockAt-at>5000)
   throw fail('Mungon ora live e freskët për intervalin.');
  const from=contract.kind==='interval-result'?contract.fromSeconds/60:contract.from;
  if(!Number.isFinite(from)||clock>=from)
   throw fail('Intervali ka nisur; nuk mund të pranohet bast për ngjarje të kaluara.');
 }
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
