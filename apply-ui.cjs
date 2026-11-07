const fs = require('fs');
const root = 'C:/Users/User/Desktop/faqja-main10.10.26/faqja-main/web/';
function edit(file, fn) { const p=root+file; fs.writeFileSync(p, fn(fs.readFileSync(p,'utf8')), 'utf8'); }
function replace(s,a,b) { if(!s.includes(a)) throw new Error('Missing replacement: '+a.slice(0,100)); return s.replaceAll(a,b); }
edit('src/context/LanguageContext.tsx', s => {
  const start=s.indexOf('  const t = (key: string) => {'); const end=s.indexOf('\n  return (', start);
  s=s.slice(0,start)+`  const lookup = (dict: any, key: string): string | undefined => {
    if (!dict || typeof dict !== 'object') return undefined;
    const exact = Object.keys(dict).find(k => k.toLowerCase() === key.toLowerCase());
    if (exact && typeof dict[exact] === 'string') return dict[exact];
    const dot = key.indexOf('.');
    if (dot < 0) return undefined;
    return lookup(dict[key.slice(0, dot)], key.slice(dot + 1));
  };
  const t = (key: string): string => lookup(dicts[lang], key) ?? lookup(dicts.al, key) ?? key;
`+s.slice(end);
  return replace(s,"localStorage.setItem('lang', lang);", "localStorage.setItem('lang', lang);\n    document.documentElement.lang = lang === 'al' ? 'sq' : lang;");
});
edit('src/i18n/al.ts', s => {
 s=replace(s,"export default {",`export default {
  market_ui: { title: 'Tregjet e ndeshjes', count: 'tregje', all: 'Të gjitha', popular: 'Popullore', goals: 'Gola', corners: 'Korne', cards: 'Kartonë', other: 'Të tjera', search: 'Kërko treg ose linjë…', empty: 'Nuk ka tregje për këtë zgjedhje', empty_hint: 'Ndrysho filtrin ose provo përsëri kur koeficientët të jenë të disponueshëm.', line: 'Linja', period: 'Pjesa' },
  match_status: { ENDED: 'Përfunduar', CANCELLED: 'Anuluar' },
  board: { title: 'Ndeshjet', hint: 'Zgjidh Live ose Para ndeshjes, pastaj sportin dhe kampionatin.', all: 'Të gjitha', live: 'Live', prematch: 'Para ndeshjes', empty: 'Nuk ka ndeshje për filtrat e zgjedhur.' },`);
 s=replace(s,"  common: {",`  common: {
    retry: 'Provo përsëri', load_failed: 'Nuk u ngarkuan të dhënat. Provo përsëri.', refresh_failed: 'Rifreskimi dështoi. Po shfaqen të dhënat e fundit.', reset_filters: 'Pastro filtrat', clear_search: 'Pastro kërkimin', clear_all: 'Hiqi të gjitha', account_menu: 'Menyja e llogarisë', language: 'Gjuha', close: 'Mbyll',`);
 s=replace(s,"  outcomes: {", "  outcomes: {\n    odd: 'Tek', even: 'Çift',");
 s=replace(s,"  markets: {",`  markets: {
    lines: 'linja', 'Match Result': 'Rezultati i ndeshjes', 'Over/Under': 'Mbi / Nën', 'Draw No Bet': 'Barazim pa bast', 'Home Team Total Goals': 'Golat total të vendasve', 'Away Team Total Goals': 'Golat total të mysafirëve', 'Team 1 Total': 'Totali i ekipit 1', 'Team 2 Total': 'Totali i ekipit 2', '1st Half Total Goals': 'Golat e pjesës së parë', '2nd Half Total Goals': 'Golat e pjesës së dytë', '1st half. Total': 'Totali i pjesës së parë', '2nd half. Total': 'Totali i pjesës së dytë', '1st Half Both Teams to Score': 'Të dyja ekipet shënojnë në pjesën e parë', '2nd Half Both Teams to Score': 'Të dyja ekipet shënojnë në pjesën e dytë', 'Corners': 'Korne', 'Cards': 'Kartonë', 'Winner': 'Fituesi', 'Moneyline': 'Fituesi', 'Total Points': 'Pikët total', 'Total Games': 'Lojërat total', 'Total Sets': 'Setet total',`);
 s=replace(s,"  betslip: {", "  betslip: {\n    empty_title: 'Skedina është bosh', empty_hint: 'Zgjidh një koeficient për ta shtuar këtu.',");
 s=s.replaceAll("'Live në Lojë'", "'Live'").replaceAll("'Para-Ndeshje'", "'Para ndeshjes'").replaceAll("'Këndet'", "'Korne'").replaceAll('Lëk', 'Lekë').replaceAll('Kerko', 'Kërko');
 return s;
});
edit('src/pages/SportsbookPage.tsx', s => {
 s=replace(s,"const [isLiveOnly, setIsLiveOnly] = useState<boolean>(false);", "const [matchMode, setMatchMode] = useState<'all' | 'live' | 'prematch'>('all');\n  const isLiveOnly = matchMode === 'live';");
 s=s.replaceAll('    setIsLiveOnly(false);\n','');
 s=replace(s,'    setIsLiveOnly(true);',"    setMatchMode('live');");
 s=replace(s,'  const handleSelectAll = () => {',"  const handleSelectAll = () => {\n    setMatchMode('all');");
 s=replace(s,'selectedSportId={selectedSport}', 'selectedSportId={selectedSport}\n      selectedCategoryId={selectedCategory}\n      matchMode={matchMode}');
 s=replace(s,'<div className="flex-1 overflow-y-auto bg-primary pb-16 lg:pb-0">','<main className="flex-1 min-w-0 overflow-y-auto bg-primary pb-[calc(5rem+env(safe-area-inset-bottom))] xl:pb-0">\n            {!id && <div className="max-w-6xl mx-auto px-3 pt-5 sm:px-6 space-y-4">\n              <div><h1 className="text-xl sm:text-2xl font-bold tracking-tight">{t(\'board.title\')}</h1><p className="mt-1 text-sm text-text-secondary">{t(\'board.hint\')}</p></div>\n              <div className="grid grid-cols-3 gap-2 rounded-2xl bg-secondary border border-white/10 p-1.5" aria-label={t(\'board.title\')}>\n                {([\'all\', \'live\', \'prematch\'] as const).map(mode => <button type="button" key={mode} aria-pressed={matchMode === mode} onClick={() => setMatchMode(mode)} className={`min-h-[48px] rounded-xl px-2 text-xs sm:text-sm font-semibold transition ${matchMode === mode ? \'bg-emerald-500 text-slate-950 shadow-sm\' : \'text-text-secondary hover:bg-white/5 hover:text-white\'}`}>{mode === \'live\' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-2" />}{t(`board.${mode}`)}</button>)}\n              </div>\n              {(selectedSport || selectedCategory || selectedTournament) && <button className="filter-chip" onClick={() => { setSelectedSport(\'\'); setSelectedCategory(\'\'); setSelectedTournament(\'\'); }}>{t(\'sections.all_competitions\')}</button>}\n            </div>}');
 s=replace(s,'                isLiveOnly={isLiveOnly}', '                isLiveOnly={isLiveOnly}\n                matchMode={matchMode}');
 s=replace(s,'          </div>\n\n          {/* betslip:', '          </main>\n\n          {/* betslip:');
 s=replace(s,'className={`flex-1 flex items-center justify-center gap-2 py-3.5 transition-all ${\n              navOpen', 'className={`lg:hidden flex-1 flex items-center justify-center gap-2 py-3.5 transition-all ${\n              navOpen');
 s=replace(s,'<Header onToggleNav={() => setNavOpen((v) => !v)} />', '<Header onToggleNav={() => { setBetslipOpen(false); setNavOpen((v) => !v); }} />');
 s=replace(s,'<div className="w-full py-2 flex justify-center bg-secondary cursor-pointer" onClick={() => setBetslipOpen(false)}>\n                <div className="w-12 h-1.5 rounded-full bg-tertiary hover:bg-slate-500 transition"></div>\n              </div>', '<button type="button" className="w-full min-h-[44px] px-4 flex items-center justify-between bg-secondary text-sm text-text-secondary" onClick={() => setBetslipOpen(false)}><span>{t(\'common.close\')}</span><X size={18} /></button>');
 s=replace(s,'  const handleSelectTournament', `  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setNavOpen(false); setBetslipOpen(false); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);

  const handleSelectTournament`);
 return s;
});
edit('src/components/Sports/MatchList.tsx', s => {
 s=replace(s,'  isLiveOnly?: boolean;', "  isLiveOnly?: boolean;\n  matchMode?: 'all' | 'live' | 'prematch';");
 s=replace(s,'sportId, isLiveOnly }: Props)', "sportId, isLiveOnly, matchMode = 'all' }: Props)");
 s=replace(s,"  const [loading, setLoading] = useState(true);", "  const [loading, setLoading] = useState(true);\n  const [error, setError] = useState(false);\n  const [retry, setRetry] = useState(0);");
 const start=s.indexOf('  const fetchMatches = async () => {'); const end=s.indexOf('  const searchFiltered',start);
 s=s.slice(0,start)+`  useEffect(() => {
    let active = true;
    let pending = false;
    const controller = new AbortController();
    setMatches([]); setLoading(true); setError(false); setExpandedId(null);
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const params: Record<string, string> = {};
        if (tournamentId) params.tournamentId = tournamentId;
        if (categoryId) params.categoryId = categoryId;
        if (sportId) params.sportId = sportId;
        const res = await apiClient.get('/matches', { params, signal: controller.signal });
        if (active) { setMatches(Array.isArray(res.data) ? res.data : []); setError(false); }
      } catch { if (active) setError(true); }
      finally { pending = false; if (active) setLoading(false); }
    };
    void load();
    const interval = setInterval(load, 15000);
    return () => { active = false; controller.abort(); clearInterval(interval); };
  }, [tournamentId, categoryId, sportId, retry]);

  const mode = isLiveOnly ? 'live' : matchMode;
  const modeMatches = matches.map(m => ({ ...m, ...(livePatches[String(m.id)] ?? {}) })).filter(m =>
    (m.status === 'LIVE' || m.status === 'PREMATCH') && (mode === 'all' || m.status === (mode === 'live' ? 'LIVE' : 'PREMATCH'))
  );
`+s.slice(end);
 s=replace(s,'? matches.filter(m => {','? modeMatches.filter(m => {');
 s=replace(s,'    : matches;', '    : modeMatches;');
 s=replace(s,'const search = searchTerm.toLowerCase();','const search = searchTerm.trim().toLowerCase();');
 s=replace(s,"m.status !== 'LIVE'", "m.status === 'PREMATCH'");
 // Retain the filters even when there are no matches or a fetch fails.
 const emptyStart=s.indexOf('  if (matches.length === 0) {'); const emptyEnd=s.indexOf('  const renderMatchCard',emptyStart);
 s=s.slice(0,emptyStart)+s.slice(emptyEnd);
 s=replace(s,"m.tournament?.name || 'League'", "m.tournament?.name || t('sections.league')");
 s=replace(s,'      <div className="bg-secondary/70 backdrop-blur-sm', `      {error && <div role="alert" className="ui-card p-4 text-sm text-amber-300 flex flex-wrap gap-3 items-center justify-between"><span>{t(matches.length ? 'common.refresh_failed' : 'common.load_failed')}</span><button className="filter-chip" onClick={() => setRetry(n => n + 1)}>{t('common.retry')}</button></div>}
      <div className="bg-secondary/70 backdrop-blur-sm`);
 s=replace(s,'placeholder={t(\'common.search_matches\')}', 'aria-label={t(\'common.search_matches\')}\n            placeholder={t(\'common.search_matches\')}');
 s=replace(s,"onClick={() => setSearchTerm('')}", "aria-label={t('common.clear_search')}\n              onClick={() => setSearchTerm('')}");
 s=replace(s,'<span className="hidden sm:inline">Filter:</span>', '<span className="hidden sm:inline">{t(\'common.filter\')}:</span>');
 for(const date of ['all','today','tomorrow']) s=replace(s,`onClick={() => setDateFilter('${date}')}`,`aria-pressed={dateFilter === '${date}'}\n              onClick={() => setDateFilter('${date}')}`);
 s=replace(s,'{filteredMatches.length} {t(\'common.results_found\')}', '{pricedMatches.length} {t(\'common.results_found\')}');
 s=replace(s,"{t('common.no_matches_date')}", "{t('board.empty')}");
 s=replace(s,'{liveMatches.length > 0 && !tournamentId && (','{liveMatches.length > 0 && (');
 s=replace(s,'className="flex-1 cursor-pointer space-y-1.5 min-w-0"','role="link" tabIndex={0} onKeyDown={e => { if (e.key === \'Enter\') navigate(`/match/${m.id}`); }}\n            className="flex-1 cursor-pointer space-y-1.5 min-w-0"');
 s=replace(s,'<span>+{totalMarketsCount}</span>','<span>{t(\'sections.view_markets\')} · {totalMarketsCount}</span>');
 s=replace(s,'md:w-72', 'md:w-56');
 s=replace(s, "quick?.mode === 'btts' ? 'GG/NG'", "quick?.mode === 'btts' ? t('markets.both_teams_score')");
 s=replace(s, "quick?.mode === 'ou' ? 'O/U'", "quick?.mode === 'ou' ? t('markets.over_under')");
 s=replace(s,'      {searchTerm && (',`      {(searchTerm || dateFilter !== 'all') && <button className="filter-chip" onClick={() => { setSearchTerm(''); setDateFilter('all'); }}>{t('common.reset_filters')}</button>}
      {searchTerm && (`);
 return s;
});
edit('src/components/Layout/SportsSidebar.tsx', s => {
 s=replace(s,'  selectedSportId?: string;', "  selectedSportId?: string;\n  selectedCategoryId?: string;\n  matchMode?: 'all' | 'live' | 'prematch';");
 s=replace(s,'  selectedSportId,','  selectedSportId,\n  selectedCategoryId,\n  matchMode,');
 s=replace(s,'!selectedTournamentId && !selectedSportId && !isLiveOnly', "!selectedTournamentId && !selectedSportId && !selectedCategoryId && !isLiveOnly && matchMode !== 'prematch'");
 s=replace(s,'            ALL', "            {t('dates.all')}");
 s=replace(s,'const translatedName = t(`sports.${s.name}`) || s.name;', 'const translatedName = t(`sports.${s.name}`) === `sports.${s.name}` ? s.name : t(`sports.${s.name}`);');
 return s;
});
edit('src/components/Sports/OddsButton.tsx', s => {
 s="import { useLanguage } from '../../context/LanguageContext';\nimport { outcomeLabel, marketLabel } from '../../utils/marketPresentation';\n"+s;
 s=replace(s,'  const { selections,', "  const { t } = useLanguage();\n  const label = outcomeLabel(t, outcome.name);\n  const { selections,");
 s=replace(s,"outcome.status === 'SUSPENDED' ||", "outcome.status !== 'ACTIVE' ||");
 s=replace(s,"market.status === 'SUSPENDED' ||", "market.status !== 'ACTIVE' ||\n    match.status === 'ENDED' || match.status === 'CANCELLED' ||");
 s=replace(s,'currentOdds === null || currentOdds === undefined;', 'currentOdds === null || currentOdds === undefined || !Number.isFinite(currentOdds) || currentOdds <= 1;');
 // REST refreshes must update displayed odds too; subscribe only to this outcome's delta.
 s=replace(s,'  useEffect(() => {\n    const delta = oddsDeltas[outcome.id];', '  useEffect(() => { setCurrentOdds(outcome.odds); }, [outcome.id, outcome.odds]);\n  const delta = oddsDeltas[outcome.id];\n  useEffect(() => {');
 s=replace(s,'  }, [oddsDeltas, outcome.id]);', '  }, [delta, outcome.id]);');
 s=replace(s,'      onClick={toggle}', '      type="button"\n      aria-pressed={isSelected}\n      title={`${marketLabel(t, market.name)} · ${label}${isSuspended ? ` · ${t(\'sections.odds_locked\')}` : \'\'}`}\n      onClick={toggle}');
 s=replace(s,'className={`group relative flex', 'className={`group min-w-0 min-h-[46px] relative flex');
 s=replace(s,'title={outcome.name}', 'title={label}');
 s=replace(s,"{outcome.name?.replace(/^#(\\d+)$/, '$1') || outcome.name}", '{label}');
 return s;
});
edit('src/components/Layout/Header.tsx', s => {
 s=replace(s,'h-14 sm:h-16 flex items-center', 'min-h-[64px] py-2 flex flex-wrap items-center');
 s=replace(s,'<div\n            className="flex items-center gap-2 cursor-pointer group select-none py-1"', '<button type="button"\n            aria-label={t(\'nav.sports\')}\n            className="flex items-center gap-2 cursor-pointer group select-none py-1"');
 s=replace(s,'          </div>\n        </div>\n\n        {/* Right side', '          </button>\n        </div>\n\n        {/* Right side');
 s=replace(s,'value={lang}', 'aria-label={t(\'common.language\')}\n              value={lang}');
 s=replace(s,'aria-label="account menu"', 'aria-label={t(\'common.account_menu\')}\n                aria-expanded={menuOpen}');
 s=s.replaceAll('Lëk', 'Lekë');
 return s;
});
for(const file of ['src/components/Betslip/Betslip.tsx', 'src/pages/MyBetsPage.tsx']) edit(file, s => {
 const path=file.includes('/pages/') ? '../utils/marketPresentation' : '../../utils/marketPresentation';
 s=`import { marketLabel, outcomeLabel } from '${path}';\n`+s;
 s=s.replaceAll('{line.marketName}', '{marketLabel(t, line.marketName)}').replaceAll('{line.outcomeName}', '{outcomeLabel(t, line.outcomeName)}').replaceAll('{line.status}', "{t(`tickets.${line.status.toLowerCase()}`)}").replaceAll('Lëk', 'Lekë');
 if(file.endsWith('Betslip.tsx')) {
   s=s.replaceAll('{s.marketName}', '{marketLabel(t, s.marketName)}').replaceAll('{s.outcomeName}', '{outcomeLabel(t, s.outcomeName)}');
   s=replace(s,'Click on any odds to add selections to your betslip.', "{t('betslip.empty_hint')}");
   s=replace(s,"{t('betslip.no_selections')}", "{t('betslip.empty_title')}");
   s=replace(s,'title="Remove selection"', "title={t('betslip.remove')}");
   s=replace(s,'>System Type</label>', ">{t('betslip.system_type')}</label>");
   s=replace(s,'>Select System</option>', ">{t('betslip.select_system')}</option>");
   s=replace(s,'Login to Bet', "{t('betslip.login_to_bet')}");
   s=replace(s,'Code: {ticket.bookingCode}', "{t('admin.code')}: {ticket.bookingCode}");
   s=replace(s,'+{amount >= 1000', '{amount >= 1000');
   s=replace(s,'flex gap-2 pt-1', 'flex flex-col gap-2 pt-1');
   s=replace(s,'grid-cols-3 sm:grid-cols-6', 'grid-cols-3');
 } else {
   s=s.replaceAll("setActiveTab('active'); fetchTickets();", "setActiveTab('active');").replaceAll("setActiveTab('history'); fetchTickets();", "setActiveTab('history');");
 }
 return s;
});
edit('src/App.tsx', s => {
 s="import { useLanguage } from './context/LanguageContext';\n"+s;
 s=replace(s,'  const { user, isAuthenticated, isLoading } = useAuth();', '  const { user, isAuthenticated, isLoading } = useAuth();\n  const { t } = useLanguage();');
 return replace(s,'<span>Loading...</span>', "<span>{t('common.loading')}</span>");
});
edit('src/index.css', s => s+`
/* Shared, restrained surfaces and usable controls throughout the application. */
@layer base {
  html { color-scheme: dark; }
  body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; line-height: 1.5; }
  button, input, select { font: inherit; }
  button, a, input, select { touch-action: manipulation; }
  button:focus-visible, a:focus-visible, [tabindex]:focus-visible, input:focus-visible, select:focus-visible {
    outline: 2px solid #34d399; outline-offset: 3px;
  }
  button:disabled { cursor: not-allowed; }
}
@layer components {
  .ui-card { @apply rounded-2xl border border-white/10 bg-[#131b2b] shadow-sm; }
  .ui-empty { @apply rounded-2xl border border-dashed border-white/10 bg-[#131b2b]/60 p-8 text-center text-text-secondary; }
  .filter-chip { @apply min-h-[44px] shrink-0 whitespace-nowrap rounded-xl border border-white/10 bg-[#182232] px-3.5 py-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-[#202d42] hover:text-white; }
  .filter-chip-active { @apply border-emerald-500 bg-emerald-500 text-slate-950 hover:bg-emerald-400 hover:text-slate-950; }
}
@media (pointer: coarse) {
  button { min-height: 44px; }
  input, select { min-height: 44px; font-size: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
}
`);
console.log('UI changes applied');
