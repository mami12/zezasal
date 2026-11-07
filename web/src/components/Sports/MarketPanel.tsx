import { marketDiagnosticAll } from '../../utils/marketExpiry';
import { useMemo, useState } from 'react';
import { Trophy, Target, Flag, Clock, ShieldAlert, ListOrdered, Layers, Search, UserRound } from 'lucide-react';
import { Match, Market } from '../../types';
import OddsButton from './OddsButton';
import MarketInfoButton from './MarketInfoButton';
import ComboOddsGrid from './ComboOddsGrid';
import LiveMatchTime from './LiveMatchTime';
import { useLanguage } from '../../context/LanguageContext';
import { useLiveFeed } from '../../api/liveFeed';
import { liveMatch as mergeLiveMatch } from '../../api/matchSync';
import {
  isMarketVisible,
  isOutcomeDisplayable,
  filterDecidedOutcomes,
} from '../../utils/marketExpiry';
import { marketBaseName, isHandicapMarket, isIdentifiedMarket, marketCategoryOf, marketCategoryLabel, marketDisplayTitle, marketGroupKey, marketLineValue, marketSelectionLabel } from '../../utils/marketCatalog';
import type { MarketCategory } from '../../utils/marketCatalog';
import { isComboMarket } from '../../utils/comboPolicy';
import { repairDisplayText } from '../../utils/repairDisplayText';

/* ------------------------------------------------------------------ */
/* Kategoritë                                                            */
/* ------------------------------------------------------------------ */

type Category = MarketCategory;

interface CategoryDef {
  key: Category;
  label: string;
  icon: typeof Trophy;
}

const CATEGORIES: CategoryDef[] = [
  { key: 'main', label: 'Main', icon: Trophy },
  { key: 'goals', label: 'Goals', icon: Target },
  { key: 'mixed', label: 'Combos', icon: Layers },
  { key: 'corners', label: 'Corners', icon: Flag },
  { key: 'cards', label: 'Cards', icon: ShieldAlert },
  { key: 'htft', label: 'Halves / Periods', icon: Clock },
  { key: 'players', label: 'Players', icon: UserRound },
  { key: 'other', label: 'Other', icon: ListOrdered },
];

/* Family and group identification now share one catalog with MatchDetail. */

interface MarketGroup {
  base: string;
  markets: Market[];
}

const groupByBaseName = (markets: Market[]): MarketGroup[] => {
  const groups = new Map<string, MarketGroup>();
  for (const mk of markets) {
    const key = marketGroupKey(mk);
    const existing = groups.get(key);
    if (existing) {
      existing.markets.push(mk);
    } else {
      groups.set(key, { base: marketBaseName(mk), markets: [mk] });
    }
  }
  for (const g of groups.values()) {
    g.markets.sort((a, b) => {
      const la = parseFloat(marketLineValue(a)) || 0;
      const lb = parseFloat(marketLineValue(b)) || 0;
      return la - lb;
    });
  }
  return Array.from(groups.values());
};

// Provider labels can repeat in a legitimate multi-selection market.
// Deduplication by name incorrectly removes valid outcomes.
const dedupeOutcomes = (outcomes: Market['outcomes'] = []) => {
  const seen = new Set<string>();
  return (outcomes ?? []).filter(outcome => {
    if (seen.has(outcome.id)) return false;
    seen.add(outcome.id);
    return true;
  });
};

/* ------------------------------------------------------------------ */
/* MarketCard — karta e një market-i                                     */
/* ------------------------------------------------------------------ */

interface MarketCardProps {
  market: Market;
  match: Match;
  title: string;
}

function MarketCard({ market, match, title }: MarketCardProps) {
  const outcomes = filterDecidedOutcomes(dedupeOutcomes(market.outcomes), market, match);
  if (!outcomes.length) return null;
  return (
    <section className="overflow-hidden border border-tertiary/80 bg-secondary">
      <div className="flex items-center justify-between gap-2 bg-[#424d60] px-2 py-1.5 text-xs font-semibold text-white"><span>{title}</span><MarketInfoButton market={market} title={title}/></div>
      {isComboMarket(market) ? <ComboOddsGrid markets={[market]} match={match} /> : (
      <div className="grid gap-px bg-tertiary/80" style={{gridTemplateColumns: `repeat(${Math.min(outcomes.length,3)}, minmax(0,1fr))`}}>
        {outcomes.map(outcome => (
          <div key={outcome.id} className="min-w-0 bg-[#252e3b] [&_button]:w-full [&_button]:min-h-[40px] [&_button]:rounded-none [&_button]:bg-transparent [&_button]:px-2">
            <OddsButton match={match} market={market} outcome={outcome} isWide showRawLabel />
          </div>
        ))}
      </div>
      )}
    </section>
  );
}

interface GroupCardProps {
  group: MarketGroup;
  match: Match;
  title: string;
}

function GroupCard({ group, match, title }: GroupCardProps) {
  const { t } = useLanguage();
  const { lang } = useLanguage();
  return (
    <section className="overflow-hidden border border-tertiary/80 bg-secondary">
      <div className="flex items-center justify-between bg-[#424d60] px-2 py-1.5">
        <span className="text-xs font-semibold text-white">{title}</span>
        <span className="text-[10px] text-slate-300">{group.markets.length} {" " + t("linja")}</span><MarketInfoButton market={{...group.markets[0],name:group.base,line:''}} title={title}/>
      </div>
      {group.markets.every(isComboMarket) ? <ComboOddsGrid markets={group.markets} match={match} /> : (
      <div className="divide-y divide-tertiary/70">
        {group.markets.map(market => {
          const outcomes = filterDecidedOutcomes(dedupeOutcomes(market.outcomes), market, match);
          if (!outcomes.length) return null;
          return (
            <div key={market.id} className="flex items-stretch min-h-[40px]">
              <div className="w-[48px] sm:w-[74px] shrink-0 flex items-center justify-center bg-[#424d60] text-xs font-semibold text-slate-200 px-1">
                {marketLineValue(market) || marketDisplayTitle(market, lang)}
              </div>
              <div className="min-w-0 flex-1 grid gap-px bg-tertiary/80"
                style={{gridTemplateColumns: `repeat(${Math.min(outcomes.length,3)}, minmax(0,1fr))`}}>
                {outcomes.map(outcome => (
                  <div key={outcome.id} className="min-w-0 bg-[#252e3b] [&_button]:w-full [&_button]:min-h-[40px] [&_button]:rounded-none [&_button]:bg-transparent [&_button]:px-2">
                    <OddsButton match={match} market={market} outcome={outcome} isWide showRawLabel />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* MarketPanel                                                         */
/* ------------------------------------------------------------------ */

export default function MarketPanel({ match }: { match: Match }) {
  const { t, lang } = useLanguage();
  const { lockedMarkets, lockedOutcomes, riskLockedOutcomes, livePatches, combosEnabled } = useLiveFeed();
  // Apply pushed goal/period changes immediately, without waiting for REST.
  const patch = livePatches[String(match.id)];
  const liveMatch = useMemo(() => mergeLiveMatch(match, patch), [match, patch]);
  const [activeCategory, setActiveCategory] = useState<Category | 'all'>('all');
  const [marketSearch, setMarketSearch] = useState('');

  const { categorized, counts } = useMemo(() => {
    const result: Record<Category, Market[]> = {
      main: [], goals: [], mixed: [], corners: [], cards: [], htft: [], players: [], other: [],
    };
    const c: Record<Category, number> = {
      main: 0, goals: 0, mixed: 0, corners: 0, cards: 0, htft: 0, players: 0, other: 0,
    };

    const query = marketSearch.trim().toLowerCase();
    for (const market of match.markets ?? []) {
      if (!combosEnabled && isComboMarket(market)) continue;
      if (!marketDiagnosticAll() && (!isIdentifiedMarket(market) || isHandicapMarket(market))) continue;
      if (query && ![market.name, marketDisplayTitle(market, lang, true), market.line, ...(market.outcomes ?? []).flatMap(o => [o.name, marketSelectionLabel(o.name, lang, market.name, `${match.homeTeam} vs ${match.awayTeam}`, o.code, market.line)])]
        .some(value => String(value ?? '').toLowerCase().includes(query))) continue;
      if (!isMarketVisible(liveMatch, market, lockedMarkets, lockedOutcomes, riskLockedOutcomes)) continue;
      const available = filterDecidedOutcomes(
        (market.outcomes ?? []).filter(isOutcomeDisplayable), market, liveMatch,
      );
      if (!available.length) continue;

      const cat = marketCategoryOf(market);
      result[cat].push({ ...market, outcomes: available });
      c[cat]++;
    }

    for (const key of Object.keys(result) as Category[]) {
      result[key].sort((a,b)=>{
        if(marketBaseName(a).toLowerCase()===marketBaseName(b).toLowerCase()){
          const left=marketLineValue(a),right=marketLineValue(b);
          if(left!==''&&right!==''&&Number.isFinite(Number(left))&&Number.isFinite(Number(right))&&Number(left)!==Number(right))return Number(left)-Number(right);
        }
        return (
          Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) ||
          String(a.name).localeCompare(String(b.name)) ||
          String(a.line ?? '').localeCompare(String(b.line ?? ''))
        );
      });
    }

    return { categorized: result, counts: c };
  }, [liveMatch, lockedMarkets, lockedOutcomes, riskLockedOutcomes, marketSearch, lang, combosEnabled]);

  const totalMarkets = Object.values(counts).reduce((sum, n) => sum + n, 0);

  if (totalMarkets === 0 && !marketSearch) {
    return (
      <div className="border-t border-tertiary/60 px-4 py-3 text-xs text-text-secondary">
        {t('common.no_results')}
      </div>
    );
  }

  const categoriesToShow = activeCategory === 'all'
    ? CATEGORIES
    : CATEGORIES.filter(c => c.key === activeCategory);

  return (
    <div className="border-t border-tertiary/70 bg-primary/50 px-2 py-3 sm:px-4 sm:py-4 space-y-3">

      {/* Strip statistikash live — më kompakt në mobile */}
      <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-[10px] sm:text-xs text-text-secondary bg-secondary/80 p-1.5 sm:p-2.5 rounded-sm border border-tertiary/60">
        {liveMatch.status === 'LIVE' && (
          <span className="font-bold text-accent-red flex items-center gap-1 sm:gap-1.5 bg-rose-500/10 px-1.5 sm:px-2 py-0.5 rounded sm:rounded-md border border-rose-500/20">
            <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-accent-red animate-ping"></span>
            <LiveMatchTime minute={liveMatch.currentMinute} second={liveMatch.currentSecond} period={liveMatch.period} seconds />{liveMatch.period ? ` · ${repairDisplayText(liveMatch.period)}` : ''}
          </span>
        )}
        {match.corners && (
          <span className="bg-primary/60 px-1.5 sm:px-2.5 py-0.5 rounded sm:rounded-md border border-tertiary/50">
            🚩 <span className="font-bold text-white tabular-nums">
              {match.corners.home} - {match.corners.away}
            </span>
          </span>
        )}
        {match.cards && (
          <span className="bg-primary/60 px-1.5 sm:px-2.5 py-0.5 rounded sm:rounded-md border border-tertiary/50">
            🟨 <span className="font-bold text-white tabular-nums">
              {match.cards.home} - {match.cards.away}
            </span>
          </span>
        )}
        <span className="ml-auto text-[10px] sm:text-[11px] font-bold text-text-secondary">
          {totalMarkets} {t('markets.market')}
        </span>
      </div>

      <label className="flex items-center gap-2 border border-tertiary/70 bg-secondary px-3 py-2 text-text-secondary">
        <Search size={16} className="shrink-0" />
        <input value={marketSearch} onChange={e => setMarketSearch(e.target.value)}
          placeholder={t("Kërko tregje, linja, zgjedhje...")}
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-text-secondary" />
        {marketSearch && <button type="button" onClick={() => setMarketSearch('')} className="text-xs underline">{t("Pastro")}</button>}
      </label>

      {/* Filtrat e kategorive — më kompakt në mobile */}
      <div className="flex gap-1 sm:gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
        <button
          onClick={() => setActiveCategory('all')}
          className={`shrink-0 flex items-center gap-1 sm:gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 rounded md:rounded-lg text-[10px] sm:text-[11px] font-bold transition ${
            activeCategory === 'all'
              ? 'bg-accent-green text-primary shadow-sm'
              : 'bg-secondary/80 text-text-secondary hover:text-white hover:bg-tertiary border border-tertiary/60'
          }`}
        >
          <ListOrdered size={14} />
          <span>{t("Të gjitha tregjet")}</span>
          <span className={`px-1 py-0.5 rounded-full text-[8px] sm:text-[9px] font-black ${
            activeCategory === 'all' ? 'bg-primary/20 text-primary' : 'bg-primary/60 text-text-secondary'
          }`}>
            {totalMarkets}
          </span>
        </button>

        {CATEGORIES.map(cat => {
          const count = counts[cat.key];
          if (count === 0) return null;
          const isActive = activeCategory === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              className={`shrink-0 flex items-center gap-1 sm:gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 rounded md:rounded-lg text-[10px] sm:text-[11px] font-bold transition ${
                isActive
                  ? 'bg-accent-green text-primary shadow-sm'
                  : 'bg-secondary/80 text-text-secondary hover:text-white hover:bg-tertiary border border-tertiary/60'
              }`}
            >
              <cat.icon size={14} strokeWidth={1.9} />
              <span>{marketCategoryLabel(cat.key, lang)}</span>
              <span className={`px-1 py-0.5 rounded-full text-[8px] sm:text-[9px] font-black ${
                isActive ? 'bg-primary/20 text-primary' : 'bg-primary/60 text-text-secondary'
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {totalMarkets === 0 && (
        <div className="border border-tertiary/60 p-4 text-center text-sm text-text-secondary">
          {t("Nuk ka tregje të disponueshme për këtë kërkim.")}</div>
      )}

      {/* Seksionet e kategorive */}
      {categoriesToShow.map(cat => {
        const markets = categorized[cat.key];
        if (!markets.length) return null;
        const marketGroups = groupByBaseName(markets);

        return (
          <section key={cat.key} className="space-y-1.5">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="w-1 h-3 sm:h-4 rounded-full bg-accent-green"></span>
              <cat.icon size={15} className="text-accent-green" strokeWidth={1.9} />
              <div className="text-xs sm:text-sm font-black uppercase tracking-wider text-white">
                {marketCategoryLabel(cat.key, lang)}
              </div>
              <span className="text-[9px] sm:text-[10px] font-bold text-text-secondary bg-secondary px-1.5 sm:px-2 py-0.5 rounded-full border border-tertiary/60">
                {marketGroups.length}
              </span>
            </div>

            {/* Grid — hapësira më e vogël në mobile */}
            <div className="grid gap-1.5 sm:gap-3 grid-cols-1">
              {marketGroups.map(group => {
                if (group.markets.length === 1) {
                  const market = group.markets[0];
                  const title = marketDisplayTitle(market, lang, !isComboMarket(market));
                  return (
                    <MarketCard
                      key={market.id}
                      market={market}
                      match={liveMatch}
                      title={title}
                    />
                  );
                }

                const baseTitle = marketDisplayTitle({...group.markets[0],name:group.base,line:''}, lang);
                return (
                  <GroupCard
                    key={marketGroupKey(group.markets[0])}
                    group={group}
                    match={liveMatch}
                    title={baseTitle}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
