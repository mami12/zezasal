/** Public Ybets API -> the board's provider-independent contract.
 * This module never evaluates a wager or invents a result from elapsed time.
 */
export const YBETS_MATCH_OFFSET = 7_000_000_000_000;
const LOOKUP_OFFSET = 1_000_000_000;
const integer = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const score = value => integer(value) ? value : null;
const label = value => String(value ?? '').trim();
const comparable = value => label(value).normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
const slug = value => comparable(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const idValue = value => {
  const n = typeof value === 'number' ? value : /^\d+$/.test(String(value)) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw new TypeError('Invalid Ybets native match ID');
  return n;
};
export function internalMatchId(nativeId) {
  const id = idValue(nativeId);
  if(id >= 1_000_000_000_000) throw new RangeError('Ybets native match ID is outside its reserved namespace');
  return YBETS_MATCH_OFFSET + id;
}
export const isYbetsMatchId = value => Number.isSafeInteger(Number(value)) && Number(value) > YBETS_MATCH_OFFSET && Number(value) < YBETS_MATCH_OFFSET+1_000_000_000_000;
export function nativeMatchId(value) {
  if(!isYbetsMatchId(value)) throw new TypeError('Not a Ybets board match ID');
  return Number(value)-YBETS_MATCH_OFFSET;
}
const lookupId = value => {
  if(value == null) return null;
  const id=idValue(value);
  if(id>2_147_483_647-LOOKUP_OFFSET) throw new RangeError('Ybets lookup ID exceeds the database namespace');
  return LOOKUP_OFFSET+id;
};

export function isYbetsFootball(match={}) {
  return match.tournament?.sport?.key === 'soccer' &&
    match.tournament?.sport?.type === 'regular' && match.type === 'match';
}

function phaseOf(match) {
  const stage=comparable(match.stage);
  // CLOSED is a listing lifecycle state: some fixtures close before kickoff.
  if(Number(match.status) === 4 || /^(?:finished|ended|full[ -]?time|ft|after match)$/.test(stage))
    return {phase:'FT',status:'ended',feedStatus:'Finished'};
  if(Number(match.status) === 3) return {phase:null,status:'closed',feedStatus:'Closed'};
  if(Number(match.status) === 5) return {phase:null,status:'uncovered',feedStatus:'Not Covered'};
  if(Number(match.status) === 0) return {phase:'pre',status:'scheduled',feedStatus:'Not Started'};
  if(/^(?:half 1|1st half|first half)$/.test(stage)) return {phase:'1H',status:Number(match.status)===2?'suspended':'live',feedStatus:'First Half'};
  if(/^(?:half 2|2nd half|second half)$/.test(stage)) return {phase:'2H',status:Number(match.status)===2?'suspended':'live',feedStatus:'Second Half'};
  if(/^(?:half[ -]?time|break|break time|ht|interval)$/.test(stage)) return {phase:'HT',status:Number(match.status)===2?'suspended':'live',feedStatus:'Half Time'};
  return {phase:null,status:Number(match.status)===2?'suspended':Number(match.status)===1?'live':'unknown',feedStatus:label(match.stage)||(Number(match.status)===2?'Stopped':Number(match.status)===1?'Live':'Unknown')};
}

/** The provider's match_time is a snapshot, never inferred from kickoff. */
export function clockMilliseconds(value) {
  if(typeof value !== 'string' || !/^\d{1,3}:\d{2}(?::\d{2})?$/.test(value)) return null;
  const parts=value.split(':').map(Number);
  if(parts.at(-1)>59 || (parts.length===3 && parts[1]>59)) return null;
  return parts.reduce((n,p)=>n*60+p,0)*1000;
}
const instant = value => {
  if(!value) return null;
  const at=Date.parse(String(value));
  return Number.isFinite(at) && at>0 ? new Date(at).toISOString() : null;
};

export function normalizeMatch(match) {
  if(!isYbetsFootball(match)) return null;
  const tournament=match.tournament??{},category=tournament.category??{},phase=phaseOf(match);
  const millis=clockMilliseconds(match.statistics?.clock?.match_time),start=instant(match.start_time);
  return {
    match_id:internalMatchId(match.id),sport_id:18,sport_tag:'football',
    category_id:lookupId(category.id),category_slug:category.slug||slug(category.name),category_name:label(category.name)||null,
    tournament_id:lookupId(tournament.id),tournament_slug:tournament.slug||slug(tournament.name),tournament_name:label(tournament.name)||null,
    home:label(match.competitors?.home?.name),away:label(match.competitors?.away?.name),
    service:Number(match.status)===0?'PREMATCH':'LIVE',start_at:start?new Date(start):null,
    is_hot:false,is_real:true,live_minute:millis==null?null:Math.floor(millis/60000),phase:phase.phase,status:phase.status,
    raw:{provider:'YBETS',nativeMatchId:match.id,urn_id:match.urn_id,ybets:match},
  };
}

export function normalizeInfo(match,{observedAt=Date.now()}={}) {
  const phase=phaseOf(match),stats=match.statistics??{},total=stats.total_score;
  const info={matchId:internalMatchId(match.id),
    observedAt:instant(observedAt instanceof Date?observedAt.toISOString():typeof observedAt==='number'?new Date(observedAt).toISOString():observedAt),
    providerClockAt:instant(stats.clock?.clock_updated_at),
    providerScoreAt:instant(stats.score_updated_at??stats.total_score_updated_at),
  };
  // Public match-status publications may omit unchanged match fields.
  if(match.status!=null || label(match.stage))info.feedStatus=phase.feedStatus;
  if(match.available_markets!=null && match.status!=null)
    info.hasOpenOdds=[0,1].includes(Number(match.status)) && Number(match.available_markets)>0;
  else if(match.status!=null && ![0,1].includes(Number(match.status)))info.hasOpenOdds=false;
  const home=score(total?.home),away=score(total?.away);
  if(home!=null&&away!=null){info.homeScore=home;info.awayScore=away;}
  const clock=clockMilliseconds(stats.clock?.match_time);
  if(clock!=null)info.matchTimeMs=clock;
  const periods=(stats.period_score??[]).filter(p=>score(p.home)!=null&&score(p.away)!=null&&integer(p.number))
    .slice().sort((a,b)=>a.number-b.number).map(p=>({t1:p.home,t2:p.away,number:p.number,name:p.period_name,key:p.period_key,type:p.type}));
  if(periods.length)info.periodsScore=periods;
  return info;
}

export const isHandicapMarket = market => /\b(?:handicaps?|fora|asian|aziatik\w*)\b/i.test(label(market?.name??market?.market_name??market?.marketName));
export function marketIdentity(market) {
  const id=idValue(market.id);
  return `yb${id}@${Buffer.from(String(market.specifier??'')).toString('base64url')}`;
}
const periodOf = name => /\b(?:1st|first) half\b|\bhalf 1\b/i.test(name)?1:/\b(?:2nd|second) half\b|\bhalf 2\b/i.test(name)?2:0;
function outcomeKey(outcome,market,match) {
  const name=comparable(outcome.name),home=comparable(match.competitors?.home?.name),away=comparable(match.competitors?.away?.name);
  // Strict entire-label matches: "Home And Over" must not become a 1X2 selection.
  if(name && home && name===home) return '1';
  if(name && away && name===away) return '2';
  if(/^(?:draw|tie|x)$/.test(name))return 'X';
  if(/^(?:1x|12|x2)$/.test(name))return name.toUpperCase();
  if(/^(?:over|under)(?:\s+[+-]?\d+(?:\.\d+)?)?$/.test(name))return name.startsWith('over')?'Over':'Under';
  if(/^(?:yes|no|odd|even)$/.test(name))return name.charAt(0).toUpperCase()+name.slice(1);
  return `o${Buffer.from(String(outcome.id??outcome.outcome_external_id??outcome.name??'')).toString('base64url')}`;
}

/** All named markets except handicap are preserved, including native player/event contracts. */
export function normalizeMarkets(match,markets) {
  const matchId=internalMatchId(match.id),rows=[];
  for(const market of markets??[]){
    if(!market || !label(market.name) || isHandicapMarket(market))continue;
    // A frame for another BC match must never be assigned to this API match ID.
    if(market.match_urn_id && match.urn_id && market.match_urn_id!==match.urn_id)continue;
    const marketKey=marketIdentity(market),name=Number(market.id)===85&&/^match result$/i.test(label(market.name))?'Full Time Result':label(market.name);
    const params=new URLSearchParams(String(market.specifier??'').replaceAll('|','&'));
    const hcp=params.get('hcp'),line=hcp!=null&&/^[+-]?\d+(?:\.\d+)?$/.test(hcp)?hcp:'';
    const period=periodOf(name),isBase=period===0&&/^(?:Full Time Result|Total Goals|Double Chance|Both Teams To Score)$/.test(name);
    const column=/^(?:Full Time Result|Double Chance)$/.test(name)?'result':/^Total Goals$/.test(name)?'total':'other';
    for(const outcome of market.outcomes??[]){
      if(!outcome || outcome.id==null && outcome.outcome_external_id==null && !label(outcome.name))continue;
      const odds=typeof outcome.odds==='number'&&Number.isFinite(outcome.odds)&&outcome.odds>1000?outcome.odds/1000:null;
      rows.push({matchId,marketKey,marketName:name,line,outcomeKey:outcomeKey(outcome,market,match),outcomeName:label(outcome.name),
        price:odds,suspended:Number(market.status)!==1||outcome.active!==true||odds==null,
        isBase,order:Number(market.priority)||0,period,column,providerId:'YBETS',
        subgames:{provider:'YBETS',nativeMatchId:match.id,matchUrnId:match.urn_id,nativeMarketId:market.id,
          marketExternalId:market.market_external_id,specifier:String(market.specifier??''),nativeMarketName:market.name,
          marketStatus:market.status,nativeOutcomeId:outcome.id,outcomeExternalId:outcome.outcome_external_id,
          nativeOutcomeName:outcome.name,groups:market.market_groups??[]},
      });
    }
  }
  return rows;
}
