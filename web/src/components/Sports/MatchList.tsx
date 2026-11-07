import { marketDiagnosticAll } from '../../utils/marketExpiry';
import { selectBoardMarkets, findBoardOutcome } from '../../utils/boardMarkets';
import ViewportList,{type WindowItem} from './ViewportList';
import {useFeedScope} from '../../api/feedScope';
import { useState, useEffect, useRef,useCallback } from 'react';
import { apiClient } from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import OddsButton from './OddsButton';
import CountryFlag from './CountryFlag';
import { useLiveFeed } from '../../api/liveFeed';
import { liveMatch } from '../../api/matchSync';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Star } from 'lucide-react';
import { filterDecidedOutcomes, isMarketVisible, isOutcomeDisplayable, isMarketExpired } from '../../utils/marketExpiry';

import { isHandicapMarket } from '../../utils/marketCatalog';
import { useFavorites } from '../../context/FavoritesContext';
import { isComboMarket } from '../../utils/comboPolicy';
import { compareMatchDisplay } from '../../utils/matchOrder';
import {isFixtureOnDay} from '../../utils/fixtureDates';
import type {DateFilter} from '../../utils/fixtureDates';
import { repairDisplayText } from '../../utils/repairDisplayText';

export type MatchViewMode = 'all' | 'live' | 'prematch' | 'favorites';

interface Props {
  tournamentId?: string;
  categoryId?: string;
  sportId?: string;
  isLiveOnly?: boolean;
  viewMode: MatchViewMode;
  onViewModeChange: (mode: MatchViewMode) => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
}

export default function MatchList({ tournamentId, categoryId, sportId, isLiveOnly, viewMode, searchTerm, onSearchChange }: Props) {
  const [matches, setMatches] = useState<any[]>([]);
  const [visibleIds,setVisibleIds]=useState<string[]>([]);
  const onVisible=useCallback((ids:string[])=>setVisibleIds(old=>old.join()===ids.join()?old:ids),[]);
  useFeedScope('board',{boardIds:visibleIds});
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState<DateFilter | 'all'>('all');
  useEffect(()=>setDateFilter('all'),[viewMode]);
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const { favorites, isFavorite, toggleFavorite } = useFavorites();
  const { livePatches, lockedMatches, lockedMarkets, lockedOutcomes, riskLockedOutcomes, feedMode, combosEnabled, refreshVersion, acceptMatches } = useLiveFeed();
  const refreshing = feedMode !== 'live';
  const refreshRef = useRef<(() => void) | null>(null);
  const lastRefreshVersion = useRef(refreshVersion);

  useEffect(() => {
    const controller=new AbortController();
    let active=true, busy=false, queued=false;
    const refresh=async()=> {
      if(!active) return;
      if(busy) {queued=true;return;}
      busy=true;
      try {
        const params:any={view:'board', _snapshot:Date.now()};
        if(tournamentId) params.tournamentId=tournamentId;
        if(categoryId) params.categoryId=categoryId;
        if(sportId) params.sportId=sportId;
        if(isLiveOnly) params.status='LIVE';
        if(viewMode==='prematch')params.status='PREMATCH';
        if((viewMode==='all'||viewMode==='prematch')&&dateFilter!=='all')params.day=dateFilter;
        // Finished favorites are fetched by ID from durable final results.
        // The ordinary board endpoint remains unchanged and excludes ended games.
        const historyRequest=viewMode==='favorites'&&favorites.length
          ?apiClient.get('/matches/favorites',{params:{ids:favorites.slice(0,100).join(',')},signal:controller.signal})
            .then(res=>Array.isArray(res.data)?res.data:[]).catch(()=>[])
          :Promise.resolve([]);
        const [res,finished]=await Promise.all([
          apiClient.get('/matches',{params,signal:controller.signal}),historyRequest,
        ]);
        if(active) {
          const snapshot=Array.isArray(res.data)?res.data:[];
          acceptMatches(snapshot);
          const archivedIds=new Set(finished.map((m:any)=>String(m.id)));
          setMatches([...snapshot.filter((m:any)=>!archivedIds.has(String(m.id))),...finished]);
        }
      } catch(error) {if(active) console.error('Failed to fetch matches:',error);}
      finally {
        busy=false;
        if(active) {
          setLoading(false);
          if(queued) {queued=false;void refresh();}
        }
      }
    };
    refreshRef.current=()=>void refresh();
    setLoading(true);
    void refresh();
    const interval=window.setInterval(()=>void refresh(),30000);
    return ()=>{active=false;refreshRef.current=null;controller.abort();window.clearInterval(interval);};
  }, [tournamentId, categoryId, sportId, isLiveOnly,viewMode,dateFilter, acceptMatches,favorites]);

  // A collector cycle must not cancel a slow request. Coalesce changes behind
  // its response; only an actual filter change or unmount aborts that request.
  useEffect(() => {
    if(lastRefreshVersion.current===refreshVersion) return;
    lastRefreshVersion.current=refreshVersion;
    refreshRef.current?.();
  }, [refreshVersion]);

  const currentMatches = matches.map(match => match.status==='ENDED'?match:liveMatch(match, livePatches[String(match.id)]))
    .filter(match => match.status !== 'CANCELLED' && (viewMode==='favorites'||match.status !== 'ENDED'))
    .sort(compareMatchDisplay);
  // The server catalog already excludes synthetic fixtures; do not hide real leagues.
  const searchFiltered = searchTerm.trim()
    ? currentMatches.filter(m => {
        const search = searchTerm.toLowerCase();
        return (
          m.homeTeam?.toLowerCase().includes(search) ||
          m.awayTeam?.toLowerCase().includes(search) ||
          m.tournament?.name?.toLowerCase().includes(search) ||
          m.tournament?.category?.name?.toLowerCase().includes(search) ||
          m.tournament?.category?.sport?.name?.toLowerCase().includes(search)
        );
      })
    : currentMatches;

  const filteredMatches = searchFiltered.filter(m => {
    if(viewMode==='live'||viewMode==='favorites')return true;
    // Live fixtures remain visible after midnight, even when their kickoff was
    // yesterday. The date picker applies to upcoming fixtures only.
    if(viewMode==='all'&&m.status==='LIVE')return true;
    return dateFilter==='all'||isFixtureOnDay(m.startTime,dateFilter);
  });

  // Keep every provider fixture while prices load or are suspended.
  const pricedMatches = filteredMatches;

  const liveMatches = pricedMatches.filter(m => m.status === 'LIVE');
  const prematchMatches = pricedMatches.filter(m => m.status !== 'LIVE');
  const favoriteMatches = pricedMatches.filter(m => isFavorite(String(m.id)));
  const visibleMatches =
    viewMode === 'live' ? liveMatches :
    viewMode === 'prematch' ? prematchMatches :
    viewMode === 'favorites' ? favoriteMatches :
    pricedMatches;

  if (loading && matches.length === 0) {
    return (
      <div className="p-12 text-center text-text-secondary flex items-center justify-center gap-2">
        <span className="w-3 h-3 rounded-full bg-accent-green animate-ping"></span>
        {t(refreshing ? 'common.feed_refreshing' : 'common.loading')}
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="p-8 sm:p-12 text-center text-text-secondary space-y-3 max-w-md mx-auto">
        <div className="text-4xl">{refreshing ? '⏳' : '⚽'}</div>
        <div className="font-bold text-white text-base">
          {t(refreshing ? 'common.feed_refreshing' : 'common.no_results')}
        </div>
        {refreshing ? (
          <p className="text-xs text-text-secondary">{t('common.feed_refreshing_hint')}</p>
        ) : (
          <p className="text-xs text-text-secondary">{t('sections.select_sport')}</p>
        )}
      </div>
    );
  }

  // Render a single compact odds board per competition. All odds still use the
  // existing OddsButton and its live-feed, suspension and betslip behavior.
  // One board projection shared by the card renderer and the league heading, so the
  // "Next goal" column is announced only when a fixture in that league really has it.
  const boardSelection = (raw: any) => {
    const m = liveMatch(raw, livePatches[String(raw.id)]);
    const markets: any[] = m.markets ?? [];
    const visible = (mk: any) => (combosEnabled || !isComboMarket(mk)) && !isHandicapMarket(mk) && isMarketVisible(m, mk, lockedMarkets, lockedOutcomes, riskLockedOutcomes) && filterDecidedOutcomes((mk.outcomes ?? []).filter(isOutcomeDisplayable), mk, m).length > 0;
    const chosen = selectBoardMarkets(markets, visible, mk => !isMarketExpired(m, mk) && (mk.status === 'SUSPENDED' || lockedMarkets[String(mk.id)] === true || (mk.outcomes ?? []).some((outcome: any) => outcome.status === 'SUSPENDED' || outcome.feedSuspended === true || lockedOutcomes[String(outcome.id)] === true || riskLockedOutcomes[String(outcome.id)] === true)), m);
    return { m, markets, chosen };
  };
  const boardOutcome = (m: any, mk: any, names: string[]): any => findBoardOutcome(mk ? {...mk, outcomes: filterDecidedOutcomes((mk.outcomes ?? []).filter(isOutcomeDisplayable), mk, m)} : null, names);
  // Render a single compact odds board per competition. All odds still use the
  // existing OddsButton and its live-feed, suspension and betslip behavior.
  const renderMatchCard = (raw: any) => {
    // A completed favorite is a result summary, never a betting market.
    if(raw.status==='ENDED'){
      const m=raw;
      const goals=(Array.isArray(m.events)?m.events:[]).filter((event:any)=>
        event?.type==='goal'&&['home','away'].includes(event.team)&&
        Number.isInteger(Number(event.minute)));
      const minuteLabels=goals.map((event:any)=>
        (event.team==='home'?'1':'2')+': '+(event.minuteLabel??event.minute)+'′').join(' · ');
      const shots=m.shotsOnTarget;
      return <div className="zshop-match zshop-match-no-next" key={m.id} data-zshop-match={m.id}>
        <div className="zshop-match-info">
          <button type="button" aria-label={t('Hiq nga të preferuarat')} aria-pressed={true} onClick={()=>toggleFavorite(String(m.id))}><Star size={14} fill="#d29500"/></button>
          <button type="button" className="zshop-match-teams" onClick={()=>navigate('/match/'+m.id)}>
            <span className="zshop-match-meta">{lang==='en'?'FULL TIME':'PËRFUNDUAR'}</span>
            <span className="zshop-team"><span title={repairDisplayText(m.homeTeam)}>{repairDisplayText(m.homeTeam)}</span><strong>{m.homeScore??'—'}</strong></span>
            <span className="zshop-team"><span title={repairDisplayText(m.awayTeam)}>{repairDisplayText(m.awayTeam)}</span><strong>{m.awayScore??'—'}</strong></span>
          </button>
        </div>
        <div data-board-market="primary" className="zshop-board-odds zshop-main-odds">
          <small>{lang==='en'?'Shots on target':'Goditje në portë'}</small>
          <span className="text-xs font-semibold">{shots?.home!=null&&shots?.away!=null?shots.home+' - '+shots.away:'—'}</span>
        </div>
        <div data-board-market="total" className="zshop-board-odds zshop-totals">
          <small>{lang==='en'?'Goal minutes':'Minutat e golave'}</small>
          <span className="text-xs font-semibold" title={minuteLabels||undefined}>{minuteLabels||'—'}</span>
        </div>
        <button type="button" className="zshop-extra" aria-label={lang==='en'?'Match summary':'Përmbledhja e ndeshjes'} onClick={()=>navigate('/match/'+m.id)}><ChevronRight size={12}/></button>
      </div>;
    }
    const { m, markets, chosen } = boardSelection(raw);
    const main = chosen.primary, goals = chosen.total;
    const find = (mk: any, names: string[]): any => boardOutcome(m, mk, names);
    const oneXtwo = chosen.primaryType === 'DC' ? [
      find(main, ['1x', '1/x', 'home or draw']), find(main, ['12', '1/2', 'home or away']), find(main, ['x2', 'x/2', 'draw or away']),
    ] : chosen.primaryType === 'BTTS' ? [find(main, ['yes', 'gg']), find(main, ['no', 'ng'])] : [
      find(main, ['1', 'home', 'w1', 'h', repairDisplayText(m.homeTeam).toLowerCase()]),
      find(main, ['x', 'draw', 'tie', 'wx', 'd']),
      find(main, ['2', 'away', 'w2', 'a', repairDisplayText(m.awayTeam).toLowerCase()]),
    ];
    const total = [
      find(goals, ['over', 'o', '1', `over ${chosen.totalLine}`, `o${chosen.totalLine}`]),
      find(goals, ['under', 'u', '2', `under ${chosen.totalLine}`, `u${chosen.totalLine}`]),
    ];
    const primaryLabels = chosen.primaryType === 'DC' ? ['1X','12','X2'] : chosen.primaryType === 'BTTS' ? [t('Po'),t('Jo')] : ['1','X','2'];
    const marketCount = Math.max(markets.length, Number(m.marketCount) || 0);
    const hasPrimary = !!main && oneXtwo.some(Boolean);
    const locked = lockedMatches[String(m.id)] === true;
    const oddsCells=(mk:any,outcomes:any[],labels:string[])=><div>{labels.map((label,i)=><div key={outcomes[i]?.id??label}>{mk&&outcomes[i]?<OddsButton match={m} market={mk} outcome={outcomes[i]} showRawLabel/>:<span className="zshop-quote-empty" title={label}>—</span>}</div>)}</div>;
    const title=chosen.primaryType==='DC'?(lang==='en'?'Double chance':'Dopjo shans'):chosen.primaryType==='BTTS'?(lang==='en'?'Both teams to score':'Shënojnë të dyja skuadrat'):'1X2';
    return <div className="zshop-match zshop-match-no-next" key={m.id} data-zshop-match={m.id}>
      <div className="zshop-match-info"><button type="button" aria-label={t('Shto te të preferuarat')} aria-pressed={isFavorite(String(m.id))} onClick={()=>toggleFavorite(String(m.id))}><Star size={14} fill={isFavorite(String(m.id))?'#d29500':'none'}/></button><button type="button" className="zshop-match-teams" onClick={()=>navigate('/match/'+m.id)}>
       <span className={m.status==='LIVE'?'zshop-match-meta !text-emerald-400 !font-extrabold':'zshop-match-meta'}>{m.status==='LIVE'?(t('NË LOJË')+' · '+(m.currentMinute??'—')+'′'):(<><span>{new Date(m.startTime).toLocaleDateString('en-GB',{timeZone:'Europe/Tirane',day:'2-digit',month:'2-digit'})}</span><span>{new Date(m.startTime).toLocaleTimeString('en-GB',{timeZone:'Europe/Tirane',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})}</span></>)}{locked?' · 🔒':''}</span>
       <span className="zshop-team"><span title={repairDisplayText(m.homeTeam)}>{repairDisplayText(m.homeTeam)}</span>{m.status==='LIVE'&&<strong>{m.homeScore??'—'}</strong>}</span><span className="zshop-team"><span title={repairDisplayText(m.awayTeam)}>{repairDisplayText(m.awayTeam)}</span>{m.status==='LIVE'&&<strong>{m.awayScore??'—'}</strong>}</span>
      </button></div>
      <div data-board-market="primary" className={'zshop-board-odds zshop-main-odds'+(!hasPrimary?' mobile-empty-primary':'')}><small>{title}</small>{oddsCells(main,oneXtwo,primaryLabels)}</div>
      <div data-board-market="total" className={'zshop-board-odds zshop-totals'+(!hasPrimary?' mobile-fallback-total':'')}><small>{t('Totali i golave')}</small><div><div>{goals&&total[1]?<OddsButton match={m} market={goals} outcome={total[1]} showRawLabel/>:<span className="zshop-quote-empty">—</span>}</div><span className="zshop-total-line">{chosen.totalLine||'—'}</span><div>{goals&&total[0]?<OddsButton match={m} market={goals} outcome={total[0]} showRawLabel/>:<span className="zshop-quote-empty">—</span>}</div></div></div>
      <button type="button" className="zshop-extra" aria-label={t('Tregjet e tjera')+' · '+repairDisplayText(m.homeTeam)+' - '+repairDisplayText(m.awayTeam)} onClick={()=>navigate('/match/'+m.id)}>+{marketCount}<ChevronRight size={12}/></button>
    </div>;
  };

  const entries:WindowItem[]=[];
  const appendCompetition=(items:any[],sectionTitle:string,prefix:string)=>{
    entries.push({key:prefix+':section',estimate:34,node:()=><div className={'zshop-section-title '+(items.some(m=>m.status==='LIVE')?'is-live':'')}><span>{sectionTitle}</span><span>{items.length}</span></div>});
    const groups=new Map<string,any[]>();for(const m of items){const league=[m.tournament?.category?.name,m.tournament?.name].filter(Boolean).map(repairDisplayText).join(' · ')||t('sections.league');if(!groups.has(league))groups.set(league,[]);groups.get(league)!.push(m);}
    for(const[league,fixtures]of groups){entries.push({key:prefix+league,estimate:60,node:()=><><div className="zshop-league-heading"><CountryFlag country={fixtures[0]?.tournament?.category?.name} countryCode={fixtures[0]?.tournament?.category?.countryCode}/><span>{league.replace(' · ',' / ')}</span><small>{fixtures.length}</small></div><div className="zshop-market-heading zshop-market-heading-no-next"><span>{t('Ndeshja')}</span><span>{lang==='en'?'Main market':'Tregu kryesor'}</span><span className="zshop-totals">{t('Poshtë')} · {t('Totali')} · {t('Lart')}</span><span>+</span></div></>});for(const m of fixtures)entries.push({key:prefix+':'+m.id,...(m.status==='ENDED'?{}:{matchId:String(m.id)}),estimate:90,node:()=>renderMatchCard(m)});}
  };
  if((viewMode==='all'||viewMode==='live')&&liveMatches.length)appendCompetition(liveMatches,t('Futboll në lojë'),'live');
  if((viewMode==='all'||viewMode==='prematch')&&prematchMatches.length)appendCompetition(prematchMatches,lang==='en'?'Prematch':'Para ndeshjes','pre');
  if(viewMode==='favorites')appendCompetition(favoriteMatches,t('Favoritet'),'fav');

  return (
    <div className="zshop-board">
      <div className="zshop-board-tools">{viewMode==='prematch'?<label className="flex items-center gap-2 text-xs">{lang==='en'?'Date':'Data'}<select aria-label={lang==='en'?'Filter fixtures by date':'Filtro ndeshjet sipas datës'} value={dateFilter} onChange={e=>setDateFilter(e.target.value as DateFilter)}><option value="all">{lang==='en'?'All dates':'Të gjitha datat'}</option>{(['today','tomorrow','dayAfterTomorrow'] as const).map(value=><option key={value} value={value}>{value==='today'?t('Sot'):value==='tomorrow'?t('Nesër'):lang==='en'?'Day after tomorrow':'Pasnesër'}</option>)}</select></label>:<span>{viewMode==='all'?t('TË GJITHA'):viewMode==='live'?t('NË LOJË'):t('Favoritet')}</span>}<span>{visibleMatches.length} {lang==='en'?'matches':'ndeshje'}</span></div>
      {searchTerm && (
        <div className="text-xs font-semibold text-text-secondary px-1">
          {filteredMatches.length} {t('common.results_found')}
        </div>
      )}

      {searchTerm && filteredMatches.length === 0 && (
        <div className="p-12 text-center text-text-secondary space-y-3 max-w-md mx-auto bg-secondary/50 rounded-2xl border border-tertiary">
          <div className="text-4xl">🔍</div>
          <div className="font-bold text-white text-base">{t('common.no_search_results')}</div>
          <p className="text-xs text-text-secondary">{t('common.try_different_search')}</p>
        </div>
      )}

      {!searchTerm && filteredMatches.length === 0 && (
        <div className="p-12 text-center text-text-secondary space-y-3 max-w-md mx-auto bg-secondary/50 rounded-2xl border border-tertiary">
          <div className="text-4xl">📅</div>
          <div className="font-bold text-white text-base">{t('common.no_matches_date')}</div>
        </div>
      )}

      {filteredMatches.length > 0 && pricedMatches.length === 0 && (
        <div className="p-8 sm:p-12 text-center text-text-secondary space-y-3 max-w-md mx-auto bg-secondary/50 rounded-2xl border border-tertiary">
          <div className="font-bold text-white text-base">
            {t(refreshing ? 'common.feed_refreshing' : 'common.no_results')}
          </div>
          {refreshing && <p className="text-xs text-text-secondary">{t('common.feed_refreshing_hint')}</p>}
        </div>
      )}

      <div className="zshop-league"><ViewportList items={entries} onVisible={onVisible}/></div>

    </div>
  );
}
