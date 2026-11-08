/**
 * Bets: place, book (share a code), list, settle at final result.
 *
 * The rules are the ones the original backend used, kept identical so the UI behaves the
 * same: minimum stake 100 LEK, only ACTIVE accounts, prices validated against the live
 * feed (never trusted from the client), live odds must be fresh, and the stake leaves the
 * balance in the same transaction that creates the ticket.
 *
 * The feed keeps prices in memory (server/odds-store.mjs), so a selection is resolved by
 * looking the market up there - which is also the anti-tamper check, because the price
 * used for the ticket is the server's, not the one the browser sent.
 */
import crypto from 'node:crypto';
import { pool, query } from '../db.mjs';
import { config } from '../config.mjs';
import { getOddsForMatches } from '../odds-store.mjs';
import { serializeMatch, phaseFromStatus } from '../collector.mjs';
import { getMatchById } from '../matches.mjs';
import { feedIsRefreshing } from '../idle-mode.mjs';
import * as overrides from './overrides.mjs';
import { outcomeIdOf, marketIdOf, parseOutcomeId, toClientMatch } from './view.mjs';
import { parseBuilderId, findLeg, listAvailableTemplates } from './bet-builders.mjs';
import { multipliedComboPrice, isSameGameComboLine } from './automatic-combos.mjs';
import { liveRiskSettings } from '../live-risk-settings.mjs';
import { isDecidedLiveOutcome, isYbetsNativeOffer } from './decided-markets.mjs';
import {isExcludedOfferMarket} from '../market-policy.mjs';
import {assertMarketEnabled} from './market-catalog-store.mjs';
import { chargeManagerCommission, refundManagerCommission } from './manager-finance.mjs';
import { assertPlayerCanBet } from './player-controls.mjs';
import { ticketTypeForSelectionCount, totalOddsForSelections, potentialPayout as calculatePotentialPayout } from './ticket-pricing.mjs';
import { isResultBttsMarket, parseResultBttsOutcome } from './result-btts.mjs';
import { liveRiskReason } from '../live-risk.mjs';
import { lockLiveRiskSettings } from './live-risk-store.mjs';
import { assertLiveBetRisk } from './bet-risk.mjs';
import { isResultTotalMarket, isTotalBttsMarket, isFirstHalfResultBtts, parseResultTotal, parseTotalBtts } from './mixed-combos.mjs';
import { buildSystemColumns, splitSystemStake, moneyCents, frozenSelectionPrice, systemColumnPayout } from './system-columns.mjs';
import { aggregateSystemTicket, parseSystemTicketId, systemTicketId, SYSTEM_STATUS_SQL } from './system-ticket-view.mjs';
import { isImpossibleLiveCombination } from './combo-feasibility.mjs';
import { assertDistinctSelectionMarkets } from './selection-market.mjs';
import {quoteValidUntil,quoteExpired} from './quote-validity.mjs';
import {isSyntheticFootballMatch} from '../football-competitions.mjs';
import {frozenLiveContract} from './live-contract-context.mjs';
import {parsePlayerCardContract} from './live-contract-rules.mjs';
import {parseCornerComparison} from './corner-comparisons.mjs';
import {parseFirstHalfCorner,parseHalfEventContract} from './live-contract-rules.mjs';
import {isHandicapMarket,parseHandicapContract} from './handicap-contracts.mjs';
import {isDcBttsMarket,parseDcBttsOutcome} from './dc-btts.mjs';
import {isHtFtMarket,parseHtFtOutcome} from './ht-ft.mjs';
import {isStatisticMarket,statisticMarketContract} from './statistic-markets.mjs';

const MIN_STAKE = 100; // LEK
// Prematch prices are refreshed hourly (SUBSCRIBE/PREMATCH_REFRESH_MS) unless the fixture is
// about to start, so they are allowed to be older - but not unbounded: a price the feed has
// stopped refreshing must not be sold, so the window is the hourly tier plus a margin.
const PRICE_TOLERANCE = 0.0000001; // Any quoted-price change requires explicit acceptance.

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

const bookingCode = () => crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();

// Under wallet locks, database-backed feed modes must use the SAME connection.
const loadMatch = async (id, executor) => config.matchStore === 'db'
  ? (await executor('select * from matches where match_id = $1',[id])).rows[0] ?? null
  : getMatchById(id);
const loadOdds = async (id, executor) => config.oddsStore === 'db'
  ? (await executor('select * from odds_current where match_id = $1 order by is_base desc, grp_order, period, market_key, line, outcome_key',[id])).rows
  : getOddsForMatches([id]);

/**
 * Turns one selection from the client ({ outcomeId, oddsAtPlacement }) into the row we
 * will store, using our own live price. Throws a 400 with a user-facing message.
 */
async function resolveSelectionInternal(selection, {executor = query} = {}) {
  const builder = parseBuilderId(selection?.outcomeId);
  if (builder) return resolveBuilderSelection(selection,builder,{executor});
  // idle mode: while the feed is paused (or starting again) the prices on the board have not
  // been refreshed since before the pause - selling one of them would be selling a stale price
  if (feedIsRefreshing()) {
    throw Object.assign(badRequest('Kuotat po rifreskohen. Provo përsëri pas pak sekondash.'),{code:'FEED_REFRESHING',outcomeId:selection?.outcomeId});
  }

  const parsed = parseOutcomeId(selection?.outcomeId);
  if (!parsed) throw badRequest('Zgjedhja nuk u njoh. Rifresko faqen dhe provo përsëri.');

  const matchId = Number(parsed.matchId);
  const match = await loadMatch(matchId,executor);
  if (!match) throw badRequest('Ndeshja nuk është më e disponueshme.');
  if(isSyntheticFootballMatch(match))throw Object.assign(badRequest('Kjo ndeshje virtuale nuk ofrohet.'),{code:'MATCH_NOT_OFFERED',outcomeId:selection.outcomeId});
  if (match.listing_stale === true || match.has_open_odds === false) throw Object.assign(
    badRequest('Kuota për këtë zgjedhje nuk është më e disponueshme.'), { code: 'SELECTION_UNAVAILABLE', outcomeId: selection.outcomeId });
  if (match.active === false || phaseFromStatus(match.feed_status) === 'FT' || ['ended','finished','cancelled'].includes(String(match.status ?? '').toLowerCase())) {
    throw badRequest('Ndeshja ka përfunduar ose është anuluar.');
  }

  const quotedOffers = await loadOdds(matchId,executor);
  const row = quotedOffers.find(
    (o) => o.market_key === parsed.marketKey && String(o.line ?? '') === String(parsed.line ?? '') && o.outcome_key === parsed.outcomeKey,
  );
  if (!row) throw badRequest('Kuota për këtë zgjedhje nuk është më e disponueshme.');
  if(isExcludedOfferMarket(row))throw Object.assign(badRequest('Ky treg nuk ofrohet.'),{code:'MARKET_NOT_OFFERED',outcomeId:selection.outcomeId});
  await assertMarketEnabled(row,executor,match);
  const nativeOffer=isYbetsNativeOffer(row,match);
  // Offer decisions depend on provider state and explicit admin policy.
  // Missing later evidence leaves the accepted wager PENDING for review.
  if (liveRiskSettings().combosEnabled === false && isSameGameComboLine({marketName:row.market_name})) {
    throw Object.assign(badRequest('Combot janë çaktivizuar nga administrata.'), {code:'COMBOS_DISABLED'});
  }
  // Never accept an expired contract even if a stale client still shows it.
  if (isDecidedLiveOutcome(match, {
    name: row.market_name, line: row.line, period: row.period,
    outcome_name: row.outcome_name, outcome_key: row.outcome_key,
  })) {
    const err = badRequest('Ky treg ka përfunduar dhe nuk pranon më baste.');
    err.code = 'MARKET_DECIDED';
    throw err;
  }
  if (row.suspended === true) throw badRequest('Kjo kuotë është pezulluar për momentin.');

  const comboParser = isResultTotalMarket(row.market_name) ? parseResultTotal
    : isTotalBttsMarket(row.market_name) ? parseTotalBtts : null;
  if (!nativeOffer && comboParser && !comboParser(row.outcome_key, match.home, match.away) &&
      !comboParser(row.outcome_name, match.home, match.away)) {
    throw badRequest('Kombinimi nuk u identifikua saktë nga furnizuesi.');
  }

  // Only sell result + BTTS selections when both parts of the contract are identifiable.
  // An unknown provider code cannot safely be graded at the end of the match.
  if (!nativeOffer && isResultBttsMarket(row.market_name) &&
      !parseResultBttsOutcome(row.outcome_key, match.home, match.away) &&
      !parseResultBttsOutcome(row.outcome_name, match.home, match.away)) {
    throw badRequest('Ky kombinim Rezultati + Të dy ekipet shënojnë nuk është identifikuar plotësisht.');
  }

  // HT/FT is two explicit 1-X-2 results. Decode the provider selection
  // now rather than charging the wallet for an unknowable text label.
  if(isHtFtMarket(row.market_name)&&
     !parseHtFtOutcome(row.outcome_name,row.outcome_key))
    throw Object.assign(badRequest('Opsioni Pjesa e parë / Fundi i ndeshjes nuk u njoh.'),{
      code:'MARKET_EVIDENCE_UNSUPPORTED',outcomeId:selection?.outcomeId});
  if(isDcBttsMarket(row.market_name)&&
     !parseDcBttsOutcome(row.outcome_name,row.outcome_key))
    throw Object.assign(badRequest('Kombinimi Double Chance + BTTS nuk ka opsion të identifikueshëm.'),{
      code:'MARKET_EVIDENCE_UNSUPPORTED',outcomeId:selection?.outcomeId});
  // admin overrides win over the feed: a suspended match/market/outcome blocks the bet, and
  // a pinned price is the price the ticket gets
  const matchOverride = overrides.matchOverride(matchId);
  const marketOverride = overrides.marketOverride(matchId, parsed.marketKey, parsed.line);
  const outcomeOverride = overrides.outcomeOverride(matchId, parsed.marketKey, parsed.line, parsed.outcomeKey);
  if (matchOverride?.hidden || matchOverride?.suspended || marketOverride?.suspended || outcomeOverride?.suspended) {
    throw badRequest('Ndeshja ose kuota është pezulluar nga administrata.');
  }

  const rawPrice = outcomeOverride?.price ?? (row.price === null || row.price === undefined ? null : Number(row.price));
  if (!Number.isFinite(Number(rawPrice)) || Number(rawPrice) <= 1) throw badRequest('Kjo kuotë nuk ka çmim të vlefshëm.');
  const price = frozenSelectionPrice(rawPrice);

  // Never trust a disabled button as protection: enforce the same reversible
  // live-risk suspension here, before balance deduction AND booking creation.
  const riskReason = liveRiskReason(match, {
    marketName: row.market_name,
    marketKey: parsed.marketKey,
    outcomeName: row.outcome_name,
    outcomeKey: parsed.outcomeKey,
    price,
  });
  if (riskReason) {
    const err = badRequest('Ky koeficient është pezulluar automatikisht për shkak të rrezikut live.');
    err.code = 'LIVE_RISK_SUSPENDED';
    throw err;
  }

  // prices must be fresh, otherwise a bet could take a price that has already moved: live
  // prices have 120s, prematch the hourly refresh window plus a margin (see the constants)
  if (quoteExpired(quoteValidUntil(row.updated_at,match,config.prematchStaleMs))) {
    throw Object.assign(badRequest('Kuotat po rifreskohen. Provo përsëri pas pak sekondash.'),{code:'QUOTE_STALE',outcomeId:selection?.outcomeId});
  }

  const shown = Number(selection?.oddsAtPlacement ?? selection?.odds ?? price);
  if (Number.isFinite(shown) && shown > 0 && Math.abs(price - shown) / shown > PRICE_TOLERANCE) {
    const err = badRequest('Koeficienti ka ndryshuar gjatë vendosjes së bastit.');
    err.code = 'ODDS_CHANGED';
    err.outcomeId = selection.outcomeId;
    err.oldOdds = shown;
    err.newOdds = price;
    err.outcomeName = row.outcome_name ?? parsed.outcomeKey;
    err.marketName = row.market_name ?? parsed.marketKey;
    err.matchName = `${match.home} vs ${match.away}`;
    throw err;
  }

  // Full-time foul/shot markets are backed by the verified statistics
  // providers. Never freeze them as a time-ordered incident contract or
  // accept an unrecognized player/half statistic with no settlement rule.
  if(isStatisticMarket(row)){
    const stat=statisticMarketContract(row);
    const selected=String(row.outcome_name??row.outcome_key??'')
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
    const validChoice=stat?.scope==='result'?
      /^(?:1|x|2|home|away|draw)$/.test(selected)||
      selected===String(match.home??'').trim().toLowerCase()||
      selected===String(match.away??'').trim().toLowerCase():
      /^(?:over|under)(?:\b|\s)/.test(selected);
    if(!stat?.supported||!validChoice)
      throw Object.assign(badRequest('Këtij tregu i mungon një rregull i verifikuar për statistikën.'),{
        code:'MARKET_EVIDENCE_UNSUPPORTED',outcomeId:selection?.outcomeId});
  }
  // Freeze whether the actual quoted market includes a third "Neither"
  // selection. Two-way races keep their original VOID rule when X is never
  // reached; three-way races pay Neither and lose on 1/2 instead.
  const raceName=String(row.market_name??row.marketName??'');
  // A rest-of-match score must be anchored to the exact verified primary
  // scoreboard when purchased. Otherwise a stale quote changes the contract.
  const correctRest=raceName.match(/^correct score rest of match\s*\(from\s*(\d{1,2})\s*:\s*(\d{1,2})\)$/i);
  if(correctRest){
    const baseHome=Number(correctRest[1]),baseAway=Number(correctRest[2]);
    if(String(match.service??'').toUpperCase()==='LIVE'){
      const currentHome=match.home_score==null?null:Number(match.home_score);
      const currentAway=match.away_score==null?null:Number(match.away_score);
      const stamp=Date.parse(match.score_at??match.scoreAt??'');
      if(currentHome!==baseHome||currentAway!==baseAway||
         !Number.isFinite(stamp)||Date.now()-stamp>90000||stamp-Date.now()>5000)
        throw Object.assign(badRequest('Rezultati ka ndryshuar. Rifresko koeficientin për këtë treg.'),{
          code:'SELECTION_UNAVAILABLE',outcomeId:selection?.outcomeId});
    }else if(baseHome!==0||baseAway!==0){
      throw Object.assign(badRequest('Kjo kuotë kërkon një rezultat LIVE të verifikuar.'),{
        code:'SELECTION_UNAVAILABLE',outcomeId:selection?.outcomeId});
    }
  }
  // "Other Score" is the complement of the ACTUAL provider quote grid,
  // never a hard-coded 0:0..4:4 grid that might overpay or underpay.
  const correctScoreMarket=/^(?:(?:1st|first|2nd|second) half\s*[-:.]\s*)?correct score$|^correct score rest of match\s*\(from\s*\d+:\d+\)$/i.test(raceName);
  const otherScore=/^(?:any\s+)?other(?:\s+score|\s+(?:home|away)\s+win|\s+draw)?$/i.test(String(row.outcome_name??'').trim());
  let correctScoreGrid=null;
  if(correctScoreMarket&&otherScore){
    const grid=quotedOffers.filter(o=>
      o.market_key===row.market_key&&String(o.line??'')===String(row.line??''))
      .map(o=>String(o.outcome_name??'').trim().match(/^(\d{1,2})\s*[:\-]\s*(\d{1,2})$/))
      .filter(Boolean).map(m=>[Number(m[1]),Number(m[2])]);
    if(!grid.length||grid.length>500)
      throw Object.assign(badRequest('Mungon lista e rezultateve të këtij tregu.'),{
        code:'MARKET_EVIDENCE_UNSUPPORTED',outcomeId:selection?.outcomeId});
    correctScoreGrid=grid;
  }

  const isRace=/\brace to \d+ (?:goals?|corners?|cards?)\b|\b(?:reaches|gets|takes|scores|receives) \d+ (?:goals?|corners?|cards?) first\b/i.test(raceName);
  const isSequenceMarket=!isRace&&
    /\b(?:next|first|\d+(?:st|nd|rd|th)?)\s+(?:goals?|corners?|cards?|bookings?)\b|\b(?:goals?|corners?|cards?|bookings?)\s+\d+\b/i.test(raceName);
  const isCardSequence=isSequenceMarket&&/\b(?:cards?|bookings?)\b/i.test(raceName);
  const sequenceNoneOffered=isSequenceMarket&&quotedOffers.some(o=>
    o.market_key===row.market_key&&String(o.line??'')===String(row.line??'')&&
    /^(?:none|neither|no team|no one|no goal|no more goals?|no corner|no more corners?|no cards?|no more cards?|no bookings?|x|draw)$/i.test(
      String(o.outcome_name??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()));
  // Two-way First/Last (half) incident bets refund on no event. A real
  // third "Neither" outcome means the team choices LOSE instead. Snapshot
  // the actual sibling quote list, not an assumption about provider rules.
  // Match the market grammar independently of its offered team label:
  // native feeds may quote 'Inter Milan' rather than literal '1'.
  const halfTitle={...row,outcome_name:'1',outcomeName:'1',outcome_key:'1',outcomeKey:'1'};
  const isHalfIncident=Boolean(parseFirstHalfCorner(halfTitle)||parseHalfEventContract(halfTitle));
  const halfNoneOffered=isHalfIncident&&quotedOffers.some(o=>
    o.market_key===row.market_key&&String(o.line??'')===String(row.line??'')&&
    /^(?:none|neither|no team|no one|no goal|no more goals?|no corner|no more corners?|no cards?|no more cards?|x|draw|asnj[eë]ra)$/i.test(
      String(o.outcome_name??o.outcome_key??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()));
  const isLast=/^(?:(?:which|what) team (?:will )?(?:score|take|receive) (?:the )?)?last (?:goal|corner|card)$|^(?:last (?:goal|corner|card) (?:by|scored by|taken by)|team (?:to )?(?:score|take|receive) (?:the )?last (?:goal|corner|card))$/i.test(raceName);
  const lastNoneOffered=isLast&&quotedOffers.some(o=>
    o.market_key===row.market_key&&String(o.line??'')===String(row.line??'')&&
    /^(?:none|neither|no team|no one|asnj[eë]ra|asnje skuader|x|draw)$/i.test(
      String(o.outcome_name??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()));
  const raceNoneOffered=isRace&&quotedOffers.some(o=>
    o.market_key===row.market_key&&String(o.line??'')===String(row.line??'')&&
    /^(?:none|neither|no team|no one|asnj[eë]ra|asnje skuader|x|draw)$/i.test(
      String(o.outcome_name??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()));
  // Cards cannot use the goal scoreboard or a guessed yellow+red sum.
  // Only a confirmed, recent primary card incident coverage can establish
  // whether Race to X Cards has already ended at LIVE placement.
  let raceCardSnapshot=null;
  if(((isRace&&/\brace to \d+ cards?\b/i.test(raceName))||isCardSequence)&&
     String(match.service??'').toUpperCase()==='LIVE'){
    try{
      raceCardSnapshot=(await executor(`select count_home,count_away,through_minute,observed_at,confirmed_at
        from app_match_event_coverage
        where match_id=$1 and provider='zizobet' and kind='card'
          and confirmed_at is not null limit 1`,[matchId])).rows?.[0]??null;
    }catch{raceCardSnapshot=null;}
  }
  // Player booking quotes use a real, verified card chronology at the
  // acceptance instant. A missing timeline may not turn a pre-existing card
  // into a wager on a future event.
  let playerCardSnapshot=null;
  const playerCard=parsePlayerCardContract(row);
  if(playerCard&&String(match.service??'').toUpperCase()==='LIVE'){
    try{
      const {rows:coverage}=await executor(
        "select through_minute,observed_at,confirmed_at from app_match_event_coverage "+
        "where match_id=$1 and provider='zizobet' and kind='card' and confirmed_at is not null",
        [matchId]);
      if(coverage.length){
        const {rows:actors}=await executor(
          "select player_id,player_name,card_color from app_match_event_fact "+
          "where match_id=$1 and provider='zizobet' and kind='card' and active=true",
          [matchId]);
        const person=v=>{
          const raw=String(v??'').trim();
          const parts=raw.includes(',')?raw.split(',').reverse().map(x=>x.trim()):[raw];
          return parts.join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
            .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
        };
        const expected=person(playerCard.playerName);
        const booked=actors.some(actor=>
          (!playerCard.cardColor||actor.card_color===playerCard.cardColor)&&
          (playerCard.playerId!=null&&actor.player_id!=null?
            String(playerCard.playerId)===String(actor.player_id):
            !!expected&&person(actor.player_name)===expected));
        playerCardSnapshot={...coverage[0],booked};
      }
    }catch{playerCardSnapshot=null;}
  }
  // Most Corners can be a two-way or a 1X2 quote. Freeze whether the
  // provider actually offered a draw; a tie cannot be presumed a loser.
  const quotedCornerComparison=parseCornerComparison(row);
  const cornerDrawOffered=quotedCornerComparison?.mode==='period-result'&&
    quotedOffers.some(o=>o.market_key===row.market_key&&
      String(o.line??'')===String(row.line??'')&&
      /^(?:x|draw|tie|barazim)$/i.test(String(o.outcome_name??o.outcome_key??'').trim()));
  // Asian 2-way, European 1X2 and corner handicaps differ. Freeze the
  // actual native third draw selection before any money is debited.
  const handicapDrawOffered=isHandicapMarket(row)&&quotedOffers.some(o=>
    o.market_key===row.market_key&&String(o.line??'')===String(row.line??'')&&
    /^(?:x|draw|tie|barazim)$/i.test(String(o.outcome_name??o.outcome_key??'').trim()));
  let handicapContract=null;
  if(isHandicapMarket(row)){
    handicapContract=parseHandicapContract(row,{teams:match,drawOffered:handicapDrawOffered});
    if(!handicapContract)
      throw Object.assign(badRequest('Handikapi nuk ka opsion të qartë ose kërkon pagesë pjesore 0.25/0.75.'),{
        code:'MARKET_EVIDENCE_UNSUPPORTED',outcomeId:selection?.outcomeId});
    const liveHandicap=String(match.service??'').toUpperCase()==='LIVE';
    if(liveHandicap){
      // Live Asian Handicap often means goals AFTER acceptance, whereas
      // corner spreads/other providers may use the entire match. Only an
      // explicitly labelled remaining-match market has unambiguous scope.
      if(!handicapContract.rest||handicapContract.event!=='goal'||handicapContract.half!==0)
        throw Object.assign(badRequest('Mungon rregulli i furnizuesit për handikapin LIVE.'),{
          code:'MARKET_EVIDENCE_UNSUPPORTED',outcomeId:selection?.outcomeId});
      const stamp=Date.parse(match.score_at??'');
      const h=match.home_score==null?null:Number(match.home_score);
      const a=match.away_score==null?null:Number(match.away_score);
      if(!Number.isSafeInteger(h)||h<0||!Number.isSafeInteger(a)||a<0||
         !Number.isFinite(stamp)||Date.now()-stamp>90000||stamp-Date.now()>5000)
        throw Object.assign(badRequest('Rezultati LIVE nuk është i konfirmuar për handikapin.'),{
          code:'MARKET_EVIDENCE_UNSUPPORTED',outcomeId:selection?.outcomeId});
      handicapContract={...handicapContract,baseline:{home:h,away:a}};
    }
  }
  let contract;
  try {
    contract=frozenLiveContract({...row,market_name:raceName||parsed.marketKey,
      outcome_name:row.outcome_name??parsed.outcomeKey,
      raceNoneOffered,sequenceNoneOffered,lastNoneOffered,halfNoneOffered,raceCardSnapshot,playerCardSnapshot,cornerDrawOffered},match);
    if(correctScoreGrid) contract={version:1,kind:'correct-score-grid',grid:correctScoreGrid};
    if(handicapContract)contract=handicapContract;
  } catch(error) {
    if(error?.code==='MARKET_EVIDENCE_UNSUPPORTED'){
      error.outcomeId=selection?.outcomeId;
      error.marketName=row.market_name??parsed.marketKey;
      error.outcomeName=row.outcome_name??parsed.outcomeKey;
      // A slip with several selections must identify the rejected one.
      error.message=`${error.marketName} (${error.outcomeName}): ${error.message}`;
    }
    throw error;
  }
  return {
    matchId: String(matchId),
    marketKey: parsed.marketKey,
    line: String(parsed.line ?? ''),
    outcomeKey: parsed.outcomeKey,
    outcomeName: row.outcome_name ?? parsed.outcomeKey,
    marketName: row.market_name ?? parsed.marketKey,
    matchName: `${match.home} vs ${match.away}`,
    price,
    liveContract:contract,
  };
}

export async function resolveSelection(selection, options = {}) {
  try { return await resolveSelectionInternal(selection,options); }
  catch (error) {
    const unavailable = ['MARKET_DECIDED','LIVE_RISK_SUSPENDED','SELECTION_UNAVAILABLE'].includes(error.code) ||
      (error.status === 400 && !error.code && /disponueshme|përfunduar|anuluar|pezulluar|më aktiv|mungon|çmim të vlefshëm|jashtë kufirit|nuk.*identifiku|nuk u njoh/i.test(error.message));
    if (unavailable && error.code !== 'ODDS_CHANGED') {
      if (error.outcomeId && error.outcomeId !== selection?.outcomeId) error.sourceOutcomeId = error.outcomeId;
      error.outcomeId = selection?.outcomeId;
      error.code ||= 'SELECTION_UNAVAILABLE';
    }
    throw error;
  }
}

// A regular ticket must never multiply correlated picks from one match.
function assertDistinctMatches(lines) {
  const ids = lines.map(line => String(line.matchId));
  if (new Set(ids).size !== ids.length) {
    throw badRequest('Dy markete nga e njëjta ndeshje duhen ndarë në kolona ose zgjedhur si Bet Builder.');
  }
}

// Resolve each template leg through the exact same price, lock, freshness and
// risk checks as a normal ticket. Never trust browser-provided composite odds.
async function resolveBuilderSelection(selection, { matchId, templateId }, {executor = query} = {}) {
  if (liveRiskSettings().combosEnabled === false) {
    throw Object.assign(badRequest('Combot janë çaktivizuar nga administrata.'), {code:'COMBOS_DISABLED'});
  }
  if (feedIsRefreshing()) throw Object.assign(badRequest('Kuotat po rifreskohen.'),{code:'FEED_REFRESHING',outcomeId:selection?.outcomeId});
  const template = (await listAvailableTemplates({executor})).find(t => t.id === templateId);
  if (!template) throw badRequest('Bet Builder nuk është më aktiv.');
  await assertMarketEnabled({name:`Bet Builder: ${template.name}`},executor);
  const match = await loadMatch(Number(matchId),executor);
  if (!match) throw badRequest('Ndeshja nuk është e disponueshme.');
  if(isSyntheticFootballMatch(match))throw Object.assign(badRequest('Kjo ndeshje virtuale nuk ofrohet.'),{code:'MATCH_NOT_OFFERED',outcomeId:selection.outcomeId});
  const raw = serializeMatch(match,await loadOdds(Number(matchId),executor));
  const projected = toClientMatch(raw);
  if (isImpossibleLiveCombination(projected,{name:`Bet Builder: ${template.name}`,comboLegs:template.legs})) {
    throw Object.assign(badRequest('Ky kombinim nuk mund të fitojë më nga rezultati live.'),{code:'MARKET_DECIDED',outcomeId:selection.outcomeId});
  }
  if (projected.isSuspended || ['ENDED','CANCELLED'].includes(projected.status)) throw badRequest('Ndeshja është pezulluar.');
  const parts = template.legs.map(leg => findLeg(projected,leg));
  if (parts.some(p => !p)) throw badRequest('Një market i Bet Builder është pezulluar ose mungon.');
  // Drain both source reads before a shared transaction can roll back/release.
  // Consent is checked against the composite quote below, rather than showing a
  // source-leg price as if it were the user's accepted Bet Builder price.
  const resolvedParts = await Promise.allSettled(parts.map(part => resolveSelection({outcomeId:part.outcome.id},{executor})));
  const rejectedPart=resolvedParts.find(result=>result.status==='rejected');
  if(rejectedPart)throw rejectedPart.reason;
  const lines = resolvedParts.map(result=>result.value);
  const price = multipliedComboPrice(lines);
  if (price === null) throw badRequest('Koeficienti i Bet Builder është jashtë kufirit.');
  const shown = Number(selection?.oddsAtPlacement ?? selection?.odds);
  if (Number.isFinite(shown) && shown > 0 && Math.abs(price-shown)/shown > PRICE_TOLERANCE) {
    const err = badRequest('Koeficienti i Bet Builder ka ndryshuar.');
    err.code = 'ODDS_CHANGED'; err.outcomeId = selection.outcomeId;
    err.oldOdds = shown; err.newOdds = price;
    err.outcomeName = template.name; err.marketName = 'Bet Builder';
    err.matchName = `${match.home} vs ${match.away}`;
    throw err;
  }
  return {
    matchId: String(matchId), marketKey: `BB:${templateId}`, line: '',
    outcomeKey: 'builder', outcomeName: template.name, marketName: 'Bet Builder',
    matchName: `${match.home} vs ${match.away}`, price,
    builderLegs: lines.map(({ matchId: _matchId, ...rest }, index) => {
      // Freeze the verified contract, not an opaque provider display alias.
      // Provenance remains recorded for audits and source lock checks.
      const leg = template.legs[index];
      const marketName = {'1X2':'1X2',DC:'Double Chance',BTTS:'Both Teams to Score',TOTAL:'Total Goals'}[leg.market];
      return {
        ...rest, match_id:Number(matchId), market_key:rest.marketKey,
        source_outcome_key:rest.outcomeKey,source_market_name:rest.marketName,
        outcomeKey:leg.outcome,outcomeName:leg.outcome,marketName,line:leg.line,
        outcome_key:leg.outcome,outcome_name:leg.outcome,market_name:marketName,
      };
    }),
  };
}

/** Recheck after wallet/settings lock waits, before any money movement. */
export async function revalidateSelections(selections, lines, resolve = resolveSelection, {executor = query} = {}) {
  // Drain every read before rollback/releasing the shared transaction client.
  const results = await Promise.allSettled(selections.map(async (selection,index) => {
    const old = lines[index];
    const current = await resolve({...selection,oddsAtPlacement:old.price,odds:old.price},{executor});
    const changed = frozenSelectionPrice(current.price) !== frozenSelectionPrice(old.price) ||
      JSON.stringify(current.builderLegs ?? null) !== JSON.stringify(old.builderLegs ?? null) ||
      JSON.stringify(current.liveContract ?? null) !== JSON.stringify(old.liveContract ?? null);
    if (changed) {
      throw Object.assign(badRequest('Koeficienti ka ndryshuar gjatë vendosjes së bastit.'), {
        code:'ODDS_CHANGED', outcomeId:selection.outcomeId, oldOdds:old.price,newOdds:current.price,
        outcomeName:current.outcomeName,marketName:current.marketName,matchName:current.matchName,
      });
    }
  }));
  const rejected = results.find(result => result.status === 'rejected');
  if (rejected) throw rejected.reason;
}

/** Optional live contracts freeze inside the same wallet debit transaction.
 * Standard ticket inserts and historical tickets are unaffected.
 */
async function persistLiveContracts(runQuery,ticketId,lines){
 for(const line of lines){
  const accepted={
   version:1,providerMarketKey:line.marketKey,providerOutcomeKey:line.outcomeKey,
   providerMarketName:line.marketName,providerOutcomeName:line.outcomeName,
   line:String(line.line??''),acceptedOdds:line.price,
   liveTerms:line.liveContract??null,builderLegs:line.builderLegs??null
  };
  const updated=await runQuery(`update app_ticket_line
   set live_contract=$1::jsonb,accepted_contract=$2::jsonb
   where ticket_id=$3 and match_id=$4 and market_key=$5
    and line=$6 and outcome_key=$7 and accepted_contract is null`,
   [line.liveContract?JSON.stringify(line.liveContract):null,JSON.stringify(accepted),
    ticketId,line.matchId,line.marketKey,String(line.line??''),line.outcomeKey]);
  if(updated.rowCount!==1)throw Object.assign(new Error('Kontrata origjinale e biletës nuk u ruajt.'),{status:409});
 }
}

const round = (n, digits = 2) => Number(Number(n).toFixed(digits));

const TICKET_COLUMNS = `t.id, t.booking_code, t.user_id, t.stake, t.total_odds, t.potential_payout, t.original_potential_payout, t.potential_quote_reconstructed,
                        t.ticket_type, t.system_type, t.status, t.placed_at, t.settled_at`;

const toClientLine = (l) => ({
  id: l.id,
  ticketId: l.ticket_id,
  matchId: String(l.match_id),
  marketId: marketIdOf(String(l.match_id), l.market_key, l.line),
  outcomeId: outcomeIdOf(String(l.match_id), l.market_key, l.line, l.outcome_key),
  outcomeName: l.outcome_name,
  // Return the provider code so UI can disambiguate correlated market labels.
  outcomeCode: l.outcome_key,
  marketName: l.market_name,
  // This parameter is essential for goal-by-minute and other line-specific tickets.
  marketLine: String(l.line ?? ''),
  matchName: l.match_name,
  oddsAtPlacement: Number(l.odds_at_placement),
  status: l.status,
  settlementReason: l.status === 'PENDING' ? (l.settlement_reason ?? null) : null,
});

/** the shape the app expects (numbers, not the strings numeric columns arrive as) */
export const toClientTicket = (row, lines = [], username = null) => ({
  id: row.id,
  userId: row.user_id,
  bookingCode: row.booking_code,
  stake: Number(row.stake),
  totalOdds: Number(row.total_odds),
  potentialPayout: Number(row.original_potential_payout ?? row.potential_payout),
  potentialPayoutIsEstimated: row.potential_quote_reconstructed === true,
  actualPayout: row.status === 'PENDING' ? null : row.status === 'REVERTED' ? Number(row.stake) : ['WON','VOID'].includes(row.status) ? Number(row.potential_payout) : 0,
  ticketType: row.ticket_type,
  systemType: row.system_type,
  status: row.status,
  placedAt: row.placed_at,
  settledAt: row.settled_at,
  user: username ? { username } : null,
  lines: (lines ?? []).map(toClientLine),
});

async function linesOf(ticketId, runQuery = query) {
  const res = await runQuery('select * from app_ticket_line where ticket_id = $1 order by id', [ticketId]);
  return res.rows;
}

export async function getTicketWithLines(ticketId, {runQuery = query, consolidate = true} = {}) {
  const batchId = parseSystemTicketId(ticketId);
  if (batchId || consolidate) {
    if (!batchId && !requestIdPattern.test(String(ticketId))) return null;
    const batch = (await runQuery(batchId
      ? 'select * from app_ticket_batch where id=$1::uuid'
      : 'select * from app_ticket_batch where ticket_ids @> ARRAY[$1::uuid]', [batchId ?? ticketId])).rows[0];
    if (batch) {
      const rows = (await runQuery(`select ${TICKET_COLUMNS}, u.username from app_ticket t
        left join app_user u on u.id=t.user_id where t.id=any($1::uuid[]) and t.user_id=$2`, [batch.ticket_ids,batch.user_id])).rows;
      const tickets = await withLines(rows, {runQuery, consolidate:false});
      const byId = new Map(tickets.map(ticket => [ticket.id,ticket]));
      return aggregateSystemTicket(batch,batch.ticket_ids.map(id => byId.get(id)));
    }
    if (batchId) return null;
  }
  const res = await runQuery(
    `select ${TICKET_COLUMNS}, u.username
       from app_ticket t
       left join app_user u on u.id = t.user_id
      where t.id = $1`,
    [ticketId],
  );
  if (!res.rows.length) return null;
  return toClientTicket(res.rows[0], await linesOf(ticketId,runQuery), res.rows[0].username ?? null);
}

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function betRequestHash({ stake, selections, ticketType, systemType }) {
  const payload = {
    stake: Number(stake),
    ticketType: ticketType ?? null,
    systemType: systemType ?? null,
    selections: selections.map(s => ({
      outcomeId: String(s?.outcomeId ?? ''),
      odds: Number(s?.oddsAtPlacement ?? s?.odds),
    })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function existingRequestTicket(userId, requestId, payloadHash, db = { query }) {
  const { rows } = await db.query(
    'select id, request_payload_hash from app_ticket where user_id = $1 and client_request_id = $2',
    [userId, requestId],
  );
  if (!rows.length) {
    const batch = await db.query('select client_request_id from app_ticket_batch where user_id=$1 and client_request_id=$2', [userId, requestId]);
    if (batch.rows.length) throw Object.assign(new Error('Kjo kërkesë është përdorur për një biletë sistemi.'), { status: 409 });
    return null;
  }
  if (rows[0].request_payload_hash !== payloadHash) {
    throw Object.assign(new Error('Kjo kërkesë basti është përdorur me të dhëna të tjera.'), { status: 409 });
  }
  return rows[0].id;
}

/**
 * Places a real ticket: every selection is validated against the live feed, then the stake,
 * the ticket (with its frozen lines) and the money movement are written in ONE database
 * transaction - a failure can never leave money and tickets out of step.
 */
export async function placeBet({ user, stake, selections = [], ticketType = null, systemType = null, clientRequestId = null }, {
  database = pool, runQuery = query, getTicket = getTicketWithLines, resolve = resolveSelection,
} = {}) {
  const amount = moneyCents(stake) / 100;
  if (amount < MIN_STAKE) throw badRequest(`Shuma minimale për të vendosur një bast është ${MIN_STAKE} Lek`);
  if (amount > 50000) throw badRequest('Shuma maksimale për të vendosur një bast është 50,000 Lek.');
  if (amount > 100000000) throw badRequest('Shuma totale është shumë e madhe.');
  if (user.status !== 'ACTIVE') {
    throw Object.assign(new Error('Llogaria juaj nuk është aktive ose është e pezulluar'), { status: 403 });
  }
  if (!Array.isArray(selections) || !selections.length || selections.length > 20) {
    throw badRequest('Bileta duhet të ketë 1–20 zgjedhje.');
  }

  if (clientRequestId != null && !requestIdPattern.test(String(clientRequestId))) {
    throw badRequest('Identifikues i pavlefshëm i kërkesës së bastit.');
  }
  const requestId = clientRequestId == null ? null : String(clientRequestId).toLowerCase();
  const payloadHash = requestId ? betRequestHash({ stake: amount, selections, ticketType, systemType }) : null;
  if (requestId) {
    const previous = await existingRequestTicket(user.id, requestId, payloadHash, { query: runQuery });
    if (previous) return getTicket(previous);
  }

  const type = ticketTypeForSelectionCount(ticketType, selections.length);
  assertDistinctSelectionMarkets(selections);
  // Independent odds checks can be awaited together instead of serially.
  const lines = (await Promise.all(selections.map(resolve))).map(line => ({ ...line, price: frozenSelectionPrice(line.price) }));

  assertDistinctSelectionMarkets(lines);
  assertDistinctMatches(lines);
  const totalOdds = totalOddsForSelections(lines);
  if (!Number.isFinite(totalOdds) || totalOdds > 9999999999.9999) throw badRequest('Koeficienti i biletës është shumë i madh.');
  const payout = systemColumnPayout(amount, lines.map(line => line.price));
  if (payout > 500000) throw badRequest('Ka kaluar limitin e fitimit prej 500,000 Lek.');

  const client = await database.connect();
  try {
    await client.query('begin');

    // lock the balance row: two simultaneous bets must not both pass the check
    const locked = await client.query('select balance, manager_id, username, status, deleted_at from app_user where id = $1 for update', [user.id]);
    if (!locked.rows.length) throw badRequest('Llogaria nuk u gjet.');
    if (locked.rows[0].deleted_at || (locked.rows[0].status && locked.rows[0].status !== 'ACTIVE')) throw Object.assign(new Error('Llogaria nuk mund të vendosë baste.'), { status: 403 });
    // The balance lock serializes simultaneous requests from the same player.
    // An already committed request returns the same ticket, without another debit.
    if (requestId) {
      const previous = await existingRequestTicket(user.id, requestId, payloadHash, client);
      if (previous) {
        await client.query('commit');
        return getTicket(previous);
      }
    }
    // Serialize risk/exposure calculations globally. This lock is shared
    // across all players and is acquired BEFORE any ticket insertion.
    const riskSettings = await lockLiveRiskSettings(client);
    await revalidateSelections(selections, lines, resolve, {executor:client.query.bind(client)});
    await assertLiveBetRisk(client, [{ stake: amount, payout, lines }], riskSettings);
    const balance = Number(locked.rows[0].balance);
    await assertPlayerCanBet(client, user.id, amount);
    if (balance - amount < 0) {
      throw badRequest(`Bilanci juaj nuk mjafton për këtë bast. Ju keni ${balance.toLocaleString()} Lek në llogari.`);
    }
    const after = round(balance - amount);

    const inserted = await client.query(
      `insert into app_ticket (user_id, stake, total_odds, potential_payout, ticket_type, system_type, status, client_request_id, request_payload_hash)
       values ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8)
       returning id`,
      [user.id, amount, totalOdds, payout, type, systemType, requestId, payloadHash],
    );
    const ticketId = inserted.rows[0].id;

    // Store all ticket lines in one DB round trip (rather than one per pick).
    for (let offset = 0; offset < lines.length; offset += 100) {
      const batch = lines.slice(offset, offset + 100);
      const params = [];
      const tuples = batch.map((line, index) => {
        const base = index * 10;
        params.push(ticketId, line.matchId, line.marketKey, line.line, line.outcomeKey,
          line.outcomeName, line.marketName, line.matchName, line.price, JSON.stringify(line.builderLegs ?? null));
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, 'PENDING', $${base + 10}::jsonb)`;
      });
      await client.query(
        `insert into app_ticket_line
           (ticket_id, match_id, market_key, line, outcome_key, outcome_name, market_name, match_name, odds_at_placement, status, builder_legs)
         values ${tuples.join(', ')}`,
        params,
      );
    }

    await persistLiveContracts(client.query.bind(client),ticketId,lines);
    await client.query('update app_user set balance = $2, updated_at = now() where id = $1', [user.id, after]);
    await client.query(
      `insert into app_transaction (user_id, amount, type, reference_id, balance_after, description)
       values ($1, $2, 'BET_PLACED', $3, $4, $5)`,
      [user.id, -amount, ticketId, after, `Bast ${type} - ${lines.length} zgjedhje`],
    );
    await chargeManagerCommission(client, {
      managerId: locked.rows[0].manager_id,
      ticketId,
      username: locked.rows[0].username,
      stake: amount,
      selectionCount: lines.length,
    });

    await client.query('commit');
    return getTicket(ticketId);
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Places the full Cartesian expansion of same-event alternatives atomically.
 * totalStake is the WHOLE slip (minimum 100 LEK), shared exactly across columns.
 * Dependency injection lets isolated SQL tests exercise this production transaction.
 */
export function createColumnsPlacer({
  database = pool, runQuery = query, resolve = resolveSelection,
  getTicket = id => getTicketWithLines(id,{consolidate:false}), lockRisk = lockLiveRiskSettings,
  assertRisk = assertLiveBetRisk, assertPlayer = assertPlayerCanBet,
  chargeCommission = chargeManagerCommission,
} = {}) {
return async function placeSystemColumns({ user, totalStake, stake, selections, columns, clientRequestId }) {
  if (user.role !== 'PLAYER' || user.status !== 'ACTIVE') {
    throw Object.assign(new Error('Llogaria nuk mund të vendosë baste.'), { status: 403 });
  }
  if (!requestIdPattern.test(String(clientRequestId ?? ''))) {
    throw badRequest('Identifikues i pavlefshëm i kërkesës.');
  }
  // Older clients used `stake` PER COLUMN. Never silently reinterpret an old
  // preview as a different financial contract after a deployment.
  if (totalStake == null || stake != null) throw badRequest('Rifresko faqen: bileta e sistemit kërkon shumën totale (totalStake).');
  const amount = moneyCents(totalStake) / 100;
  if (amount > 50000) throw badRequest('Shuma maksimale për të vendosur një bast është 50,000 Lek.');
  let picks = selections;
  // If explicit columns are supplied with totalStake, require the exact full
  // expansion. A client may never omit or duplicate a column to change risk.
  if (picks == null && Array.isArray(columns)) {
    if (columns.length < 2 || columns.length > 24 || columns.some(col => !Array.isArray(col) || !col.length || col.length > 20)) {
      throw badRequest('Numër i pavlefshëm kolonash (2–24).');
    }
    const unique = new Map();
    for (const selection of columns.flat()) {
      const id = String(selection?.outcomeId ?? '');
      const old = unique.get(id);
      if (old && Number(old.oddsAtPlacement ?? old.odds) !== Number(selection.oddsAtPlacement ?? selection.odds)) {
        throw badRequest('Koeficientë të ndryshëm për të njëjtën zgjedhje.');
      }
      if (!old) unique.set(id, selection);
    }
    picks = [...unique.values()];
  }
  const grouped = buildSystemColumns(picks, { matchIdOf: selection => {
    const builder = parseBuilderId(selection?.outcomeId);
    const parsed = builder ?? parseOutcomeId(selection?.outcomeId);
    if (!parsed || !/^\d+$/.test(String(parsed.matchId))) throw badRequest('Zgjedhja nuk u identifikua.');
    return parsed.matchId;
  } });
  const stakes = splitSystemStake(amount, grouped.length);
  if (columns != null) {
    if (!Array.isArray(columns) || columns.length !== grouped.length) throw badRequest('Kolonat nuk përputhen me sistemin.');
    const fingerprint = col => {
      if (!Array.isArray(col)) throw badRequest('Kolonë e pavlefshme.');
      return col.map(pick => String(pick?.outcomeId ?? '')).sort().join('\u0000');
    };
    const expected = grouped.map(fingerprint).sort();
    const received = columns.map(fingerprint).sort();
    if (JSON.stringify(expected) !== JSON.stringify(received)) throw badRequest('Kolonat nuk përputhen me sistemin.');
  }
  const requestId = String(clientRequestId).toLowerCase();
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify({ amount, selections: picks.map(pick => ({
    outcomeId: String(pick.outcomeId), odds: Number(pick.oddsAtPlacement ?? pick.odds),
  })) })).digest('hex');
  const getPrevious = async (db) => {
    const { rows } = await db.query(
      'select * from app_ticket_batch where user_id = $1 and client_request_id = $2',
      [user.id, requestId],
    );
    if (!rows.length) {
      const ticket = await db.query('select id from app_ticket where user_id=$1 and client_request_id=$2', [user.id, requestId]);
      if (ticket.rows.length) throw Object.assign(new Error('Kjo kërkesë është përdorur për një biletë tjetër.'), { status: 409 });
      return null;
    }
    if (rows[0].request_payload_hash !== payloadHash) {
      throw Object.assign(new Error('Kjo kërkesë është përdorur me të dhëna të tjera.'), { status: 409 });
    }
    return rows[0];
  };
  const response = async batch => aggregateSystemTicket(batch,await Promise.all(batch.ticket_ids.map(getTicket)));
  const previous = await getPrevious({ query: runQuery });
  if (previous) return response(previous);
  assertDistinctSelectionMarkets(picks);

  // Every underlying selection is resolved exactly once, so repeated legs across
  // columns cannot acquire different prices while the feed changes.
  const linesById = new Map(await Promise.all(picks.map(async pick => {
    const line = await resolve(pick);
    return [String(pick.outcomeId), { ...line, price: frozenSelectionPrice(line.price) }];
  })));
  assertDistinctSelectionMarkets([...linesById.values()]);
  const resolved = grouped.map(column => column.map(pick => linesById.get(String(pick.outcomeId))));
  resolved.forEach(assertDistinctMatches);
  const priced = resolved.map((lines, i) => ({
    stake: stakes[i], odds: totalOddsForSelections(lines),
    payout: systemColumnPayout(stakes[i], lines.map(line => line.price)), lines,
  }));
  if (priced.some(column => !Number.isFinite(column.odds) || column.odds > 9999999999.9999)) {
    throw badRequest('Koeficienti i kolonës është shumë i madh.');
  }
  if (priced.some(column => column.payout > 500000)) {
    throw badRequest('Ka kaluar limitin e fitimit prej 500,000 Lek.');
  }

  const client = await database.connect();
  let ids = [], placedBatch;
  try {
    await client.query('begin');
    const locked = await client.query('select balance, manager_id, username, status, deleted_at from app_user where id = $1 for update', [user.id]);
    if (!locked.rows.length) throw badRequest('Llogaria nuk u gjet.');
    if (locked.rows[0].deleted_at || (locked.rows[0].status && locked.rows[0].status !== 'ACTIVE')) throw Object.assign(new Error('Llogaria nuk mund të vendosë baste.'), { status: 403 });
    const retry = await getPrevious(client);
    if (retry) {
      await client.query('commit');
      return response(retry);
    }
    const riskSettings = await lockRisk(client);
    await revalidateSelections(picks, picks.map(pick => linesById.get(String(pick.outcomeId))), resolve, {executor:client.query.bind(client)});
    await assertRisk(client, priced, riskSettings);
    const balance = Number(locked.rows[0].balance);
    await assertPlayer(client, user.id, amount);
    if (moneyCents(balance) < moneyCents(amount)) throw badRequest('Bilanci nuk mjafton për të gjitha kolonat.');
    let debitedCents = 0;
    for (let i = 0; i < resolved.length; i++) {
      const { lines, stake: columnStake, odds, payout } = priced[i];
      const type = 'SYSTEM';
      const inserted = await client.query(
        `insert into app_ticket (user_id, stake, total_odds, potential_payout, ticket_type, system_type, status)
         values ($1,$2,$3,$4,$5,$6,'PENDING') returning id`,
        [user.id, columnStake, odds, payout, type, `AUTO:${i+1}/${resolved.length}`],
      );
      const id = inserted.rows[0].id;
      ids.push(id);
      // One insert per column avoids up to 480 individual database round trips.
      const params = [];
      const tuples = lines.map((line, index) => {
        const base = index * 10;
        params.push(id,line.matchId,line.marketKey,line.line,line.outcomeKey,line.outcomeName,line.marketName,line.matchName,line.price,JSON.stringify(line.builderLegs ?? null));
        return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},'PENDING',$${base+10}::jsonb)`;
      });
      await client.query(
        `insert into app_ticket_line
         (ticket_id,match_id,market_key,line,outcome_key,outcome_name,market_name,match_name,odds_at_placement,status,builder_legs)
         values ${tuples.join(',')}`, params,
      );
      await persistLiveContracts(client.query.bind(client),id,lines);
      debitedCents += moneyCents(columnStake);
      const after = (moneyCents(balance) - debitedCents) / 100;
      await client.query(
        `insert into app_transaction (user_id,amount,type,reference_id,balance_after,description)
         values ($1,$2,'BET_PLACED',$3,$4,$5)`,
        [user.id,-columnStake,id,after,`Sistem - Kolona ${i+1}/${resolved.length} - ${type}`],
      );
      await chargeCommission(client, {
        managerId: locked.rows[0].manager_id, ticketId: id,
        username: locked.rows[0].username, stake: columnStake, selectionCount: lines.length,
      });
    }
    await client.query('update app_user set balance = $2, updated_at = now() where id = $1', [user.id, (moneyCents(balance)-moneyCents(amount))/100]);
    placedBatch = (await client.query(
      'insert into app_ticket_batch (user_id,client_request_id,request_payload_hash,ticket_ids,selection_order) values ($1,$2,$3,$4,$5) returning *',
      [user.id,requestId,payloadHash,ids,picks.map(pick=>{
        const line=linesById.get(String(pick.outcomeId));return outcomeIdOf(line.matchId,line.marketKey,line.line,line.outcomeKey);
      })],
    )).rows[0];
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return response(placedBatch);
};
}

export const placeColumns = createColumnsPlacer();

/**
 * "Book" a ticket: same validation, but no stake and no account - just a shareable code
 * that anyone can look up (the app's booking-code flow).
 */
export async function bookTicket({ stake, selections = [], ticketType = null, systemType = null }) {
  const amount = moneyCents(stake) / 100;
  if (amount < MIN_STAKE) throw badRequest(`Shuma minimale për të prenotuar një skedinë është ${MIN_STAKE} Lek`);
  if (amount > 50000) throw badRequest('Shuma maksimale për të prenotuar një skedinë është 50,000 Lek.');
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > 20) throw badRequest('Zgjidh 1–20 kuota për kolonë.');

  const type = ticketTypeForSelectionCount(ticketType, selections.length);
  assertDistinctSelectionMarkets(selections);
  const lines = [];
  for (const selection of selections) lines.push(await resolveSelection(selection));
  assertDistinctSelectionMarkets(lines);
  assertDistinctMatches(lines);

  const totalOdds = totalOddsForSelections(lines);
  const payout = systemColumnPayout(amount, lines.map(line => line.price));
  if (payout > 500000) throw badRequest('Ka kaluar limitin e fitimit prej 500,000 Lek.');
  const code = bookingCode();

  const inserted = await query(
    `insert into app_ticket (booking_code, stake, total_odds, potential_payout, ticket_type, system_type, status)
     values ($1, $2, $3, $4, $5, $6, 'PENDING') returning id`,
    [code, amount, totalOdds, payout, type, systemType],
  );
  const ticketId = inserted.rows[0].id;

  for (const line of lines) {
    await query(
      `insert into app_ticket_line
         (ticket_id, match_id, market_key, line, outcome_key, outcome_name, market_name, match_name, odds_at_placement, status, builder_legs)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10::jsonb)`,
      [ticketId, line.matchId, line.marketKey, line.line, line.outcomeKey, line.outcomeName, line.marketName, line.matchName, line.price, JSON.stringify(line.builderLegs ?? null)],
    );
  }

  await persistLiveContracts(query,ticketId,lines);
  return { bookingCode: code, ticket: await getTicketWithLines(ticketId) };
}

/** attaches lines to ticket rows with one extra query (no N+1) */
export async function withLines(rows, {runQuery = query, consolidate = true} = {}) {
  if (!rows.length) return [];
  let completeRows = rows;
  const batches = consolidate ? (await runQuery('select * from app_ticket_batch where ticket_ids && $1::uuid[]', [rows.map(row => row.id)])).rows : [];
  if (batches.length) {
    const missing = [...new Set(batches.flatMap(batch => batch.ticket_ids))].filter(id => !rows.some(row => row.id === id));
    if (missing.length) completeRows = [...rows,...(await runQuery(`select ${TICKET_COLUMNS}, u.username from app_ticket t
      left join app_user u on u.id=t.user_id where t.id=any($1::uuid[])`,[missing])).rows];
  }
  const ids = completeRows.map((r) => r.id);
  const res = await runQuery('select * from app_ticket_line where ticket_id = any($1::uuid[]) order by id', [ids]);
  const byTicket = new Map();
  for (const line of res.rows) {
    if (!byTicket.has(line.ticket_id)) byTicket.set(line.ticket_id, []);
    byTicket.get(line.ticket_id).push(line);
  }
  const byId = new Map(completeRows.map(row => [row.id,toClientTicket(row,byTicket.get(row.id)??[],row.username??null)]));
  const batchByChild = new Map(batches.flatMap(batch => batch.ticket_ids.map(id => [id,batch])));
  const emitted = new Set(), result = [];
  for (const row of rows) {
    const batch = batchByChild.get(row.id);
    if (!batch) result.push(byId.get(row.id));
    else if (!emitted.has(batch.id)) {
      emitted.add(batch.id);
      result.push(aggregateSystemTicket(batch,batch.ticket_ids.map(id => byId.get(id))));
    }
  }
  return result;
}

/** Select one representative per logical ticket; filter its COMPLETE status before LIMIT. */
export async function listLogicalTickets({userId = null, managerId = null, statuses = null, from = null, to = null, limit = 200} = {}, {runQuery = query} = {}) {
  const params = [], conditions = [], batchConditions = [];
  if (userId) {
    params.push(userId); conditions.push(`t.user_id=$${params.length}`); batchConditions.push(`b.user_id=$${params.length}`);
  }
  if (managerId) {
    params.push(managerId);
    conditions.push(`t.user_id in(select id from app_user where manager_id=$${params.length})`);
    batchConditions.push(`b.user_id in(select id from app_user where manager_id=$${params.length})`);
  }
  if (statuses) { params.push(statuses); conditions.push(`coalesce(b.logical_status,t.status)=any($${params.length}::text[])`); }
  if (from) { params.push(from); conditions.push(`coalesce(b.created_at,t.placed_at)>=$${params.length}::timestamptz`); }
  if (to) { params.push(to); conditions.push(`coalesce(b.created_at,t.placed_at)<=$${params.length}::timestamptz`); }
  params.push(Math.min(Math.max(Number(limit)||200,1),500));
  const result = await runQuery(`with batch_state as (
    select b.id,b.user_id,b.ticket_ids,b.created_at,${SYSTEM_STATUS_SQL} as logical_status
    from app_ticket_batch b join app_ticket c on c.id=any(b.ticket_ids) and c.user_id=b.user_id
    ${batchConditions.length?'where '+batchConditions.join(' and '):''}
    group by b.id,b.user_id,b.ticket_ids,b.created_at
  ), representatives as (
    select distinct on(coalesce('SYS-'||b.id::text,t.id::text)) t.id,
      coalesce(b.created_at,t.placed_at) as logical_placed_at,
      coalesce('SYS-'||b.id::text,t.id::text) as logical_id
    from app_ticket t left join batch_state b on t.id=any(b.ticket_ids) and t.user_id=b.user_id
    ${conditions.length?'where '+conditions.join(' and '):''}
    order by coalesce('SYS-'||b.id::text,t.id::text),t.id
  ) select ${TICKET_COLUMNS},u.username from representatives r join app_ticket t on t.id=r.id
    left join app_user u on u.id=t.user_id order by r.logical_placed_at desc,r.logical_id desc limit $${params.length}`,params);
  return withLines(result.rows,{runQuery});
}

/** open tickets (My Bets -> active) */
export async function listActive(userId, options = {}) {
  return listLogicalTickets({userId,statuses:['PENDING'],limit:500},options);
}

/** settled tickets (My Bets -> history): the last 50 */
export async function listHistory(userId, options = {}) {
  return listLogicalTickets({userId,statuses:['WON','LOST','VOID','REVERTED','CANCELLED'],limit:50},options);
}

/** booking code (public) or a ticket id fragment, as the betslip's search box does */
export async function searchTickets(term, {runQuery = query} = {}) {
  const raw = String(term ?? '').trim();
  if (!raw) return null;
  const systemPrefix=/^SYS-?/i.test(raw);
  const compact=raw.replace(/^SYS-?/i,'').replace(/-/g,'').toLowerCase();
  const validCompact=/^[0-9a-f]{7,32}$/.test(compact);
  const findBatch=async()=>{
    if(!validCompact)return null;
    const batches=(await runQuery("select id from app_ticket_batch where replace(id::text,'-','') like $1 order by created_at desc limit 2",[compact+'%'])).rows;
    if(batches.length>1)throw badRequest('Kodi është i paqartë. Përdor ID-në e plotë të biletës.');
    return batches[0]?getTicketWithLines(systemTicketId(batches[0].id),{runQuery}):null;
  };
  if(systemPrefix)return findBatch();
  const res = await runQuery(
    `select ${TICKET_COLUMNS}, u.username
       from app_ticket t left join app_user u on u.id = t.user_id
      where t.booking_code = $1 or t.id::text like $2 or ($3::text is not null and replace(t.id::text,'-','') like $3)
      order by case when t.booking_code=$1 then 0 else 1 end,t.placed_at desc limit 2`,
    [raw.toUpperCase(), `%${raw.toLowerCase()}%`,validCompact?compact+'%':null],
  );
  if(res.rows.length){
    if(res.rows.length>1&&res.rows[0].booking_code!==raw.toUpperCase())throw badRequest('Kodi është i paqartë. Përdor ID-në e plotë të biletës.');
    const [ticket]=await withLines([res.rows[0]],{runQuery});return ticket;
  }
  return findBatch();
}

/** a shared booking code, no login needed */
export async function getBookingTicket(code, {runQuery = query} = {}) {
  const res = await runQuery(`select ${TICKET_COLUMNS} from app_ticket t where t.booking_code = $1`, [
    String(code ?? '').toUpperCase(),
  ]);
  if (!res.rows.length) return null;
  const [ticket] = await withLines(res.rows,{runQuery});
  return ticket;
}

/** Refunds an open ticket and its placement-time manager commission atomically. */
export async function revertTicket(ticketId, managerId = null, { database = pool } = {}) {
  const client = await database.connect();
  try {
    await client.query('begin');
    const publicBatchId = parseSystemTicketId(ticketId);
    if (!publicBatchId && !requestIdPattern.test(String(ticketId))) throw Object.assign(new Error('ticket not found'),{status:404});
    const batch = (await client.query(publicBatchId
      ? 'select * from app_ticket_batch where id=$1::uuid for update'
      : 'select * from app_ticket_batch where ticket_ids @> ARRAY[$1::uuid] for update',[publicBatchId??ticketId])).rows[0];
    if (publicBatchId && !batch) throw Object.assign(new Error('ticket not found'),{status:404});
    const ids = batch ? batch.ticket_ids : [ticketId];
    const found = await client.query(
      `select t.*, u.manager_id, u.username as player_username
         from app_ticket t
         left join app_user u on u.id = t.user_id
        where t.id = any($1::uuid[]) order by t.id
        for update of t`,
      [ids],
    );
    const ticket = found.rows[0];
    if (!ticket) throw Object.assign(new Error('ticket not found'), { status: 404 });
    if (found.rows.length !== ids.length || found.rows.some(row => row.user_id !== ticket.user_id) ||
        (batch && ticket.user_id !== batch.user_id)) throw new Error('System ticket ownership mismatch.');
    if (managerId && found.rows.some(row => row.manager_id !== managerId)) {
      throw Object.assign(new Error('this ticket belongs to another manager'), { status: 403 });
    }
    if (found.rows.some(row => row.status !== 'PENDING')) throw badRequest('only completely pending tickets can be reverted');
    if (!ticket.user_id) throw badRequest('a booked (guest) ticket has no stake to refund');

    const player = await client.query('select balance from app_user where id = $1 for update', [ticket.user_id]);
    if (!player.rows.length) throw Object.assign(new Error('player not found'), { status: 404 });
    // A player may have changed manager since placement. Refund the actors who
    // were actually debited, while authorization above uses current ownership.
    const commissionActors=(await client.query(`select distinct user_id,reference_id from app_transaction
      where reference_id=any($1::uuid[]) and type='MANAGER_COMMISSION_DEBIT' order by user_id,reference_id`,[ids])).rows;
    const actorIds=[...new Set(commissionActors.map(row=>row.user_id))].sort();
    if(actorIds.length)await client.query('select id from app_user where id=any($1::uuid[]) order by id for update',[actorIds]);
    const stakeCents = found.rows.reduce((sum,row) => sum+moneyCents(Number(row.stake)),0);
    const stake = stakeCents/100;
    const balanceAfter = (moneyCents(Number(player.rows[0].balance))+stakeCents)/100;

    await client.query(`update app_ticket set status = 'REVERTED', settled_at = now() where id = any($1::uuid[])`, [ids]);
    await client.query(`update app_ticket_line set status = 'VOID' where ticket_id = any($1::uuid[])`, [ids]);
    await client.query('update app_user set balance = $2, updated_at = now() where id = $1', [ticket.user_id, balanceAfter]);
    let refundedCents = 0;
    for (const column of found.rows) {
      refundedCents += moneyCents(Number(column.stake));
      await client.query(
        `insert into app_transaction (user_id, amount, type, reference_id, balance_after, description)
         values ($1, $2, 'TICKET_REVERT', $3, $4, $5)`,
        [ticket.user_id,Number(column.stake),column.id,(moneyCents(Number(player.rows[0].balance))+refundedCents)/100,
          batch?'Bileta e sistemit u anulua nga paneli':'Bileta u anulua nga paneli'],
      );
      for(const actor of commissionActors.filter(row=>row.reference_id===column.id)){
        await refundManagerCommission(client,{managerId:actor.user_id,ticketId:column.id,username:column.player_username});
      }
    }

    await client.query('commit');
    return { success: true, refunded: stake, ticketId: batch?systemTicketId(batch.id):ticket.id, refundedColumns:ids.length };
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
