import { useCallback, useEffect, useState } from 'react';
import Header from '../components/Layout/Header';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../api/client';
import type { Ticket } from '../types';
import SystemTicketSummary from '../components/Betslip/SystemTicketSummary';
import { Ticket as TicketIcon, RefreshCw, Clock3, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { formatTicketSelection, formatMarketSelectionLabel, translateTicketType } from '../utils/sportsbookLabels';
import { formatOdds } from '../utils/formatOdds';

const formatMoney=(value:number)=>Number.isFinite(value)?value.toLocaleString('sq-AL',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';

export default function MyBetsPage(){
  const {t}=useLanguage();
  const {isAuthenticated}=useAuth();
  const [activeTickets,setActiveTickets]=useState<Ticket[]>([]);
  const [historyTickets,setHistoryTickets]=useState<Ticket[]>([]);
  const [activeTab,setActiveTab]=useState<'active'|'history'>('active');
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState(false);

  const fetchTickets=useCallback(async(silent=false)=>{
    if(silent)setRefreshing(true);else setLoading(true);
    try{
      const [activeRes,historyRes]=await Promise.all([
        apiClient.get('/bets/active'),apiClient.get('/bets/history')
      ]);
      setActiveTickets(Array.isArray(activeRes.data)?activeRes.data:[]);
      setHistoryTickets(Array.isArray(historyRes.data)?historyRes.data:[]);
      setError(false);
    }catch(e){
      console.error('Failed to fetch tickets:',e);
      setError(true);
    }finally{
      setLoading(false);setRefreshing(false);
    }
  },[]);

  useEffect(()=>{
    if(!isAuthenticated){setLoading(false);return;}
    void fetchTickets();
    const timer=window.setInterval(()=>void fetchTickets(true),30000);
    return()=>window.clearInterval(timer);
  },[isAuthenticated,fetchTickets]);

  const formatDate=(dateStr?:string)=>{
    if(!dateStr)return '—';
    const date=new Date(dateStr);
    return Number.isFinite(date.getTime())?date.toLocaleString('sq-AL',{
      year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'
    }):'—';
  };
  const statusInfo=(status:string)=>{
    switch(status){
      case 'WON':return {label:t('tickets.won'),Icon:CheckCircle2,
        color:'text-emerald-300',border:'border-emerald-700/50'};
      case 'LOST':return {label:t('tickets.lost'),Icon:XCircle,
        color:'text-rose-300',border:'border-rose-800/50'};
      case 'PENDING':return {label:t('tickets.pending'),Icon:Clock3,
        color:'text-amber-200',border:'border-amber-800/40'};
      case 'VOID':return {label:t('tickets.void'),Icon:MinusCircle,
        color:'text-slate-300',border:'border-slate-600'};
      default:return {label:status,Icon:MinusCircle,
        color:'text-slate-300',border:'border-slate-600'};
    }
  };

  const renderTicket=(ticket:Ticket)=>{
    const state=statusInfo(ticket.status),StatusIcon=state.Icon;
    return <article key={ticket.id}
      className="overflow-hidden rounded-lg border border-slate-700/80 bg-[#151e2b] text-slate-100 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-700/70 bg-[#1b2736] px-4 py-3 sm:px-5">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold tracking-wide text-slate-100">{translateTicketType(ticket.ticketType,t)}</span>
            <span className="rounded border border-slate-600/70 bg-[#101824] px-1.5 py-0.5 font-mono text-[11px] text-slate-300"
              title={ticket.id}>{ticket.bookingCode||ticket.id.slice(0,8).toUpperCase()}</span>
          </div>
          <p className="text-[11px] text-slate-400">{t('tickets.placed_at')}: {formatDate(ticket.placedAt)}</p>
        </div>
        <span className={`inline-flex min-h-8 items-center gap-1.5 rounded-md border bg-[#121c29] px-2.5 py-1 text-xs font-semibold ${state.color} ${state.border}`}>
          <StatusIcon size={14} aria-hidden="true"/>{state.label}
        </span>
      </header>

      <div className="divide-y divide-slate-700/50 px-4 sm:px-5">
        {(ticket.lines??[]).map((line,index)=>{
          const lineState=statusInfo(line.status),LineIcon=lineState.Icon;
          return <div key={line.id||index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-3">
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold leading-snug text-slate-100">{line.matchName}</p>
              <p className="mt-1 break-words text-xs leading-relaxed text-slate-400">
                {formatMarketSelectionLabel(line.marketName,line.marketLine,t)}
              </p>
              <p className="mt-0.5 break-words text-xs font-medium text-slate-200">
                {formatTicketSelection(line.outcomeName,line.marketName,line.matchName,t,line.outcomeCode)}
              </p>
            </div>
            <div className="flex flex-col items-end justify-between gap-1.5">
              <span className="font-mono text-sm font-semibold tabular-nums text-slate-100">@{formatOdds(line.oddsAtPlacement)}</span>
              <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${lineState.color}`}>
                <LineIcon size={12}/>{lineState.label}
              </span>
            </div>
          </div>;
        })}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-700 bg-[#111a27] px-4 py-3 sm:grid-cols-3 sm:px-5">
        <div>
          <div className="text-[11px] text-slate-400">{t('tickets.stake')}</div>
          <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{formatMoney(ticket.stake)} <span className="text-xs font-normal text-slate-400">Lek</span></div>
        </div>
        {!ticket.system&&<div>
          <div className="text-[11px] text-slate-400">{t('tickets.total_odds')}</div>
          <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">@{formatOdds(ticket.totalOdds)}</div>
        </div>}
        <div className="col-span-2 sm:col-span-1">
          <div className="text-[11px] text-slate-400">{ticket.status==='PENDING'?t('Fitimi i mundshëm'):t('Fitimi i mundshëm')}</div>
          <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-100">
            {formatMoney(ticket.potentialPayout)} <span className="text-xs font-normal text-slate-400">Lek</span>
          </div>
        </div>
        {ticket.actualPayout!=null&&<div className="col-span-2 border-t border-slate-700/60 pt-2 sm:col-span-3">
          <span className="text-xs text-slate-400">{t('Fitimi real')}: </span>
          <span className="font-mono text-sm font-semibold tabular-nums text-slate-100">
            {formatMoney(ticket.actualPayout)} Lek
          </span>
        </div>}
        {ticket.potentialPayoutIsEstimated&&<p className="col-span-2 text-[11px] text-slate-400 sm:col-span-3">{t('Vlerë e rindërtuar nga shuma dhe koeficienti i ruajtur.')}</p>}
      </div>
      <SystemTicketSummary ticket={ticket}/>
      {ticket.settledAt&&ticket.status!=='PENDING'&&<footer className="border-t border-slate-700/60 px-4 py-2 text-[11px] text-slate-400 sm:px-5">
        {t('tickets.settled_at')}: {formatDate(ticket.settledAt)}
      </footer>}
    </article>;
  };

  const shown=activeTab==='active'?activeTickets:historyTickets;
  return <div className="flex min-h-[100dvh] flex-col bg-[#0d1420] text-slate-100">
    <Header/>
    <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-5 sm:px-6 sm:py-7">
      {!isAuthenticated?<div className="rounded-lg border border-slate-700 bg-[#151e2b] p-7 text-center">
        <h1 className="text-lg font-semibold">{t('auth.login_title')}</h1>
        <p className="mt-2 text-sm text-slate-400">{t('tickets.no_tickets_logged_out')}</p>
      </div>:<>
        <header className="mb-5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-[#192332]">
              <TicketIcon size={19} aria-hidden="true"/>
            </span>
            <div>
              <h1 className="text-lg font-semibold">{t('nav.myBets')}</h1>
              <p className="text-xs text-slate-400">{t('Biletat aktive dhe historiku yt')}</p>
            </div>
          </div>
          <button type="button" disabled={refreshing} onClick={()=>void fetchTickets(true)}
            aria-label="Rifresko biletat"
            className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md border border-slate-600 px-3 text-xs font-medium text-slate-200 hover:border-slate-400 disabled:opacity-50">
            <RefreshCw size={15} className={refreshing?'animate-spin':''}/>
            <span className="hidden sm:inline">Rifresko</span>
          </button>
        </header>
        <div role="tablist" aria-label="Gjendja e biletave"
          className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-slate-700 bg-[#151e2b] p-1">
          {([
            {key:'active',label:t('tickets.active_tickets'),count:activeTickets.length},
            {key:'history',label:t('tickets.ticket_history'),count:historyTickets.length},
          ] as const).map(tab=><button key={tab.key} type="button" role="tab"
            aria-selected={activeTab===tab.key} onClick={()=>setActiveTab(tab.key)}
            className={`min-h-10 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${activeTab===tab.key?'bg-slate-200 text-slate-950':'text-slate-300 hover:bg-slate-700/60'}`}>
            {tab.label} <span className="ml-1 font-mono tabular-nums opacity-75">({tab.count})</span>
          </button>)}
        </div>
        {error&&<div role="alert" className="mb-4 rounded-md border border-amber-800/60 bg-amber-950/20 px-4 py-3 text-xs text-amber-200">
          Nuk u rifreskuan biletat. Të dhënat e fundit të ngarkuara mbeten të shfaqura.
        </div>}
        {loading?<div role="status" className="py-14 text-center text-sm text-slate-400">{t('common.loading')}</div>:
          shown.length===0?<div className="rounded-lg border border-slate-700 bg-[#151e2b] px-5 py-12 text-center">
            <TicketIcon size={25} className="mx-auto text-slate-500"/>
            <p className="mt-3 text-sm text-slate-300">
              {activeTab==='active'?t('tickets.no_active_tickets'):t('tickets.no_history_tickets')}
            </p>
          </div>:<section className="space-y-3" aria-label={activeTab==='active'?'Biletat aktive':'Historiku i biletave'}>
            {shown.map(renderTicket)}
          </section>}
      </>}
    </main>
  </div>;
}
