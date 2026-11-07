import { useEffect, useState } from 'react';
import { apiClient } from '../../api/client';
import { Users, Activity, Euro, Target, RefreshCw, ChevronDown, ChevronUp, Wallet } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import FinancialChart from '../Finance/FinancialChart';
import CommissionRates from './CommissionRates';

interface Stats {
  users: number;
  activeBets: number;
  totalStake: number;
  revenue: number;
  managers?: Array<{
    id: string;
    username: string;
    playerCount: number;
    playerBalance: number;
    balance: number;
    totalStake: number;
    wonPayouts: number;
    lostStake: number;
    commission: number;
    sportCommission: number;
    casinoCommission: number;
    commissionRates: { single: number; double: number; multi: number; casino: number };
    netDifference: number;
  }>;
}

export default function AdminDashboard() {
  const { t } = useLanguage();
  const [stats, setStats] = useState<Stats>({ users: 0, activeBets: 0, totalStake: 0, revenue: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedManagerId, setExpandedManagerId] = useState<string | null>(null);

  const refreshStats = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await apiClient.get('/admin/stats');
      setStats(res.data);
    } catch (error) {
      console.error(error);
    } finally {
      if (showLoading) setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshStats(true);
    const refreshTimer = window.setInterval(() => void refreshStats(), 30000);
    return () => window.clearInterval(refreshTimer);
  }, []);

  const cards = [
    { title: t('admin.total_users'), value: stats.users, icon: Users, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { title: t('admin.active_bets_today'), value: stats.activeBets, icon: Activity, color: 'text-accent-yellow', bg: 'bg-amber-500/10' },
    { title: t('admin.total_stake_today'), value: `${stats.totalStake.toFixed(2)} Lëk`, icon: Euro, color: 'text-accent-green', bg: 'bg-emerald-500/10' },
    { title: t('admin.total_revenue'), value: `${stats.revenue.toFixed(2)} Lëk`, icon: Target, color: 'text-accent-red', bg: 'bg-rose-500/10' },
  ];
  const managers = stats.managers ?? [];
  const financialTotals = managers.reduce((totals, manager) => ({
    totalStake: totals.totalStake + manager.totalStake,
    wonPayouts: totals.wonPayouts + manager.wonPayouts,
    lostStake: totals.lostStake + manager.lostStake,
    commission: totals.commission + manager.commission,
    sportCommission: totals.sportCommission + (manager.sportCommission || 0),
    casinoCommission: totals.casinoCommission + (manager.casinoCommission || 0),
    playerBalance: totals.playerBalance + manager.playerBalance,
    balance: totals.balance + manager.balance,
    netDifference: totals.netDifference + manager.netDifference,
  }), { totalStake: 0, wonPayouts: 0, lostStake: 0, commission: 0, sportCommission: 0, casinoCommission: 0, playerBalance: 0, balance: 0, netDifference: 0 });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-center text-text-secondary gap-3">
        <RefreshCw size={28} className="animate-spin text-accent-green" />
        <span className="text-sm font-semibold">{t('common.loading')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 p-3 sm:p-6 max-w-7xl mx-auto">
      {/* Top Bar with Refresh */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-2xl font-black text-white">{t('admin.dashboard')}</h2>
          <p className="text-xs sm:text-sm text-text-secondary">{t("Përmbledhje në kohë reale e aktivitetit dhe financave")}</p>
        </div>
        <button
          onClick={() => void refreshStats(false)}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl bg-tertiary/70 hover:bg-tertiary text-text-primary text-xs sm:text-sm font-bold border border-white/5 active:scale-95 transition"
          title={t("Rifresko statistikat")}
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin text-accent-green' : ''} />
          <span className="hidden sm:inline">{t("Rifresko")}</span>
        </button>
      </div>

      {/* 4 Stat Cards: 2x2 grid on mobile, 4 columns on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        {cards.map((c, i) => (
          <div key={i} className="bg-secondary p-3.5 sm:p-5 rounded-2xl border border-tertiary/80 shadow-sm flex flex-col justify-between gap-2 transition hover:border-tertiary">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary text-[11px] sm:text-xs font-semibold truncate leading-tight">{c.title}</span>
              <div className={`p-2 rounded-xl ${c.bg} ${c.color} shrink-0`}>
                <c.icon size={16} className="sm:w-5 sm:h-5" />
              </div>
            </div>
            <div className="text-base sm:text-2xl font-black text-white tracking-tight tabular-nums truncate">
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {/* Financial Chart */}
      <FinancialChart
        title={t("Grafiku financiar i menaxherëve")}
        description="Totali aktual i fondeve të luajtura, pagesave dhe bilanceve të menaxherëve."
        items={[
          { label: 'Fonde të luajtura', value: financialTotals.totalStake, color: 'bg-sky-400' },
          { label: 'Pagesa fituese', value: financialTotals.wonPayouts, color: 'bg-emerald-400' },
          { label: 'Humbje të lojtarëve', value: financialTotals.lostStake, color: 'bg-rose-400' },
          { label: 'Komisioni i sporteve', value: financialTotals.sportCommission, color: 'bg-amber-400' },
          { label: 'Komisioni i slot machine', value: financialTotals.casinoCommission, color: 'bg-cyan-400' },
          { label: 'Bilanci i lojtarëve', value: financialTotals.playerBalance, color: 'bg-violet-400' },
          { label: 'Bilanci i menaxherëve', value: financialTotals.balance, color: 'bg-cyan-400' },
          { label: 'Diferenca neto', value: financialTotals.netDifference, color: 'bg-fuchsia-400' },
        ]}
      />

      {/* Commission Rates Control */}
      <CommissionRates />

      {/* Manager Financial Overview */}
      <section className="bg-secondary rounded-2xl border border-tertiary shadow-xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-tertiary flex items-center justify-between">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-white">{t("Pasqyra financiare e menaxherëve")}</h3>
            <p className="text-xs sm:text-sm text-text-secondary">{t("Bilanci, aktiviteti i lojtarëve dhe diferenca neto")}</p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 bg-tertiary/70 text-text-secondary rounded-lg">
            {managers.length} {managers.length === 1 ? 'menaxher' : 'menaxherë'}
          </span>
        </div>

        {/* Mobile View: Cards (< md screens) */}
        <div className="block md:hidden divide-y divide-tertiary/60">
          {managers.map((manager) => {
            const isExpanded = expandedManagerId === manager.id;
            const isPositive = manager.netDifference >= 0;
            return (
              <div key={manager.id} className="p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-black text-xs uppercase">
                      {manager.username.substring(0, 2)}
                    </span>
                    <div>
                      <div className="font-bold text-white text-sm">{manager.username}</div>
                      <div className="text-[11px] text-text-secondary">{manager.playerCount} {" " + t("lojtarë")}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`inline-block px-2 py-0.5 rounded-lg text-xs font-black tabular-nums ${
                      isPositive ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/15 text-rose-400 border border-rose-500/20'
                    }`}>
                      {isPositive ? '+' : ''}{manager.netDifference.toFixed(2)} {" " + t("Lëk")}</span>
                  </div>
                </div>

                {/* 4-Box Key Metrics Grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-primary/70 p-2.5 rounded-xl border border-tertiary/50">
                    <div className="text-[10px] text-text-secondary font-medium uppercase">{t("Fonde të luajtura")}</div>
                    <div className="font-bold text-white tabular-nums mt-0.5">{manager.totalStake.toFixed(2)} {" " + t("Lëk")}</div>
                  </div>
                  <div className="bg-primary/70 p-2.5 rounded-xl border border-tertiary/50">
                    <div className="text-[10px] text-text-secondary font-medium uppercase">{t("Pagesa fituese")}</div>
                    <div className="font-bold text-emerald-400 tabular-nums mt-0.5">{manager.wonPayouts.toFixed(2)} {" " + t("Lëk")}</div>
                  </div>
                  <div className="bg-primary/70 p-2.5 rounded-xl border border-tertiary/50">
                    <div className="text-[10px] text-text-secondary font-medium uppercase">{t("Humbje")}</div>
                    <div className="font-bold text-rose-400 tabular-nums mt-0.5">{manager.lostStake.toFixed(2)} {" " + t("Lëk")}</div>
                  </div>
                  <div className="bg-primary/70 p-2.5 rounded-xl border border-tertiary/50">
                    <div className="text-[10px] text-text-secondary font-medium uppercase">{t("Bilanci menaxherit")}</div>
                    <div className="font-bold text-white tabular-nums mt-0.5">{manager.balance.toFixed(2)} {" " + t("Lëk")}</div>
                  </div>
                </div>

                {/* Toggle Details */}
                <button
                  type="button"
                  onClick={() => setExpandedManagerId(isExpanded ? null : manager.id)}
                  className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-text-secondary hover:text-white font-semibold rounded-lg bg-tertiary/30 hover:bg-tertiary/50 transition"
                >
                  <span>{isExpanded ? 'Më pak detaje' : 'Më shumë detaje (Komisioni, Bilanci lojtarëve)'}</span>
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {isExpanded && (
                  <div className="bg-primary/90 p-3 rounded-xl border border-tertiary/80 space-y-2 text-xs">
                    <div className="flex justify-between items-center py-1 border-b border-tertiary/40">
                      <span className="text-text-secondary">{t("Norma komisionit (T/D/M)")}</span>
                      <span className="font-bold text-accent-yellow">
                        {manager.commissionRates.single}% / {manager.commissionRates.double}% / {manager.commissionRates.multi}%
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-tertiary/40">
                      <span className="text-text-secondary">{t("Komisioni i sporteve")}</span>
                      <span className="font-bold text-white">{(manager.sportCommission ?? 0).toFixed(2)} {" " + t("Lëk")}</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-tertiary/40"><span className="text-text-secondary">{t("Komisioni i slot machine")}</span><span className="font-bold text-cyan-300">{(manager.casinoCommission ?? 0).toFixed(2)} {t("Lëk")} · {manager.commissionRates.casino}%</span></div>
                    <div className="flex justify-between items-center py-1">
                      <span className="text-text-secondary">{t("Bilanci total i lojtarëve")}</span>
                      <span className="font-bold text-accent-green">{manager.playerBalance.toFixed(2)} {" " + t("Lëk")}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!managers.length && (
            <div className="p-8 text-center text-text-secondary text-sm">
              {t("Nuk ka menaxherë për t’u shfaqur.")}</div>
          )}
        </div>

        {/* Desktop View: Full Data Table (>= md screens) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="bg-tertiary/60 uppercase text-[11px] text-text-secondary font-bold tracking-wider">
              <tr>
                <th className="p-3.5">{t("Menaxheri")}</th>
                <th className="p-3.5 text-right">{t("Lojtarë")}</th>
                <th className="p-3.5 text-right">{t("Fonde të luajtura")}</th>
                <th className="p-3.5 text-right">{t("Pagesa fituese")}</th>
                <th className="p-3.5 text-right">{t("Humbje")}</th>
                <th className="p-3.5 text-right">{t("Komisioni (%)")}</th>
                <th className="p-3.5 text-right">{t("Komisioni i sporteve")}</th><th className="p-3.5 text-right">{t("Komisioni i slot machine")}</th>
                <th className="p-3.5 text-right">{t("Bilanci i lojtarëve")}</th>
                <th className="p-3.5 text-right">{t("Bilanci")}</th>
                <th className="p-3.5 text-right">{t("Diferenca")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-tertiary/60">
              {managers.map((manager) => (
                <tr key={manager.id} className="text-white hover:bg-primary/40 transition">
                  <td className="p-3.5 font-semibold flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-xs uppercase">
                      {manager.username.substring(0, 2)}
                    </span>
                    {manager.username}
                  </td>
                  <td className="p-3.5 text-right tabular-nums">{manager.playerCount}</td>
                  <td className="p-3.5 text-right tabular-nums">{manager.totalStake.toFixed(2)} {" " + t("Lëk")}</td>
                  <td className="p-3.5 text-right tabular-nums text-emerald-400">{manager.wonPayouts.toFixed(2)} {" " + t("Lëk")}</td>
                  <td className="p-3.5 text-right tabular-nums text-rose-400">{manager.lostStake.toFixed(2)} {" " + t("Lëk")}</td>
                  <td className="p-3.5 text-right tabular-nums text-accent-yellow">{manager.commissionRates.single}% / {manager.commissionRates.double}% / {manager.commissionRates.multi}%</td>
                  <td className="p-3.5 text-right tabular-nums">{manager.commission.toFixed(2)} {" " + t("Lëk")}</td>
                  <td className="p-3.5 text-right tabular-nums">{manager.playerBalance.toFixed(2)} {" " + t("Lëk")}</td>
                  <td className="p-3.5 text-right tabular-nums font-semibold">{manager.balance.toFixed(2)} {" " + t("Lëk")}</td>
                  <td className={`p-3.5 text-right font-black tabular-nums ${manager.netDifference >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {manager.netDifference >= 0 ? '+' : ''}{manager.netDifference.toFixed(2)} {" " + t("Lëk")}</td>
                </tr>
              ))}
              {!managers.length && (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-text-secondary">
                    {t("Nuk ka menaxherë për t’u shfaqur.")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="text-xs text-text-secondary px-1 leading-relaxed bg-tertiary/20 p-3 rounded-xl border border-tertiary/40">
        <span className="text-accent-yellow font-bold">{t("Informacion:")}</span> {" " + t("Komisionet e reja janë vetëm raport, veçmas për sport dhe slot machine. Nuk shtohen ose zbriten nga bilancet. Llogaritjet bëhen manualisht.")}</div>
    </div>
  );
}