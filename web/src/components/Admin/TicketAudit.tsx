import { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import { ChevronDown, ChevronUp, Ticket as TicketIcon, CheckCircle2, XCircle, Clock, RotateCcw, Search, X, Copy, Check, RefreshCw } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { formatMarketSelectionLabel, formatTicketSelection, translateTicketStatus, translateTicketType } from '../../utils/sportsbookLabels';
import { formatOdds } from '../../utils/formatOdds';
import SystemTicketSummary from '../Betslip/SystemTicketSummary';

type PendingFixture = {
  matchId: string;
  matchName: string;
  pendingLines: number;
  pendingTickets: number;
  oldestTicketAt: string;
  ageHours: number | null;
  kickoff: string | null;
  finalScore: string | null;
  reason: 'MISSING_MARKET_STATS' | 'RESULT_STORED' | 'FINAL_FRAME_NOT_ARCHIVED' |
    'NO_FINAL_FEED_SIGNAL' | 'FINAL_RESULT_MISSING';
  marketNames: string[];
  feedStatus: string | null;
  feedScoreAt: string | null;
};

const reasonText: Record<PendingFixture['reason'], string> = {
  MISSING_MARKET_STATS: 'Rezultati final ekziston; mungojnë statistika të tregut (HT, korne, kartona ose early payout)',
  RESULT_STORED: 'Rezultati final ekziston; kërkohet rillogaritje',
  FINAL_FRAME_NOT_ARCHIVED: 'U pa sinjal final, por rezultati nuk është arkivuar',
  NO_FINAL_FEED_SIGNAL: 'Në pritje të sinjalit përfundimtar nga furnizuesi',
  FINAL_RESULT_MISSING: 'Ndeshja nuk ka rezultat final të verifikuar; duhet verifikim manual',
};

export default function TicketAudit() {
  const { t: translate } = useLanguage();
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'WON' | 'LOST' | 'REVERTED'>('ALL');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [pendingFixtures, setPendingFixtures] = useState<PendingFixture[]>([]);
  const [pendingError, setPendingError] = useState('');
  const [settlementMessage, setSettlementMessage] = useState('');

  const fetchTickets = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/admin/tickets');
      setTickets(res.data);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingFixtures = async () => {
    try {
      setPendingError('');
      const response = await apiClient.get('/admin/settlement/pending', { params: { limit: 100 } });
      setPendingFixtures(response.data.pending ?? []);
    } catch (e: any) {
      setPendingError(e.response?.data?.message || 'Nuk u ngarkuan ndeshjet në pritje.');
    }
  };

  const handleTriggerSettlement = async () => {
    try {
      setSettling(true);
      const response = await apiClient.post('/admin/settlement');
      await Promise.all([fetchTickets(), fetchPendingFixtures()]);
      const result = response.data?.lastPass ?? {};
      setSettlementMessage(result.closed > 0
        ? result.closed + ' bileta u mbyllën me rezultate të verifikuara.'
        : 'Nuk u mbyll asnjë biletë. Disa ndeshje ende nuk kanë rezultat final të verifikuar.');
    } catch (e: any) {
      try {
        const response = await apiClient.get('/admin/settlement');
        await Promise.all([fetchTickets(), fetchPendingFixtures()]);
        const result = response.data?.lastPass ?? {};
        setSettlementMessage(result.closed > 0
          ? result.closed + ' bileta u mbyllën me rezultate të verifikuara.'
          : 'Nuk u mbyll asnjë biletë. Kontrollo ndeshjet në pritje më poshtë.');
      } catch (err: any) {
        alert(err.response?.data?.error || err.message || 'Dështoi llogaritja e skedinave');
      }
    } finally {
      setSettling(false);
    }
  };

  const handleRevertTicket = async (ticketId: string) => {
    if (!confirm(translate('tickets.confirm_revert'))) return;
    try {
      const res = await apiClient.post(`/admin/tickets/${ticketId}/revert`);
      alert(translate('tickets.ticket_reverted').replace('{amount}', res.data.refunded.toFixed(2)));
      void Promise.all([fetchTickets(), fetchPendingFixtures()]);
    } catch (e: any) {
      alert(e.response?.data?.error || translate('tickets.revert_failed'));
    }
  };

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  useEffect(() => {
    void fetchTickets();
    void fetchPendingFixtures();
  }, []);

  const filteredTickets = tickets.filter(t => {
    if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchId = t.id?.toLowerCase() || '';
      const matchCode = t.bookingCode?.toLowerCase() || '';
      const matchUser = t.user?.username?.toLowerCase() || '';
      return matchId.includes(q) || matchCode.includes(q) || matchUser.includes(q);
    }
    return true;
  });

  const pendingCount = tickets.filter(t => t.status === 'PENDING').length;
  const wonCount = tickets.filter(t => t.status === 'WON').length;
  const lostCount = tickets.filter(t => t.status === 'LOST').length;
  const revertedCount = tickets.filter(t => t.status === 'REVERTED').length;

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white">{translate('tickets.audit_title')}</h2>
          <p className="text-text-secondary text-xs sm:text-sm">{translate('tickets.audit_description')}</p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button 
            onClick={handleTriggerSettlement}
            disabled={settling}
            className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-emerald-900/30 transition active:scale-95 disabled:opacity-50"
            title={translate("Përfundo ndeshjet e mbyllura dhe llogarit skedinat menjëherë")}
          >
            <CheckCircle2 size={16} className={settling ? 'animate-spin' : ''} />
            <span>{settling ? 'Duke llogaritur...' : 'Llogarit Skedinat Tani'}</span>
          </button>
          <button 
            onClick={() => { void fetchTickets(); void fetchPendingFixtures(); }}
            className="flex items-center gap-2 px-3.5 py-2 bg-tertiary/80 hover:bg-tertiary text-white rounded-xl text-xs sm:text-sm font-bold transition active:scale-95"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin text-accent-green' : ''} />
            <span>{translate('tickets.refresh_tickets')}</span>
          </button>
        </div>
      </div>

      {settlementMessage && (
        <p role="status" className="border border-tertiary bg-secondary px-3 py-2 text-xs text-amber-200">
          {settlementMessage}
        </p>
      )}
      {/* Administrative diagnostics, keyed by the REAL upstream match ID,
          not by potentially repeated team names or the public ticket prefix. */}
      <section aria-label={translate("Kontrolli i ndeshjeve në pritje")} className="border border-tertiary bg-secondary p-3 sm:p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-white">{translate("Ndeshje me bileta në pritje")}</h3>
          <span className="text-[11px] text-slate-300">{pendingFixtures.length} {" " + translate("ndeshje")}</span>
        </div>
        <p className="text-[11px] text-text-secondary">
          {translate("Ndeshjet mbyllen vetëm me rezultat përfundimtar të konfirmuar. Në mungesë të rezultatit, pas 72 orësh zbatohet kontrolli i rimbursimit sipas rregullave ekzistuese.")}</p>
        {pendingError && <p role="alert" className="text-xs text-rose-300">{pendingError}</p>}
        {!pendingError && pendingFixtures.length === 0 && (
          <p className="text-xs text-slate-300">{translate("Nuk ka ndeshje të palogaritshme në listën e kontrollit.")}</p>
        )}
        <div className="max-h-64 overflow-auto divide-y divide-tertiary/70">
          {pendingFixtures.map(item => (
            <div key={item.matchId} className="flex flex-wrap items-start justify-between gap-2 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-white">{item.matchName}</div>
                <div className="text-[10px] text-slate-400">
                  Match ID: {item.matchId} · {item.pendingTickets} {" " + translate("bileta /") + " "}{item.pendingLines} {" " + translate("zgjedhje")}{item.ageHours !== null ? ' · Më e vjetra ' + item.ageHours + ' orë' : ''}
                </div>
                <div className="mt-1 text-[11px] text-amber-200">{reasonText[item.reason]}</div>
                {item.marketNames?.length > 0 && (
                  <div className="mt-0.5 text-[10px] text-slate-400">{item.marketNames.join(', ')}</div>
                )}
              </div>
              {item.finalScore && (
                <span className="shrink-0 font-bold tabular-nums text-emerald-300">
                  FT {item.finalScore}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Search & Status Filters */}
      <div className="bg-secondary p-3 sm:p-4 rounded-2xl border border-tertiary space-y-3 shadow-md">
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={translate("Kërko me numër skedine, kod rezervimi ose përdorues...")}
            className="w-full bg-primary border border-tertiary rounded-xl pl-9 pr-9 py-2.5 text-xs sm:text-sm text-white placeholder-text-secondary focus:outline-none focus:border-accent-green"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-white"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden pt-1">
          {[
            { id: 'ALL', label: 'Të Gjitha', count: tickets.length },
            { id: 'PENDING', label: translate("Në Pritje"), count: pendingCount },
            { id: 'WON', label: translate("Fituar"), count: wonCount },
            { id: 'LOST', label: translate("Humbur"), count: lostCount },
            { id: 'REVERTED', label: translate("Anuluar"), count: revertedCount },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition active:scale-95 ${
                statusFilter === tab.id
                  ? 'bg-accent-green text-primary font-black shadow-sm'
                  : 'bg-primary/80 text-text-secondary hover:text-white hover:bg-tertiary/60'
              }`}
            >
              {tab.label} <span className="opacity-75 text-[11px]">({tab.count})</span>
            </button>
          ))}
          <span className="ml-auto text-[11px] text-text-secondary font-medium whitespace-nowrap pl-2">
            {translate("Shfaqur") + " "}{filteredTickets.length}
          </span>
        </div>
      </div>

      {/* Ticket List */}
      <div className="bg-secondary rounded-2xl border border-tertiary shadow-xl overflow-hidden">
        {loading ? (
          <div className="p-16 text-center text-text-secondary flex flex-col items-center justify-center gap-3">
            <RefreshCw size={26} className="animate-spin text-accent-green" />
            <span className="text-sm font-semibold">{translate('tickets.loading_records')}</span>
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="p-12 text-center text-text-secondary flex flex-col items-center gap-2">
            <TicketIcon size={32} className="opacity-30 text-white" />
            <div className="text-sm font-bold text-white">{translate("Nuk u gjet asnjë skedinë")}</div>
            <p className="text-xs">{translate("Ndryshoni filtrin ose fjalën e kërkimit për të gjetur skedina të tjera.")}</p>
          </div>
        ) : (
          <div className="divide-y divide-tertiary/70">
            {filteredTickets.map(t => {
              const isExpanded = expandedTicketId === t.id;
              return (
                <div key={t.id} className="p-3.5 sm:p-4 hover:bg-primary/30 transition">
                  {/* Top Ticket Row */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
                    <div className="flex items-start sm:items-center gap-3">
                      <div className={`p-2 sm:p-2.5 rounded-xl flex items-center justify-center shrink-0 mt-0.5 sm:mt-0 ${
                        t.status === 'WON' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                        t.status === 'LOST' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                        t.status === 'REVERTED' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}>
                        {t.status === 'WON' && <CheckCircle2 size={20} />}
                        {t.status === 'LOST' && <XCircle size={20} />}
                        {t.status === 'REVERTED' && <RotateCcw size={20} />}
                        {t.status === 'PENDING' && <Clock size={20} />}
                      </div>

                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-white text-sm sm:text-base">
                            {translate("Skedina #")}{t.id.substring(0, 8)}
                          </span>
                          {t.bookingCode && (
                            <button
                              onClick={() => copyToClipboard(t.bookingCode)}
                              className="text-[11px] bg-accent-blue/15 hover:bg-accent-blue/25 text-accent-blue font-mono px-2 py-0.5 rounded-lg font-bold flex items-center gap-1 border border-accent-blue/20 transition active:scale-95"
                              title={translate("Kopjo kodin e rezervimit")}
                            >
                              <span>{translate("Kodi:") + " "}{t.bookingCode}</span>
                              {copiedCode === t.bookingCode ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                            </button>
                          )}
                          <span className={`text-[10px] sm:text-xs px-2 py-0.5 rounded-full font-black uppercase ${
                            t.status === 'WON' ? 'bg-emerald-500/20 text-emerald-400' :
                            t.status === 'LOST' ? 'bg-rose-500/20 text-rose-400' :
                            t.status === 'REVERTED' ? 'bg-purple-500/20 text-purple-400' : 'bg-amber-500/20 text-amber-400'
                          }`}>
                            {translateTicketStatus(t.status, translate)}
                          </span>
                        </div>

                        <div className="text-[11px] sm:text-xs text-text-secondary flex items-center gap-2 flex-wrap">
                          <span>{translate('admin.user')}: <strong className="text-white">{t.user?.username || translate('tickets.guest_booked')}</strong></span>
                          <span>&bull;</span>
                          <span>{translate('tickets.type')}: <strong className="text-accent-yellow uppercase">{translateTicketType(t.ticketType, translate)}</strong></span>
                          <span>&bull;</span>
                          <span>{new Date(t.placedAt).toLocaleString('sq-AL', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                    </div>

                    {/* Financial Numbers & Actions */}
                    <div className="flex items-center justify-between md:justify-end gap-3 sm:gap-4 pt-2 md:pt-0 border-t md:border-t-0 border-tertiary/40">
                      <div className="text-left md:text-right">
                        <div className="text-[10px] sm:text-xs text-text-secondary uppercase">{translate('tickets.stake_payout')}</div>
                        <div className="text-xs sm:text-sm font-bold text-white tabular-nums">
                          {t.stake.toFixed(2)} {" " + translate("Lëk →") + " "}<span className="text-accent-green font-black text-sm sm:text-base">{(t.system && t.status !== 'PENDING' ? t.actualPayout ?? 0 : t.potentialPayout).toFixed(2)} {" " + translate("Lëk")}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {t.status === 'PENDING' && (
                          <button
                            onClick={() => handleRevertTicket(t.id)}
                            className="px-3 py-1.5 sm:py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded-xl text-xs font-bold flex items-center gap-1.5 transition active:scale-95 border border-purple-500/30"
                            title={translate('tickets.revert_ticket')}
                          >
                            <RotateCcw size={13} /> <span>{translate('manager.revert')}</span>
                          </button>
                        )}
                        <button
                          onClick={() => setExpandedTicketId(isExpanded ? null : t.id)}
                          className="px-2.5 py-1.5 sm:p-2 bg-tertiary hover:bg-tertiary/80 text-text-secondary hover:text-white rounded-xl text-xs font-bold flex items-center gap-1 transition active:scale-95"
                          title={translate('tickets.view_selections')}
                        >
                          <span className="sm:hidden text-xs">{translate("Zgjedhjet")}</span>
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* EXPANDED LINES */}
                  {isExpanded && (
                    <div className="mt-3.5 pt-3.5 border-t border-tertiary/60 space-y-2.5">
                      <SystemTicketSummary ticket={t} />
                      <div className="text-xs font-bold uppercase text-text-secondary tracking-wider">
                        {translate('tickets.selections')} ({t.lines?.length || 0})
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {t.lines?.map((line: any) => (
                          <div key={line.id} className="bg-primary/80 p-3 rounded-xl border border-tertiary flex justify-between items-center text-xs gap-2">
                            <div className="space-y-0.5 min-w-0">
                              <div className="text-text-secondary text-[11px] truncate">{line.matchName}</div>
                              <div className="font-semibold text-white">
                                {formatMarketSelectionLabel(line.marketName, line.marketLine, translate)}: <span className="text-accent-green font-black">{formatTicketSelection(line.outcomeName, line.marketName, line.matchName, translate)}</span>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="font-black text-white px-2 py-0.5 bg-secondary rounded-lg border border-tertiary tabular-nums">
                                {formatOdds(line.oddsAtPlacement ?? line.odds)}
                              </span>
                              <div className="mt-1 font-bold text-[10px] uppercase">
                                <span className={
                                  line.status === 'WON' ? 'text-emerald-400' :
                                  line.status === 'LOST' ? 'text-rose-400' : 'text-amber-400'
                                }>
                                  {translateTicketStatus(line.status, translate)}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
