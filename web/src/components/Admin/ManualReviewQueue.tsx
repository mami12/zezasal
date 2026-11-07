import { useEffect, useState } from 'react';
import { apiClient } from '../../api/client';
import {
  AlertTriangle, RefreshCw, Calendar, Clock, User,
  CheckCircle2, XCircle, RotateCcw, ShieldCheck, Ticket
} from 'lucide-react';

type ReviewItem = {
  lineId: string;
  ticketId: string;
  matchId: string;
  marketName: string;
  matchName: string;
  outcomeName: string;
  marketLine: string;
  lineStatus: string;
  ticketStatus: string;
  username: string | null;
  placedAt: string;
  stake: string | number;
  odds: string | number;
  potentialPayout?: string | number;
  notificationActive: boolean;
  noticeExpiresAt: string;
  finalScore: string | null;
  reason: string;
  conflicts?: Record<string, unknown> | null;
};

type Decision = { status: string; reason: string; source: string };

const labels: Record<string, string> = {
  VOID_NEEDS_CONFIRMATION: 'E pavlefshme: kontrollo nëse anulimi ishte i justifikuar',
  CONFLICTING_API_STATISTICS: 'Mospërputhje mes burimeve të statistikave të ndeshjes',
  MISSING_EVENT_TIMELINE: 'Mungon kronologjia e ngjarjeve (gol, korner ose interval)',
  MISSING_MARKET_STATISTICS: 'Mungojnë statistikat e nevojshme për mbylljen e tregut',
  UNRESOLVED_FINAL_SELECTION: 'Ndeshja ka përfunduar, por përzgjedhja ende nuk është zgjidhur automatikisht',
  MISSING_FINAL_RESULT: 'Mungon rezultati përfundimtar i konfirmuar nga burimi sportiv',
};

function formatDateTime(iso: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString('sq-AL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${date} · ${time}`;
}

const fresh: Decision = { status: 'PENDING', reason: '', source: '' };

export default function ManualReviewQueue({ onlyLineId, onSaved }: { onlyLineId?: string; onSaved?: () => void } = {}) {
  const [approval, setApproval] = useState<{ item: ReviewItem; decision: Decision } | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    try {
      const res = await apiClient.get('/admin/settlement-review-queue', { params: { limit: 200 } });
      setItems(Array.isArray(res.data?.items) ? res.data.items.filter((item: ReviewItem) => !onlyLineId || item.lineId === onlyLineId) : []);
      setError('');
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'Lista e verifikimeve nuk u ngarkua.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(id);
  }, [onlyLineId]);

  const change = (id: string, key: keyof Decision, value: string) => setDecisions(prev => ({
    ...prev,
    [id]: { ...(prev[id] ?? fresh), [key]: value }
  }));

  async function decide(item: ReviewItem, entry: Decision) {
    setBusy(item.lineId);
    setError('');
    setNotice('');
    try {
      const res = await apiClient.post('/admin/manual-settlement', {
        lineId: item.lineId,
        status: entry.status,
        reason: entry.reason?.trim() || 'Ndryshim manual nga administratori',
        source: entry.source?.trim() || 'ADMIN',
      });
      setNotice('Vendimi u regjistrua me sukses për ' + (res.data.changed?.length ?? 0) + ' biletë/a.');
      setDecisions(prev => {
        const next = { ...prev };
        delete next[item.lineId];
        return next;
      });
      setApproval(null);
      onSaved?.();
      await load();
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'Vendimi manual dështoi.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-3 sm:p-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-black text-white sm:text-xl">
            <AlertTriangle size={20} className="text-amber-400" />
            <span>Njoftime: Bileta për Kontroll ({items.length})</span>
          </h2>
          <p className="mt-1 text-xs text-text-secondary">
            Biletat që kërkojnë konfirmim manual të rezultatit ose që kanë anomali nga API. Njoftimi skadon pas 48 orësh.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-2 rounded-xl border border-tertiary bg-secondary px-3.5 py-2 text-xs font-bold text-white shadow hover:border-purple-400/50 hover:bg-white/5 transition-all"
        >
          <RefreshCw size={14} />
          <span>Rifresko</span>
        </button>
      </div>

      {error && <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm font-semibold text-rose-200">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-200">{notice}</p>}
      {loading && <p className="text-sm text-text-secondary">Duke ngarkuar biletat…</p>}

      {!loading && !items.length && (
        <div className="rounded-2xl border border-purple-500/20 bg-secondary/80 p-8 text-center text-text-secondary">
          <ShieldCheck size={32} className="mx-auto mb-2 text-emerald-400" />
          <h3 className="text-sm font-bold text-white">Nuk ka bileta që kërkojnë verifikim manual</h3>
          <p className="mt-1 text-xs text-text-secondary">Të gjitha biletat janë të zgjidhura automatikisht ose të rregullta.</p>
        </div>
      )}

      {/* Confirmation Modal */}
      {approval && items.some(item => item.lineId === approval.item.lineId) && (
        <section aria-label="Miratimi i vendimit" className="rounded-2xl border border-amber-400/40 bg-amber-950/40 p-4 sm:p-5 space-y-3 backdrop-blur-md">
          <p className="font-bold text-white">Konfirmo vendimin për këtë përzgjedhje:</p>
          <p className="text-xs text-amber-200">
            {approval.item.matchName} &bull; {approval.item.marketName} &bull; <strong>{approval.item.outcomeName}</strong>
          </p>
          <p className="text-xs font-semibold text-emerald-300">
            Statusi i Ri: {({ WON: 'Fituese', LOST: 'Humbëse', VOID: 'E pavlefshme (Anulo)', PENDING: 'Në pritje' } as Record<string, string>)[approval.decision.status]}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={busy !== null}
              className="rounded-xl bg-accent-green px-4 py-2 text-xs font-black text-primary hover:brightness-110"
              onClick={() => void decide(approval.item, approval.decision)}
            >
              Po, mirato
            </button>
            <button
              type="button"
              disabled={busy !== null}
              className="rounded-xl border border-tertiary px-4 py-2 text-xs font-bold text-text-secondary hover:text-white"
              onClick={() => setApproval(null)}
            >
              Jo, kthehu
            </button>
          </div>
        </section>
      )}

      {/* Structured Ticket Review Cards */}
      <div className="space-y-4">
        {items.map(item => {
          const decision = decisions[item.lineId] ?? fresh;
          const stakeNum = Number(item.stake || 0);
          const oddsNum = Number(item.odds || 0);
          const potentialNum = item.potentialPayout ? Number(item.potentialPayout) : stakeNum * oddsNum;

          return (
            <section
              key={item.lineId}
              className="overflow-hidden rounded-2xl border border-purple-500/20 bg-gradient-to-b from-[#241239]/95 to-[#160a22]/95 shadow-xl shadow-purple-950/40 backdrop-blur-md"
            >
              {/* Ticket Top Bar: ID, Date & Time, User, Status */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-purple-500/20 bg-[#2d1544]/80 px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-[#1c0c2a] px-2.5 py-1 font-mono text-xs font-bold text-purple-200">
                    <Ticket size={13} className="text-amber-400" />
                    <span>Bileta #{item.ticketId.slice(0, 8).toUpperCase()}</span>
                  </span>

                  {/* DATA DHE ORA KUR ESHTE LUAJTUR */}
                  <span className="flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-[#1c0c2a] px-2.5 py-1 text-xs font-bold text-amber-200 shadow-inner">
                    <Calendar size={13} className="text-amber-400 shrink-0" />
                    <Clock size={13} className="text-amber-400 shrink-0" />
                    <span>Luajtur më: <strong>{formatDateTime(item.placedAt)}</strong></span>
                  </span>

                  {item.username && (
                    <span className="flex items-center gap-1 rounded-lg border border-purple-500/20 bg-purple-950/40 px-2 py-1 text-xs text-purple-200/90">
                      <User size={13} className="text-purple-400 shrink-0" />
                      <span>Lojtari: <strong>{item.username}</strong></span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider border ${
                    item.lineStatus === 'VOID'
                      ? 'border-rose-500/40 bg-rose-500/20 text-rose-300'
                      : 'border-amber-500/40 bg-amber-500/20 text-amber-200'
                  }`}>
                    {item.lineStatus === 'VOID' ? 'E PAVLEFSHME' : 'NË PRITJE'}
                  </span>
                </div>
              </div>

              {/* Ticket Details Body: Match, Market & Pick, Financials */}
              <div className="p-4 sm:p-5 space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {/* 1. NDESHJA & REZULTATI */}
                  <div className="rounded-xl border border-purple-500/15 bg-[#1a0c28]/60 p-3.5 space-y-1.5">
                    <span className="text-[11px] font-black uppercase tracking-wider text-purple-300/70">Ndeshja</span>
                    <h4 className="text-sm font-black text-white leading-snug">{item.matchName}</h4>
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                      {item.finalScore ? (
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 font-black text-emerald-300">
                          Rezultati: {item.finalScore}
                        </span>
                      ) : (
                        <span className="text-[11px] text-purple-300/60">Pa rezultat final nga feed-i</span>
                      )}
                      <span className="text-[10px] text-purple-300/50">ID: {item.matchId}</span>
                    </div>
                  </div>

                  {/* 2. TREGU DHE ZGJEDHJA */}
                  <div className="rounded-xl border border-purple-500/15 bg-[#1a0c28]/60 p-3.5 space-y-1.5">
                    <span className="text-[11px] font-black uppercase tracking-wider text-purple-300/70">Tregu & Zgjedhja</span>
                    <div className="text-xs text-purple-200/90 font-medium">
                      {item.marketName} {item.marketLine}
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="rounded-lg bg-purple-500/20 border border-purple-400/30 px-2.5 py-1 text-xs font-black text-white">
                        {item.outcomeName}
                      </span>
                      <span className="font-mono text-sm font-black text-amber-300">
                        @{oddsNum.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* 3. FINANCAT: BASTI & FITIMI */}
                  <div className="rounded-xl border border-purple-500/15 bg-[#1a0c28]/60 p-3.5 space-y-1.5">
                    <span className="text-[11px] font-black uppercase tracking-wider text-purple-300/70">Financat e Biletës</span>
                    <div className="flex items-center justify-between text-xs text-purple-200">
                      <span className="text-purple-300/70">Shuma e luajtur:</span>
                      <span className="font-mono font-bold text-white">{stakeNum.toFixed(2)} Lek</span>
                    </div>
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-purple-500/10">
                      <span className="text-purple-300/70">Fitimi i mundshëm:</span>
                      <span className="font-mono font-black text-amber-300 text-sm">{potentialNum.toFixed(2)} Lek</span>
                    </div>
                  </div>
                </div>

                {/* Arsyeja e Njoftimit / Kontrollit */}
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-black text-amber-200">
                        {labels[item.reason] ?? item.reason}
                      </div>
                      <div className="mt-0.5 text-[11px] text-amber-300/70">
                        {item.notificationActive
                          ? 'Njoftimi aktiv deri më ' + new Date(item.noticeExpiresAt).toLocaleString('sq-AL')
                          : 'Njoftimi ka skaduar · Verifikimi mbetet i hapur'}
                      </div>
                      {item.conflicts && Object.keys(item.conflicts).length > 0 && (
                        <div className="mt-1 text-[11px] font-bold text-rose-300">
                          Statistika kontradiktore: {Object.keys(item.conflicts).join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Bottom Action Bar: Vendimi i Administratorit */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-purple-500/20">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-purple-200/80">Vendimi:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { value: 'WON', label: 'Fituese', icon: CheckCircle2, activeClass: 'border-emerald-500 bg-emerald-500/30 text-emerald-200' },
                        { value: 'LOST', label: 'Humbëse', icon: XCircle, activeClass: 'border-rose-500 bg-rose-500/30 text-rose-200' },
                        { value: 'VOID', label: 'E pavlefshme (Anulo)', icon: RotateCcw, activeClass: 'border-slate-400 bg-slate-500/30 text-slate-200' },
                        { value: 'PENDING', label: 'Në pritje', icon: Clock, activeClass: 'border-amber-400 bg-amber-500/30 text-amber-200' },
                      ].map(opt => {
                        const isSelected = decision.status === opt.value;
                        const Icon = opt.icon;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => change(item.lineId, 'status', opt.value)}
                            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all ${
                              isSelected
                                ? opt.activeClass + ' shadow-md'
                                : 'border-purple-500/20 bg-[#1e0e31] text-purple-200/70 hover:bg-[#2c1545] hover:text-white'
                            }`}
                          >
                            <Icon size={13} />
                            <span>{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => onlyLineId ? setApproval({ item, decision: { ...decision } }) : void decide(item, decision)}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-5 py-2 text-xs font-black text-black shadow-lg shadow-amber-950/50 hover:brightness-110 active:scale-95 disabled:opacity-40 transition-all ml-auto"
                  >
                    <ShieldCheck size={14} />
                    <span>{busy === item.lineId ? 'Duke ruajtur…' : 'Ruaj Vendimin'}</span>
                  </button>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
