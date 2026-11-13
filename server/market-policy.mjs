/**
 * Global offer policy. These exclusions apply to NEW provider offers and
 * browser/socket projections, never to the immutable terms of past tickets.
 *
 * Zizobet's full-match API is an indivisible payload. We can discard unwanted
 * markets immediately on ingest, before normalization/storage/broadcast, but
 * cannot make its upstream getprematchgamefull/gamenew response omit them.
 */
const marketTitle=market=>String(
  market?.marketName??market?.market_name??market?.name??
  market?.nativeMarketName??market?.native_market_name??''
).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 .replace(/[_–—]+/g,' ').replace(/\s+/g,' ').trim();

/** Retire incident/discipline prop markets about a NAMED player. Do not
 * retire aggregate shots/fouls/cards/corners, team goal markets or anonymous
 * first/next goal selections. Retain plain anytime goal scorer as requested. */
export function isRetiredPlayerOfferMarket(market){
 const title=marketTitle(market);
 if(!title)return false;
 // Team-level propositions must continue through normal provider settlement.
 if(/^(?:home team|away team|team [12]|either team|both teams|total |first team|last team|next team)\b/.test(title))return false;
 if(/\b(?:anytime|any time)\s+goalscorer\b/.test(title)&&
    !/\b(?:extra\s*time|overtime)\b/.test(title))return false;

 // Native provider markets frequently embed the person's full name in the
 // market title rather than in an outcome label.
 const individual=(
   !!String(market?.player??market?.pl??market?.nativeParameters?.pl??'').trim()||
   /\b(?:player|goalscorer|goal scorer|goalkeeper|goal keeper|scorer)\b/.test(title)||
   /^(?!\d)(?!total\b)[\p{L}][\p{L}'., -]{1,95}\s+(?:to\s+|\-\s+|will\s+)/u.test(title)
 );
 if(!individual)return false;

 // Carded / sent off / keeper saves / fouls / assists / tackles / shots.
 if(/\b(?:to be|will be)\s+(?:yellow\s+carded|red\s+carded|carded|booked|sent\s+off)\b/.test(title)||
    /\b(?:yellow\s+card|red\s+card|booking|sent\s+off|sending\s+off)\b/.test(title)||
    /\b(?:shots?|shots?\s+on\s+(?:goal|target)|saves?|goalkeeper\s+saves?|fouls?|tackles?|assists?)\b/.test(title))return true;

 // Player-specific scorer specials (including 1H/2H, minute intervals,
 // extra-time, multi-goal, header, first/last or numbered goals).
 if(/\b(?:first|1st|last|final|2nd|second|third|3rd)\s+goalscorer\b/.test(title)||
    /\b(?:first|last|next)\s+(?:goal|scorer)\b/.test(title)||
    /\b(?:score|scoring|goal)\b.*\b(?:header|headed|head|by head)\b/.test(title)||
    /\b(?:to score|score|scoring|goals?)\b.*\b(?:extra\s*time|overtime|incl(?:uding)?\.?\s+extra\s*time)\b/.test(title)||
    /\bto\s+score\s+(?:(?:in|during|between|from|within|the)\b|\d+\s*(?:(?:\+|or more)\s*)?goals?\b)/.test(title)||
    /\b(?:to\s+score|scores?)\s+(?:at\s+least\s+)?\d+\s+goals?\b/.test(title)||
    /\b(?:to score|scorer)\b.*\b(?:minute|minutes|interval|1st\s+half|2nd\s+half|first\s+half|second\s+half)\b/.test(title))
   return true;
 return false;
}

export const isHandicapOfferMarket = market => market?.explicitlyExcluded === true;
export const isEarlyPayoutOfferMarket = market => /1x2\s*\(xup\)|early\s*payout/i.test(String(market?.name ?? market?.market_name ?? '')) || String(market?.native_market_id ?? market?.nativeMarketId ?? '') === '27073';
export const isExcludedOfferMarket = market =>
 isHandicapOfferMarket(market) || isEarlyPayoutOfferMarket(market) || isRetiredPlayerOfferMarket(market);
