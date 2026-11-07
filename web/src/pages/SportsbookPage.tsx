import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../components/Layout/Header';
import SportsSidebar, { FootballIcon } from '../components/Layout/SportsSidebar';
import MobileSportsHeader from '../components/Layout/MobileSportsHeader';
import BetslipSidebar from '../components/Layout/BetslipSidebar';
import MatchList from '../components/Sports/MatchList';
import MatchDetail from '../components/Sports/MatchDetail';

import { useBetslip } from '../context/BetslipContext';
import { useLanguage } from '../context/LanguageContext';
import { CalendarDays, Search, ListOrdered, Ticket, X } from 'lucide-react';
import type { MatchViewMode } from '../components/Sports/MatchList';
import { formatOdds } from '../utils/formatOdds';

/**
 * The board. Three columns on a desktop (leagues | matches | betslip); on a phone the two side
 * columns become drawers over the matches, opened from the header and from the bottom bar.
 * The phone frame is anchored to the viewport. Only the match column scrolls,
 * so outer-document scrolling cannot carry the mobile betslip controls away.
 */
export default function SportsbookPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { t,lang } = useLanguage();
  const { selections, totalOdds, ticketType, columns } = useBetslip();
  const [selectedTournament, setSelectedTournament] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedSport, setSelectedSport] = useState<string>('');
  // Shared by icon tabs, the board filters and the side search.
  const [viewMode, setViewMode] = useState<MatchViewMode>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const isLiveOnly = viewMode === 'live';
  const isFavoritesOnly = viewMode === 'favorites';
  // small screens: the leagues drawer and the betslip sheet
  const [navOpen, setNavOpen] = useState(false);
  const [betslipOpen, setBetslipOpen] = useState(false);
  const [sheetViewport, setSheetViewport] = useState<{ height: number; top: number } | null>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (mobileSearchOpen) mobileSearchRef.current?.focus(); }, [mobileSearchOpen]);

  useEffect(() => {
    if (!betslipOpen) return;
    // Mobile keyboards can shrink the visual viewport without changing 100dvh.
    // Keep the whole sheet, including its footer, inside the visible area.
    const viewport = window.visualViewport;
    const resize = () => setSheetViewport({ height: viewport?.height ?? window.innerHeight, top: viewport?.offsetTop ?? 0 });
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    window.addEventListener('resize', resize);
    return () => {
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
      window.removeEventListener('resize', resize);
    };
  }, [betslipOpen]);

  // both are overlays: opening a match closes them
  useEffect(() => {
    setNavOpen(false);
    setBetslipOpen(false);
  }, [id]);

  const handleSelectTournament = (tourId: string) => {
    setSelectedTournament(tourId);
    setSelectedCategory('');
    setSelectedSport('');
    setViewMode('all');
    setNavOpen(false);
    // Navigate back to matches list if on match detail page
    if (id) navigate('/');
  };

  const handleSelectCategory = (catId: string) => {
    setSelectedCategory(catId);
    setSelectedTournament('');
    setSelectedSport('');
    setViewMode('all');
    setNavOpen(false);
    // Navigate back to matches list if on match detail page
    if (id) navigate('/');
  };

  const handleSelectSport = (sportId: string) => {
    setSelectedSport(sportId);
    setSelectedTournament('');
    setSelectedCategory('');
    setViewMode('all');
    setNavOpen(false);
    // Navigate back to matches list if on match detail page
    if (id) navigate('/');
  };

  const handleSelectAll = () => {
    setMobileSearchOpen(false);
    setSearchTerm('');
    setSelectedSport('');
    setSelectedCategory('');
    setSelectedTournament('');
    setViewMode('all');
    setNavOpen(false);
    // Navigate back to matches list if on match detail page
    if (id) navigate('/');
  };

  const handleSelectLive = () => {
    setMobileSearchOpen(false);
    setSearchTerm('');
    setSelectedSport('');
    setSelectedCategory('');
    setSelectedTournament('');
    setViewMode('live');
    setNavOpen(false);
    // Navigate back to matches list if on match detail page
    if (id) navigate('/');
  };

  const handleSelectFavorites = () => {
    setSelectedSport('');
    setSelectedCategory('');
    setSelectedTournament('');
    setViewMode('favorites');
    setNavOpen(false);
    if (id) navigate('/');
  };

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    if (id) navigate('/');
  };

  const sidebar = (
    <SportsSidebar
      selectedTournamentId={selectedTournament}
      selectedCategoryId={selectedCategory}
      selectedSportId={selectedSport}
      isLiveOnly={isLiveOnly}
      isFavoritesOnly={isFavoritesOnly}
      searchTerm={searchTerm}
      onSearchChange={handleSearchChange}
      onSearchSubmit={() => setNavOpen(false)}
      onSelectFavorites={handleSelectFavorites}
      onSelectTournament={handleSelectTournament}
      onSelectSport={handleSelectSport}
      onSelectCategory={handleSelectCategory}
      onSelectAll={handleSelectAll}
      onSelectLive={handleSelectLive}
    />
  );

  return (
    <>
      <div data-sportsbook-shell className="sportsbook-shell zshop-shell flex flex-col overflow-hidden bg-primary xl:bg-[#150a22]">
        <div className="hidden md:block"><Header onToggleNav={() => setNavOpen(v => !v)}/></div>
        <MobileSportsHeader
          onOpenLeagues={() => {setBetslipOpen(false);setNavOpen(v => !v);}}
          onOpenBetslip={() => {setNavOpen(false);setBetslipOpen(v => !v);}}
        />
        <nav className="zshop-sports-strip" aria-label={t('Shkurtoret e sporteve')}>
          <button type="button" onClick={handleSelectAll} aria-pressed={viewMode==='all'}><CalendarDays size={25}/><span>{t('TË GJITHA')}</span></button>
          <button type="button" onClick={handleSelectLive} aria-pressed={isLiveOnly}><FootballIcon size={27}/><span>{t('NË LOJË')}</span></button>
          <button type="button" onClick={()=>setMobileSearchOpen(v=>!v)} aria-expanded={mobileSearchOpen} className="md:hidden"><Search size={25}/><span>{t('Kërko')}</span></button>
          <button type="button" onClick={()=>{handleSelectAll();setViewMode('prematch');}} aria-pressed={viewMode==='prematch'}><CalendarDays size={25}/><span>{lang==='en'?'Prematch':'Para ndeshjes'}</span></button>
          <button type="button" onClick={handleSelectFavorites} aria-pressed={isFavoritesOnly}><Ticket size={25}/><span>{t('FAVORITET')}</span></button>
          <button type="button" className="zs-strip-extra" onClick={()=>navigate('/casino')}><img src={import.meta.env.BASE_URL+'zshop/casino.png'} alt="" width="42" height="27" className="h-[27px] w-[42px] object-contain"/><span>{t('KAZINO')}</span></button>
        </nav>
        {mobileSearchOpen && (
          <form role="search" onSubmit={e => {e.preventDefault();mobileSearchRef.current?.blur();}}
            className="flex shrink-0 items-center gap-2 border-b border-[#62417d] bg-[#25133c] p-2 md:hidden">
            <Search size={19} className="shrink-0 text-purple-200"/>
            <input ref={mobileSearchRef} type="search" value={searchTerm}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder={t("Kërko ndeshje ose kampionat")} aria-label={t("Kërko ndeshje")}
              className="h-9 min-w-0 flex-1 rounded-xl border border-[#62417d] bg-[#1a0c28] px-3 text-sm text-white outline-none placeholder:text-purple-300/50 focus:border-purple-400"/>
            <button type="button" className="p-1 text-purple-200 hover:text-white"
              aria-label={searchTerm ? t("Pastro kërkimin") : 'Mbyll kërkimin'}
              onClick={() => searchTerm ? handleSearchChange('') : setMobileSearchOpen(false)}><X size={19}/></button>
          </form>
        )}

        <div className="min-h-0 flex-1 flex overflow-hidden">
          {/* leagues: always there from lg up, a drawer below that */}
          <div className="hidden lg:flex">{sidebar}</div>

          <div data-sportsbook-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-primary pb-0 md:pb-16 xl:pb-0 xl:border-x xl:border-[#462d5e] xl:bg-[#170c24]">
            {id ? (
              <MatchDetail />
            ) : (
              <MatchList
                tournamentId={selectedTournament}
                categoryId={selectedCategory}
                sportId={selectedSport}
                isLiveOnly={isLiveOnly}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                searchTerm={searchTerm}
                onSearchChange={handleSearchChange}
              />
            )}
          </div>

          {/* betslip: a rail from xl up, a bottom sheet below that */}
          <div className="hidden min-h-0 xl:flex" data-betslip-rail>
            <BetslipSidebar />
          </div>
        </div>

        {/* small screens: modern bottom navigation dock */}
        <div className="hidden md:flex xl:hidden fixed bottom-0 inset-x-0 z-30 bg-secondary/95 backdrop-blur-sm border-t border-tertiary/80 flex items-stretch text-xs font-bold shadow-2xl pb-[env(safe-area-inset-bottom)]">
          <button
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 transition-all ${
              navOpen ? 'text-accent-yellow bg-primary/40' : 'text-text-secondary active:bg-tertiary/60'
            }`}
            onClick={() => {
              setBetslipOpen(false);
              setNavOpen((v) => !v);
            }}
          >
            <ListOrdered size={16} className={navOpen ? 'text-accent-yellow' : 'text-text-secondary'} />
            <span className="tracking-wide">{t('nav.sports')}</span>
          </button>
          <button
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 transition-all ${
              selections.length > 0
                ? 'bg-accent-yellow text-[#17212c] font-bold'
                : 'text-text-secondary bg-primary/50 active:bg-tertiary/60'
            }`}
            onClick={() => {
              setNavOpen(false);
              setBetslipOpen((v) => !v);
            }}
          >
            <Ticket size={16} />
            <span>{t('betslip.betslip')}</span>
            {selections.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-primary text-accent-yellow border border-primary/20">
                {selections.length}
              </span>
            )}
            {selections.length > 0 && (
              <span className="text-[10px] font-mono font-black bg-primary/20 rounded px-1.5 py-0.5">
                {ticketType==='SYSTEM' ? `Sistem · ${columns.length} kolona` : `@${formatOdds(totalOdds)}`}
              </span>
            )}
          </button>
        </div>

        {/* leagues drawer */}
        {navOpen && (
          <div className="lg:hidden fixed inset-0 z-40 flex bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setNavOpen(false)}>
            <div className="relative h-full animate-in slide-in-from-left duration-250 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              {sidebar}
              <button
                className="absolute top-2 -right-11 p-2 rounded-full bg-primary/80 hover:bg-primary border border-tertiary/80 text-white shadow-lg transition"
                onClick={() => setNavOpen(false)}
                aria-label={t('common.cancel')}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* betslip sheet */}
        {betslipOpen && (
          <div className="xl:hidden fixed inset-0 z-40 flex items-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            style={sheetViewport ? { top: sheetViewport.top, height: sheetViewport.height, bottom: 'auto' } : undefined}
            onClick={() => setBetslipOpen(false)}>
            <div data-betslip-sheet role="dialog" aria-modal="true" aria-label={t('betslip.betslip')}
              className="h-[92%] min-h-0 max-h-full w-full bg-secondary rounded-t-sm border-t border-tertiary/90 overflow-hidden shadow-2xl flex flex-col animate-in slide-in-from-bottom duration-250" onClick={(e) => e.stopPropagation()}>
              {/* Sheet handle bar */}
              <button
                type="button"
                className="flex w-full shrink-0 justify-center bg-secondary py-2"
                onClick={() => setBetslipOpen(false)}
                aria-label={t('common.cancel')}
              >
                <span className="h-1.5 w-12 rounded-full bg-tertiary transition hover:bg-slate-500" />
              </button>
              <BetslipSidebar className="min-h-0 w-full flex-1 overflow-hidden" />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

