import {formatBuilderSelection} from '../../utils/sportsbookLabels';
import {useOutcomeSelection} from '../../context/selectionFeed';
import { Match, Market, Outcome } from '../../types';
import {useOutcomeFeed} from '../../api/outcomeFeed';
import { memo,useEffect, useState, useRef } from 'react';
import { Lock } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { formatOddsButtonLabel, isResultBttsMarket, parseResultBttsOutcome } from '../../utils/sportsbookLabels';
import { marketSelectionLabel } from '../../utils/marketCatalog';
import { isMarketExpired, isCompletedCombinationOutcome, isMarketOfferSupported } from '../../utils/marketExpiry';
import { isComboMarket } from '../../utils/comboPolicy';
import { multipliedComboPrice } from '../../../../server/ledger/combo-price.mjs';
import { formatOdds } from '../../utils/formatOdds';
import { timestamp } from '../../api/matchSync';
import { comboOutcomeLegs } from '../../../../server/ledger/combo-feasibility.mjs';
import {useQuoteExpiry} from '../../hooks/useQuoteExpiry';
import {latestQuoteDeadline,earliestQuoteDeadline} from '../../utils/quoteValidity';
import { repairDisplayText } from '../../utils/repairDisplayText';

interface Props { match: Match; market: Market; outcome: Outcome; isWide?: boolean; showRawLabel?: boolean; }

function OddsButton({ match, market, outcome, isWide, showRawLabel = false }: Props) {
  const {isSelected,addSelection,removeSelection}=useOutcomeSelection(outcome.id);
  const { oddsDeltas, lockedOutcomes, riskLockedOutcomes, lockedMarkets, lockedMatches, combosEnabled,feedMode } = useOutcomeFeed(String(match.id),market.id,outcome.id,market.builderLegs);
  const { t, lang } = useLanguage();
  const [flashClass, setFlashClass] = useState('');

  const delta=oddsDeltas[outcome.id];
  const nativePrice=delta&&(delta.at??0)>=timestamp(outcome.quotedAt)?delta.newOdds:outcome.odds;
  const quotedAt=timestamp(market.builderQuotedAt);
  const comboParts=market.builderLegs??[];
  const currentOdds=outcome.id.startsWith('BB|')?(comboParts.length===2&&comboParts.every(part=>Number.isFinite(part.odds))?multipliedComboPrice(comboParts.map(part=>({price:(oddsDeltas[part.outcomeId]?.at??0)>=quotedAt?oddsDeltas[part.outcomeId]?.newOdds??Number(part.odds):Number(part.odds)})))??0:outcome.odds):nativePrice;
  const previousPrice=useRef({id:outcome.id,price:currentOdds});
  const snapshotAt=timestamp(outcome.quotedAt??market.builderQuotedAt);
  const legs=market.builderLegs?.map(part=>{
    const until=latestQuoteDeadline(part.outcomeId,part,timestamp(market.builderQuotedAt),oddsDeltas);
    return until===undefined?part:{...part,priceValidUntil:until,quoteSnapshotAt:Math.max(timestamp(market.builderQuotedAt),oddsDeltas[part.outcomeId]?.at??0)};
  });
  const priceValidUntil=legs?.length?earliestQuoteDeadline(legs.map(part=>part.priceValidUntil)):latestQuoteDeadline(outcome.id,outcome,snapshotAt,oddsDeltas);
  const quoteStale=useQuoteExpiry(priceValidUntil);
  const unidentifiedMixedOutcome = !outcome.id.startsWith('BB|') && isResultBttsMarket(market.name) &&
    !parseResultBttsOutcome(outcome.code, match.homeTeam, match.awayTeam) &&
    !parseResultBttsOutcome(outcome.name, match.homeTeam, match.awayTeam);
  // Once the server clears a risk lock, a stale REST status must not keep the
  // choice disabled. Provider/admin locks always remain authoritative.
  const providerSuspended = lockedOutcomes[outcome.id] ?? outcome.feedSuspended ??
    (outcome.status === 'SUSPENDED' && outcome.riskSuspended !== true);
  const autoSuspended = riskLockedOutcomes[outcome.id] ?? outcome.riskSuspended === true;
  const builderLegLocked = (market.builderLegs ?? []).some(part =>
    lockedMarkets[part.marketId] === true ||
    lockedOutcomes[part.outcomeId] === true ||
    riskLockedOutcomes[part.outcomeId] === true);
  const isSuspended =
    quoteStale || feedMode!=='live' ||
    !isMarketOfferSupported(market,match) ||
    outcome.decided === true ||
    (!combosEnabled && isComboMarket(market)) ||
    isMarketExpired(match, market) || isCompletedCombinationOutcome(match, market, outcome) ||
    builderLegLocked ||
    unidentifiedMixedOutcome ||
    providerSuspended ||
    autoSuspended ||
    (lockedMarkets[market.id] ?? market.status === 'SUSPENDED') ||
    (lockedMatches[String(match.id)] ?? match.isSuspended) ||
    currentOdds === null || currentOdds === undefined || !Number.isFinite(currentOdds) || currentOdds <= 1 ||
    (outcome.id.startsWith('BB|') && currentOdds > 1000);

  const label = repairDisplayText((outcome.id.startsWith('BB|')?formatBuilderSelection(market.comboLegs,t):null) ?? (showRawLabel
    ? marketSelectionLabel(String(outcome.name || outcome.code || 'Zgjedhje'), lang, market.name, `${match.homeTeam} vs ${match.awayTeam}`, outcome.code, market.line || market.specifier)
    : formatOddsButtonLabel(outcome.name, market.name, market.line || market.specifier, t, `${match.homeTeam} vs ${match.awayTeam}`, outcome.code)));
  const scoringTimeLabel = !showRawLabel && /\btime\s+of\s+scoring\b|\bgoal\s+(?:before|after|in|during|until|by|within|between)\b|\b(?:to\s+score|scores?|scoring)\s+(?:before|after|in|during|until|by|within|between)\b/i.test(market.name);

  // Compare the displayed price, including synthetic leg products. Unrelated
  // socket messages and equal-price refreshes cannot restart or erase the flash.
  useEffect(()=>{
    const previous=previousPrice.current;
    previousPrice.current={id:outcome.id,price:currentOdds};
    if(previous.id!==outcome.id||!Number.isFinite(previous.price)||!Number.isFinite(currentOdds)){setFlashClass('');return;}
    if(previous.price===currentOdds)return;
    setFlashClass(currentOdds>previous.price?'animate-flash-green':'animate-flash-red');
    const timer=setTimeout(()=>setFlashClass(''),3000);
    return()=>clearTimeout(timer);
  },[outcome.id,currentOdds]);

  const toggle = () => {
    if (isSuspended) return;
    if (isSelected) {
      removeSelection(outcome.id);
    } else {
      addSelection({
        outcomeId: outcome.id,
        matchId: match.id,
        marketId: market.id,
        outcomeName: outcome.name,
        outcomeCode: outcome.code,
        marketName: market.name,
        marketType: market.marketType,
        marketLine: market.line || market.specifier,
        matchName: `${match.homeTeam} vs ${match.awayTeam}`,
        odds: currentOdds,
        builderLegs: legs,
        priceValidUntil,
        quoteSnapshotAt:Math.max(snapshotAt,oddsDeltas[outcome.id]?.at??0),
        comboLegs: comboOutcomeLegs(match,{...market,outcomeName:outcome.name,outcomeCode:outcome.code})??undefined,
        period: market.period,
        matchSnapshot: {status:match.status,homeTeam:match.homeTeam,awayTeam:match.awayTeam,homeScore:match.homeScore,awayScore:match.awayScore,scoreAt:match.scoreAt,period:match.period,currentMinute:match.currentMinute},
      });
    }
  };

  return (
    <button
      data-outcome-id={outcome.id}
      data-market-id={market.id}
      data-odds-direction={isSuspended?undefined:flashClass==='animate-flash-green'?'up':flashClass==='animate-flash-red'?'down':undefined}
      onClick={toggle}
      type="button"
      aria-pressed={isSelected}
      disabled={isSuspended}
      className={`group relative flex items-center ${scoringTimeLabel ? 'flex-col justify-center gap-1 py-2.5 text-center' : 'justify-between gap-2'} rounded-sm border-0 px-2 py-2 text-left transition-colors duration-150 select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-green focus-visible:outline-offset-[-2px] ${flashClass} ${
        isSuspended
          ? '!bg-[#29313d] cursor-not-allowed !text-slate-400 opacity-85'
          : isSelected
          ? '!bg-[#347d48] hover:!bg-[#3b9354] text-white ring-2 ring-inset ring-[#f2c04f] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]'
          : 'bg-primary/40 text-text-primary hover:bg-tertiary/60 active:bg-tertiary/80'
      }`}
    >
      <span
        className={`text-[11px] font-semibold transition-colors sm:text-xs leading-snug ${
          scoringTimeLabel ? 'break-words whitespace-normal line-clamp-3' : isWide || label.length > 10 ? 'break-words line-clamp-2' : 'truncate'
        } ${
          isSuspended ? 'text-slate-400' : isSelected ? 'text-white font-extrabold' : 'text-text-secondary group-hover:text-slate-200'
        }`}
        title={label}
      >
        {label}
      </span>
      <span data-odds-value className={`shrink-0 font-mono text-xs font-black tabular-nums sm:text-sm ${
        isSuspended ? 'text-slate-400' : isSelected ? 'text-white' : 'text-accent-yellow group-hover:text-accent-yellow sm:text-text-primary'
      }`}>
        {isSuspended ? <Lock size={14} strokeWidth={2.3} className="inline text-slate-400" aria-label={t("Koeficient i pezulluar")} /> : formatOdds(currentOdds)}
      </span>
    </button>
  );
}

export default memo(OddsButton,(a,b)=>a.market===b.market&&a.outcome===b.outcome&&a.isWide===b.isWide&&a.showRawLabel===b.showRawLabel&&['id','status','homeTeam','awayTeam','homeScore','awayScore','scoreAt','period','currentMinute','isSuspended','corners','cards','shots','shotsOnTarget','fouls'].every(key=>(a.match as any)[key]===(b.match as any)[key]));
