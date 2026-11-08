import {formatBuilderSelection} from '../../utils/sportsbookLabels';
import { useState, useRef,useEffect } from 'react';
import { useBetslip } from '../../context/BetslipContext';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { Trash2, AlertTriangle, Search, Ticket as TicketIcon, X, TrendingUp, TrendingDown, Check } from 'lucide-react';
import BookingModal from './BookingModal';
import TicketReceipt from './TicketReceipt';
import { apiClient } from '../../api/client';
import { Ticket } from '../../types';
import { formatTicketSelection, formatMarketSelectionLabel } from '../../utils/sportsbookLabels';
import { stakeToCents } from '../../utils/betslipColumns';
import { useLiveFeed } from '../../api/liveFeed';
import { isComboMarket } from '../../utils/comboPolicy';
import { formatOdds } from '../../utils/formatOdds';
import SystemTicketSummary from './SystemTicketSummary';
import { filterDecidedOutcomes } from '../../utils/marketExpiry';
import { isImpossibleLiveCombination } from '../../../../server/ledger/combo-feasibility.mjs';
import {quoteExpired} from '../../../../server/ledger/quote-validity.mjs';
import {useQuoteExpiry} from '../../hooks/useQuoteExpiry';
import {selectionQuoteDeadline,earliestQuoteDeadline} from '../../utils/quoteValidity';
import './betslip.css';
import {totalFromColumnStake} from '../../utils/zshopStake';

export default function Betslip() {
  const { 
    selections, columns, columnsOverflow, columnStakes, columnPreviews, stake, setStake, ticketType,
    removeSelection, clearAll, updateOdds, totalOdds, potentialPayout, placeBet, bookTicket, isPlacingBet 
  } = useBetslip();
  const { t,lang } = useLanguage();
  const tr=(sq:string,en:string)=>lang==='en'?en:sq;
  const { user, refreshUser } = useAuth();
  const { combosEnabled, lockedOutcomes, lockedMarkets, lockedMatches, riskLockedOutcomes, livePatches, invalidateSelections,oddsDeltas,feedMode } = useLiveFeed();
  useQuoteExpiry(earliestQuoteDeadline(selections.map(s=>selectionQuoteDeadline(s,oddsDeltas))));
  const unavailableSelections = selections.filter(s=> {
    const match={...s.matchSnapshot,...livePatches[s.matchId]};
    const outcome={name:s.outcomeName,code:s.outcomeCode};
    const market={id:s.marketId,name:s.marketName,marketType:s.marketType,line:s.marketLine,period:s.period,comboLegs:s.comboLegs,outcomes:[outcome]};
    const locked=lockedOutcomes[s.outcomeId]||riskLockedOutcomes[s.outcomeId]||lockedMarkets[s.marketId]||lockedMatches[s.matchId]||
      s.builderLegs?.some(leg=>lockedOutcomes[leg.outcomeId]||riskLockedOutcomes[leg.outcomeId]||lockedMarkets[leg.marketId]);
    return feedMode!=='live'||quoteExpired(selectionQuoteDeadline(s,oddsDeltas))||locked||isImpossibleLiveCombination(match,market)||filterDecidedOutcomes([outcome],market,match).length===0;
  });
  const hasUnavailable = unavailableSelections.length>0;
  const blockedCombos = !combosEnabled && selections.some(s => s.outcomeId.startsWith('BB|') || isComboMarket(s.marketName));
  const invalidQuote = columnPreviews.some(column => column.invalid);
  
  const [oddsChangedError, setOddsChangedError] = useState(false);
  const [oddsChangeModal, setOddsChangeModal] = useState<{
    outcomeId: string;
    oldOdds: number;
    newOdds: number;
    outcomeName: string;
    outcomeCode?: string;
    marketName: string;
    marketLine?: string;
    matchName: string;
  } | null>(null);
  const [bookingCode, setBookingCode] = useState('');
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [placedTicket, setPlacedTicket] = useState<Ticket | null>(null);
  const [stakeError, setStakeError] = useState('');
  const placeBetClickLock = useRef(false);
  const hasMultipleColumns = ticketType === 'SYSTEM';
  const [columnDraft,setColumnDraft]=useState<string|null>(null);
  useEffect(()=>setColumnDraft(null),[columns.length]);
  const invalidColumnInput=hasMultipleColumns&&columnDraft!==null&&totalFromColumnStake(columnDraft,columns.length)===null;
  const matchGroups=[...selections.reduce((groups,selection)=>{const items=groups.get(selection.matchId)??[];items.push(selection);groups.set(selection.matchId,items);return groups;},new Map<string,typeof selections>())];
  const setTotal=(value:string)=>{setColumnDraft(null);setStake(value);};
  const setColumn=(value:string)=>{setColumnDraft(value);const total=totalFromColumnStake(value,columns.length);if(total!==null)setStake(total);};
  const perColumnMinimum = Math.min(...columnStakes) / 100;
  const perColumnMaximum = Math.max(...columnStakes) / 100;

  const MAX_STAKE_CENTS = 5000000;
  const MAX_PAYOUT_LEK = 500000;
  const currentMaxPayout = hasMultipleColumns && !columnsOverflow
    ? (columnPreviews.length ? Math.max(...columnPreviews.map(c => c.payout)) : 0)
    : potentialPayout;
  const isOverPayoutLimit = currentMaxPayout > MAX_PAYOUT_LEK;

  // Ticket search state
  const [ticketSearch, setTicketSearch] = useState('');
  const [searchedTicket, setSearchedTicket] = useState<any>(null);
  const [ticketSearchError, setTicketSearchError] = useState('');
  const [ticketSearchLoading, setTicketSearchLoading] = useState(false);
  const [showTicketSearch, setShowTicketSearch] = useState(false);

  const handlePlaceBet = async () => {
    if (placeBetClickLock.current || invalidColumnInput) return;
    const stakeCents = stakeToCents(stake);
    if (stakeCents == null || stakeCents < 10000) {
      setStakeError(stakeCents == null ? 'Vendos një shumë me maksimumi 2 shifra pas presjes.' : 'Shuma minimale totale është 100 Lek.');
      return;
    }
    if (stakeCents > MAX_STAKE_CENTS) {
      setStakeError('Shuma maksimale e lejuar është 50,000 Lek.');
      return;
    }
    if (isOverPayoutLimit) {
      setStakeError('Ka kaluar limitin e fitimit (Maksimumi 500,000 Lek).');
      return;
    }
    setStakeError('');
    placeBetClickLock.current = true;
    try {
      const ticket = await placeBet(() => refreshUser());
      setPlacedTicket(ticket);
      clearAll();
    } catch (e: any) {
      const errData = e.response?.data;
      if (errData?.code === 'ODDS_CHANGED' || errData?.message?.includes('ndryshuar') || errData?.message === 'Odds have changed') {
        const foundSel = errData?.outcomeId ? selections.find(s => s.outcomeId === errData.outcomeId) : selections[0];
        setOddsChangeModal({
          outcomeId: errData?.outcomeId || foundSel?.outcomeId || '',
          oldOdds: Number(errData?.oldOdds) || foundSel?.odds || 1.0,
          newOdds: Number(errData?.newOdds) || foundSel?.odds || 1.0,
          outcomeName: errData?.outcomeName || foundSel?.outcomeName || '',
          outcomeCode: foundSel?.outcomeCode,
          marketName: errData?.marketName || foundSel?.marketName || '',
          marketLine: foundSel?.marketLine,
          matchName: errData?.matchName || foundSel?.matchName || '',
        });
      } else if (errData?.code === 'LIVE_RISK_SUSPENDED' ||
                 ['MARKET_DECIDED','SELECTION_UNAVAILABLE','QUOTE_STALE','FEED_REFRESHING','MARKET_EVIDENCE_UNSUPPORTED'].includes(errData?.code) ||
                 /pezulluar|përfunduar|nuk është më e disponueshme/i.test(String(errData?.message ?? ''))) {
        invalidateSelections([errData?.outcomeId,errData?.sourceOutcomeId].filter(Boolean));
      } else {
        alert(errData?.message || e.message || t('common.error'));
      }
    } finally {
      placeBetClickLock.current = false;
    }
  };

  const handleAcceptOddsChange = () => {
    if (oddsChangeModal && oddsChangeModal.outcomeId) {
      updateOdds(oddsChangeModal.outcomeId, oddsChangeModal.newOdds);
    }
    setOddsChangeModal(null);
  };

  const handleBook = async () => {
    const stakeCents = stakeToCents(stake);
    if (stakeCents != null && stakeCents > MAX_STAKE_CENTS) {
      alert('Shuma maksimale e lejuar është 50,000 Lek.');
      return;
    }
    if (isOverPayoutLimit) {
      alert('Ka kaluar limitin e fitimit (Maksimumi 500,000 Lek).');
      return;
    }
    try {
      const res = await bookTicket();
      setBookingCode(res.bookingCode);
      setShowBookingModal(true);
      clearAll();
    } catch (e: any) {
      const detail = e.response?.data;
      if (['LIVE_RISK_SUSPENDED','MARKET_DECIDED','SELECTION_UNAVAILABLE','QUOTE_STALE','FEED_REFRESHING','MARKET_EVIDENCE_UNSUPPORTED'].includes(detail?.code) ||
          /pezulluar|përfunduar/i.test(String(detail?.message ?? ''))) {
        invalidateSelections([detail?.outcomeId,detail?.sourceOutcomeId].filter(Boolean));
      } else {
        alert(detail?.message || e.message || t('common.error'));
      }
    }
  };

  const handleSearchTicket = async () => {
    const query = ticketSearch.trim();
    if (!query) {
      setTicketSearchError(t('betslip.enter_ticket_code'));
      return;
    }
    setTicketSearchError('');
    setTicketSearchLoading(true);
    setSearchedTicket(null);
    try {
      const res = await apiClient.get('/tickets/search', { params: { q: query } });
      setSearchedTicket(res.data);
    } catch (e: any) {
      setTicketSearchError(e.response?.data?.error || t('betslip.ticket_not_found'));
    } finally {
      setTicketSearchLoading(false);
    }
  };

  const clearTicketSearch = () => {
    setTicketSearch('');
    setSearchedTicket(null);
    setTicketSearchError('');
  };

  const renderSearchedTicket = () => {
    if (!searchedTicket) return null;
    const ticket = searchedTicket;
    const statusClass = ticket.status === 'WON' ? 'text-accent-green' : ticket.status === 'LOST' ? 'text-accent-red' : 'text-accent-yellow';

    return (
      <div className="bg-primary rounded-lg border border-tertiary p-3 space-y-2">
        <div className="flex justify-between items-start">
          <div>
            <div className="text-xs text-text-secondary">{t('tickets.ticket_id')}: <span className="font-mono text-white">{ticket.id.slice(0, 8).toUpperCase()}</span></div>
            {ticket.bookingCode && (
              <div className="text-xs text-accent-blue font-mono font-bold mt-0.5">{t('admin.code')}: {ticket.bookingCode}</div>
            )}
            {ticket.user?.username && (
              <div className="text-xs text-text-secondary mt-0.5">{t('admin.user')}: {ticket.user.username}</div>
            )}
          </div>
          <span className={`font-semibold text-xs ${statusClass}`}>{t(`tickets.${ticket.status.toLowerCase()}`)}</span>
        </div>

        <div className="space-y-1.5 border-t border-tertiary pt-2">
          {ticket.lines?.map((line: any, idx: number) => (
            <div key={idx} className="flex justify-between items-center text-xs">
              <div className="min-w-0">
                <div className="font-semibold text-white truncate">{line.matchName}</div>
                <div className="text-text-secondary">
                  {formatMarketSelectionLabel(line.marketName, line.marketLine ?? line.line, t)} - {formatTicketSelection(line.outcomeName, line.marketName, line.matchName, t, line.outcomeCode, line.marketLine ?? line.line)}
                </div>
              </div>
              <div className="text-right shrink-0 ml-2">
                <span className="text-accent-green font-bold">@{formatOdds(line.oddsAtPlacement)}</span>
                <div className="text-[10px] text-text-secondary">{t(`tickets.${line.status.toLowerCase()}`)}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-between items-center border-t border-tertiary pt-2 text-xs">
          <div>
            <span className="text-text-secondary">{t('tickets.stake')}: </span>
            <span className="font-bold text-white">{ticket.stake?.toFixed(2)} {" " + t("Lëk")}</span>
          </div>
          <div className="text-right">
            <span className="text-text-secondary">{t('tickets.payout')}: </span>
            <span className="font-bold text-accent-yellow">{(ticket.system && ticket.status !== 'PENDING' ? ticket.actualPayout ?? 0 : ticket.potentialPayout)?.toFixed(2)} {" " + t("Lëk")}</span>
          </div>
        </div>
        <SystemTicketSummary ticket={ticket} />
      </div>
    );
  };

  return (
    <>
    <div className="betslip zshop-betslip flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-secondary text-white">
      {/* Compact slip heading and ticket type. */}
      <div className="betslip-heading shrink-0 border-b border-tertiary bg-[#424e60]">
        <div className="betslip-heading-row flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-bold tracking-wide">
            <TicketIcon size={15} className="text-accent-yellow"/>
            <span>{t('betslip.betslip')}</span>
            <span className="bg-[#17212c] px-1.5 py-0.5 font-mono text-[11px] text-accent-yellow" aria-label={`${selections.length} përzgjedhje`}>{selections.length}</span>
          </div>
          <button type="button" onClick={() => setShowTicketSearch(value => !value)}
            aria-expanded={showTicketSearch} className="flex items-center gap-1.5 text-[11px] text-slate-200 hover:text-white">
            <Search size={13}/>
            {t('betslip.search_ticket')}
          </button>
        </div>
        <div className="betslip-config"><div className="flex items-center gap-2"><select disabled value={ticketType} aria-label={t('Lloji i skedinës')}>{(['SINGLE','COMBO','SYSTEM'] as const).map(type=><option key={type} value={type}>{t('betslip.'+type.toLowerCase())}</option>)}</select>{hasMultipleColumns&&<span className="text-[11px] text-amber-300">{columnsOverflow?'24+':columns.length} {tr('kolona','columns')}</span>}</div>{selections.length>0&&<button type="button" onClick={clearAll} className="flex items-center gap-1 text-[11px] text-[#94a7c9]"><Trash2 size={12}/>{t('Fshij Të Gjitha')}</button>}</div>
      </div>

      <div className="betslip-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#1b2530]" data-betslip-scroll>
      {showTicketSearch && (
        <div className="shrink-0 space-y-2 border-b border-tertiary bg-[#1d2835] p-3">
          <div className="flex gap-1">
            <label className="relative min-w-0 flex-1">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary"/>
              <input type="text" value={ticketSearch}
                onChange={e => setTicketSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearchTicket()}
                placeholder={t('betslip.enter_ticket_code')}
                aria-label={t('betslip.enter_ticket_code')}
                className="w-full border border-tertiary bg-primary px-2 py-2 pl-8 text-xs text-white placeholder:text-text-muted focus:outline-none focus:border-accent-yellow"/>
            </label>
            <button type="button" onClick={handleSearchTicket} disabled={ticketSearchLoading}
              className="bg-accent-yellow px-3 text-xs font-bold text-[#17212c] hover:brightness-110 disabled:opacity-50">
              {ticketSearchLoading ? '...' : t('betslip.search')}
            </button>
            {(ticketSearch || searchedTicket) && (
              <button type="button" onClick={clearTicketSearch} aria-label={t('common.cancel')}
                className="px-1.5 text-text-secondary hover:text-white"><X size={15}/></button>
            )}
          </div>
          {ticketSearchError && <div className="text-xs font-semibold text-rose-300">{ticketSearchError}</div>}
          {searchedTicket && <div className="max-h-[200px] overflow-y-auto">{renderSearchedTicket()}</div>}
        </div>
      )}

      {selections.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
          <TicketIcon size={25} strokeWidth={1.5} className="text-text-muted"/>
          <p className="text-xs font-semibold text-slate-200">{t('betslip.no_selections')}</p>
          <p className="max-w-[230px] text-[11px] leading-relaxed text-text-secondary">{t('betslip.select_odds_help')}</p>
        </div>
      ) : (
        <>
          <div data-zshop-slip-matches>{matchGroups.map(([matchId,items])=><article key={matchId} className="betslip-match" data-slip-match={matchId}><div className="betslip-match-title">{items[0].matchName}</div>{items.map(selection=><div className="betslip-match-bet" key={selection.outcomeId} data-slip-selection={selection.outcomeId}><span>{selection.matchSnapshot?.status==='LIVE'&&<small className="mr-1">(L)</small>}{formatMarketSelectionLabel(selection.marketName,selection.marketLine,t)} - <b>{((selection.outcomeId.startsWith('BB|')?formatBuilderSelection(selection.comboLegs,t):null)??formatTicketSelection(selection.outcomeName,selection.marketName,selection.matchName,t,selection.outcomeCode,selection.marketLine))}</b></span><div>{unavailableSelections.some(row=>row.outcomeId===selection.outcomeId)?<span className="text-rose-300">{t('Pezulluar')}</span>:<strong>{formatOdds(selection.odds)}×</strong>}<button type="button" onClick={()=>removeSelection(selection.outcomeId)} aria-label={t('betslip.remove_selection')}><X size={14}/></button></div></div>)}</article>)}</div>

          {hasMultipleColumns && (
            <details className="border-t border-accent-yellow/30 bg-[#1d2835] px-3 py-2 text-xs" data-betslip-columns>
              <summary className="cursor-pointer font-bold text-accent-yellow">{t("Sistem ·") + " "}{columnsOverflow ? 'Mbi 24' : columns.length} {" " + t("kolona automatike")}</summary>
              <p className="mt-1 text-text-secondary">{t("Një zgjedhje për ndeshje në çdo kolonë. Shuma totale ndahet mes kolonave.")}</p>
              <div className="mt-2 space-y-1">
                {columns.map((col, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 border-b border-tertiary/50 py-1">
                    <span className="min-w-0 break-words text-slate-200">#{i+1} {col.map(s => `${s.matchName}: ${formatMarketSelectionLabel(s.marketName, s.marketLine, t)} · ${formatTicketSelection(s.outcomeName, s.marketName, s.matchName, t, s.outcomeCode, s.marketLine)}`).join(' + ')}</span>
                    <span className="shrink-0 text-right font-mono text-accent-yellow">
                      <strong>{columnPreviews[i].invalid ? '—' : formatOdds(columnPreviews[i].odds)}</strong>
                      <span className="block text-[10px] text-slate-300">{columnPreviews[i].stake.toFixed(2)} {" " + t("Lek →") + " "}{columnPreviews[i].invalid ? '—' : columnPreviews[i].payout.toFixed(2)} {" " + t("Lek")}</span>
                    </span>
                  </div>
                ))}
              </div>
              {columnsOverflow && <p role="alert" className="text-rose-300">{t("Maksimumi 24 kolona. Hiq disa zgjedhje.")}</p>}
            </details>
          )}

          {oddsChangedError && (
            <div className="shrink-0 flex items-center justify-between gap-2 border-t border-accent-yellow/30 bg-accent-yellow/10 px-3 py-2 text-xs text-amber-200">
              <span className="flex items-center gap-1.5"><AlertTriangle size={15}/>{t('betslip.odds_changed')}</span>
              <button type="button" onClick={() => setOddsChangedError(false)} className="font-bold underline">{t('betslip.accept_changes')}</button>
            </div>
          )}

          <p className="zs-slip-help px-1 py-2 text-[10px] text-text-secondary">{hasMultipleColumns?tr('Një zgjedhje për ndeshje në çdo kolonë. Shuma totale ndahet mes kolonave.','One selection per match in each column. The total stake is divided between columns.'):tr('Kuotat verifikohen kur vendoset bileta.','Odds are verified when the ticket is placed.')}</p>
        </>
      )}
      </div>

      {selections.length > 0 && (
          <div className="betslip-footer shrink-0 border-t border-tertiary bg-[#252d3a]" data-betslip-footer>
            <div className="betslip-footer-fields space-y-1">
              <div className="zs-currency flex justify-between text-[11px] text-slate-300"><span>{tr('Valuta','Currency')}</span><strong>{tr('Lek','ALL')}</strong></div>
              {!hasMultipleColumns&&<div className="zs-return-row"><span>{t('betslip.total_odds')}</span><strong>{formatOdds(totalOdds)}</strong></div>}
              <div className="zs-stake-row"><label htmlFor="betslip-stake">{tr('Shuma totale','Total stake')}</label><div className="zs-stake-control"><input id="betslip-stake" type="number" inputMode="decimal" min="100" step="0.01" value={stake} onChange={e=>setTotal(e.target.value)}/></div></div>
              {hasMultipleColumns&&!columnsOverflow&&<div className="zs-stake-row"><label htmlFor="betslip-column-stake">{tr('Shuma për kolonë','Stake per column')}</label><div className="zs-stake-control"><span>{columns.length} ×</span><input id="betslip-column-stake" type="number" inputMode="decimal" min="0.01" step="0.01" value={columnDraft??perColumnMinimum.toFixed(2)} onChange={e=>setColumn(e.target.value)} onBlur={()=>{if(!invalidColumnInput)setColumnDraft(null);}} aria-invalid={invalidColumnInput}/></div></div>}
              {hasMultipleColumns&&perColumnMinimum!==perColumnMaximum&&<p className="text-[10px] text-text-secondary" data-stake-rounding>{perColumnMinimum.toFixed(2)}–{perColumnMaximum.toFixed(2)} {tr('Lek për kolonë; diferenca 0.01 ndahet te kolonat e para.','ALL per column; the 0.01 remainder goes to the first columns.')}</p>}
              <div className="betslip-notices max-h-12 overflow-y-auto text-[11px]">{stakeError&&<p role="alert" className="text-rose-300">{t(stakeError)}</p>}{isOverPayoutLimit&&<p role="alert" className="text-rose-300 font-bold">{t('Ka kaluar limitin e fitimit (Maksimumi 500,000 Lek).')}</p>}{invalidColumnInput&&<p role="alert" className="text-rose-300">{tr('Vendos shumën për kolonë me maksimumi 2 shifra pas presjes.','Enter a column stake with at most 2 decimal places.')}</p>}{blockedCombos&&<p role="alert" className="text-rose-300">{t('Combot janë çaktivizuar. Hiqi nga bileta për të vazhduar.')}</p>}{invalidQuote&&<p role="alert" className="text-rose-300">{t('Një koeficient ose kthim është i pavlefshëm. Rifresko kuotat ose hiqe zgjedhjen.')}</p>}</div>
              <div className="betslip-quick-stakes grid grid-cols-4 gap-1">{[100,500,1000,5000].map(amount=><button type="button" key={amount} onClick={()=>setTotal(String(amount))}>{amount.toLocaleString(lang==='en'?'en-GB':'sq-AL')}</button>)}</div>
              {hasMultipleColumns&&!columnsOverflow?<div data-zshop-column-returns><div className="zs-return-row"><span>{tr('Kthimi minimal për kolonë fituese','Min. return per winning column')}</span><strong>{invalidQuote?'—':Math.min(...columnPreviews.map(c=>c.payout)).toFixed(2)}</strong></div><div className="zs-return-row"><span>{tr('Kthimi maksimal për kolonë fituese','Max. return per winning column')}</span><strong>{invalidQuote?'—':Math.max(...columnPreviews.map(c=>c.payout)).toFixed(2)}</strong></div></div>:<div className="zs-return-row"><span>{t('betslip.potential_payout')}</span><strong>{invalidQuote?'—':potentialPayout.toFixed(2)} {tr('Lek','ALL')}</strong></div>}
            </div>
            <div className="betslip-actions grid gap-px bg-[#0b1018] p-px">
              {user ? (
                <button type="button" data-betslip-place onClick={handlePlaceBet} disabled={isPlacingBet || columnsOverflow || blockedCombos || invalidQuote || hasUnavailable || invalidColumnInput || isOverPayoutLimit}
                  aria-busy={isPlacingBet}
                  className="bg-accent-yellow py-3 text-sm font-bold text-[#17212c] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:cursor-wait disabled:opacity-60">
                  {isPlacingBet ? 'Duke vendosur bastin...' : t('betslip.place_bet')}
                </button>
              ) : (
                <button disabled className="bg-tertiary/60 py-3 text-sm font-semibold text-text-muted">{t("Identifikohu për të vendosur bast")}</button>
              )}
              <button type="button" onClick={handleBook} disabled={hasMultipleColumns || isPlacingBet || blockedCombos || invalidQuote || hasUnavailable || isOverPayoutLimit}
                title={hasMultipleColumns ? 'Prenotimi për shumë kolona nuk është aktiv' : undefined}
                className="betslip-book bg-[#424e60] py-2 text-xs font-semibold text-white hover:bg-[#465870]">
                {t('betslip.book_ticket')}
              </button>
            </div>
          </div>
      )}
    </div>

      {showBookingModal && <BookingModal code={bookingCode} onClose={() => setShowBookingModal(false)} />}
      {placedTicket && <TicketReceipt ticket={placedTicket} onClose={() => setPlacedTicket(null)} />}

      {/* Modal kur koeficienti ka ndryshuar */}
      {oddsChangeModal && (
        <div role="dialog" aria-modal="true" aria-labelledby="betslip-odds-change-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-secondary border border-tertiary rounded-sm w-full max-w-md overflow-hidden shadow-2xl space-y-0">
            {/* Header */}
            <div className="bg-[#424e60] border-b border-white/10 p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent-yellow/20 border border-accent-yellow/40 flex items-center justify-center shrink-0">
                <AlertTriangle size={22} className="text-accent-yellow" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 id="betslip-odds-change-title" className="text-sm sm:text-base font-black text-white">{t("Koeficienti ka Ndryshuar!")}</h3>
                <p className="text-xs text-text-secondary truncate">
                  {t("Koeficienti ka lëvizur gjatë vendosjes së bastit.")}</p>
              </div>
              <button 
                onClick={() => setOddsChangeModal(null)} 
                className="text-text-secondary hover:text-white p-1 rounded-lg hover:bg-white/5 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content Table */}
            <div className="p-4 space-y-4">
              <div className="bg-primary/90 rounded-xl border border-tertiary overflow-hidden shadow-inner">
                <div className="p-3 border-b border-tertiary/60 bg-tertiary/20">
                  <div className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">{t("Ndeshja")}</div>
                  <div className="text-xs sm:text-sm font-black text-white truncate">{oddsChangeModal.matchName || 'Ndeshje'}</div>
                </div>

                <div className="p-3 border-b border-tertiary/60 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] text-text-secondary font-bold uppercase">{t("Tregu & Zgjedhja")}</div>
                    <div className="text-xs font-bold text-accent-yellow truncate">
                      {formatMarketSelectionLabel(oddsChangeModal.marketName, oddsChangeModal.marketLine, t)} — {formatTicketSelection(oddsChangeModal.outcomeName, oddsChangeModal.marketName, oddsChangeModal.matchName, t, oddsChangeModal.outcomeCode, oddsChangeModal.marketLine)}
                    </div>
                  </div>
                  {oddsChangeModal.newOdds >= oddsChangeModal.oldOdds ? (
                    <span className="shrink-0 text-[11px] font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <TrendingUp size={12} /> {" " + t("Rritje")}</span>
                  ) : (
                    <span className="shrink-0 text-[11px] font-bold text-rose-400 bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <TrendingDown size={12} /> {" " + t("Rënie")}</span>
                  )}
                </div>

                {/* Odds comparison row */}
                <div className="grid grid-cols-2 divide-x divide-tertiary/60 p-3 bg-primary/40 text-center">
                  <div>
                    <div className="text-[10px] font-bold uppercase text-text-secondary">{t("Koeficienti i vjetër")}</div>
                    <div className="text-base font-mono font-bold text-rose-400 line-through mt-0.5">
                      @{formatOdds(oddsChangeModal.oldOdds)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase text-text-secondary">{t("Koeficienti i ri")}</div>
                    <div className="text-base font-mono font-black text-accent-green mt-0.5">
                      @{formatOdds(oddsChangeModal.newOdds)}
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-xs text-text-secondary text-center leading-relaxed">
                {t("Shtypni butonin") + " "}<span className="text-white font-bold">OK</span> {" " + t("për të rifreskuar automatikisht koeficientin e ri në biletën tuaj dhe për të rillogaritur fitimin e mundshëm.")}</p>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOddsChangeModal(null)}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-tertiary/60 hover:bg-tertiary text-text-secondary hover:text-white font-bold text-xs transition"
                >
                  {t("Anulo")}</button>
                <button
                  type="button"
                  onClick={handleAcceptOddsChange}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-accent-yellow text-[#17212c] font-bold text-xs hover:brightness-105 active:scale-[0.99] transition flex items-center justify-center gap-1.5"
                >
                  <Check size={16} /> {" " + t("OK — Përditëso Biletën")}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
