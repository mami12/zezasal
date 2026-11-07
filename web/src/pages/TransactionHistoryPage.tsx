import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { Ticket } from '../types';
import SystemTicketSummary from '../components/Betslip/SystemTicketSummary';
import { formatMarketSelectionLabel, formatTicketSelection } from '../utils/sportsbookLabels';
import { useLanguage } from '../context/LanguageContext';
import Header from '../components/Layout/Header';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { toDateRange } from '../utils/dateFilters';
import { formatOdds } from '../utils/formatOdds';
import {transactionLabel,transactionDescription} from '../utils/accountLabels';
import {userError} from '../utils/userError';
import { Coins, Ticket as TicketIcon, ArrowUpDown, Trophy } from 'lucide-react';

interface Transaction {
  id: string;
  username: string;
  userRole: string;
  amount: number;
  type: string;
  balanceAfter: number;
  description: string | null;
  createdAt: string;
}

interface TransactionSummary {
  winnings: number;
  losses: number;
  net: number;
}

type BetFilter = 'ALL' | 'WON' | 'LOST' | 'PENDING' | 'CANCELLED' | 'REJECTED';
type TransactionCategory = 'ALL' | 'SPORT' | 'CASINO' | 'TRANSFERS';
type RejectedAttempt = {
  kind: 'REJECTED';
  id: string;
  status: 'REJECTED';
  placedAt: string;
  stake: number | null;
  selectionCount: number;
  reason: string;
};
type BetActivity = (Ticket & { kind: 'TICKET' }) | RejectedAttempt;

const BET_FILTER_LABELS: Record<BetFilter, string> = {
  ALL: 'Të gjitha',
  WON: 'Fituese',
  LOST: 'Humbëse',
  PENDING: 'Në pritje',
  CANCELLED: 'Të anulluara',
  REJECTED: 'Të refuzuara',
};
const BET_STATUS_LABELS: Record<string, string> = {
  WON: 'Fitues', LOST: 'Humbës', PENDING: 'Në pritje',
  CANCELLED: 'Anulluar', REVERTED: 'Anulluar', VOID: 'Rimbursuar',
  REJECTED: 'Refuzuar',
};
const betStatusClass = (status: string) =>
  status === 'WON' ? 'text-emerald-300' :
  status === 'PENDING' ? 'text-amber-300' :
  ['CANCELLED', 'REVERTED', 'VOID'].includes(status) ? 'text-slate-300' :
  'text-rose-300';

export default function TransactionHistoryPage({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const locale = lang === 'en' ? 'en-GB' : 'sq-AL';
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<TransactionSummary | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [betFilter, setBetFilter] = useState<BetFilter>('ALL');
  const [betEntries, setBetEntries] = useState<BetActivity[]>([]);
  const [betRange, setBetRange] = useState<ReturnType<typeof toDateRange>>({ from: undefined, to: undefined });
  const [betRefresh, setBetRefresh] = useState(0);
  const [betLoading, setBetLoading] = useState(false);
  const [betError, setBetError] = useState('');
  const [txCategory, setTxCategory] = useState<TransactionCategory>('ALL');

  const isCasinoTx = (tx: Transaction) => {
    if (tx.type.startsWith('CASINO_')) return true;
    const text = (tx.type + ' ' + (tx.description ?? '')).toLowerCase();
    return /\b(casino|kazino|spin|rrotullim|slot|firejoker|bookofra|sizzling|clover|pyramid|fruits|teller|vikings)\b/.test(text);
  };

  const isSportTx = (tx: Transaction) => {
    if (['BET_PLACED', 'BET_WON', 'BET_REFUND', 'TICKET_REVERT', 'MANAGER_PAYOUT_DEDUCTION', 'MANAGER_LOST_COLLECTED'].includes(tx.type)) return true;
    const text = (tx.type + ' ' + (tx.description ?? '')).toLowerCase();
    return /\b(ticket|bilet|bet|bast|match|ndeshj)\b/.test(text) && !isCasinoTx(tx);
  };

  const isTransferTx = (tx: Transaction) => {
    return ['DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT', 'MANAGER_PLAYER_FUNDING', 'MANAGER_PLAYER_RETURN', 'AGENT_MANAGER_FUNDING', 'AGENT_MANAGER_RETURN', 'PLAYER_DELETE_TRANSFER_OUT', 'PLAYER_DELETE_TRANSFER_IN'].includes(tx.type);
  };

  const displayedTransactions = useMemo(() => {
    return transactions.filter(tx => {
      if (txCategory === 'SPORT') return isSportTx(tx);
      if (txCategory === 'CASINO') return isCasinoTx(tx);
      if (txCategory === 'TRANSFERS') return isTransferTx(tx);
      return true;
    });
  }, [transactions, txCategory]);

  const sportCount = useMemo(() => transactions.filter(isSportTx).length, [transactions]);
  const casinoCount = useMemo(() => transactions.filter(isCasinoTx).length, [transactions]);
  const transferCount = useMemo(() => transactions.filter(isTransferTx).length, [transactions]);

  const fetchTransactions = async (event?: FormEvent) => {
    event?.preventDefault();
    setLoading(true);
    setError('');
    setBetRange(toDateRange(from, to));
    const endpoint = user?.role === 'ADMIN'
      ? '/admin/transactions'
      : user?.role === 'MANAGER'
        ? '/manager/transactions'
        : '/me/transactions';
    try {
      const params = { ...toDateRange(from, to), limit: 500 };
      const [response, summaryResponse] = await Promise.all([
        apiClient.get(endpoint, { params }),
        user?.role === 'PLAYER'
          ? apiClient.get('/me/transactions/summary', { params })
          : Promise.resolve(null),
      ]);
      setTransactions(response.data);
      setSummary(summaryResponse?.data ?? null);
    } catch (requestError: any) {
      console.error(requestError);
      setError(requestError.response?.data?.message || 'Nuk u ngarkua historiku i transaksioneve.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTransactions();
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== 'PLAYER') return;
    let active = true;
    setBetLoading(true);
    setBetError('');
    void apiClient.get('/me/bets', {
      params: { status: betFilter, ...betRange, limit: 500 },
    }).then(response => {
      if (active) setBetEntries(response.data);
    }).catch((e: any) => {
      if (active) setBetError(e.response?.data?.message || 'Nuk u ngarkuan bastet.');
    }).finally(() => {
      if (active) setBetLoading(false);
    });
    return () => { active = false; };
  }, [user?.role, user?.id, betFilter, betRange, betRefresh]);

  return (
    <div className="min-h-[100dvh] bg-primary text-white">
      {!embedded && <Header />}
      <main className={`mx-auto w-full max-w-7xl space-y-3 p-3 sm:p-5 ${embedded ? '' : 'flex-1'}`}>
        <header>
          <h1 className="text-lg sm:text-xl font-bold">{t("Historiku i transaksioneve")}</h1>
          <p className="mt-1 text-xs text-text-secondary">
            {t(user?.role === 'ADMIN' ? 'Të gjitha lëvizjet financiare në platformë.'
              : user?.role === 'MANAGER' ? 'Transaksionet e portofolit tënd dhe të lojtarëve të tu.'
                : 'Depozitat, bastet dhe pagesat e llogarisë tënde.')}
          </p>
        </header>
        <form onSubmit={fetchTransactions} className="flex flex-col gap-3 rounded-2xl border border-purple-500/20 bg-[#241239]/80 p-3.5 backdrop-blur-md shadow-lg sm:flex-row sm:items-end">
          <label className="flex-1 text-xs font-semibold text-purple-200/80">{t("Nga data")}<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-[#62417d] bg-[#1a0c28] px-3.5 py-2 text-sm text-white outline-none focus:border-purple-400" />
          </label>
          <label className="flex-1 text-xs font-semibold text-purple-200/80">{t("Deri më")}<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-[#62417d] bg-[#1a0c28] px-3.5 py-2 text-sm text-white outline-none focus:border-purple-400" />
          </label>
          <button type="submit" className="rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-6 py-2.5 text-sm font-extrabold text-black shadow-lg shadow-amber-950/40 hover:brightness-110 active:scale-95 transition-all">{t("Filtro")}</button>
        </form>

        {/* Filter Pills: All / Sport / Kazino / Depozita & Tërheqje */}
        <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-full border border-purple-500/30 bg-[#1e0f2f]/80 backdrop-blur-xl shadow-lg shadow-purple-950/30 w-fit max-w-full">
          <button
            type="button"
            onClick={() => setTxCategory('ALL')}
            className={`rounded-full px-4 py-2 text-xs font-bold transition-all ${
              txCategory === 'ALL'
                ? 'bg-gradient-to-r from-[#7F00FF] to-[#a85cff] text-white shadow-md shadow-purple-900/50'
                : 'text-purple-200/80 hover:text-white hover:bg-white/10'
            }`}
          >
            {t("Të gjitha")} ({transactions.length})
          </button>
          <button
            type="button"
            onClick={() => setTxCategory('SPORT')}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-all ${
              txCategory === 'SPORT'
                ? 'bg-gradient-to-r from-[#7F00FF] to-[#a85cff] text-white shadow-md shadow-purple-900/50'
                : 'text-purple-200/80 hover:text-white hover:bg-white/10'
            }`}
          >
            <TicketIcon size={14} className="text-amber-300" />
            <span>{t("Sport (Baste)")}</span>
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-black">{sportCount}</span>
          </button>
          <button
            type="button"
            onClick={() => setTxCategory('CASINO')}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-all ${
              txCategory === 'CASINO'
                ? 'bg-gradient-to-r from-[#7F00FF] to-[#a85cff] text-white shadow-md shadow-purple-900/50'
                : 'text-purple-200/80 hover:text-white hover:bg-white/10'
            }`}
          >
            <Coins size={14} className="text-amber-300" />
            <span>{t("Kazino")}</span>
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-black">{casinoCount}</span>
          </button>
          {transferCount > 0 && (
            <button
              type="button"
              onClick={() => setTxCategory('TRANSFERS')}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-all ${
                txCategory === 'TRANSFERS'
                  ? 'bg-gradient-to-r from-[#7F00FF] to-[#a85cff] text-white shadow-md shadow-purple-900/50'
                  : 'text-purple-200/80 hover:text-white hover:bg-white/10'
              }`}
            >
              <ArrowUpDown size={14} className="text-emerald-300" />
              <span>{t("Depozita & Tërheqje")}</span>
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-black">{transferCount}</span>
            </button>
          )}
        </div>

        {user?.role === 'PLAYER' && summary && txCategory !== 'CASINO' && (
          <section aria-label={t("Përmbledhja e fitimeve dhe humbjeve")} className="grid gap-2 sm:grid-cols-3">
            {[
              { label: 'Fitimet', value: summary.winnings, color: 'text-amber-200' },
              { label: 'Humbjet', value: summary.losses, color: 'text-rose-300' },
              { label: 'Bilanci neto', value: summary.net, color: summary.net >= 0 ? 'text-amber-200' : 'text-rose-300' },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-tertiary bg-secondary p-3">
                <div className="text-xs font-semibold text-text-secondary">{t(item.label)}</div>
                <div className={`mt-1 font-mono text-xl font-black ${item.color}`}>
                  {item.value.toFixed(2)} {" " + t("Lëk")}</div>
              </div>
            ))}
          </section>
        )}
        {user?.role === 'PLAYER' && txCategory !== 'CASINO' && (
          <section aria-label={t("Bastet e mia sipas statusit")} className="rounded-2xl overflow-hidden border border-tertiary bg-secondary">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-tertiary bg-[#2b1742] p-3">
              <div>
                <h2 className="text-sm font-bold text-white">{t("Bastet e mia")}</h2>
                <p className="mt-1 text-[11px] text-text-secondary">
                  {t("Shiko kuponët sipas statusit dhe datës së vendosjes.")}</p>
              </div>
              <div className="flex items-end gap-2">
                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-200">
                  {t("Statusi")}<select value={betFilter} onChange={e => setBetFilter(e.target.value as BetFilter)}
                    aria-label={t("Filtro bastet sipas statusit")}
                    className="min-w-[155px] rounded-lg border border-[#62417d] bg-[#190d28] px-2 py-2 text-xs text-white focus:outline-none focus:border-accent-yellow">
                    {(Object.keys(BET_FILTER_LABELS) as BetFilter[]).map(status => (
                      <option key={status} value={status}>{t(BET_FILTER_LABELS[status])}</option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => setBetRefresh(n => n + 1)}
                  className="rounded-lg border border-tertiary bg-[#3f215e] px-3 py-2 text-xs font-semibold text-white hover:bg-[#522d7a]">
                  {t("Rifresko")}</button>
              </div>
            </div>
            {betFilter === 'REJECTED' && (
              <p className="border-b border-tertiary/60 px-3 py-2 text-[11px] text-text-secondary">
                {t("Këtu shfaqen kërkesat e refuzuara nga serveri pas aktivizimit të këtij regjistrimi. Ato nuk janë bileta të pranuara dhe nuk kanë zbritur para nga llogaria.")}</p>
            )}
            {betLoading ? <div className="p-8 text-center text-text-secondary text-xs">{t("Duke ngarkuar bastet…")}</div> :
              betError ? <div className="p-6 text-center text-rose-300 text-xs" role="alert">{t(betError)}</div> :
              betEntries.length === 0 ? (
                <div className="p-8 text-center text-text-secondary text-xs">{t("Nuk ka baste për këtë filtër dhe periudhë.")}</div>
              ) : (
                <>
                  <p className="border-b border-tertiary/60 px-3 py-2 text-[11px] text-text-secondary">
                    {betEntries.length} {" " + t("rezultate") + " "}{betEntries.length === 500 ? t('(maksimumi 500 më të fundit për filtrin)') : ''}
                  </p>
                  <div className="max-h-[560px] divide-y divide-tertiary/70 overflow-y-auto">
                    {betEntries.map(entry => (
                      <details key={entry.kind + entry.id} className="group px-3 py-2.5 open:bg-[#241339]">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[11px] font-bold text-white">{entry.id.slice(0,8).toUpperCase()}</span>
                              <span className={'text-[11px] font-bold ' + betStatusClass(entry.status)}>
                                {t(BET_STATUS_LABELS[entry.status] ?? entry.status)}
                              </span>
                            </div>
                            <div className="mt-1 truncate text-xs text-slate-200">
                              {entry.kind === 'REJECTED'
                                ? `${t('Kërkesë e refuzuar')} (${entry.selectionCount} ${t('zgjedhje')})`
                                : entry.lines?.map(line => line.matchName).filter((name, idx, all) => all.indexOf(name) === idx).join(' · ') || t('Biletë')}
                            </div>
                            <div className="mt-1 text-[10px] text-text-secondary">
                              {new Date(entry.placedAt).toLocaleString(locale)}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-xs font-bold tabular-nums text-amber-200">
                              {entry.stake == null ? '—' : entry.stake.toFixed(2) + ' ' + t('Lëk')}
                            </div>
                            <div className="text-[10px] text-text-secondary">{t("Shuma")}</div>
                            <span className="text-[10px] text-text-secondary">{t("Detajet ▾")}</span>
                          </div>
                        </summary>
                        {entry.kind === 'REJECTED' ? (
                          <div className="mt-3 border-t border-tertiary/60 pt-2 text-xs text-rose-200">
                            {t("Arsyeja:") + " "}{t(userError(entry.reason,'Kërkesa për bast nuk u pranua.'))}
                          </div>
                        ) : (
                          <div className="mt-3 space-y-2 border-t border-tertiary/60 pt-2">
                            {entry.lines?.map(line => (
                              <div key={line.id} className="flex items-start justify-between gap-2 text-[11px]">
                                <div className="min-w-0">
                                  <div className="font-semibold text-white">{line.matchName}</div>
                                  <div className="text-text-secondary">
                                    {formatMarketSelectionLabel(line.marketName, line.marketLine, t)} ·{' '}
                                    {formatTicketSelection(line.outcomeName, line.marketName, line.matchName, t, line.outcomeCode, line.marketLine)}
                                  </div>
                                </div>
                                <div className="shrink-0 text-right">
                                  <div className="font-mono text-amber-200">@{formatOdds(line.oddsAtPlacement)}</div>
                                  <div className={betStatusClass(line.status)}>{t(BET_STATUS_LABELS[line.status] ?? line.status)}</div>
                                </div>
                              </div>
                            ))}
                            <div className="flex flex-wrap justify-between gap-2 border-t border-tertiary/60 pt-2 text-[11px]">
                              <span className="text-slate-300">{entry.system ? `${t('Sistem')} · ${entry.system.columnCount} ${t('kolona')}` : <>{t("Koeficienti total:") + " "}<strong>{formatOdds(entry.totalOdds)}</strong></>}</span>
                              <span className="text-slate-300">
                                {t('Fitimi i mundshëm')}{entry.potentialPayoutIsEstimated ? ' · '+t('i rindërtuar') : ''}:
                                <strong className="ml-1 text-amber-200">{entry.potentialPayout.toFixed(2)} {" " + t("Lëk")}</strong>
                              </span>
                            </div>
                            {entry.potentialPayoutIsEstimated && <div className="text-[11px] text-text-secondary" title={t('Vlerë e rindërtuar nga shuma dhe koeficienti i ruajtur; shuma origjinale nuk ishte ruajtur.')}>{t('Vlerë e rindërtuar nga shuma dhe koeficienti i ruajtur.')}</div>}
                            {entry.actualPayout != null && (entry.status !== 'PENDING' || entry.actualPayout > 0) && <div className="text-[11px] text-text-secondary">{t('Fitimi real')}: {entry.actualPayout.toFixed(2)} {t('Lëk')}</div>}
                            <SystemTicketSummary ticket={entry} />
                          </div>
                        )}
                      </details>
                    ))}
                  </div>
                </>
              )}
          </section>
        )}
        <section className="overflow-hidden rounded-2xl border border-tertiary bg-secondary">
          {!loading && !error && (
            <div className="flex items-center justify-between border-b border-tertiary bg-[#2c1743] px-3.5 py-2.5 text-xs font-semibold text-purple-100">
              <span>
                {displayedTransactions.length} {" " + t("transaksione")}
                {txCategory !== 'ALL' && <span className="ml-1.5 text-amber-300 font-bold">({txCategory === 'SPORT' ? t('Vetëm Sport') : txCategory === 'CASINO' ? t('Vetëm Kazino') : t('Depozita / Tërheqje')})</span>}
              </span>
              <span className="text-[10px] text-purple-300/80 uppercase tracking-wider">{t("Regjistri financiar")}</span>
            </div>
          )}
          {loading ? <div className="p-16 text-center text-text-secondary">{t("Duke ngarkuar transaksionet…")}</div>
            : error ? <div role="alert" className="p-8 text-center text-rose-300">{t(error)}</div>
              : displayedTransactions.length === 0 ? <div className="p-12 text-center text-text-secondary">{t("Nuk ka transaksione për këtë filtër dhe periudhë.")}</div>
                : (
                  <>
                    {/* MOBILE VIEW: Cards (< md) */}
                    <div className="block md:hidden divide-y divide-tertiary/60">
                      {displayedTransactions.map((transaction) => {
                        const isPositive = transaction.amount >= 0;
                        return (
                          <div key={transaction.id} className="px-3 py-3 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-bold text-white text-xs">
                                  {t(transactionLabel(transaction.type))}
                                </div>
                                {user?.role !== 'PLAYER' && (
                                  <div className="text-[11px] text-text-secondary font-medium">
                                    {t("Llogaria:") + " "}<span className="text-white font-semibold">{transaction.username}</span>
                                  </div>
                                )}
                              </div>
                              <span className={`text-sm font-black tabular-nums ${isPositive ? 'text-amber-300' : 'text-rose-300'}`}>
                                {transaction.amount > 0 ? '+' : ''}{transaction.amount.toFixed(2)} {" " + t("Lëk")}</span>
                            </div>

                            <div className="flex items-center justify-between text-[11px] text-text-secondary pt-1 border-t border-tertiary/40">
                              <span>{t("Bilanci pas:") + " "}<strong className="text-white font-mono">{transaction.balanceAfter.toFixed(2)} {" " + t("Lëk")}</strong></span>
                              <span>{new Date(transaction.createdAt).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>

                            {transaction.description && (
                              <div className="text-[11px] text-text-secondary bg-primary/50 px-2 py-1 border-l-2 border-tertiary">
                                {transactionDescription(transaction.description,transaction.type,lang)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* DESKTOP VIEW: Table (>= md) */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full min-w-[780px] text-left text-sm">
                        <thead className="bg-[#2c1743] text-[11px] uppercase text-text-secondary font-bold tracking-wider">
                          <tr>
                            <th className="p-3">{t("Data & Ora")}</th>
                            {user?.role !== 'PLAYER' && <th className="p-3">{t("Llogaria")}</th>}
                            <th className="p-3">{t("Lloji")}</th>
                            <th className="p-3">{t("Përshkrimi")}</th>
                            <th className="p-3 text-right">{t("Shuma")}</th>
                            <th className="p-3 text-right">{t("Bilanci pas veprimit")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-tertiary/60">
                          {displayedTransactions.map((transaction) => (
                            <tr key={transaction.id} className="text-white hover:bg-primary/40 transition">
                              <td className="p-3 whitespace-nowrap text-xs text-text-secondary tabular-nums">
                                {new Date(transaction.createdAt).toLocaleString(locale)}
                              </td>
                              {user?.role !== 'PLAYER' && <td className="p-3 font-semibold">{transaction.username}</td>}
                              <td className="p-3 font-semibold text-xs">{t(transactionLabel(transaction.type))}</td>
                              <td className="p-3 text-xs text-text-secondary">{transaction.description ? transactionDescription(transaction.description,transaction.type,lang) : '—'}</td>
                              <td className={`p-3 text-right font-mono font-black tabular-nums ${transaction.amount >= 0 ? 'text-amber-300' : 'text-rose-300'}`}>
                                {transaction.amount > 0 ? '+' : ''}{transaction.amount.toFixed(2)} {" " + t("Lëk")}</td>
                              <td className="p-3 text-right font-mono tabular-nums text-xs font-bold text-text-secondary">{transaction.balanceAfter.toFixed(2)} {" " + t("Lëk")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
        </section>
      </main>
    </div>
  );
}
