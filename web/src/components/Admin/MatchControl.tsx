import {useFeedScope} from '../../api/feedScope';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Clock, Filter, Layers, Loader2, Lock, Percent, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Trophy, Unlock, X } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { Match, Market, Outcome } from '../../types';
import { adminUiText, adminUiError } from './adminUiCopy';
import { useLanguage } from '../../context/LanguageContext';
import { formatMarketSelectionLabel, formatTicketSelection } from '../../utils/sportsbookLabels';
import { formatOdds } from '../../utils/formatOdds';
import { marketCategoryLabel, marketCategoryOf, type MarketCategory } from '../../utils/marketCatalog';
import { userError } from '../../utils/userError';
import MatchControlDialog from './MatchControlDialog';
import { competitionKey, eligibleOutcomes, fixtureName, matchStatus, previewAdjustments, searchText, statusLabel, type AdminOverride, type ControlDialog } from './matchControlModel';
import './matchControl.css';

const PAGE_SIZE = 30;
const categories: MarketCategory[] = ['main', 'goals', 'mixed', 'corners', 'cards', 'htft', 'players', 'other'];
const errorMessage = (error: any, fallback: string) => userError(error.response?.data?.error ?? error, fallback);
const kickoff = (value: string, lang: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(lang === 'en' ? 'en-GB' : 'sq-AL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : adminUiText('Ora nuk është konfirmuar', lang);
};

export default function MatchControl() {
  const { t, lang } = useLanguage();
  const tr = (value: string) => adminUiText(value, lang);
  const [matches, setMatches] = useState<Match[]>([]);
  const [overrides, setOverrides] = useState<AdminOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useFeedScope('admin-detail',{detail:selectedId?{id:selectedId,category:'all'}:null});
  const [detail, setDetail] = useState<Match | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailStale, setDetailStale] = useState(true);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [competition, setCompetition] = useState('ALL');
  const [suspension, setSuspension] = useState('ALL');
  const [page, setPage] = useState(1);
  const [marketQuery, setMarketQuery] = useState('');
  const [category, setCategory] = useState<'all' | MarketCategory>('all');
  const [marketState, setMarketState] = useState('ALL');
  const [marketLimit, setMarketLimit] = useState(20);
  const [dialog, setDialog] = useState<ControlDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [notice, setNotice] = useState('');
  const [automatic, setAutomatic] = useState(true);
  const [bulkCountry, setBulkCountry] = useState('');
  const [bulkCompetition, setBulkCompetition] = useState('');
  const [bulkCategory, setBulkCategory] = useState('totals');
  const [bulkAction, setBulkAction] = useState<'suspend' | 'open'>('suspend');
  const [bulkBusy, setBulkBusy] = useState(false);
  const mounted = useRef(true);
  const selection = useRef<string | null>(null);
  const epoch = useRef(0);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const actionRunning = useRef(false);
  const detailAvailable = useRef(false);
  const overrideMap = useMemo(() => new Map(overrides.map(row => [`${row.kind}:${row.ref}`, row])), [overrides]);
  const ownLock = (kind: string, id: string) => overrideMap.get(`${kind}:${id}`)?.suspended === true;

  const loadList = useCallback(async () => {
    const request = ++listRequest.current, version = epoch.current;
    setRefreshing(true);
    try {
      const response = await apiClient.get('/admin/matches?summary=true&limit=2000&includeEnded=true');
      if (!mounted.current || request !== listRequest.current || version !== epoch.current) return;
      const items: Match[] = (response.data.items ?? []).map((match: Match) => ({ ...match, id: String(match.id) }));
      setMatches(items);
      setListError('');
      setOverrides(response.data.overrides ?? []);
      setUpdatedAt(new Date());
      if (!selection.current && items[0]) {
        selection.current = items[0].id;
        setSelectedId(items[0].id);
      }
    } catch (failure) {
      if (mounted.current && request === listRequest.current && version === epoch.current) setListError(errorMessage(failure, tr('Ndeshjet nuk u ngarkuan. Provo rifreskimin.')));
    } finally {
      if (mounted.current && request === listRequest.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const request = ++detailRequest.current, version = epoch.current;
    detailAvailable.current = false;
    setDetailLoading(true);
    try {
      const response = await apiClient.get(`/admin/matches/${encodeURIComponent(id)}`);
      if (!mounted.current || request !== detailRequest.current || selection.current !== id || version !== epoch.current) return;
      setDetail({ ...response.data.item, id: String(response.data.item.id) });
      setDetailStale(false); setDetailError(''); detailAvailable.current = true;
      const relevant: AdminOverride[] = response.data.overrides ?? [];
      setOverrides(previous => [...previous.filter(row => !(row.kind === 'match' ? row.ref === id : row.ref.startsWith(`${id}|`))), ...relevant]);
    } catch (failure) {
      if (mounted.current && request === detailRequest.current && selection.current === id && version === epoch.current) {
        setDetailStale(true); detailAvailable.current = false;
        setDetailError(errorMessage(failure, tr('Tregjet nuk u rifreskuan. Veprimet janë bllokuar derisa të rifreskosh me sukses.')));
      }
    } finally {
      if (mounted.current && request === detailRequest.current) setDetailLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    // The selected fixture's precise overrides take precedence over the light list.
    await loadList();
    if (selection.current) await loadDetail(selection.current);
  }, [loadList, loadDetail]);
  useEffect(() => {
    mounted.current = true;
    void loadList();
    return () => { mounted.current = false; listRequest.current++; detailRequest.current++; };
  }, [loadList]);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); }, [selectedId, loadDetail]);
  useEffect(() => {
    if (!automatic || dialog || busy || bulkBusy) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible' && !actionRunning.current) void refresh(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [automatic, dialog, busy, bulkBusy, refresh]);
  useEffect(() => { setPage(1); }, [query, status, competition, suspension]);
  useEffect(() => { setMarketLimit(20); }, [selectedId, marketQuery, category, marketState]);

  const perform = async (work: () => Promise<unknown>, success: string, closeDialog = false) => {
    if (actionRunning.current) return;
    if (!detailAvailable.current) { setError(tr('Rifresko ndeshjen me sukses përpara një ndryshimi tjetër.')); return; }
    actionRunning.current = true;
    epoch.current++;
    setBusy(true); setError(''); setNotice('');
    let completed = false;
    try {
      await work();
      completed = true;
      if (mounted.current) setNotice(success);
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure, tr('Veprimi nuk u konfirmua. Kontrollo gjendjen e rifreskuar përpara se ta provosh përsëri.')));
    } finally {
      await refresh();
      actionRunning.current = false;
      if (mounted.current) { setBusy(false); if (completed && closeDialog) setDialog(null); }
    }
  };
  const toggle = (kind: 'match' | 'market' | 'outcome', id: string) => {
    const remove = ownLock(kind, id);
    const resource = kind === 'match' ? 'matches' : `${kind}s`;
    void perform(() => apiClient.patch(`/admin/${resource}/${encodeURIComponent(id)}/suspend`, kind === 'match'
      ? { isSuspended: !remove } : { status: remove ? 'ACTIVE' : 'SUSPENDED' }), remove
      ? tr('Pezullimi i administratorit u hoq. Gjendja e burimit dhe rregullat e rrezikut vazhdojnë të zbatohen.')
      : tr('Pezullimi u ruajt me sukses.'));
  };
  const saveOdds = async (odds: number) => {
    if (dialog?.kind !== 'odds') return;
    await perform(() => apiClient.patch(`/admin/outcomes/${encodeURIComponent(dialog.outcome.id)}/odds`, { odds }), tr('Kuota u ruajt me sukses.'), true);
  };
  const adjustOdds = async (percentage: number) => {
    if (dialog?.kind !== 'adjust') return;
    const changes = previewAdjustments(dialog.outcomes, percentage);
    if (!Number.isFinite(percentage) || percentage <= -100 || percentage === 0 || !changes.length || changes.some(row => !row.valid)) return;
    await perform(async () => {
      let failed = 0;
      // Bound concurrent writes; preserve native three-decimal prices and IDs.
      for (let index = 0; index < changes.length; index += 6) {
        const results = await Promise.allSettled(changes.slice(index, index + 6).map(row => apiClient.patch(`/admin/outcomes/${encodeURIComponent(row.outcome.id)}/odds`, { odds: row.next })));
        failed += results.filter(result => result.status === 'rejected').length;
      }
      if (failed) throw new Error(`U konfirmuan ${changes.length - failed} nga ${changes.length} kuota. ${failed} nuk u konfirmuan; kontrollo gjendjen e rifreskuar përpara një veprimi tjetër.`);
    }, `U përditësuan ${changes.length} kuota.`, true);
  };
  const settleMatch = async (homeScore: number, awayScore: number) => {
    if (dialog?.kind !== 'settle') return;
    await perform(() => apiClient.post(`/admin/matches/${encodeURIComponent(dialog.match.id)}/settle`, { homeScore, awayScore }), tr('Rezultati u ruajt dhe skedinat u përditësuan.'), true);
  };

  const bulkCountries = useMemo(() => [...new Set(matches.map(match => match.tournament?.category?.name?.trim()).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b)), [matches]);
  const bulkCompetitions = useMemo(() => [...new Map(matches
    .filter(match => match.tournament?.category?.name === bulkCountry && competitionKey(match))
    .map(match => [competitionKey(match), match.tournament?.name ?? tr('Pa kampionat')]))]
    .sort((a, b) => a[1].localeCompare(b[1])), [matches, bulkCountry]);
  const bulkMarketCategories = [
    ['all', 'Të gjitha tregjet'], ['totals', 'Totale'], ['results', 'Rezultati / 1X2'],
    ['goals', 'Gola'], ['intervals', 'Intervale'], ['corners', 'Këndore'], ['cards', 'Kartona'],
    ['fouls', 'Faulle'], ['shots', 'Goditje'], ['players', 'Lojtarë'], ['combos', 'Kombinime'], ['other', 'Të tjera'],
  ] as const;
  const runBulkMarketAction = async () => {
    if (!bulkCountry || !bulkCompetition || bulkBusy) return;
    const competitionName = bulkCompetitions.find(([key]) => key === bulkCompetition)?.[1] ?? '';
    const actionLabel = bulkAction === 'suspend' ? tr('pezullohen') : tr('rihapen');
    const categoryLabel = tr(bulkMarketCategories.find(([key]) => key === bulkCategory)?.[1] ?? 'Të gjitha tregjet');
    if (!window.confirm(`${tr('Konfirmo veprimin masiv')}: ${categoryLabel}, ${competitionName}, ${bulkCountry}. ${tr('Tregjet do të')} ${actionLabel}.`)) return;
    setBulkBusy(true); setError(''); setNotice('');
    try {
      const response = await apiClient.post('/admin/markets/bulk-suspend', {
        country: bulkCountry,
        competitionId: bulkCompetition,
        category: bulkCategory,
        suspended: bulkAction === 'suspend',
      });
      const count = Number(response.data.count) || 0;
      setNotice(`${bulkAction === 'suspend' ? 'U pezulluan' : 'U rihapën'} ${count} tregje.`);
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure, tr('Veprimi masiv dështoi.')));
    } finally {
      if (mounted.current) setBulkBusy(false);
    }
  };

  const competitions = useMemo(() => [...new Map(matches.filter(match => competitionKey(match)).map(match => [competitionKey(match), match.tournament?.name ?? tr('Pa kampionat')])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [matches]);
  const filtered = useMemo(() => matches.filter(match => {
    const text = searchText(`${match.homeTeam} ${match.awayTeam} ${match.tournament?.name ?? ''} ${match.id}`);
    return (!query.trim() || text.includes(searchText(query.trim()))) && (status === 'ALL' || matchStatus(match) === status)
      && (competition === 'ALL' || competitionKey(match) === competition)
      && (suspension === 'ALL' || Boolean(match.isSuspended) === (suspension === 'SUSPENDED'));
  }), [matches, query, status, competition, suspension]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const selected = detail && detail.id === selectedId ? detail : null;
  const controlsBlocked = busy || bulkBusy || detailLoading || detailStale;
  const shownError = adminUiError(error || detailError || listError, lang);
  const markets = selected?.markets ?? [];
  const categoryCounts = new Map(categories.map(key => [key, markets.filter(market => marketCategoryOf(market) === key).length]));
  const marketTitle = (market: Market) => formatMarketSelectionLabel(market.name, market.line, t);
  const outcomeTitle = (outcome: Outcome, market: Market) => formatTicketSelection(outcome.name, market.name, selected ? fixtureName(selected) : '', t, outcome.code, market.line);
  const filteredMarkets = markets.filter(market => (category === 'all' || marketCategoryOf(market) === category)
    && (marketState === 'ALL' || market.status === marketState)
    && (!marketQuery.trim() || searchText(`${marketTitle(market)} ${market.name} ${market.line ?? ''} ${(market.outcomes ?? []).map(outcome => outcomeTitle(outcome, market)).join(' ')}`).includes(searchText(marketQuery.trim()))));
  const chooseMatch = (match: Match) => {
    if (actionRunning.current) return;
    if (selection.current !== match.id) { detailAvailable.current = false; setDetailStale(true); setDetailError(''); }
    selection.current = match.id;
    setSelectedId(match.id); setMobileDetail(true);
    setMarketQuery(''); setCategory('all'); setMarketState('ALL'); setError('');
  };
  const openDialog = (value: ControlDialog) => { setError(''); setNotice(''); setDialog(value); };
  const adjustDialog = (scope: 'match' | 'market', id: string, title: string, outcomes: Outcome[]) => {
    if (selected) openDialog({ kind: 'adjust', match: selected, scope, id, title, outcomes });
  };

  return <section className="match-control" data-mobile-detail={mobileDetail} aria-busy={busy || bulkBusy || undefined}>
    <header className="mc-heading">
      <div><div className="mc-eyebrow"><SlidersHorizontal size={14} />{' '}{tr("ADMINISTRIMI I TREGJEVE")}</div><h2>{tr("Ndeshjet dhe koeficientët")}</h2><p>{tr("Gjej ndeshjen, kontrollo tregjet dhe menaxho kuotat në një vend.")}</p></div>
      <button className="mc-button mc-secondary" disabled={busy || refreshing || detailLoading} onClick={() => { setError(''); void refresh(); }}><RefreshCw size={16} className={refreshing ? 'mc-spin' : ''} />{' '}{tr("Rifresko")}</button>
    </header>
    <div className="mc-stats">
      <div><Layers /><strong>{matches.length}</strong><span>{tr("Ndeshje të ngarkuara")}</span></div>
      <div><span className="mc-live-dot" /><strong>{matches.filter(match => matchStatus(match) === 'LIVE').length}</strong><span>{tr("Në lojë")}</span></div>
      <div><Lock /><strong>{matches.filter(match => match.isSuspended).length}</strong><span>{tr("Të pezulluara")}</span></div>
      <div><Filter /><strong>{filtered.length}</strong><span>{tr("Në këtë kërkim")}</span></div>
    </div>
    <div className="mc-toolbar">
      <label className="mc-search"><Search size={18} /><input aria-label={tr("Kërko ndeshje")} placeholder={tr("Kërko ekip, kampionat ose ID…")} value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label={tr("Pastro kërkimin")} onClick={() => setQuery('')}><X size={16} /></button>}</label>
      <label className="mc-auto"><input type="checkbox" aria-label={tr("Rifreskim automatik")} checked={automatic} onChange={event => setAutomatic(event.target.checked)} /><span>{tr("Rifreskim automatik")}<small>{updatedAt ? tr(`Përditësuar ${updatedAt.toLocaleTimeString(lang === 'en' ? 'en-GB' : 'sq-AL', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`) : tr('Çdo 30 sekonda')}</small></span></label>
    </div>
    <div className="mc-filters">
      <label>{tr("Gjendja")}<select aria-label={tr("Gjendja e ndeshjeve")} value={status} onChange={event => setStatus(event.target.value)}><option value="ALL">{tr("Të gjitha ndeshjet")}</option><option value="LIVE">{tr("Në lojë")}</option><option value="PREMATCH">{tr("Para ndeshjes")}</option><option value="ENDED">{tr("Të përfunduara")}</option></select></label>
      <label>{tr("Kampionati")}<select aria-label={tr("Kampionati")} value={competition} onChange={event => setCompetition(event.target.value)}><option value="ALL">{tr("Të gjitha kampionatet")}</option>{competitions.map(([key, label]) => <option key={key} value={key}>{tr(label)}</option>)}</select></label>
      <label>{tr("Pezullimi")}<select aria-label={tr("Pezullimi i ndeshjeve")} value={suspension} onChange={event => setSuspension(event.target.value)}><option value="ALL">{tr("Çdo gjendje")}</option><option value="ACTIVE">{tr("Pa pezullim ndeshjeje")}</option><option value="SUSPENDED">{tr("Të pezulluara")}</option></select></label>
    </div>
    <section className="mc-bulk-controls" aria-label={tr('Pezullim masiv i tregjeve')}>
      <div><strong>{tr('Pezullim masiv i tregjeve')}</strong><small>{tr('Zgjidh vendin, kampionatin dhe kategorinë që do të ndryshosh.')}</small></div>
      <div className="mc-bulk-fields">
        <label>{tr('Shteti')}<select value={bulkCountry} onChange={event => { setBulkCountry(event.target.value); setBulkCompetition(''); }}><option value="">{tr('Zgjidh shtetin')}</option>{bulkCountries.map(country => <option key={country} value={country}>{country}</option>)}</select></label>
        <label>{tr('Kampionati')}<select value={bulkCompetition} onChange={event => setBulkCompetition(event.target.value)} disabled={!bulkCountry}><option value="">{tr('Zgjidh kampionatin')}</option>{bulkCompetitions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <label>{tr('Kategoria e tregut')}<select value={bulkCategory} onChange={event => setBulkCategory(event.target.value)}>{bulkMarketCategories.map(([key, label]) => <option key={key} value={key}>{tr(label)}</option>)}</select></label>
        <label>{tr('Veprimi')}<select value={bulkAction} onChange={event => setBulkAction(event.target.value as 'suspend' | 'open')}><option value="suspend">{tr('Pezullo')}</option><option value="open">{tr('Rihap')}</option></select></label>
        <button type="button" className={`mc-button ${bulkAction === 'suspend' ? 'mc-warning' : 'mc-secondary'}`} disabled={!bulkCountry || !bulkCompetition || bulkBusy || busy} onClick={() => void runBulkMarketAction()}>{bulkBusy ? <Loader2 size={16} className="mc-spin" /> : bulkAction === 'suspend' ? <Lock size={15} /> : <Unlock size={15} />}{bulkBusy ? tr('Po përditësohen tregjet…') : tr('Zbato në bulk')}</button>
      </div>
    </section>
    {shownError && !dialog && <div className="mc-message mc-error" role="alert"><Lock size={17} /><span>{shownError}</span>{!detailError && !listError && <button aria-label={tr("Mbyll njoftimin")} onClick={() => setError('')}><X size={16} /></button>}</div>}
    {notice && <div className="mc-message mc-success" role="status"><CheckCircle2 size={17} /><span>{tr(notice)}</span><button aria-label={tr("Mbyll njoftimin")} onClick={() => setNotice('')}><X size={16} /></button></div>}
    <div className="mc-workspace">
      <aside className="mc-list" data-mobile-hidden={mobileDetail} aria-label={tr("Lista e ndeshjeve")}>
        <div className="mc-list-heading"><strong>{tr("Ndeshjet")}</strong><span>{filtered.length}{' '}{tr("rezultate")}</span></div>
        <div className="mc-list-scroll">
          {loading ? <div className="mc-empty"><Loader2 className="mc-spin" />{tr("Po ngarkohen ndeshjet…")}</div> : !filtered.length ? <div className="mc-empty"><Search />{tr("Nuk u gjet asnjë ndeshje.")}<small>{tr("Provo një emër tjetër ose ndrysho filtrat.")}</small></div> : filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(match => <button className="mc-match" key={match.id} data-admin-match-id={match.id} aria-pressed={selectedId === match.id} disabled={busy} onClick={() => chooseMatch(match)}>
            <span className="mc-match-top"><span className={`mc-badge ${matchStatus(match) === 'LIVE' ? 'mc-live' : ''}`}>{statusLabel(match, lang)}{matchStatus(match) === 'LIVE' && match.currentMinute != null ? ` · ${match.currentMinute}′` : ''}</span><span>#{match.id}</span>{match.isSuspended && <Lock size={13} aria-label={tr("E pezulluar")} />}</span>
            <span className="mc-team"><span>{match.homeTeam}</span><b>{match.homeScore ?? '–'}</b></span><span className="mc-team"><span>{match.awayTeam}</span><b>{match.awayScore ?? '–'}</b></span>
            <span className="mc-match-bottom"><span>{match.tournament?.name ?? tr('Pa kampionat')}</span><ChevronRight size={15} /></span><span className="mc-kickoff"><Clock size={11} />{kickoff(match.startTime, lang)}</span>
          </button>)}
        </div>
        <footer className="mc-pagination"><span>{tr("Faqja")}{' '}{currentPage} / {pages}</span><div><button aria-label={tr("Faqja e mëparshme")} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={17} /></button><button aria-label={tr("Faqja tjetër")} disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={17} /></button></div></footer>
      </aside>
      <div className="mc-detail" data-mobile-hidden={!mobileDetail}>
        <button className="mc-mobile-back" onClick={() => setMobileDetail(false)} disabled={busy}><ArrowLeft size={17} />{tr("Kthehu te ndeshjet")}</button>
        {!selected ? <div className="mc-detail-placeholder"><Layers size={32} /><h3>{detailLoading ? tr('Po ngarkohen tregjet…') : tr('Zgjidh një ndeshje')}</h3><p>{tr("Kuotat dhe kontrollet do të shfaqen këtu.")}</p></div> : <div data-admin-selected-match={selected.id}>
          <section className="mc-fixture">
            <div className="mc-fixture-meta"><span className={`mc-badge ${matchStatus(selected) === 'LIVE' ? 'mc-live' : ''}`}>{statusLabel(selected, lang)}{matchStatus(selected) === 'LIVE' && selected.currentMinute != null ? ` · ${selected.currentMinute}′` : ''}</span><span>#{selected.id}</span>{detailLoading && <Loader2 size={14} className="mc-spin" aria-label={tr("Po rifreskohet ndeshja")} />}</div>
            <div className="mc-fixture-title"><div><h3>{selected.homeTeam}</h3><h3>{selected.awayTeam}</h3></div><div className="mc-score">{selected.homeScore ?? '–'}<span>:</span>{selected.awayScore ?? '–'}</div></div>
            <div className="mc-fixture-subtitle"><Trophy size={13} /><span>{selected.tournament?.name ?? tr('Pa kampionat')}</span><span>· {kickoff(selected.startTime, lang)}</span></div>
            <div className="mc-fixture-actions">
              <button className={`mc-button ${ownLock('match', selected.id) ? 'mc-warning' : 'mc-secondary'}`} data-admin-toggle-match={selected.id} aria-pressed={ownLock('match', selected.id)} disabled={controlsBlocked} onClick={() => toggle('match', selected.id)}>{ownLock('match', selected.id) ? <Unlock size={15} /> : <Lock size={15} />}{ownLock('match', selected.id) ? tr('Hiq pezullimin') : tr('Pezullo ndeshjen')}</button>
              <button className="mc-button mc-secondary" data-admin-adjust-scope="match" data-admin-adjust-id={selected.id} disabled={controlsBlocked || !eligibleOutcomes(markets.flatMap(market => market.outcomes ?? [])).length} onClick={() => adjustDialog('match', selected.id, tr('Të gjitha kuotat e ndeshjes'), markets.flatMap(market => market.outcomes ?? []))}><Percent size={15} />{tr("Rregullo kuotat")}</button>
              <button className="mc-button mc-quiet" disabled={controlsBlocked} onClick={() => perform(() => apiClient.patch('/admin/matches/'+encodeURIComponent(selected.id)+'/visibility', {hidden: !selected.isHidden}), selected.isHidden ? 'Ndeshja u shfaq.' : 'Ndeshja u fsheh.')}>{selected.isHidden ? 'Shfaq ndeshjen' : 'Fshih ndeshjen'}</button>
              <button className="mc-button mc-quiet" disabled={controlsBlocked} onClick={() => openDialog({ kind: 'settle', match: selected })}><Trophy size={15} />{tr("Vendos rezultatin")}</button>
            </div>
            {selected.isSuspended && <p className="mc-lock-note"><Lock size={14} />{ownLock('match', selected.id) ? tr('Ndeshja është pezulluar nga administratori. Tregjet trashëgojnë këtë pezullim.') : tr('Ndeshja është pezulluar nga burimi ose rregullat e sistemit. Heqja e një pezullimi individual nuk e hap ndeshjen.')}</p>}
          </section>
          <section className="mc-market-controls">
            <div className="mc-section-heading"><h3>{tr("Tregjet")}{' '}<span>{markets.length}</span></h3><small>{filteredMarkets.length}{' '}{tr("të shfaqshme")}</small></div>
            <div className="mc-market-search"><label className="mc-search"><Search size={17} /><input aria-label={tr("Kërko treg ose zgjedhje")} placeholder={tr("Kërko treg, zgjedhje ose linjë…")} value={marketQuery} onChange={event => setMarketQuery(event.target.value)} /></label><select aria-label={tr("Gjendja e tregjeve")} value={marketState} onChange={event => setMarketState(event.target.value)}><option value="ALL">{tr("Çdo gjendje")}</option><option value="ACTIVE">{tr("Tregje aktive")}</option><option value="SUSPENDED">{tr("Të pezulluara")}</option></select></div>
            <div className="mc-categories" aria-label={tr("Kategoritë e tregjeve")}><button aria-pressed={category === 'all'} onClick={() => setCategory('all')}>{tr("Të gjitha")}</button>{categories.filter(key => categoryCounts.get(key)).map(key => <button key={key} aria-pressed={category === key} onClick={() => setCategory(key)}>{marketCategoryLabel(key, lang)}</button>)}</div>
          </section>
          <div className="mc-markets">
            {filteredMarkets.slice(0, marketLimit).map(market => <article key={market.id} className={`mc-market ${market.status === 'SUSPENDED' ? 'mc-market-paused' : ''}`} data-admin-market-id={market.id}>
              <header><div><small>{marketCategoryLabel(marketCategoryOf(market), lang)}</small><h4>{marketTitle(market)}</h4>{market.status !== 'ACTIVE' && <span className="mc-paused-text">{market.status === 'SETTLED' ? tr('I përfunduar') : tr('I pezulluar')}</span>}</div><div className="mc-market-actions"><button className="mc-icon-button" title={tr("Rregullo kuotat e tregut")} aria-label={tr(`Rregullo kuotat: ${marketTitle(market)}`)} data-admin-adjust-scope="market" data-admin-adjust-id={market.id} disabled={controlsBlocked || !eligibleOutcomes(market.outcomes ?? []).length} onClick={() => adjustDialog('market', market.id, marketTitle(market), market.outcomes ?? [])}><Percent size={16} /></button><button className={`mc-icon-button ${ownLock('market', market.id) ? 'mc-locked' : ''}`} aria-label={`${ownLock('market', market.id) ? tr('Hiq pezullimin e tregut') : tr('Pezullo tregun')}: ${marketTitle(market)}`} data-admin-toggle-market={market.id} aria-pressed={ownLock('market', market.id)} disabled={controlsBlocked} onClick={() => toggle('market', market.id)}>{ownLock('market', market.id) ? <Unlock size={16} /> : <Lock size={16} />}</button></div></header>
              <div className="mc-outcomes" style={{ gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, market.outcomes?.length ?? 1))}, minmax(0, 1fr))` }}>{(market.outcomes ?? []).map(outcome => {
                const locked = outcome.status !== 'ACTIVE', own = ownLock('outcome', outcome.id), pinned = overrideMap.get(`outcome:${outcome.id}`)?.price != null;
                return <div className={`mc-outcome ${locked ? 'mc-outcome-paused' : ''}`} key={outcome.id} data-admin-outcome-id={outcome.id}>
                  <button className="mc-quote" data-admin-edit-outcome={outcome.id} aria-label={tr(`Ndrysho kuotën: ${outcomeTitle(outcome, market)}`)} disabled={controlsBlocked || !eligibleOutcomes([outcome]).length} onClick={() => openDialog({ kind: 'odds', match: selected, market, outcome })}><span>{outcomeTitle(outcome, market)}</span><strong>{formatOdds(outcome.odds)}</strong><small>{pinned ? tr('E ndryshuar') : tr('Ndrysho kuotën')}<ArrowRight size={10} /></small></button>
                  <div className="mc-outcome-status"><span>{outcome.riskSuspended ? tr('Rreziku') : own ? tr('Pezulluar nga ju') : locked ? tr('E pezulluar') : tr('Aktive')}</span><button data-admin-toggle-outcome={outcome.id} aria-pressed={own} aria-label={`${own ? tr('Hiq pezullimin e kuotës') : tr('Pezullo kuotën')}: ${outcomeTitle(outcome, market)}`} disabled={controlsBlocked} onClick={() => toggle('outcome', outcome.id)}>{own ? <Unlock size={13} /> : <Lock size={13} />}</button></div>
                </div>;
              })}</div>
              {!market.outcomes?.length && <p className="mc-market-empty">{tr("Nuk ka kuota të disponueshme.")}</p>}
            </article>)}
          </div>
          {!filteredMarkets.length && <div className="mc-empty mc-market-empty"><Search /><strong>{markets.length ? tr('Nuk u gjet treg për këto filtra.') : tr('Nuk ka tregje të disponueshme për këtë ndeshje.')}</strong><small>{tr("Rifresko ndeshjen ose ndrysho kërkimin.")}</small></div>}
          {filteredMarkets.length > marketLimit && <button className="mc-more" onClick={() => setMarketLimit(value => value + 20)}>{tr("Shfaq edhe")}{' '}{Math.min(20, filteredMarkets.length - marketLimit)}{' '}{tr("tregje")}<ChevronRight size={16} /></button>}
          <p className="mc-help"><ShieldCheck size={15} /><span>{tr("Butonat e pezullimit ndryshojnë vetëm vendimin e administratorit. Pezullimet e burimit, ndeshjes dhe rrezikut vazhdojnë të zbatohen.")}</span></p>
        </div>}
      </div>
    </div>
    {dialog && <MatchControlDialog key={`${dialog.kind}:${dialog.kind === 'odds' ? dialog.outcome.id : dialog.kind === 'adjust' ? dialog.id : dialog.match.id}`} dialog={dialog} busy={busy} error={shownError} onClose={() => { if (!actionRunning.current) { setDialog(null); setError(''); } }} onSaveOdds={saveOdds} onAdjust={adjustOdds} onSettle={settleMatch} />}
  </section>;
}
