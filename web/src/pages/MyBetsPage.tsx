import { useState, useEffect } from 'react';
import Header from '../components/Layout/Header';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../api/client';
import { Ticket } from '../types';
import SystemTicketSummary from '../components/Betslip/SystemTicketSummary';
import { Ticket as TicketIcon } from 'lucide-react';
import { formatTicketSelection, formatMarketSelectionLabel, translateTicketType } from '../utils/sportsbookLabels';
import { formatOdds } from '../utils/formatOdds';

export default function MyBetsPage() {
  const { t } = useLanguage();
  const { user, isAuthenticated, refreshUser } = useAuth();
  const [activeTickets, setActiveTickets] = useState<Ticket[]>([]);
  const [historyTickets, setHistoryTickets] = useState<Ticket[]>([]);
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isAuthenticated) {
      fetchTickets();
    }
  }, [isAuthenticated, activeTab]);

  const fetchTickets = async () => {
    setLoading(true);
    try {
      const [activeRes, historyRes] = await Promise.all([
        apiClient.get('/bets/active'),
        apiClient.get('/bets/history')
      ]);
      setActiveTickets(activeRes.data);
      setHistoryTickets(historyRes.data);
    } catch (e) {
      console.error('Failed to fetch tickets:', e);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('sq-AL', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit' 
    });
  };

  const renderTicket = (ticket: Ticket) => {
    const isPending = ticket.status === 'PENDING';
    const isWon = ticket.status === 'WON';
    const statusClass = isWon 
      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
      : isPending 
      ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40' 
      : 'bg-rose-500/20 text-rose-300 border border-rose-500/40';
    const totalStake = ticket.stake;
    const totalOdds = ticket.totalOdds;

    return (
      <div key={ticket.id} className="overflow-hidden rounded-2xl border border-purple-500/20 bg-gradient-to-b from-[#241239]/90 to-[#140a20]/95 shadow-xl shadow-purple-950/30 backdrop-blur-md">
        <div className="flex justify-between items-start gap-2 bg-[#2d1544] border-b border-[#523769]/50 px-4 py-3 sm:px-5">
          <div className="space-y-0.5">
            <div className="text-xs text-purple-200/70">
              {t('tickets.ticket_id')}: <span className="font-mono text-purple-100 font-bold bg-[#1a0c28] px-2 py-0.5 rounded-md border border-purple-500/20">{ticket.id.slice(0, 8).toUpperCase()}</span>
            </div>
            <div className="text-[11px] text-purple-300/60">{t('tickets.placed_at')}: {formatDate(ticket.placedAt)}</div>
            <div className="text-[11px] text-purple-300/60">{t("Lloji:") + " "}<span className="font-semibold text-purple-200">{translateTicketType(ticket.ticketType, t)}</span></div>
          </div>
          <span className={`font-bold text-[10px] px-2.5 py-1 rounded-full uppercase tracking-wider ${statusClass}`}>
            {t(`tickets.${ticket.status.toLowerCase()}`)}
          </span>
        </div>

        <div className="px-4 py-2 sm:px-5">
          {ticket.lines?.map((line, idx) => (
            <div key={idx} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 border-b border-purple-500/10 py-2.5 text-xs last:border-b-0">
              <div className="flex-1 min-w-0">
                <div className="font-bold text-white break-words text-xs sm:text-sm" title={line.matchName}>{line.matchName}</div>
                <div className="text-purple-200/70 text-[11px] mt-0.5">
                  {formatMarketSelectionLabel(line.marketName, line.marketLine, t)} - <span className="text-purple-100 font-semibold">{formatTicketSelection(line.outcomeName, line.marketName, line.matchName, t, line.outcomeCode)}</span>
                </div>
              </div>
              <div className="sm:text-right shrink-0 flex sm:flex-col justify-between items-baseline sm:items-end">
                <div className="text-amber-300 font-mono font-black text-xs sm:text-sm">@{formatOdds(line.oddsAtPlacement)}</div>
                <div className="text-[10px] text-purple-300/60 font-bold uppercase">{t(`tickets.${line.status.toLowerCase()}`)}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-between items-center border-t border-purple-500/20 bg-[#140a20] px-4 py-3 text-xs sm:px-5">
          <div>
            <span className="text-purple-200/70">{t('tickets.stake')}: </span>
            <span className="font-mono font-bold text-white">{totalStake.toFixed(2)} {" " + t("Lëk")}</span>
          </div>
          <div className="text-right">
            <div>
              <span className="text-purple-200/70">{t('Fitimi i mundshëm')}{ticket.potentialPayoutIsEstimated ? ' · '+t('i rindërtuar') : ''}: </span>
              <span className="font-mono font-black text-amber-300 text-sm">{ticket.potentialPayout.toFixed(2)} {" " + t("Lëk")}</span>
            </div>
            {ticket.potentialPayoutIsEstimated && <div className="text-[11px] text-purple-300/60" title={t('Vlerë e rindërtuar nga shuma dhe koeficienti i ruajtur; shuma origjinale nuk ishte ruajtur.')}>{t('Vlerë e rindërtuar nga shuma dhe koeficienti i ruajtur.')}</div>}
            {ticket.actualPayout != null && (!isPending || ticket.actualPayout > 0) && <div className="text-[11px] text-purple-300/60 font-mono">{t('Fitimi real')}: {ticket.actualPayout.toFixed(2)} {t('Lëk')}</div>}
            {!ticket.system && <div className="text-[11px] text-purple-300/60 font-mono">{t('tickets.total_odds')}: @{formatOdds(totalOdds)}</div>}
          </div>
        </div>

        <SystemTicketSummary ticket={ticket} />
        {ticket.status !== 'PENDING' && ticket.settledAt && (
          <div className="px-4 py-1.5 bg-[#140a20] border-t border-purple-500/10 text-[11px] text-purple-300/50">
            {t('tickets.settled_at')}: {formatDate(ticket.settledAt)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-[100dvh] bg-primary flex flex-col">
      <Header />
      <div className="p-3 sm:p-6 max-w-5xl mx-auto w-full flex-1">
        {!isAuthenticated ? (
          <div className="rounded-2xl border border-purple-500/20 bg-[#241239]/80 p-8 text-center text-purple-300">
            <h2 className="text-xl font-bold text-white mb-2">{t('auth.login_title')}</h2>
            <p>{t('tickets.no_tickets_logged_out')}</p>
          </div>
        ) : (
          <>
            <header className="mb-5 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-purple-500/30 bg-[#25133c] text-amber-300 shadow-md">
                <TicketIcon size={20} />
              </div>
              <div>
                <h1 className="text-lg font-black text-white">{t('nav.myBets')}</h1>
                <p className="text-xs text-purple-300/70">{t("Biletat aktive dhe historiku yt")}</p>
              </div>
            </header>
            <div className="mb-5 flex flex-wrap items-center gap-1.5 p-1 rounded-full border border-purple-500/30 bg-[#1e0f2f]/80 backdrop-blur-xl shadow-lg shadow-purple-950/30 w-fit">
              <button 
                onClick={() => setActiveTab('active')}
                className={`rounded-full px-5 py-2 text-xs font-bold transition-all ${
                  activeTab === 'active' 
                    ? 'bg-gradient-to-r from-[#7F00FF] to-[#a85cff] text-white shadow-md shadow-purple-900/50' 
                    : 'text-purple-200/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                {t('tickets.active_tickets')} {activeTickets.length > 0 && `(${activeTickets.length})`}
              </button>
              <button 
                onClick={() => setActiveTab('history')}
                className={`rounded-full px-5 py-2 text-xs font-bold transition-all ${
                  activeTab === 'history' 
                    ? 'bg-gradient-to-r from-[#7F00FF] to-[#a85cff] text-white shadow-md shadow-purple-900/50' 
                    : 'text-purple-200/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                {t('tickets.ticket_history')} {historyTickets.length > 0 && `(${historyTickets.length})`}
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : activeTab === 'active' ? (
              activeTickets.length === 0 ? (
                <div className="rounded-2xl border border-purple-500/20 bg-[#241239]/80 p-10 text-center text-purple-300 shadow-md space-y-2">
                  <TicketIcon size={28} className="mx-auto text-purple-300/60"/>
                  <div className="font-bold text-white">{t('tickets.no_active_tickets')}</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeTickets.map(renderTicket)}
                </div>
              )
            ) : (
              historyTickets.length === 0 ? (
                <div className="rounded-2xl border border-purple-500/20 bg-[#241239]/80 p-10 text-center text-purple-300 shadow-md space-y-2">
                  <TicketIcon size={28} className="mx-auto text-purple-300/60"/>
                  <div className="font-bold text-white">{t('tickets.no_history_tickets')}</div>
                </div>
              ) : (
                <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                  {historyTickets.map(renderTicket)}
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
