import { useLanguage } from '../../context/LanguageContext';
import { FormEvent, useEffect, useState } from 'react';
import { apiClient } from '../../api/client';
import { toDateRange } from '../../utils/dateFilters';
import { ClipboardList, Search, X, RefreshCw, Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import {auditActionLabel,auditTargetLabel} from '../../utils/accountLabels';

interface AuditEntry {
  id: number;
  actorName: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string | null;
  details: { input?: Record<string, unknown> };
  createdAt: string;
}

export default function AdminAuditLog() {
  const { t, lang } = useLanguage();
  const locale = lang === 'en' ? 'en-GB' : 'sq-AL';
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchEntries = async (event?: FormEvent) => {
    event?.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await apiClient.get('/admin/audit-log', { params: { ...toDateRange(from, to), limit: 500 } });
      setEntries(result.data);
    } catch (requestError: any) {
      console.error(requestError);
      setError(requestError.response?.data?.message || 'Nuk u ngarkua regjistri i veprimeve.');
    } finally {
      setLoading(false);
    }
  };

  const setDatePreset = (preset: 'today' | 'week' | 'month' | 'all') => {
    const today = new Date();
    const formatDate = (d: Date) => d.toISOString().split('T')[0];
    
    if (preset === 'all') {
      setFrom('');
      setTo('');
    } else if (preset === 'today') {
      const dateStr = formatDate(today);
      setFrom(dateStr);
      setTo(dateStr);
    } else if (preset === 'week') {
      const past = new Date(today);
      past.setDate(today.getDate() - 7);
      setFrom(formatDate(past));
      setTo(formatDate(today));
    } else if (preset === 'month') {
      const past = new Date(today);
      past.setDate(today.getDate() - 30);
      setFrom(formatDate(past));
      setTo(formatDate(today));
    }
  };

  useEffect(() => { void fetchEntries(); }, []);

  const filteredEntries = entries.filter((entry) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      entry.actorName.toLowerCase().includes(q) ||
      entry.action.toLowerCase().includes(q) ||
      t(auditActionLabel(entry.action)).toLowerCase().includes(q) ||
      entry.targetType.toLowerCase().includes(q) ||
      t(auditTargetLabel(entry.targetType)).toLowerCase().includes(q) ||
      (entry.targetId && entry.targetId.toLowerCase().includes(q))
    );
  });

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-3 sm:p-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white">{t("Regjistri i veprimeve")}</h2>
          <p className="mt-0.5 text-xs sm:text-sm text-text-secondary">
            {t("Regjistron ndryshimet financiare, llogaritë, kuotat dhe rezultatet e kryera nga administratori ose menaxherët.")}</p>
        </div>
        <button
          onClick={() => void fetchEntries()}
          className="self-start sm:self-auto flex items-center gap-2 px-3.5 py-2 bg-tertiary/80 hover:bg-tertiary text-white rounded-xl text-xs sm:text-sm font-bold transition active:scale-95"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin text-accent-green' : ''} />
          <span>{t("Rifresko")}</span>
        </button>
      </header>

      {/* Filter and Date Form */}
      <form onSubmit={fetchEntries} className="rounded-2xl border border-tertiary bg-secondary p-3 sm:p-4 space-y-3 shadow-md">
        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("Kërko me autor, veprim ose objekt...")}
            className="w-full bg-primary border border-tertiary rounded-xl pl-9 pr-9 py-2 text-xs sm:text-sm text-white placeholder-text-secondary focus:outline-none focus:border-accent-green"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-white"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Date Inputs & Quick Chips */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-2.5">
          <label className="flex-1 text-xs font-semibold text-text-secondary">
            {t("Nga data")}<input
              type="date" 
              value={from} 
              onChange={(e) => setFrom(e.target.value)} 
              className="mt-1 block w-full rounded-xl border border-tertiary bg-primary px-3 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-accent-green" 
            />
          </label>
          <label className="flex-1 text-xs font-semibold text-text-secondary">
            {t("Deri më")}<input
              type="date" 
              value={to} 
              onChange={(e) => setTo(e.target.value)} 
              className="mt-1 block w-full rounded-xl border border-tertiary bg-primary px-3 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-accent-green" 
            />
          </label>

          <button 
            type="submit" 
            className="w-full sm:w-auto rounded-xl bg-accent-green hover:bg-emerald-600 px-5 py-2.5 text-xs sm:text-sm font-black text-primary transition active:scale-95 shadow-md shadow-accent-green/20"
          >
            {t("Filtro datat")}</button>
        </div>

        {/* Quick Date Presets */}
        <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-tertiary/40">
          <span className="text-[11px] text-text-secondary font-semibold">{t("Periudha:")}</span>
          {(['today', 'week', 'month', 'all'] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setDatePreset(preset)}
              className="px-2.5 py-1 rounded-lg bg-tertiary hover:bg-tertiary/80 text-text-secondary hover:text-white text-xs font-bold transition active:scale-95"
            >
              {preset === 'today' ? t("Sot") : preset === 'week' ? t('7 ditë') : preset === 'month' ? t('30 ditë') : t("Të gjitha")}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-text-secondary font-medium">
            {filteredEntries.length} {" " + t("veprime")}</span>
        </div>
      </form>

      {/* Entries Display */}
      <section className="overflow-hidden rounded-2xl border border-tertiary bg-secondary shadow-xl">
        {loading ? (
          <div className="p-16 text-center text-text-secondary flex flex-col items-center justify-center gap-3">
            <RefreshCw size={26} className="animate-spin text-accent-green" />
            <span className="text-sm font-semibold">{t("Duke ngarkuar regjistrin…")}</span>
          </div>
        ) : error ? (
          <div role="alert" className="p-8 text-center text-rose-300 text-sm">{t(error)}</div>
        ) : filteredEntries.length === 0 ? (
          <div className="p-12 text-center text-text-secondary flex flex-col items-center gap-2">
            <ClipboardList size={32} className="opacity-30 text-white" />
            <div className="text-sm font-bold text-white">{t("Nuk ka veprime të regjistruara")}</div>
            <p className="text-xs">{t("Nuk u gjet asnjë veprim për këtë kërkim ose periudhë.")}</p>
          </div>
        ) : (
          <>
            {/* MOBILE VIEW: Touch-friendly cards (< md) */}
            <div className="block md:hidden divide-y divide-tertiary/60">
              {filteredEntries.map((entry) => {
                const isExpanded = expandedId === entry.id;
                const detailsStr = JSON.stringify(entry.details?.input ?? {}, null, 2);
                const hasDetails = detailsStr && detailsStr !== '{}';

                return (
                  <div key={entry.id} className="p-3.5 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ${
                          entry.actorRole === 'ADMIN' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}>
                          {entry.actorRole === 'ADMIN' ? t("Administrator") : t("Menaxher")}
                        </span>
                        <span className="font-bold text-white text-xs">{entry.actorName}</span>
                      </div>
                      <span className="text-[11px] text-text-secondary tabular-nums">
                        {new Date(entry.createdAt).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-primary text-accent-yellow font-bold border border-tertiary">
                        {t(auditActionLabel(entry.action))}
                      </span>
                      <span className="text-xs text-text-secondary font-medium">
                        {t(auditTargetLabel(entry.targetType))}{entry.targetId ? ` · ${entry.targetId}` : ''}
                      </span>
                    </div>

                    {hasDetails && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                          className="flex items-center gap-1 text-[11px] text-accent-blue hover:underline font-semibold"
                        >
                          <span>{t(isExpanded ? 'Fshih detajet' : 'Shiko detajet')}</span>
                          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                        {isExpanded && (
                          <pre className="mt-1.5 p-2.5 rounded-xl bg-primary text-[10px] font-mono text-text-secondary overflow-x-auto border border-tertiary">
                            {detailsStr}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* DESKTOP VIEW: Full Table (>= md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-tertiary/60 text-[11px] uppercase text-text-secondary font-bold tracking-wider">
                  <tr>
                    <th className="p-3.5">{t("Data & Ora")}</th>
                    <th className="p-3.5">{t("Autori")}</th>
                    <th className="p-3.5">{t("Veprimi")}</th>
                    <th className="p-3.5">{t("Objekti")}</th>
                    <th className="p-3.5">{t("Detajet")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-tertiary/60">
                  {filteredEntries.map((entry) => (
                    <tr key={entry.id} className="text-white hover:bg-primary/40 transition">
                      <td className="p-3.5 whitespace-nowrap text-xs text-text-secondary tabular-nums">
                        {new Date(entry.createdAt).toLocaleString(locale)}
                      </td>
                      <td className="p-3.5 font-semibold">
                        {entry.actorName}{' '}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-black uppercase ${
                          entry.actorRole === 'ADMIN' ? 'bg-purple-500/20 text-purple-400' : 'bg-amber-500/20 text-amber-400'
                        }`}>
                          {entry.actorRole === 'ADMIN' ? t("Administrator") : t("Menaxher")}
                        </span>
                      </td>
                      <td className="p-3.5 text-xs text-accent-yellow font-bold">{t(auditActionLabel(entry.action))}</td>
                      <td className="p-3.5 text-xs">{t(auditTargetLabel(entry.targetType))}{entry.targetId ? ` · ${entry.targetId}` : ''}</td>
                      <td className="p-3.5 text-xs text-text-secondary max-w-xs truncate font-mono">
                        {JSON.stringify(entry.details?.input ?? {})}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
