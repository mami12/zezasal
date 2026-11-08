/** Conservative live settlement facts. A provider observation is evidence, not
 * a prediction. Unknown identity, clock, order or completeness => PENDING.
 * This module never updates tickets, balances or database state.
 */
import {goalTotalContract} from './goal-total-contract.mjs';
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const number=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const yesNo=line=>{
 const label=norm(line.outcome_name??line.outcomeName??line.outcome_key??line.outcomeKey);
 if(['yes','po'].includes(label))return true;
 if(['no','jo'].includes(label))return false;
 return null;
};
const sideOf=v=>['1','home','home team','team 1'].includes(norm(v))?'home':['2','away','away team','team 2'].includes(norm(v))?'away':['none','neither','asnjera','asnje skuader','x','draw','no goal','no corner','no more goals','no more corners','no team'].includes(norm(v))?'none':null;
const typeOf=name=>/\b(?:corners?|corner kicks?|kornera?)\b/.test(name)?'corner':
 /\b(?:goals?|scores?|golat?|gola?)\b/.test(name)?'goal':
 /\b(?:cards?|bookings?|kartona?)\b/.test(name)?'card':
 /\b(?:fouls?|faulle?)\b/.test(name)?'foul':null;
const nonNeg=v=>{const n=number(v);return n!==null&&Number.isInteger(n)&&n>=0?n:null;};
/** Freeze the provider's exact goal ordinal/interval before any funds move.
 * Provider labels are used only during initial quote interpretation.
 * Settlement uses the immutable numbered contract, not this text.
 */
/** Freeze the native Zizobet player selection only at purchase.
 * All actual goal times and teams continue to come from Zizobet.
 */
/** Player booking quotes are bound to the actual native quoted actor,
 * never to a team-wide card total. A confirmed individual incident proves
 * YES; a NO needs separate participation and completeness evidence.
 */
export function parsePlayerCardContract(line){
 const original=String(line.market_name??line.marketName??line.name??'').trim();
 const [title,...personParts]=original.split(/\s+·\s+/);
 const name=norm(title);
 const valid=/^(?:anytime\s+)?player\s+(?:to be booked|to get booked|to receive (?:a |any )?card|to receive (?:a )?(?:yellow|red) card|to be sent off|(?:yellow|red) card)$/.test(name);
 if(!valid)return null;
 let quoted=null;
 try{
  const encoded=String(line.market_key??line.marketKey??'').split('@')[1];
  if(encoded)quoted=JSON.parse(Buffer.from(encoded,'base64url').toString())?.pl;
 }catch{return null;}
 const embedded=personParts.join(' · ').trim();
 const label=String(line.outcome_name??line.outcomeName??'').trim();
 const choice=yesNo(line);
 const player=typeof quoted==='string'&&quoted.trim()?quoted.trim():
  embedded||null;
 if(!player){
  // Some providers quote player names as outcomes, not as parameters.
  if(!label||/^(?:yes|no|po|jo|home|away|over|under|none)$/i.test(label))return null;
  return {version:1,kind:'player-card',event:'card',playerName:label,choice:true,
   ...(/\b(?:yellow|red)\b|\bsent off\b/.test(name)?{cardColor:/\byellow\b/.test(name)?'yellow':'red'}:{})};
 }
 if(choice===null)return null;
 return {version:1,kind:'player-card',event:'card',playerName:player,choice,
  ...(/\b(?:yellow|red)\b|\bsent off\b/.test(name)?{cardColor:/\byellow\b/.test(name)?'yellow':'red'}:{})};
}
export function parsePlayerGoalContract(line){
 const key=String(line.market_key??line.marketKey??'');
 let quotedPlayer=null;
 try{
  const raw=key.split('@')[1];
  if(raw)quotedPlayer=JSON.parse(Buffer.from(raw,'base64url').toString())?.pl;
 }catch{return null;}
 const name=String(line.market_name??line.marketName??line.name??'').trim();
 const choice=norm(line.outcome_name??line.outcomeName??line.outcome_key??line.outcomeKey);
 if(typeof quotedPlayer==='string'&&quotedPlayer.trim()&&
  /\bto score\b|\bgoalscorer\b/i.test(name)&&!/first|last|assist|header|penalty|exact|more|hat.?trick/i.test(name)){
  if(!['yes','no','po','jo'].includes(choice))return null;
  return {version:1,kind:'player-goal',event:'goal',playerName:quotedPlayer,
   choice:['yes','po'].includes(choice)};
 }
 if(/^(?:anytime|any time) goalscorers?$/i.test(name)&&choice&&
   !['no goalscorer','none','no goal'].includes(choice)){
  const player=String(line.outcome_name??line.outcomeName??'').trim();
  if(!player||/^(yes|no|po|jo|over|under)$/i.test(player))return null;
  return {version:1,kind:'player-goal',event:'goal',playerName:player,choice:true};
 }
 return null;
}

export function parseOrdinalGoalTime(line){
 const title=String(line.market_name??line.marketName??line.name??'').trim();
 if(!/^when will (?:next )?goal\b/i.test(title))return null;
 let target=null;
 const fixed=title.match(/^when will goal (\d{1,3}) be scored/i);
 if(fixed)target=Number(fixed[1]);
 if(target===null){
  try{
   const encoded=String(line.market_key??line.marketKey??'').split('@')[1];
   const json=JSON.parse(Buffer.from(encoded,'base64url').toString());
   if(Number.isSafeInteger(Number(json.p3))&&Number(json.p3)>0)target=Number(json.p3);
  }catch{return null;}
 }
 if(!Number.isInteger(target)||target<1||target>100)return null;
 const label=String(line.outcome_name??line.outcomeName??'').trim();
 if(/^(no goal|no more goals?|none)$/i.test(label))
  return {version:1,kind:'nth-time',event:'goal',target,choice:'none'};
 const range=label.match(/^(?:min(?:ute)?s?\s*)?(\d{1,3})\s*[-–]\s*(\d{1,3})(?:\s*(?:mins?|minutes?))?$/i);
 if(!range)return null;
 const from=Number(range[1]),to=Number(range[2]);
 if(from<0||to>130||from>to)return null;
 return {version:1,kind:'nth-time',event:'goal',target,choice:'range',from,to};
}

/** Explicit Zizobet 00:00–09:59 minute RESULT, never today's match score.
 * A period/result is scored ONLY from goals in that interval, from the full
 * primary timeline, once its ending second has elapsed and goals reconcile.
 */
export function parseTimedResultMarket(line){
 const raw=norm(line.market_name??line.marketName??line.name);
 // Relative 2H intervals need a separately verified period clock. Do not
 // silently map 00:00 to the first half of an already-started second half.
 const title=raw.replace(/^(?:1st|first) half\s*[-–:.]\s*/,'');
 if(/^(?:2nd|second) half\b/.test(title))return null;
 const match=title.match(/^(\d{1,3}):([0-5]\d)\s*[-–]\s*(\d{1,3}):([0-5]\d)\s*(?:min(?:ute)?s?\.?)?\s*[-–]\s*(?:result|1x2)$/);
 if(!match)return null;
 const from=Number(match[1])*60+Number(match[2]),end=Number(match[3])*60+Number(match[4])+1;
 if(from<0||end<=from||end>130*60||from%60!==0||end%60!==0)return null;
 const side=sideOf(line.outcome_name??line.outcomeName)??sideOf(line.outcome_key??line.outcomeKey);
 if(!side)return null;
 return {version:1,kind:'interval-result',event:'goal',side,
  fromSeconds:from,toExclusiveSeconds:end};
}

/** Full-match team totals are irreversible once the team's confirmed
 * score passes the offered line. Never infer a win from the opposite team or
 * infer UNDER before the verified match conclusion.
 */
export function parseTeamGoalMarket(line,teams={}){
 const original=String(line.market_name??line.marketName??line.name??'');
 if(/\b(?:1st|first|2nd|second)\s+half\b|\b(?:minutes?|interval|asian|handicap|player|scorer|both|each)\b|[&+]/i.test(original))return null;
 const scope=goalTotalContract(line,teams)?.scope;
 if(scope!=='home'&&scope!=='away')return null;
 const choice=norm(line.outcome_name??line.outcomeName??line.outcome_key??line.outcomeKey);
 const kind=/^(?:over|lart|mbi)(?:\s|$)/.test(choice)?'over':
  /^(?:under|poshte|nen)(?:\s|$)/.test(choice)?'under':null;
 if(!kind)return null;
 const rawLine=line.line??line.specifier??original.match(/\((\d+(?:[.,]\d+)?)\)\s*$/)?.[1];
 const namedValue=choice.match(/(?:over|under|lart|mbi|poshte|nen)\s+(\d+(?:[.,]\d+)?)/)?.[1];
 const threshold=number(String(namedValue??rawLine??'').replace(',','.'));
 if(threshold===null||threshold<0||threshold>100)return null;
 return {version:1,kind:'team-total-goals',event:'goal',side:scope,choice:kind,threshold};
}

export function parseEventWindow(line,clock=null) {
 let name=norm(line.market_name??line.marketName??line.name);
 const kind=typeOf(name);
 if(!kind||!/minutes?|mins?|first \d+|next \d+|within|before|by the \d+/.test(name))return null;
 const choice=yesNo(line);if(choice===null)return null;
 const home=/\b(?:home team|team 1)\b/.test(name);
 const away=/\b(?:away team|team 2)\b/.test(name);
 if(home&&away)return null;
 const side=home?'home':away?'away':null;
 let start,end;
 const fixed=name.match(/\b(?:minutes?|mins?)\s*(\d{1,3})\s*[-–]\s*(\d{1,3})\b|\b(?:between|from)\s+(?:minutes?\s+)?(\d{1,3})\s*(?:and|to|[-–])\s*(\d{1,3})\b|\bfrom\s+(\d{1,3}):00\s+to\s+(\d{1,3})\s*min\b/);
 const first=name.match(/\b(?:first|opening)\s+(\d{1,3})\s+minutes?\b/);
 const by=name.match(/\b(?:by|before|until)\s+(?:the\s+)?(?:minute\s+)?(\d{1,3})(?:st|nd|rd|th)?(?:\s+minute)?\b/);
 const rolling=name.match(/\b(?:next|following)\s+(\d{1,2})\s+minutes?\b/);
 // Exact provider minute is preserved at ticket acceptance.
 const exactMinute=name.match(/\b(?:in|at|during)\s+(?:the\s+)?(?:minute\s+(\d{1,3})|(\d{1,3})(?:st|nd|rd|th)?\s+minute)\b/);
 if(fixed){start=Number(fixed[1]??fixed[3]??fixed[5]);end=Number(fixed[2]??fixed[4]??fixed[6]);}
 else if(exactMinute){start=Number(exactMinute[1]??exactMinute[2]);end=start;}
 else if(first){start=0;end=Number(first[1])-1;}
 else if(by){start=0;end=Number(by[1]);}
 else if(rolling){
  const current=number(clock);
  if(current===null||current<0||current>=130)return null;
  start=current;end=current+Number(rolling[1]);
 }else return null;
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||
    ((exactMinute||first)?start>end:start>=end)||end>130)return null;
 // Freeze the window at selection acceptance. No later moving reference clocks.
 return {version:1,kind:'window',event:kind,...(side?{side}:{}),from:start,to:end,choice,
  startExclusive:!!rolling,exactMinute:!!exactMinute,clockAtAcceptance:number(clock)};
}
/** Explicit Zizobet interval leader: who scores/takes MOST in X-Y.
 * A tie is a distinct draw outcome; this is not a next-event or full-time bet.
 */
export function parseIntervalLeader(line) {
 const name=norm(line.market_name??line.marketName??line.name);
 const m=name.match(/^who\s+(?:scores\s+most\s+goals|takes\s+most\s+corners)\s+in\s+minutes?\s+(\d{1,3})\s*[-–]\s*(\d{1,3})\b/);
 if(!m)return null;
 const from=Number(m[1]),to=Number(m[2]);
 if(from<0||to<from||to>130)return null;
 const event=/corners/.test(name)?'corner':'goal';
 const side=sideOf(line.outcome_name??line.outcomeName)??sideOf(line.outcome_key??line.outcomeKey);
 if(!side)return null;
 return {version:1,kind:'interval-leader',event,from,to,side};
}
/** Count of goals/corners/cards in a provider's fixed minute range.
 * Unlike a YES/NO incident window, the selection can be Over, Under,
 * exactly N or at least N. Each is graded against persisted incident rows.
 */
export function parseIntervalCount(line) {
 const name=norm(line.market_name??line.marketName??line.name);
 // Only fixed absolute match-minute totals. No half-relative, player or
 // compound market can silently become a full-match total.
 if(Number(line.period??0)!==0||/[&+]/.test(name)||
    /\b(?:which|who|race|next|first|last|winner|result|player|scorer|asian|handicap|penalty|extra time)\b/.test(name))return null;
 // Accept a complete grammar, not a substring: discarding "home team"
 // would pay a home-only bet from the away team's corners.
 const usual=name.match(/^(?:total\s+)?(?:(\d+(?:[.,]\d+)?)\s+)?(?:(home|away)\s+team\s+)?(goals?|corners?|cards?)\s*(?:(home|away)\s+team)?\s+in\s+minutes?\s+(\d{1,3})\s*[-–]\s*(\d{1,3})(?:\s+\((\d{1,2})-minute interval\))?$/);
 const leading=name.match(/^(home|away)\s+team\s+(?:total\s+)?(goals?|corners?|cards?)\s+in\s+minutes?\s+(\d{1,3})\s*[-–]\s*(\d{1,3})(?:\s+\((\d{1,2})-minute interval\))?$/);
 if(!usual&&!leading)return null;
 const titleLine=usual?.[1]??null,preSide=usual?.[2]??leading?.[1]??null;
 const eventName=usual?.[3]??leading?.[2],postSide=usual?.[4]??null;
 if(preSide&&postSide)return null;
 const side=preSide??postSide;
 const from=Number(usual?.[5]??leading?.[3]),to=Number(usual?.[6]??leading?.[4]);
 const width=usual?.[7]??leading?.[5];
 if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<from||to>130||
    (width!=null&&to-from+1!==Number(width)))return null;
 const event=typeOf(eventName);
 if(!['goal','corner','card'].includes(event))return null;
 const label=norm(line.outcome_name??line.outcomeName??line.outcome_key??line.outcomeKey);
 const rawLine=number(line.line??line.specifier),inTitle=number(titleLine?.replace(',','.'));
 const over=label.match(/^over(?:\s+(\d+(?:[.,]\d+)?))?$/);
 const under=label.match(/^under(?:\s+(\d+(?:[.,]\d+)?))?$/);
 const sidePart=side?{side}:{};
 if(over||under){
  const named=number((over??under)[1]?.replace(',','.'));
  const supplied=[named,rawLine,inTitle].filter(x=>x!==null);
  if(!supplied.length||supplied.some(x=>x!==supplied[0])||
     supplied[0]<0||supplied[0]>300||!Number.isInteger(supplied[0]*2))return null;
  return {version:1,kind:'window-total',event,...sidePart,from,to,
   choice:over?'over':'under',threshold:supplied[0]};
 }
 const exact=label.match(/^(?:exact(?:ly)?\s+)?(\d{1,3})$/);
 if(exact)return {version:1,kind:'window-total',event,...sidePart,from,to,
  choice:'exact',target:Number(exact[1])};
 const atLeast=label.match(/^(\d{1,3})\s*(?:\+|or more)$/);
 if(atLeast)return {version:1,kind:'window-total',event,...sidePart,from,to,
  choice:'atLeast',target:Number(atLeast[1])};
 return null;
}
/** Provider clock-window totals: accept ONLY complete, minute-aligned intervals.
 * For example 30:00–39:59 equals the closed buckets 30..39. Do not interpret
 * 45+ or 90+ as a numeric end: injury time requires separately verified phase
 * attribution and cannot safely be reconstructed from absolute minute counts.
 */
export function parseClockWindowTotal(line){
 const name=norm(line.market_name??line.marketName??line.name);
 const m=name.match(/^(\d{1,3}):([0-5]\d)\s*[-–]\s*(\d{1,3}):([0-5]\d)\s*min\.?\s*[-–]\s*(?:total\s+)?(?:(home|away)\s+team\s+)?(goals?|corners?|cards?)(?:\s+(home|away)\s+team)?\s*(?:\((\d+(?:[.,]\d+)?)\))?$/);
 if(!m||m[2]!=='00'||m[4]!=='59'||(m[5]&&m[7]))return null;
 const from=Number(m[1]),to=Number(m[3]);
 // 45+ first-half injury time can overlap ordinary absolute minute 45;
 // no reliable period attribution currently exists for this market family.
 if(from<0||to<from||to>=45)return null;
 const event=typeOf(m[6]),side=m[5]??m[7],label=norm(line.outcome_name??line.outcomeName??line.outcome_key??line.outcomeKey);
 if(!event||!['goal','corner','card'].includes(event))return null;
 const over=label.match(/^over(?:\s+(\d+(?:[.,]\d+)?))?$/);
 const under=label.match(/^under(?:\s+(\d+(?:[.,]\d+)?))?$/);
 if(!over&&!under)return null;
 const named=(over??under)[1],raw=line.line??line.specifier;
 const supplied=raw!=null&&String(raw).trim()!==''?raw:null;
 const threshold=number(String(named??supplied??m[8]??'').replace(',','.'));
 const inTitle=number(String(m[8]??'').replace(',','.'));
 if(threshold===null||threshold<0||threshold>300||!Number.isInteger(threshold*2)||
    (inTitle!==null&&inTitle!==threshold))return null;
 return {version:1,kind:'window-total',event,...(side?{side}:{}),from,to,choice:over?'over':'under',threshold};
}
/** Explicit full-match yellow/red card totals. The two colors never share a
 * counter when freezing the wager or grading it in PostgreSQL. */
export function parseColorCardCount(line) {
 const name=norm(line.market_name??line.marketName??line.name);
 if(/\b(?:second yellow|yellow red|player|team|half|asian|handicap|minutes?|mins?|interval|penalty)\b/.test(name))return null;
 const match=name.match(/^(?:(?:full time|match)\s+)?(?:total\s+)?(yellow|red)\s+cards?(?:\s+(?:total|over\s*\/\s*under))?$/);
 if(!match)return null;
 const label=norm(line.outcome_name??line.outcomeName??line.outcome_key??line.outcomeKey);
 const over=label.match(/^over(?:\s+(\d+(?:[.,]\d+)?))?$/);
 const under=label.match(/^under(?:\s+(\d+(?:[.,]\d+)?))?$/);
 const value=over??under;
 if(value){
  const threshold=number(String(value[1]??line.line??line.specifier??'').replace(',','.'));
  if(threshold===null||threshold<0||threshold>300||!Number.isInteger(threshold*2))return null;
  return {version:1,kind:over?'over':'under',event:'card',cardColor:match[1],threshold};
 }
 const exact=label.match(/^(?:exact(?:ly)?\s+)?(\d{1,3})$/);
 if(exact)return {version:1,kind:'exact',event:'card',cardColor:match[1],target:Number(exact[1])};
 return null;
}

/** Half-scoped corner/card totals. Unlike the FT counters, a half's
 * incidents must be classified by their saved period, including 45+ or 90+
 * stoppage time. The original provider quote stays in English; UI translates.
 */
export function parseHalfTotal(line){
 const name=norm(line.market_name??line.marketName??line.name);
 const match=name.match(/^(1st|first|2nd|second)\s+half\s*[-–:.]\s*(?:total\s+)?(?:(home|away)\s+team\s+)?(?:total\s+)?(?:(yellow|red)\s+)?(corners?|cards?)\s*(?:(home|away)\s+team)?\s*(?:\((\d+(?:[.,]\d+)?)\))?$/);
 if(!match)return null;
 const half=/^(?:1st|first)$/.test(match[1])?1:2;
 if(line.period!=null&&Number(line.period)!==0&&Number(line.period)!==half)return null;
 const sideA=match[2],sideB=match[5];
 if(sideA&&sideB)return null;
 const side=sideA??sideB;
 const event=typeOf(match[4]),cardColor=match[3];
 if(!['corner','card'].includes(event)||(cardColor&&event!=='card'))return null;
 const outcome=norm(line.outcome_name??line.outcomeName??line.outcome_key??line.outcomeKey);
 const over=outcome.match(/^over(?:\s+(\d+(?:[.,]\d+)?))?$/);
 const under=outcome.match(/^under(?:\s+(\d+(?:[.,]\d+)?))?$/);
 if(!over&&!under)return null;
 const named=number((over??under)[1]?.replace(',','.'));
 const quoted=number(line.line??line.specifier);
 const title=number(match[6]?.replace(',','.'));
 const thresholds=[named,quoted,title].filter(x=>x!==null);
 if(!thresholds.length||thresholds.some(x=>x!==thresholds[0])||
    thresholds[0]<0||thresholds[0]>300||!Number.isInteger(thresholds[0]*2))return null;
 return {version:1,kind:'half-total',event,half,...(side?{side}:{}),
  ...(cardColor?{cardColor}:{}),choice:over?'over':'under',threshold:thresholds[0]};
}
/** First corner IN THE FIRST HALF, not the first corner of the match.
 * A "None" offer wins only when verified first-half corner absence is proven.
 * Never reuse the match-wide ordinal, especially when the first corner is 2H.
 */
export function parseFirstHalfCorner(line) {
 const name=norm(line.market_name??line.marketName??line.name);
 if(!/^(?:1st|first)\s+half\s*[-–:.]\s*first\s+corner$/.test(name))return null;
 const side=sideOf(line.outcome_name??line.outcomeName)??sideOf(line.outcome_key??line.outcomeKey);
 if(!['home','away','none'].includes(side))return null;
 return {version:1,kind:'half-first-event',event:'corner',half:1,side};
}
/** The last goal/corner/card can be determined only from a complete FT
 * chronology. A quoted Neither is an actual third outcome; without one,
 * zero events do not turn a two-way proposition into a losing bet.
 */
/** Half-specific races and ordinal events never use whole-match cumulative
 * counts. The PostgreSQL fact grader filters by the recorded match period.
 * Live half-races need period baselines and are held until that evidence exists.
 */
export function parseHalfEventContract(line){
 const name=norm(line.market_name??line.marketName??line.name);
 const m=name.match(/^(1st|first|2nd|second) half\s*[-–.:]?\s*(?:(?:which team wins )?race to (\d{1,3}) (goals?|corners?|cards?)|(first|last) (goal|corner|card))$/);
 if(!m)return null;
 const half=/^(?:1st|first)$/.test(m[1])?1:2;
 if(line.period!=null&&Number(line.period)!==0&&Number(line.period)!==half)return null;
 const side=sideOf(line.outcome_name??line.outcomeName)??sideOf(line.outcome_key??line.outcomeKey);
 if(!side)return null;
 if(m[2]){
  const target=Number(m[2]);
  if(!Number.isSafeInteger(target)||target<1||target>100)return null;
  const event=typeOf(m[3]);
  if(!event||!['goal','corner','card'].includes(event))return null;
  return {version:1,kind:'half-race',event,half,side,target,
   noneOffered:side==='none'||line.raceNoneOffered===true};
 }
 const event=typeOf(m[5]);
 if(!event||!['goal','corner','card'].includes(event))return null;
 return {version:1,kind:m[4]==='first'?'half-first-event':'half-last-event',
  event,half,side,noneOffered:side==='none'||line.lastNoneOffered===true};
}
export function parseLastEvent(line){
 const title=norm(line.market_name??line.marketName??line.name);
 if(Number(line.period??0)!==0)return null;
 if(!/^(?:(?:which|what) team (?:will )?(?:score|take|receive) (?:the )?)?last (?:goal|corner|card)$/.test(title)&&
    !/^(?:last (?:goal|corner|card) (?:by|scored by|taken by)|team (?:to )?(?:score|take|receive) (?:the )?last (?:goal|corner|card))$/.test(title))return null;
 const event=typeOf(title);
 if(!['goal','corner','card'].includes(event))return null;
 const side=sideOf(line.outcome_name??line.outcomeName)??sideOf(line.outcome_key??line.outcomeKey);
 if(!side)return null;
 return {version:1,kind:'last-event',event,side,
  noneOffered:side==='none'||line.lastNoneOffered===true};
}
export function parseSequenceBet(line,counts={}) {
 const name=norm(line.market_name??line.marketName??line.name);
 // An event numbered inside a time band is not the same as the Nth event of the match.
 if(/\b(?:minutes?|mins?|interval|period|extra time)\b|\b(?:1st|first|2nd|second)\s+half\b/.test(name))return null;
 const event=/\bcorner/.test(name)?'corner':/\bgoal/.test(name)?'goal':/\b(?:cards?|bookings?)\b/.test(name)?'card':null;
 if(!event)return null;
 // Zizobet publishes separate *absolute* numbered offers such as
 // "Next Goal 1st" and "Next Goal 2nd". These refer to goal #1/#2 of
 // the fixture, NOT blindly to current score + 1. Preserve their ordinal.
 // A bare "Next Goal" remains the live next goal from the accepted score.
 const providerOrdinal=name.match(/^next\s+(goal|corner)\s+(\d{1,3})(?:st|nd|rd|th)?$/);
 // Do not collapse a malformed numbered/period-specific NEXT offer into
 // the unnamed live-next market. Its meaning is unsupported, so hold it.
 if(/^next\s+(?:goal|corner)\s+\d/.test(name)&&!providerOrdinal)return null;
 if(/^next\s+(?:goal|corner)\b/.test(name)&&/\b(?:half|period)\b/.test(name))return null;
 const isNext=/^(?:next|who (?:scores|takes) (?:the )?next)\s+(?:goal|corner)\b|^(?:which team )?(?:scores|wins) next (?:goal|corner)/.test(name);
 const numbered=name.match(/^(?:(?:who (?:scores|takes) (?:the )?)|(?:which team (?:scores|wins) (?:the )?))?(\d+)(?:st|nd|rd|th)?\s+(?:goal|corner)\b|^(?:(?:who (?:scores|takes)|which team (?:scores|wins)) (?:the )?)?(?:goal|corner)\s*(\d+)\b|^which team (?:scores|wins) (?:the )?goal (\d+)\b/);
 const first=/^(?:(?:who|which team)\s+(?:scores|takes|wins)\s+(?:the\s+)?)?first\s+(?:goal|corner)\b/.test(name);
 const reach=name.match(/^(?:which team\s+)?(?:reaches|gets|takes|scores|receives)\s+(\d{1,3})\s+(goals?|corners?|cards?)\s+first\b/);
 const race=name.match(/\brace to (\d{1,3}) (goals?|corners?|cards?)\b/);
 if(!isNext&&!providerOrdinal&&!numbered&&!race&&!first&&!reach)return null;
 const side=sideOf(line.outcome_name??line.outcomeName)??sideOf(line.outcome_key??line.outcomeKey);
 if(!side)return null;
 if(race||reach){
  const threshold=Number((race??reach)[1]);
  if(!Number.isInteger(threshold)||threshold<1||threshold>100)return null;
  const raceEvent=/goal/.test((race??reach)[2])?'goal':/corner/.test((race??reach)[2])?'corner':'card';
  // A third quoted outcome changes the no-threshold result from VOID to
  // a winning Neither selection. Freeze that distinction at acceptance.
  return {version:1,kind:'race',event:raceEvent,target:threshold,side,
   noneOffered:side==='none'||line.raceNoneOffered===true};
 }
 let target=providerOrdinal?Number(providerOrdinal[2]):
  numbered?Number(numbered[1]??numbered[2]??numbered[3]):first?1:null;
 if(isNext&&!providerOrdinal&&!numbered&&!first){
  const c=counts[event];
  const home=nonNeg(c?.home),away=nonNeg(c?.away);
  if(home===null||away===null)return null;
  target=home+away+1;
 }
 if(!Number.isSafeInteger(target)||target<1||target>100)return null;
 return {version:1,kind:'sequence',event,target,side};
}
/** Exact native HOME/AWAY aggregate contracts. These use the chosen
 * team's incident count, never both teams combined. Color-qualified cards
 * require a verified color-specific chronology, not a guessed tally.
 */
export function parseTeamCountMarket(line){
 let name=norm(line.market_name??line.marketName??line.name);
 if(line.period!=null&&Number(line.period)!==0)return null;
 if(/\b(?:asian|handicap|half|minutes?|interval|player|scorer|penalty|both|each)\b|[&+]/.test(name))return null;
 name=name.replace(/^(?:full time|match)\s*[-–.:]?\s*/,'');
 const m=name.match(/^(?:total\s+)?(home(?: team)?|away(?: team)?|team [12])\s+(?:total\s+)?(?:(yellow|red)\s+)?(goals?|corners?|cards?|fouls?)(?:\s+(?:total|over\s*\/\s*under))?(?:\s*\((\d+(?:[.,]\d+)?)\))?$/) ??
  name.match(/^(?:total\s+)?(?:(yellow|red)\s+)?(goals?|corners?|cards?|fouls?)\s+(home(?: team)?|away(?: team)?|team [12])(?:\s+(?:total|over\s*\/\s*under))?(?:\s*\((\d+(?:[.,]\d+)?)\))?$/);
 if(!m)return null;
 const first=/^(?:home|away)(?: team)?$|^team [12]$/.test(m[1]);
 const rawSide=first?m[1]:m[3];
 const side=/^(?:home|team 1)\b/.test(rawSide)?'home':
   /^(?:away|team 2)\b/.test(rawSide)?'away':null;
 const color=first?m[2]:m[1],event=typeOf(first?m[3]:m[2]),title=m[4];
 if(!['home','away'].includes(side)||!['goal','corner','card','foul'].includes(event)||
    (color&&event!=='card'))return null;
 const selection=norm(line.outcome_name??line.outcomeName??line.outcome_key??line.outcomeKey);
 const rawLine=number(line.line??line.specifier),inTitle=number(title?.replace(',','.'));
 const value=selection.match(/^(over|under)(?:\s+(\d+(?:[.,]\d+)?))?$/);
 const base={version:1,event,side,...(color?{cardColor:color}:{})};
 if(value){
  const named=number(value[2]?.replace(',','.'));
  const thresholds=[named,rawLine,inTitle].filter(v=>v!==null);
  if(!thresholds.length||thresholds.some(v=>v!==thresholds[0])||
     thresholds[0]<0||thresholds[0]>300||!Number.isInteger(thresholds[0]*2))return null;
  return {...base,kind:value[1],threshold:thresholds[0]};
 }
 const exact=selection.match(/^(?:exact(?:ly)?\s+)?(\d{1,3})$/);
 if(exact)return {...base,kind:'exact',target:Number(exact[1])};
 const range=selection.match(/^(\d{1,3})\s*(?:to|[-–])\s*(\d{1,3})$/);
 if(range&&Number(range[2])>=Number(range[1]))
  return {...base,kind:'range',min:Number(range[1]),max:Number(range[2])};
 const more=selection.match(/^(\d{1,3})\s*(?:\+|or more)$/);
 if(more)return {...base,kind:'atLeast',target:Number(more[1])};
 return null;
}
export function parseCountMarket(line) {
 const name=norm(line.market_name??line.marketName??line.name);
 const event=typeOf(name);
 if(!event||/\b(?:next|first|last|race|interval|minutes?|fouls? won|player|scorer|penalty|handicap|asian|odd|even|both|each)\b|[&+]/.test(name))return null;
 // Only explicit full-match aggregate count markets, never a team or half.
 if(!/^(?:(?:full time|match|total)\s+)?(?:total\s+)?(?:goals?|corners?|cards?|fouls?)(?:\s+(?:total|over\/under))?(?:\s*\((?:exact|bands)\))?$/.test(name))return null;
 const rawLabel=norm(line.outcome_name??line.outcomeName??line.outcome_key);
 const numeric=number(line.line??line.specifier);
 const over=rawLabel.match(/^over(?:\s+(\d+(?:[.,]\d+)?))?$/);
 const under=rawLabel.match(/^under(?:\s+(\d+(?:[.,]\d+)?))?$/);
 if(over||under){const n=number((over??under)[1]?.replace(',','.')??numeric);if(n===null||n<0||n>300)return null;return {version:1,kind:over?'over':'under',event,threshold:n};}
 const exact=rawLabel.match(/^(?:exact(?:ly)?\s+)?(\d{1,3})$/);
 if(exact)return {version:1,kind:'exact',event,target:Number(exact[1])};
 const band=rawLabel.match(/^(\d{1,3})\s*(?:to|[-–])\s*(\d{1,3})$/);
 if(band&&Number(band[2])>=Number(band[1]))return {version:1,kind:'range',event,min:Number(band[1]),max:Number(band[2])};
 const plus=rawLabel.match(/^(\d{1,3})\s*(?:\+|or more)$/);
 if(plus)return {version:1,kind:'atLeast',event,target:Number(plus[1])};
 return null;
}
export const liveContract=(line,{counts={},clock=null,teams={}}={})=>{
 const name=norm(line.market_name??line.marketName??line.name);
 const yellow=/\byellow\s+cards?\b/.test(name),red=/\bred\s+cards?\b/.test(name);
 const ambiguous=/\b(?:second\s+yellow|yellow\s+red)\b/.test(name);
 if((yellow&&red)||ambiguous)return null;
 const contract=parsePlayerCardContract(line)??parsePlayerGoalContract(line)??parseOrdinalGoalTime(line)??
  parseTimedResultMarket(line)??parseIntervalLeader(line)??
  parseEventWindow(line,clock)??parseIntervalCount(line)??parseClockWindowTotal(line)??
  parseHalfTotal(line)??parseColorCardCount(line)??parseFirstHalfCorner(line)??parseHalfEventContract(line)??parseLastEvent(line)??parseSequenceBet(line,counts)??
  parseTeamGoalMarket(line,teams)??parseTeamCountMarket(line)??parseCountMarket(line);
 if(!contract)return null;
 if(yellow||red){
  // Reject a color qualifier attached to an unrelated contract.
  if(contract.event!=='card'||!['over','under','exact','range','atLeast',
    'window','window-total','half-total','player-card'].includes(contract.kind))return null;
  return {...contract,cardColor:yellow?'yellow':'red'};
 }
 return contract;
};

const sortEvents=(events,event)=>{
 const all=events.filter(e=>e.type===event&&e.disabled!==true&&e.cancelled!==true);
 const valid=all.every(e=>number(e.minute)!==null&&Number(e.minute)>=0&&
  (e.team==='home'||e.team==='away'||event==='card'||event==='foul'));
 if(!valid)return null;
 // Preserve explicit unique provider order where available. A same-minute
 // tie without sub-minute order cannot settle a sequence or race reliably.
 const ordered=[...all].sort((a,b)=>a.minute-b.minute||
  (Number.isFinite(a.seconds)&&Number.isFinite(b.seconds)?a.seconds-b.seconds:0));
 if(ordered.some((e,i)=>i&&e.minute===ordered[i-1].minute&&
  (!Number.isFinite(e.seconds)||!Number.isFinite(ordered[i-1].seconds)||e.seconds===ordered[i-1].seconds)))return {events:ordered,orderKnown:false};
 return {events:ordered,orderKnown:true};
};
const eventCount=(count,event)=>count?.[event];
const fullCoverage=(evidence,event,through)=>{
 const covered=number(evidence?.coverage?.[event+'Through']);
 return covered!==null&&covered>=through;
};
/** Returns WON, LOST or null. Never infers an absence from a missing event.
 * 'ended' requires a confirmed terminal feed phase, not wall-clock time.
 */
export function gradeLiveContract(contract,evidence={}, {ended=false,scopeEnded=false}={}){
 if(!contract||!['interval-result','team-total-goals','window','sequence','race','last-event','over','under','exact','range','atLeast'].includes(contract.kind))return null;
 const {event}=contract;
 const ordered=sortEvents(Array.isArray(evidence.events)?evidence.events:[],event);
 const clock=number(evidence.clock);
 // Never use the combined match total for a home/away-only selection.
 // A color-qualified card also requires an independently verified colored
 // chronology; the regular LIVE scoreboard cannot establish yellow vs red.
 const count=contract.cardColor?null:number(contract.side?
   evidence.teams?.[event]?.[contract.side]:eventCount(evidence.counts,event));
 if(contract.kind==='team-total-goals'){
  const side=contract.side;
  if(!['home','away'].includes(side)||!['over','under'].includes(contract.choice))return null;
  const goals=nonNeg(evidence.teams?.goal?.[side]);
  // The primary per-team scoreboard is itself a confirmed count. A truncated
  // event list may omit earlier goals, but cannot undo an already reached total.
  // Financial writes still require two independent agreeing source observations.
  if(goals===null||clock===null)return null;
  if(goals>contract.threshold)return contract.choice==='over'?'WON':'LOST';
  // Do not pay an UNDER or mark OVER lost while more goals can happen.
  if(!ended&&!scopeEnded)return null;
  if(Number.isInteger(contract.threshold)&&goals===contract.threshold)return 'VOID';
  return contract.choice==='under'?'WON':'LOST';
 }
 if(contract.kind==='interval-result'){
  if(!ordered||clock===null||!Number.isSafeInteger(contract.fromSeconds)||
     !Number.isSafeInteger(contract.toExclusiveSeconds)||clock*60<contract.toExclusiveSeconds||
     !fullCoverage(evidence,'goal',contract.toExclusiveSeconds/60))return null;
  const goals=ordered.events;
  // Exact provider times take priority. An integer minute without seconds
  // safely identifies only its entire 00:00–00:59 bucket, which is enough
  // for this provider's minute-aligned 00:00–09:59 contracts.
  const eventSecond=e=>Number.isFinite(e.seconds)?e.seconds:Number.isInteger(e.minute)?e.minute*60:null;
  if(goals.some(e=>eventSecond(e)===null))return null;
  let home=0,away=0;
  for(const e of goals){
   const second=eventSecond(e);
   if(second>=contract.fromSeconds&&second<contract.toExclusiveSeconds){
    if(e.team==='home')home++;
    else if(e.team==='away')away++;
    else return null;
   }
  }
  const result=home>away?'home':away>home?'away':'none';
  return contract.side===result?'WON':'LOST';
 }
 if(contract.kind==='window'){
  if(contract.cardColor||!ordered)return null; // use verified color-specific SQL facts
  if(contract.side&&ordered.events.some(e=>!['home','away'].includes(e.team)))return null;
  const events=contract.side?ordered.events.filter(e=>e.team===contract.side):ordered.events;
  // A positive event can be proven by an event that is individually verified.
  // Rolling markets are anchored to an exact acceptance clock. Providers
  // frequently return ONLY an integer event minute: an event in the opening
  // or closing minute could be either inside or outside the actual window.
  // Never turn that ambiguity into a false win, loss or no-event decision.
  let relevant;
  if(contract.startExclusive){
   const lo=Math.floor(contract.from),hi=Math.floor(contract.to);
   if(events.some(e=>e.minute===lo||e.minute===hi))return null;
   relevant=events.filter(e=>e.minute>lo&&e.minute<hi);
  }else relevant=events.filter(e=>Number(e.minute)>=contract.from&&Number(e.minute)<=contract.to);
  // A named, non-cancelled primary event with a valid time is positive proof
  // even when the short incident list omits older corners/cards. Never infer
  // "no event" from that short list; those decisions still require coverage.
  if(relevant.some(e=>e.id!=null&&String(e.id).length>0&&
    Number.isFinite(Number(e.minute))&&Number(e.minute)<=clock&&
    (!Number.isFinite(e.seconds)||e.seconds<=clock*60)))return contract.choice?'WON':'LOST';
  // An abandoned/early-closed match is not proof that a scheduled window elapsed.
  if(clock!==null&&clock>contract.to&&fullCoverage(evidence,event,contract.to))return contract.choice?'LOST':'WON';
  return null;
 }
 if(contract.kind==='last-event'){
  if(!ended||!ordered?.orderKnown||clock===null||!fullCoverage(evidence,event,clock))return null;
  const last=ordered.events.at(-1);
  if(last)return contract.side===last.team?'WON':'LOST';
  return contract.noneOffered===true?(contract.side==='none'?'WON':'LOST'):'VOID';
 }
 if(contract.kind==='sequence'||contract.kind==='race'){
  if(!ordered?.orderKnown||clock===null||!fullCoverage(evidence,event,clock))return null;
  const relevant=ordered.events;
  if(contract.kind==='sequence'){
   const goal=relevant[contract.target-1];
   if(goal)return contract.side===goal.team?'WON':contract.side==='none'?'LOST':'LOST';
   return ended?contract.side==='none'?'WON':'LOST':null;
  }
  const teamCounts={home:0,away:0};let winner=null;
  for(const e of relevant){if(!['home','away'].includes(e.team))return null;teamCounts[e.team]++;
   if(teamCounts[e.team]===contract.target){winner=e.team;break;}}
  if(winner)return winner===contract.side?'WON':'LOST';
  if(!ended)return null;
  return contract.noneOffered===true?(contract.side==='none'?'WON':'LOST'):'VOID';
 }
 if(count===null)return null;
 if(contract.kind==='over')return count>contract.threshold?'WON':(scopeEnded||ended)?count===contract.threshold&&Number.isInteger(contract.threshold)?'VOID':'LOST':null;
 if(contract.kind==='under')return count>contract.threshold?'LOST':(scopeEnded||ended)?count===contract.threshold&&Number.isInteger(contract.threshold)?'VOID':'WON':null;
 if(contract.kind==='atLeast')return count>=contract.target?'WON':(scopeEnded||ended)?'LOST':null;
 if(contract.kind==='exact')return count>contract.target?'LOST':(scopeEnded||ended)?count===contract.target?'WON':'LOST':null;
 if(contract.kind==='range')return count>contract.max?'LOST':(scopeEnded||ended)?count>=contract.min?'WON':'LOST':null;
 return null;
}

/** Score/corner delta fallback for *the specific ticket's accepted baseline*.
 * An increment of exactly one proves which side supplied the next event,
 * even when the provider sends only an aggregate scoreboard. More than one
 * unknown event or a backwards correction is never guessed. These are
 * shadow decisions until the provider's live results have been validated.
 */
export function gradeFromAcceptedCounters(contract,frame={}){
 if(!contract||!['sequence','race'].includes(contract.kind))return null;
 const base=contract.baseline,latest=frame.teams?.[contract.event];
 const bh=nonNeg(base?.home),ba=nonNeg(base?.away),
  h=nonNeg(latest?.home),a=nonNeg(latest?.away);
 if([bh,ba,h,a].some(v=>v===null)||h<bh||a<ba)return null;
 const deltaHome=h-bh,deltaAway=a-ba,delta=deltaHome+deltaAway;
 const end=frame.ended===true;
 if(contract.kind==='sequence'){
  if(contract.target!==bh+ba+1)return null;
  if(delta===1){
   const winner=deltaHome===1?'home':'away';
   return contract.side===winner?'WON':'LOST';
  }
  if(delta===0&&end)return contract.side==='none'?'WON':'LOST';
  return null;
 }
 if(bh>=contract.target||ba>=contract.target)return null;
 const homeReached=h>=contract.target,awayReached=a>=contract.target;
 if(contract.side==='none'){
  if(homeReached||awayReached)return 'LOST';
  return end&&contract.noneOffered===true?'WON':null;
 }
 if(!homeReached&&!awayReached){
  return end&&contract.noneOffered===true?'LOST':null;
 }
 if(homeReached&&awayReached)return null;
 return (homeReached?'home':'away')===contract.side?'WON':'LOST';
}
