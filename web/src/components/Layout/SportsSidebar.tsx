import { useEffect, useState } from 'react';
import { apiClient } from '../../api/client';
import { useLiveFeed } from '../../api/liveFeed';
import { useLanguage } from '../../context/LanguageContext';
import {
  CalendarDays, ChevronDown, ChevronRight, Search, X, Star,
  Dribbble, Target, Circle, Trophy,
} from 'lucide-react';
import { isMainFootballCompetition } from '../../utils/sportsbookFilters';
import CountryFlag from '../Sports/CountryFlag';

interface Props {
  selectedTournamentId?: string;
  selectedCategoryId?: string;
  selectedSportId?: string;
  isLiveOnly?: boolean;
  isFavoritesOnly?: boolean;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit?: () => void;
  onSelectTournament: (id: string) => void;
  onSelectSport: (id: string) => void;
  onSelectCategory: (id: string) => void;
  onSelectAll: () => void;
  onSelectLive: () => void;
  onSelectFavorites: () => void;
}

/** White outlined football, like the supplied compact sportsbook navigation. */
export function FootballIcon({size=25}:{size?:number}){return <img src={import.meta.env.BASE_URL+'zshop/football.svg'} width={size} height={size} alt="" aria-hidden="true"/>;}

const sportIcons: Record<string, typeof Trophy> = {
  Basketball: Dribbble, Tennis: Target, 'Ice Hockey': Circle,
  Volleyball: Circle,
};

type SportItem = {
  id: string | number;
  name: string;
  categories?: {
    id: string | number;
    name: string;
    countryCode?: string;
    tournaments?: { id: string | number; name: string;protectedPrematch?:boolean }[];
  }[];
};

export default function SportsSidebar({
  selectedTournamentId, selectedCategoryId, selectedSportId,
  isLiveOnly, isFavoritesOnly, searchTerm, onSearchChange, onSearchSubmit,
  onSelectTournament, onSelectSport, onSelectCategory,
  onSelectAll, onSelectLive, onSelectFavorites,
}: Props) {
  const { t } = useLanguage();
  const { refreshVersion } = useLiveFeed();
  const [sports, setSports] = useState<SportItem[]>([]);
  const [expandedSports, setExpandedSports] = useState<Record<string, boolean>>({});
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    const accept = (data: SportItem[]) => {
      if (!alive) return;
      const items = Array.isArray(data) ? data : [];
      setSports(items);
      setExpandedSports(prev => ({
        ...Object.fromEntries(items.filter(s => s.name === 'Football').map(s => [String(s.id), true])),
        ...prev,
      }));
    };
    const controller = new AbortController();
    const options = {signal:controller.signal, params:{_snapshot:Date.now()}};
    apiClient.get('/sports',options)
      .then(res => accept(res.data))
      .catch(() => { if (alive) void apiClient.get('/sports/tree',options).then(res => accept(res.data)).catch(error => {if(alive)console.error(error);}); });
    return () => { alive = false; controller.abort(); };
  }, [refreshVersion]);

  const isAllActive = !selectedTournamentId && !selectedCategoryId &&
    !selectedSportId && !isLiveOnly && !isFavoritesOnly;

  return (
    <aside className="zshop-sidebar flex h-full w-[230px] shrink-0 select-none flex-col border-r border-[#101923] bg-[#192330] text-white xl:w-[242px]" aria-label={t("Sportet dhe kampionatet")}>
      {/* Three short icon tabs: the reference photo uses this compact navigation. */}
      <div className="grid shrink-0 grid-cols-3 border-b border-[#344254] bg-[#0e1622]">
        <button type="button" onClick={onSelectAll} aria-pressed={isAllActive}
          className={`relative flex min-h-[65px] flex-col items-center justify-center gap-1 border-b-[3px] px-0.5 pt-2 text-center transition-colors hover:bg-[#263141] ${isAllActive ? 'border-[#e5a900]' : 'border-transparent'}`}>
          <CalendarDays size={26} strokeWidth={2.2} aria-hidden="true"/>
          <span className="text-[9px] font-extrabold uppercase leading-tight tracking-tight">{t('sports.all')}</span>
        </button>
        <button type="button" onClick={onSelectLive} aria-pressed={!!isLiveOnly}
          className={`relative flex min-h-[65px] flex-col items-center justify-center gap-1 border-b-[3px] px-0.5 pt-2 text-center transition-colors hover:bg-[#263141] ${isLiveOnly ? 'border-[#e5a900]' : 'border-transparent'}`}>
          <span className="relative">
            <FootballIcon/>
            <span className="absolute -right-5 -top-1 rounded-[2px] bg-[#2e8b48] px-[3px] py-px text-[9px] font-extrabold leading-none text-white">{t("TANI")}</span>
          </span>
          <span className="text-[9px] font-extrabold uppercase leading-tight tracking-tight">{t("FUTBOLL")}</span>
        </button>
        <button type="button" onClick={onSelectFavorites} aria-pressed={!!isFavoritesOnly}
          className={`relative flex min-h-[65px] flex-col items-center justify-center gap-1 border-b-[3px] px-0.5 pt-2 text-center transition-colors hover:bg-[#263141] ${isFavoritesOnly ? 'border-[#e5a900]' : 'border-transparent'}`}>
          <span className="flex h-[25px] w-[25px] items-center justify-center rounded-full border border-white/90"><Star size={16} strokeWidth={1.8}/></span>
          <span className="text-[9px] font-extrabold uppercase leading-tight tracking-tight">{t("FAVORITET")}</span>
        </button>
      </div>

      {/* Sidebar match search: filters the central match list, not merely this tree. */}
      <div className="shrink-0 border-b border-[#121c2a] bg-[#536073] p-[5px]">
        <label htmlFor="sidebar-match-search" className="mb-1 block text-[12px] font-medium text-white">{t("Kërko Ndeshje")}</label>
        <div className="flex h-[34px] items-center gap-2 border border-[#8291a5] bg-[#1b2533] px-2 focus-within:border-[#dcae51]">
          <Search size={17} strokeWidth={2.7} className="shrink-0 text-[#d4dde7]" aria-hidden="true"/>
          <input id="sidebar-match-search" type="search" value={searchTerm}
            onChange={e => onSearchChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); onSearchSubmit?.(); } }}
            placeholder={t("Kërko")}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-white placeholder-[#78879a] outline-none [appearance:textfield] [&::-webkit-search-cancel-button]:hidden"
          />
          {searchTerm && (
            <button type="button" onClick={() => onSearchChange('')} aria-label={t("Pastro kërkimin")}
              className="shrink-0 text-[#c3d2e2] transition-colors hover:text-white">
              <X size={17} strokeWidth={3}/>
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[5px] py-2 [scrollbar-color:#657285_#192330] [scrollbar-width:thin]">
        {sports.map(s => {
          const sportId = String(s.id);
          const isFootball = s.name.toLowerCase() === 'football';
          const open = expandedSports[sportId] ?? isFootball;
          const isSportSelected = selectedSportId === sportId;
          const Icon = sportIcons[s.name] ?? Trophy;
          const categories = (s.categories ?? []).map(category => ({
            ...category,
            tournaments: isFootball
              ? (category.tournaments ?? []).filter(tour => tour.protectedPrematch || isMainFootballCompetition(tour.name, category.name))
              : (category.tournaments ?? []),
          })).filter(cat => cat.tournaments.length > 0);
          return (
            <section key={sportId} className="mb-2 border border-[#111b28]">
              <div data-sports-group-heading className={`flex h-[30px] items-center bg-[#4c596c] text-[12px] ${isSportSelected ? 'font-bold text-white' : 'text-[#e4ebf4]'}`}>
                <button type="button" onClick={() => onSelectSport(sportId)}
                  aria-pressed={isSportSelected}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left hover:text-white">
                  {isFootball ? <FootballIcon size={15}/> : <Icon size={15}/>}
                  <span className="truncate">{t(`sports.${s.name}`) || s.name}</span>
                </button>
                <button type="button" onClick={() => setExpandedSports(prev => ({...prev,[sportId]:!open}))}
                  aria-label={`${open ? t("Mbyll") : t("Hap")} ${s.name}`} aria-expanded={open}
                  className="flex h-full shrink-0 items-center gap-[3px] px-[6px] text-[#d9e2ed] hover:bg-[#607087]">
                  <span className="h-[15px] w-[15px] border border-[#bac5d2]"/>
                  {open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
                </button>
              </div>
              {open && (
                <div data-sports-country-list className="bg-[#202a38]">
                  {isFootball && (
                    <button type="button" onClick={onSelectLive}
                      className={`flex h-[34px] w-full items-center justify-between border-b border-[#151e29] px-2 text-left text-[12px] font-semibold text-white transition-colors hover:bg-[#387548] ${isLiveOnly ? 'bg-[#347c41]' : 'bg-[#2c6335]'}`}>
                      <span>{t("Drejtpërdrejt")}</span><ChevronDown size={13} fill="currentColor"/>
                    </button>
                  )}
                  {categories.map(category => {
                    const categoryId = String(category.id);
                    const selected = selectedCategoryId === categoryId;
                    const expanded = !!expandedCategories[categoryId];
                    return (
                      <div key={categoryId} className="border-b border-[#101923] last:border-b-0">
                        <div data-sports-country-row data-selected={selected} className={`flex min-h-[29px] items-center text-[12px] transition-colors hover:bg-[#314154] ${selected ? 'bg-[#344759] text-white' : 'text-[#c3cfde]'}`}>
                          <button type="button" aria-label={`Filtro ${category.name}`}
                            onClick={() => onSelectCategory(categoryId)} aria-pressed={selected}
                            className="flex h-[29px] shrink-0 items-center px-[6px]">
                            <span className={`flex h-[16px] w-[16px] items-center justify-center border border-[#a3b2c4] text-[11px] ${selected ? 'border-[#e3ad31] bg-[#e3ad31] text-[#17212d]' : ''}`}>
                              {selected ? '✓' : ''}
                            </span>
                          </button>
                          <button type="button" onClick={() => onSelectCategory(categoryId)}
                            className="flex min-w-0 flex-1 items-center gap-1.5 px-[6px] py-[6px] text-left">
                            <CountryFlag country={category.name} countryCode={category.countryCode}/><span className="truncate">{category.name}</span>
                          </button>
                          <button type="button" onClick={() => setExpandedCategories(prev => ({...prev,[categoryId]:!expanded}))}
                            aria-label={`${expanded ? t("Mbyll") : t("Hap")} ligat e ${category.name}`}
                            aria-expanded={expanded}
                            className="flex h-[29px] items-center px-[7px] hover:bg-[#46576a]">
                            {expanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
                          </button>
                        </div>
                        {expanded && (
                          <div data-sports-league-list className="border-t border-[#152232] bg-[#151f2c]">
                            {category.tournaments.map(tour => {
                              const selected = selectedTournamentId === String(tour.id);
                              return (
                                <button type="button" key={tour.id} onClick={() => onSelectTournament(String(tour.id))}
                                  data-sports-league-row aria-pressed={selected} title={tour.name}
                                  className={`flex min-h-[28px] w-full items-center gap-2 px-[7px] py-1 text-left text-[11px] transition-colors hover:bg-[#2d3d50] ${selected ? 'font-bold text-[#f2bc42]' : 'text-[#b9c6d7]'}`}>
                                  <span className={`h-[13px] w-[13px] shrink-0 border ${selected ? 'border-[#f2bc42] bg-[#f2bc42]' : 'border-[#78889e]'}`}/>
                                  <span className="truncate">{tour.name}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {categories.length === 0 && (
                    <div className="px-2 py-3 text-[11px] text-[#9aa8ba]">{t("Nuk ka liga të disponueshme")}</div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
