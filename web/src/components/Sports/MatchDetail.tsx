import ViewportList from './ViewportList';
import {useFeedScope} from '../../api/feedScope';
import ZshopScoreboard from '../Tracker/ZshopScoreboard';
import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Trophy, Sparkles, Flame, Clock, Flag, 
  ShieldAlert, ChevronDown, ChevronUp, Star, Bell, BellRing, 
  Search, X, Layers, Layers2
} from 'lucide-react';
import { apiClient } from '../../api/client';
import { Match, Market } from '../../types';
import OddsButton from './OddsButton';
import MarketInfoButton from './MarketInfoButton';
import CountryFlag from './CountryFlag';
import ComboOddsGrid from './ComboOddsGrid';
import PitchTracker from '../Tracker/PitchTracker';
import { useLanguage } from '../../context/LanguageContext';
import { useLivePatch, useLiveFeed } from '../../api/liveFeed';
import { liveMatch } from '../../api/matchSync';
import { filterDecidedOutcomes, isMarketVisible, isOutcomeDisplayable } from '../../utils/marketExpiry';
import { formatMarketLine } from '../../utils/sportsbookLabels';
import { marketBaseName, marketCategoryOf, isHandicapMarket, isIdentifiedMarket, marketCategoryLabel, marketDisplayTitle, marketGroupKey, marketLineValue, marketSelectionLabel } from '../../utils/marketCatalog';
import type { MarketCategory, MarketLanguage } from '../../utils/marketCatalog';
import {marketRank} from '../../../../server/market-catalog.mjs';
import { useFavorites } from '../../context/FavoritesContext';
import { isComboMarket } from '../../utils/comboPolicy';

// MatchDetail keeps its original tab IDs, but uses the same canonical
// classification and localized labels as MarketPanel.
const CATEGORY_KEY: Record<string, MarketCategory> = {
  Popular: 'main', Goals: 'goals', Mixed: 'mixed', Halves: 'htft',
  Corners: 'corners', Cards: 'cards',
  Players: 'players', Other: 'other',
};
const getGroupCategory = (market: Market): string => {
  const category = marketCategoryOf(market);
  return Object.keys(CATEGORY_KEY).find((key) => CATEGORY_KEY[key] === category) ?? 'Other';
};
const categoryLabel = (category: string, lang: MarketLanguage): string =>
  marketCategoryLabel(CATEGORY_KEY[category] ?? 'other', lang);
const CATEGORY_ORDER = ['Popular', 'Goals', 'Mixed', 'Halves', 'Corners', 'Cards', 'Players', 'Other'];

const getCategoryIcon = (catId: string) => {
  switch (catId) {
    case 'Popular': return <Trophy size={13} className="text-amber-400" />;
    case 'Goals': return <Flame size={13} className="text-orange-400" />;
    case 'Mixed': return <Layers size={13} className="text-amber-300" />;
    case 'Halves': return <Clock size={13} className="text-purple-400" />;
    case 'Corners': return <Flag size={13} className="text-blue-400" />;
    case 'Cards': return <ShieldAlert size={13} className="text-rose-400" />;
    default: return <Sparkles size={13} className="text-accent-green" />;
  }
};

const getMarketIcon = (category: string, title: string) => {
  const t = title.toLowerCase();
  if (category === 'Mixed') return <Layers size={14} className="text-amber-300 shrink-0" />;
  if (category === 'Cards' || /card|karton/i.test(t)) return <ShieldAlert size={14} className="text-rose-400 shrink-0" />;
  if (category === 'Corners' || /corner|kënd/i.test(t)) return <Flag size={14} className="text-blue-400 shrink-0" />;
  if (category === 'Halves' || /half|pjes/i.test(t)) return <Clock size={14} className="text-purple-400 shrink-0" />;
  if (category === 'Goals' || /goal|score|gola/i.test(t)) return <Flame size={14} className="text-orange-400 shrink-0" />;
  return <Trophy size={14} className="text-accent-yellow shrink-0" />;
};

// Do not deduplicate by the label: different selections can legitimately have
// the same provider text while carrying distinct outcome ids.
const dedupeOutcomes = (outcomes: any[] = []) => {
  const seen = new Set<string>();
  return outcomes.filter((outcome) => {
    const id = String(outcome.id ?? '');
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

interface GroupedMarket {
  baseName: string;
  title: string;
  category: string;
  markets: Market[];
}

const groupMarkets = (markets: Market[], lang: MarketLanguage): GroupedMarket[] => {
  const groups = new Map<string, Market[]>();
  for (const market of markets) {
    if (!isIdentifiedMarket(market) || isHandicapMarket(market)) continue;
    const key = marketGroupKey(market);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(market);
  }
  const rankedLine = (market: Market): number => {
    const raw = marketLineValue(market);
    if (!raw) return Number.POSITIVE_INFINITY;
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  };
  const result: GroupedMarket[] = [];
  for (const [key, entries] of groups) {
    entries.sort((a, b) => rankedLine(a) - rankedLine(b));
    result.push({
      baseName: key,
      title: marketDisplayTitle({...entries[0],name:marketBaseName(entries[0]),line:''}, lang),
      category: getGroupCategory(entries[0]),
      markets: entries,
    });
  }
  return result.sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
};

export default function MatchDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, lang } = useLanguage();
  const [match, setMatch] = useState<Match | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [requestSearch,setRequestSearch]=useState('');
  const [categoryLoading,setCategoryLoading]=useState(false);
  const [categoryTotals,setCategoryTotals]=useState<Record<string,number>>({});
  const [requestError,setRequestError]=useState<{id:string;notFound:boolean;httpStatus:number|null;timedOut:boolean}|null>(null);
  const requestedCategory=requestSearch||activeTab==='favorites'?'all':activeTab;
  const [marketSearch, setMarketSearch] = useState<string>('');
  useEffect(()=>{
    setMatch(null);setMarkets([]);setCategoryTotals({});setCollapsedGroups({});setRequestError(null);
    setActiveTab('all');setMarketSearch('');setRequestSearch('');
  },[id]);
  useEffect(()=>{const timer=setTimeout(()=>setRequestSearch(marketSearch.trim()),250);return()=>clearTimeout(timer);},[marketSearch]);
  useFeedScope('detail',{detail:id?{id,category:requestedCategory}:null,selectionIds:markets.flatMap(m=>(m.builderLegs??[]).map(p=>p.outcomeId))});
  const [favoriteMarkets,setFavoriteMarkets]=useState<string[]>(()=>{try{const saved=JSON.parse(localStorage.getItem('app_favorite_markets')??'[]');return Array.isArray(saved)?saved.filter(v=>typeof v==='string'):[];}catch{return [];}});
  const favoriteKey=(key:string)=>id+'|'+key;
  const toggleMarketFavorite=(key:string)=>setFavoriteMarkets(old=>{const value=favoriteKey(key),next=old.includes(value)?old.filter(v=>v!==value):[...old,value];try{localStorage.setItem('app_favorite_markets',JSON.stringify(next));}catch{}return next;});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const { isFavorite, toggleFavorite, isAlertEnabled, toggleAlert } = useFavorites();
  const patch = useLivePatch(id);
  const { lockedMarkets, lockedOutcomes, riskLockedOutcomes, combosEnabled, refreshVersion, acceptMatches } = useLiveFeed();
  const refreshRef = useRef<((force?:boolean) => void) | null>(null);
  const lastRefreshVersion = useRef(refreshVersion);
  // The live clock pushes seconds every tick. Only facts relevant to market
  // expiry should rebuild all market groups, not an unrelated second counter.
  const liveMarketMatch = useMemo(
    () => match && String(match.id)===id ? (match.status==='ENDED'?match:liveMatch(match, patch)) : null,
    [match,id,patch?.homeScore,patch?.awayScore,patch?.scoreAt,patch?.currentMinute,patch?.period,patch?.status,patch?.isSuspended,patch?.corners,patch?.cards,patch?.shots,patch?.shotsOnTarget,patch?.fouls],
  );

  useEffect(() => {
    if (!id) return;
    let active = true;
    const requestState = {controller: null as AbortController | null};
    let sequence = 0;
    const refresh = (force = false) => {
      if (!active) return;
      // A manual retry cancels the stale request and starts a brand-new HTTP
      // attempt. Automatic 20s refreshes instead avoid overlapping requests.
      if (requestState.controller) {
        if (!force) return;
        requestState.controller.abort();
      }
      const current = new AbortController();
      requestState.controller = current;
      const requestId = ++sequence;
      setCategoryLoading(true);
      apiClient.get(`/matches/${id}`, {
        signal: current.signal,
        timeout: 12000,
        params: { category: requestedCategory, _snapshot: Date.now() },
      }).then(res => {
        if (!active || requestId !== sequence || current.signal.aborted) return;
        if (String(res.data?.id) !== id) throw new Error('MATCH_RESPONSE_MISMATCH');
        setRequestError(null);
        acceptMatches([res.data]);
        setMatch(res.data);
        setCategoryTotals(res.data.marketCategories ?? {});
        if (requestedCategory === 'Popular' && res.data.marketCategories?.Popular === 0) {
          const next = CATEGORY_ORDER.find(category => res.data.marketCategories[category] > 0);
          if (next) setActiveTab(next);
        }
        setMarkets(res.data?.markets ?? []);
      }).catch(error => {
        if (!active || requestId !== sequence || current.signal.aborted ||
            error?.code === 'ERR_CANCELED') return;
        const httpStatus = Number(error?.response?.status);
        setRequestError({
          id,
          notFound: httpStatus === 404,
          httpStatus: Number.isInteger(httpStatus) && httpStatus > 0 ? httpStatus : null,
          timedOut: error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT',
        });
      }).finally(() => {
        if (!active || requestId !== sequence) return;
        if (requestState.controller === current) requestState.controller = null;
        setCategoryLoading(false);
      });
    };
    refreshRef.current = refresh;
    refresh();
    // The first reply may predate the upstream full-market snapshot. Give the
    // background focus one short opportunity before the regular 20s refresh.
    const firstFullRefresh = window.setTimeout(() => refresh(), 5000);
    const timer = window.setInterval(() => refresh(), 20_000);
    return () => {
      active = false;
      if (refreshRef.current === refresh) refreshRef.current = null;
      requestState.controller?.abort();
      window.clearTimeout(firstFullRefresh);
      window.clearInterval(timer);
    };
  }, [id,requestedCategory, acceptMatches]);

  useEffect(() => {
    if(lastRefreshVersion.current===refreshVersion) return;
    lastRefreshVersion.current=refreshVersion;
    refreshRef.current?.();
  }, [refreshVersion]);

  // One visibility rule for the full market page, search, category counts and rows.
  // Apply pushed scores immediately instead of waiting for the 20s REST refresh.
  const filteredMarkets = useMemo(() => {
    if (!liveMarketMatch) return [];
    return markets.flatMap(market => {
      if (!combosEnabled && isComboMarket(market)) return [];
      if (!isMarketVisible(liveMarketMatch, market, lockedMarkets, lockedOutcomes, riskLockedOutcomes)) return [];
      const outcomes = filterDecidedOutcomes(
        (market.outcomes ?? []).filter(isOutcomeDisplayable), market, liveMarketMatch,
      );
      return outcomes.length ? [{ ...market, outcomes }] : [];
    });
  }, [markets, liveMarketMatch, lockedMarkets, lockedOutcomes, riskLockedOutcomes, combosEnabled,refreshVersion]);

  const stableMarketOrder=useRef<{id:string|undefined;keys:Map<string,number>}>({id:undefined,keys:new Map()});
  const viewportAnchor=useRef<{context:string;items:{key:string;top:number}[]}>({context:'',items:[]});
  const allGrouped = useMemo(() => {
    const context=[id,activeTab,marketSearch,lang].join('|');
    const items=viewportAnchor.current.context===context?Array.from(document.querySelectorAll<HTMLElement>('[data-market-anchor]')).map(el=>({key:el.dataset.marketAnchor!,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom})).filter(el=>el.bottom>100&&el.top<window.innerHeight).slice(0,5):[];
    viewportAnchor.current={context,items};
    if(stableMarketOrder.current.id!==id)stableMarketOrder.current={id,keys:new Map()};
    const order=stableMarketOrder.current.keys,groups=groupMarkets(filteredMarkets,lang);
    for(const group of groups)if(!order.has(group.baseName))order.set(group.baseName,order.size);
    return groups.sort((a,b)=>marketRank(a.markets[0])-marketRank(b.markets[0])||order.get(a.baseName)!-order.get(b.baseName)!);
  }, [filteredMarkets, lang,id]);
  useLayoutEffect(()=>{
    for(const saved of viewportAnchor.current.items){
      const el=Array.from(document.querySelectorAll<HTMLElement>('[data-market-anchor]')).find(el=>el.dataset.marketAnchor===saved.key);
      if(!el)continue;
      const delta=el.getBoundingClientRect().top-saved.top;if(Math.abs(delta)<1)break;
      let parent=el.parentElement;
      while(parent&&!(parent.scrollHeight>parent.clientHeight&&/(auto|scroll)/.test(getComputedStyle(parent).overflowY)))parent=parent.parentElement;
      if(parent)parent.scrollTop+=delta;else window.scrollBy(0,delta);break;
    }
    viewportAnchor.current.items=[];
  },[allGrouped]);

  // Available categories with count
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { ...categoryTotals,all:categoryTotals.all??allGrouped.length };
    if(Object.keys(categoryTotals).length)return counts;
    allGrouped.forEach(g => {
      counts[g.category] = (counts[g.category] || 0) + 1;
    });
    return counts;
  }, [allGrouped,categoryTotals]);

  const groupedMarkets = useMemo(() => {
    return allGrouped.filter(group => {
      if(activeTab==='favorites'){if(!favoriteMarkets.includes(favoriteKey(group.baseName)))return false;}else if (activeTab !== 'all' && group.category !== activeTab) return false;
      if (marketSearch.trim()) {
        const q = marketSearch.toLowerCase().trim();
        const titleMatches = group.title.toLowerCase().includes(q);
        const subMarketMatches = group.markets.some(m => 
          (m.name?.toLowerCase().includes(q)) || 
          (String(m.line ?? '').toLowerCase().includes(q)) ||
          ((m as any).outcomes?.some((o: any) => o.name?.toLowerCase().includes(q) ||
            marketSelectionLabel(o.name, lang, m.name, `${match?.homeTeam} vs ${match?.awayTeam}`, o.code, m.line).toLowerCase().includes(q)))
        );
        return titleMatches || subMarketMatches;
      }
      return true;
    });
  }, [allGrouped, activeTab, marketSearch, lang, match?.homeTeam, match?.awayTeam,favoriteMarkets,id]);

  const visibleLines = groupedMarkets.reduce((sum, group) => sum + group.markets.length, 0);

  const toggleGroupCollapse = (baseName: string) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [baseName]: !prev[baseName]
    }));
  };

  const toggleAllCollapse = () => {
    const allCollapsed = Object.values(collapsedGroups).length > 0 && Object.values(collapsedGroups).every(v => v);
    const nextState: Record<string, boolean> = {};
    allGrouped.forEach(g => {
      nextState[g.baseName] = !allCollapsed;
    });
    setCollapsedGroups(nextState);
  };

  const failure=requestError&&requestError.id===id?(
    <div role="alert" className="rounded-xl border border-tertiary bg-secondary p-6 text-center text-sm text-text-secondary space-y-3">
      <p>{requestError.notFound
        ?(lang==='en'?'This match is no longer available.':'Ndeshja nuk është më e disponueshme.')
        :(lang==='en'?'Unable to load this match. Please try again.':'Nuk u ngarkua ndeshja. Provo përsëri.')}</p>
      <p className="text-xs" aria-live="polite">
        {categoryLoading
          ? (lang==='en'?'Trying again...':'Po provohet përsëri...')
          : requestError.timedOut
            ? (lang==='en'?'The server took too long to respond.':'Serveri nuk u përgjigj brenda afatit.')
            : requestError.httpStatus
              ? `HTTP ${requestError.httpStatus}`
              : (lang==='en'?'Connection to the server failed.':'Lidhja me serverin dështoi.')}
      </p>
      <button type="button" onClick={()=>refreshRef.current?.(true)}
        aria-busy={categoryLoading}
        className="rounded-lg bg-tertiary px-4 py-2 font-semibold text-white">
        {categoryLoading
          ? (lang==='en'?'Retrying...':'Duke riprovuar...')
          : (lang==='en'?'Try again':'Provo përsëri')}
      </button>
    </div>
  ):null;

  if (!match || !liveMarketMatch) {
    if(failure)return failure;
    return (
      <div role="status" className="flex items-center justify-center min-h-[50vh] text-text-secondary text-sm font-medium gap-2">
        <span className="w-3 h-3 rounded-full bg-accent-green animate-ping"></span>
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  const live = liveMarketMatch!;
  const matchIdStr = String(live.id);
  const isFav = isFavorite(matchIdStr);
  const isAlert = isAlertEnabled(matchIdStr);

  // Finished favorites are read-only match reports. No betting widgets or
  // old prices should be rendered after the provider-confirmed final result.
  if(live.status==='ENDED'){
    const goals=(live.events??[]).filter(e=>e.type==='goal'&&['home','away'].includes(e.team))
      .sort((a,b)=>a.minute-b.minute);
    return <div className="zshop-detail space-y-2">
      <ZshopScoreboard match={live}/>
      <section className="rounded-lg border border-tertiary bg-secondary p-3 text-sm text-text-secondary">
        <div className="font-bold text-white">{lang==='en'?'Match finished':'Ndeshja ka përfunduar'}</div>
        {goals.length>0&&<div className="mt-2 space-y-1">
          <div className="text-xs font-bold">{lang==='en'?'Goal minutes':'Minutat e golave'}</div>
          {goals.map((goal,index)=><div key={goal.id??index}>
            ⚽ {goal.team==='home'?live.homeTeam:live.awayTeam} · {goal.minuteLabel??goal.minute}′{goal.player ? ' · ' + goal.player : ''}
          </div>)}
        </div>}
        {goals.length===0&&<div className="mt-2 text-xs">
          {lang==='en'?'Goal times are not available from the provider.':'Minutat e golave nuk janë të disponueshme nga API-ja.'}
        </div>}
      </section>
    </div>;
  }

  const categories = [
    { id: 'all', label: lang==='en'?'All markets':'Të gjitha tregjet' },
    {id:'favorites',label:lang==='en'?'Favorite markets':'Tregjet e preferuara'},
    ...CATEGORY_ORDER.map(id => ({ id, label: categoryLabel(id, lang) })),
  ];

  const filteredCategories = categories.filter(c => c.id === 'all' || c.id==='favorites' || (categoryCounts[c.id] && categoryCounts[c.id] > 0));

  const formattedDate = new Date(live.startTime);
  const isLive = live.status === 'LIVE';

  return (
    <div className="zshop-detail space-y-2">
      <ZshopScoreboard match={live}/>
      {isLive&&<PitchTracker matchId={live.id} homeTeam={live.homeTeam} awayTeam={live.awayTeam} snapshot={live}/>}

      {/* Filter & Search Bar */}
      <div className="zs-market-filters space-y-2">
        {/* Search input for instant market find */}
        <div className="relative zs-market-search">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            value={marketSearch}
            onChange={(e) => setMarketSearch(e.target.value)}
            placeholder={t("Kërko tregje, linja, zgjedhje (p.sh. 3.5, këndore, kartona...)")}
            className="w-full bg-secondary border border-tertiary rounded-xl pl-9 pr-9 py-2 text-xs sm:text-sm text-white placeholder-text-secondary focus:outline-none focus:border-accent-green shadow-inner"
          />
          {marketSearch && (
            <button
              onClick={() => setMarketSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-white"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Category Filter Pills with Icons */}
        <div className="zs-market-tabs rounded-sm border border-tertiary bg-primary/90 p-0.5">
          <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden pb-0.5">
            {filteredCategories.map((cat) => {
              const count = categoryCounts[cat.id] || 0;
              const isActive = activeTab === cat.id;

              return (
                <button
                  key={cat.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setActiveTab(cat.id)}
                  className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-2 text-xs font-bold whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-accent-green text-primary font-bold'
                      : 'border border-transparent bg-transparent text-text-secondary hover:bg-tertiary/60 hover:text-white'
                  }`}
                >
                  {getCategoryIcon(cat.id)}
                  <span>{cat.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${isActive ? 'bg-primary/30 text-primary' : 'bg-white/5 text-text-secondary'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Header controls: market counter and collapse toggle */}
      <div className="flex items-center justify-between text-xs px-1 text-text-secondary">
        <span className="font-semibold">
          {t("Shfaqen") + " "}<strong className="text-white">{groupedMarkets.length}</strong> {" " + t("tregje /") + " "}<strong className="text-white">{visibleLines}</strong> {" " + t("linja")}</span>
        <button
          onClick={toggleAllCollapse}
          className="text-text-secondary hover:text-white font-bold inline-flex items-center gap-1 hover:underline active:scale-95 transition"
        >
          <Layers size={13} />
          <span>{t("Palos / Hapi të Gjitha")}</span>
        </button>
      </div>

      {/* Original zshop two-column market layout. */}
      <div className="zshop-market-list">
        {failure??(categoryLoading?(<div role="status" className="p-6 text-sm text-text-secondary">{t("common.loading")}</div>):groupedMarkets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-secondary p-8 text-center text-sm text-text-secondary space-y-2">
            <Search size={28} className="mx-auto opacity-30 text-white" />
            <div className="font-bold text-white">{t("Nuk u gjet asnjë treg")}</div>
            <p className="text-xs">{t("Provoni të ndryshoni kategorinë ose fjalën e kërkimit.")}</p>
          </div>
        ) : (
          <ViewportList items={groupedMarkets.map((group,idx)=>({key:group.baseName,estimate:160,node:()=>{
            const isCollapsed = collapsedGroups[group.baseName] ?? false;
            const sectionStart = idx === 0 || groupedMarkets[idx - 1].category !== group.category;

            return (
              <div key={group.baseName} data-market-anchor={group.baseName} className="zs-market-group">
                {sectionStart && (
                  <div className="zs-market-category flex items-center gap-2 px-1 pt-2 text-xs font-bold uppercase tracking-wide text-white">
                    {getCategoryIcon(group.category)}
                    <span>{categoryLabel(group.category, lang)}</span>
                    <span className="rounded bg-tertiary/70 px-2 py-0.5 text-[10px] text-text-secondary">
                      {groupedMarkets.filter(g => g.category === group.category).length}
                    </span>
                  </div>
                )}
              <section className="overflow-hidden border border-tertiary/80 bg-secondary">
                <div className="zs-market-toggle w-full flex items-center justify-between gap-2 bg-[#424d60] px-2.5 py-1.5 text-left border-b border-tertiary">
                  <button type="button" className="shrink-0 p-1" aria-label={(lang==='en'?'Favorite market: ':'Treg i preferuar: ')+group.title} aria-pressed={favoriteMarkets.includes(favoriteKey(group.baseName))} onClick={()=>toggleMarketFavorite(group.baseName)}><Star size={16} className={favoriteMarkets.includes(favoriteKey(group.baseName))?'fill-amber-400 text-amber-400':'text-text-secondary'}/></button>
                  <button type="button" onClick={() => toggleGroupCollapse(group.baseName)} aria-expanded={!isCollapsed} className="min-w-0 flex flex-1 items-center justify-between gap-2 py-1 text-left text-xs font-semibold text-white">
                    <span className="break-words">{group.title}</span>
                  <span className="shrink-0 text-[10px] text-text-secondary flex items-center gap-1">
                    {group.markets.length} {group.markets.length === 1 ? (lang==='en'?'line':'linjë') : t("linja")}
                    {isCollapsed ? <ChevronDown size={14}/> : <ChevronUp size={14}/>}
                  </span>
                  </button>
                  <MarketInfoButton market={{...group.markets[0],name:marketBaseName(group.markets[0]),line:group.markets.length>1?'':group.markets[0].line}} title={group.title}/>
                </div>
                {!isCollapsed && (group.markets.every(isComboMarket) ? (
                  <ComboOddsGrid markets={group.markets} match={live} />
                ) : (
                  <div className="divide-y divide-tertiary/70">
                    {group.markets.map(market => {
                      const cleanOutcomes = dedupeOutcomes((market as any).outcomes ?? []);
                      if (!cleanOutcomes.length) return null;
                      const line = marketLineValue(market);
                      const showLine = group.markets.length > 1 || !!line;
                      return (
                        <div key={market.id} className="flex items-stretch min-h-[40px] bg-[#252e3b]">
                          {showLine && (
                            <div className="w-[48px] sm:w-[76px] shrink-0 flex items-center justify-center bg-[#424d60] border-r border-tertiary/80 px-1 text-xs font-bold text-slate-200">
                              {formatMarketLine(market.name, line) || marketDisplayTitle(market, lang)}
                            </div>
                          )}
                          <div className="zs-market-outcomes flex-1 min-w-0 grid gap-px bg-tertiary/80"
                            style={{gridTemplateColumns: `repeat(${Math.min(cleanOutcomes.length, 3)}, minmax(0, 1fr))`}}>
                            {cleanOutcomes.map((outcome: any) => (
                              <div key={outcome.id} className="min-w-0 bg-[#252e3b] [&_button]:w-full [&_button]:h-full [&_button]:min-h-[40px] [&_button]:rounded-none [&_button]:bg-transparent [&_button]:px-2 [&_button]:text-xs">
                                <OddsButton match={live} market={market} outcome={outcome} isWide showRawLabel />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </section>
              </div>
            );
          }}))}/>
        ))}
      </div>
    </div>
  );
}

