import { useLanguage } from '../context/LanguageContext';
import CasinoFullscreen,{requestCasinoLandscape,releaseCasinoLandscape} from '../components/Layout/CasinoFullscreen';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {createCasinoExitController} from './casinoExit';
import {apiClient} from '../api/client';
import {useAuth} from '../context/AuthContext';
import { ArrowLeft, BookOpen, Cherry, Sparkles, Flame, Search, Play, EyeOff } from 'lucide-react';
import { Link, Navigate, useParams, useNavigate } from 'react-router-dom';
import Header from '../components/Layout/Header';
import type { CasinoGame } from './CasinoOriginalWallet';
const CasinoOriginalWallet=lazy(()=>import('./CasinoOriginalWallet'));
import { casinoAssetUrl } from './casinoOriginalArt';

type GameMeta = {
  id: CasinoGame | 'prophecy-ra-demo';
  title: string;
  subtitle: string;
  logo: string;
  background: string;
  demo?: boolean;
};

const GAMES: (GameMeta & { id: CasinoGame })[] = [
  {id:'ice-fruits-6x3',title:'Ice Fruits 6 Reels',subtitle:'6 bobina · 20 linja · Dyfishim',logo:'ice-fruits-6x3/top.webp',background:'ice-fruits-6x3/emptyback.jpg'},
  {id:'fortune-pyramid',title:'Fortune Pyramid',subtitle:'20 linja · Dyfishim',logo:'fortune-pyramid/top_name.webp',background:'fortune-pyramid/background.webp'},
  {id:'fortune-teller',title:'Fortune Teller',subtitle:'20 linja · 15/20/25 rrotullime falas · Tarot',logo:'fortune-teller/logo.png',background:'fortune-teller/background.jpg'},
  {id:'vikings-fun',title:"Viking's Fun",subtitle:'25 linja · 15 rrotullime falas · Dyfishim',logo:'vikings-fun/top_name.webp',background:'vikings-fun/background.webp'},
  {id:'fruit-queen',title:'Fruit Queen',subtitle:'18 linja · Dyfishim',logo:'fruit-queen/top.webp',background:'fruit-queen/emptyback.jpg'},
  {id:'seven-hot',title:'Seven Hot',subtitle:'20 linja · Dyfishim',logo:'seven-hot/top.webp',background:'seven-hot/emptyback.jpg'},
  {id:'firejoker',title:'Fire Joker',subtitle:'5 linja · 10 free-spins · Slotopol',logo:'firejoker/logo-atlas.png',background:'firejoker/background.jpg'},
  {
    id: 'lucky-clover-x3',
    title: 'Lucky Clover X3',
    subtitle: '5 linja · Simbol zëvendësues x3 · Dyfishim',
    logo: 'lucky-clover-x3/main/top_name.webp',
    background: 'lucky-clover-x3/main/background.webp',

  },
  {
    id: 'sizzling',
    title: 'Sizzling Hot Deluxe',
    subtitle: '5 linja · fruta · Kuq/Zi',
    logo: 'sizzling/logo-alpha.png',
    background: 'sizzling/background.webp',
  },
  {
    id: 'bookofra',
    title: 'Book of Ra Deluxe',
    subtitle: '10 linja · Libri zëvendësues · 10 rrotullime falas',
    logo: 'book-ra/logo-alpha.png',
    background: 'book-ra/background.webp',
  },
];

const DEMO_GAME: GameMeta = {
  id: 'prophecy-ra-demo',
  title: 'Prophecy of Ra · Demo',
  subtitle: '13 linja · Rrotullime falas · Kredi virtuale',
  logo: 'prophecy-ra-demo/assets/card/logo.webp',
  background: 'prophecy-ra-demo/assets/card/background.webp',
  demo: true,
};
const ALL_GAMES = [...GAMES, DEMO_GAME];

function GameArt({ game, className }: { game: GameMeta; className: string }) {
  if(game.id==='fortune-teller')return <span role="img" aria-label={game.title} className={'block h-[74px] w-[210px] max-w-[85%] shrink-0 bg-left-top bg-no-repeat '+className} style={{backgroundImage:`url("${casinoAssetUrl(game.logo)}")`,backgroundSize:'535px auto'}}/>;
  if (game.id === 'firejoker') return <span role="img" aria-label={game.title} className={'block h-10 w-[210px] max-w-[85%] shrink-0 bg-left-top bg-no-repeat '+className}
    style={{ backgroundImage: `url("${casinoAssetUrl(game.logo)}")`, backgroundSize: '255px auto' }} />;
  return (
    <img
      src={game.demo ? '/app/casino-original/prophecy-ra-demo/assets/card/logo.webp' : casinoAssetUrl(game.logo)}
      alt={game.title}
      loading="lazy"
      decoding="async"
      className={className}
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
    />
  );
}

/** Original provider cabinets connected to the shared sportsbook wallet. */
export default function CasinoPage() {
  const { t } = useLanguage();
  const { gameId } = useParams<{ gameId?: string }>();
  const navigate=useNavigate(),{user,refreshUser}=useAuth();
  const [activeTab, setActiveTab] = useState<'all' | 'popular' | 'fruits' | 'slots' | 'demo'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [hiddenGames, setHiddenGames] = useState<string[]>([]);

  useEffect(() => {
    apiClient.get<{ enabled: boolean; hiddenGames: string[] }>('/casino/config')
      .then(res => {
        if (Array.isArray(res.data?.hiddenGames)) {
          setHiddenGames(res.data.hiddenGames);
        }
      })
      .catch(() => {});
  }, []);

  const exitGame=useMemo(()=>createCasinoExitController({
    releaseDisplay:()=>releaseCasinoLandscape({keepSession:true}),
    closeWallet:()=>apiClient.post(['lucky-clover-x3','vikings-fun','fruit-queen','seven-hot','firejoker','fortune-teller','fortune-pyramid','ice-fruits-6x3'].includes(gameId||'')?'/casino/original/'+gameId+'/close':'/casino/original/pixi/close',{},{timeout:5000,validateStatus:status=>status===401||(status>=200&&status<300)}),
    refreshWallet:refreshUser,
    navigate:()=>navigate('/casino'),
  }),[gameId,navigate,refreshUser]);

  const filteredGames = useMemo(() => {
    return ALL_GAMES.filter((game) => {
      if (hiddenGames.includes(game.id)) return false;
      if (activeTab === 'popular') {
        if (!['bookofra', 'sizzling', 'firejoker', 'lucky-clover-x3', 'fortune-teller'].includes(game.id)) return false;
      } else if (activeTab === 'fruits') {
        if (!['sizzling', 'ice-fruits-6x3', 'fruit-queen', 'seven-hot'].includes(game.id)) return false;
      } else if (activeTab === 'slots') {
        if (!['bookofra', 'fortune-pyramid', 'fortune-teller', 'vikings-fun'].includes(game.id)) return false;
      } else if (activeTab === 'demo') {
        if (!game.demo) return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        return game.title.toLowerCase().includes(query) || game.subtitle.toLowerCase().includes(query);
      }
      return true;
    });
  }, [activeTab, searchQuery, hiddenGames]);

  if (!gameId) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-[#0d1420] text-slate-100">
        <Header />
        <main className="mx-auto w-full max-w-[1360px] flex-1 px-3 pb-16 pt-4 sm:px-6 sm:pt-6">
          {/* Top Bar Navigation & Controls */}
          <div className="mb-5 flex min-w-0 flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between">
            <Link
              to="/"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-700 bg-[#151d2b] px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500 hover:text-white self-start"
            >
              <div className="flex h-5 w-5 items-center justify-center text-slate-300">
                <ArrowLeft size={14} />
              </div>
              <span className="tracking-wide">{t("Kthehu te sporti")}</span>
            </Link>

            {/* Single-line swipeable categories: mobile never wraps into
                uneven rows or pushes the search field off-screen. */}
            <div className="w-full min-w-0 overflow-hidden md:max-w-[570px] md:flex-1" role="region" aria-label="Kategoritë e lojërave">
              <div role="tablist" aria-label="Filtro lojërat" className="flex w-full min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain rounded-lg border border-slate-700/70 bg-[#151d2b] p-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {([
                  {id:'all',title:'Të gjitha',icon:null},
                  {id:'popular',title:'Popullore',icon:<Flame size={14}/>},
                  {id:'fruits',title:'Fruta & Hot',icon:<Cherry size={14}/>},
                  {id:'slots',title:'Slots',icon:<BookOpen size={14}/>},
                  {id:'demo',title:'Demo',icon:null},
                ] as const).map(tab=>(
                  <button key={tab.id} type="button" role="tab"
                    aria-selected={activeTab===tab.id}
                    onClick={()=>setActiveTab(tab.id)}
                    className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3.5 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-300 ${activeTab===tab.id?'bg-slate-200 text-slate-950':'text-slate-300 hover:bg-white/10 hover:text-white'}`}>
                    {tab.icon}<span>{tab.title}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Search Input */}
            <div className="relative w-full min-w-0 sm:w-56">
              <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-300/70" />
              <input
                type="text"
                placeholder="Kërko lojën..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full w-full min-h-10 rounded-lg border border-slate-700 bg-[#151d2b] py-2.5 pl-10 pr-4 text-sm text-slate-100 placeholder-slate-500 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
            </div>
          </div>

          {/* Modern Games Grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {filteredGames.map((game) => (
              <Link
                key={game.id}
                to={`/casino/${game.id}`}
                onClick={() => { void requestCasinoLandscape(); }}
                className="group relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-700/80 bg-[#151e2b] shadow-sm transition-colors hover:border-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300"
              >
                {/* Visual Image Container with 16/10 aspect */}
                <div className="relative aspect-[16/11] w-full overflow-hidden bg-black/50">
                  <img
                    src={game.demo ? '/app/casino-original/prophecy-ra-demo/assets/card/background.webp' : casinoAssetUrl(game.background)}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover opacity-75 transition-all duration-500 group-hover:scale-108 group-hover:opacity-95"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#140a20] via-[#140a20]/30 to-black/30" />

                  {/* Logo Center */}
                  <div className="absolute inset-x-0 bottom-1 flex items-end justify-center px-4 pb-2 z-10">
                    <GameArt game={game} className="max-h-20 w-auto max-w-[85%] object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)] transition-transform duration-300 group-hover:scale-105" />
                  </div>

                  {/* Badges on Top */}
                  <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
                    {game.demo && (
                      <span className="rounded-full border border-amber-400/80 bg-amber-500/25 px-2.5 py-0.5 text-[10px] font-black tracking-wider text-amber-200 backdrop-blur-md">
                        DEMO
                      </span>
                    )}
                    {game.id === 'bookofra' && (
                      <span className="rounded-full border border-amber-400 bg-amber-500/30 px-2.5 py-0.5 text-[10px] font-black tracking-wider text-amber-200 backdrop-blur-md">
                        TOP
                      </span>
                    )}
                    {game.id === 'sizzling' && (
                      <span className="rounded-full border border-rose-400 bg-rose-500/30 px-2.5 py-0.5 text-[10px] font-black tracking-wider text-rose-200 backdrop-blur-md">
                        HOT
                      </span>
                    )}
                    {game.id === 'lucky-clover-x3' && (
                      <span className="rounded-full border border-emerald-400 bg-emerald-500/30 px-2.5 py-0.5 text-[10px] font-black tracking-wider text-emerald-200 backdrop-blur-md">
                        WILD X3
                      </span>
                    )}
                    {game.id === 'firejoker' && (
                      <span className="rounded-full border border-rose-400 bg-rose-500/30 px-2.5 py-0.5 text-[10px] font-black tracking-wider text-rose-200 backdrop-blur-md">
                        HOT
                      </span>
                    )}
                  </div>

                  {/* Quick Icon on Top Right */}
                  <div className="absolute right-3 top-3 z-10">
                    {game.id === 'bookofra' ? (
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 backdrop-blur-md text-amber-300 border border-amber-400/30">
                        <BookOpen size={14} />
                      </span>
                    ) : ['sizzling', 'fruit-queen', 'seven-hot', 'ice-fruits-6x3'].includes(game.id) ? (
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 backdrop-blur-md text-rose-300 border border-rose-400/30">
                        <Cherry size={14} />
                      </span>
                    ) : (
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 backdrop-blur-md text-[#d5b5ff] border border-purple-400/30">
                        <Sparkles size={14} />
                      </span>
                    )}
                  </div>

                  {/* Hover Overlay with Glowing Play Button */}
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 opacity-0 backdrop-blur-[3px] transition-all duration-300 group-hover:opacity-100">
                    <span className="flex items-center gap-2 rounded-full border border-amber-300 bg-gradient-to-r from-amber-400 to-amber-500 px-6 py-2.5 text-xs font-black text-black shadow-xl shadow-amber-950/80 transform scale-90 transition-transform duration-300 group-hover:scale-100">
                      <Play size={15} fill="currentColor" />
                      <span>LUAJ TANI</span>
                    </span>
                  </div>
                </div>

                {/* Card Info Bottom */}
                <div className="flex min-w-0 flex-1 flex-col justify-between border-t border-slate-700/70 bg-[#151e2b] p-2.5 sm:p-4">
                  <div className="mb-3">
                    <h2 className="truncate text-xs font-semibold text-slate-100 sm:text-sm">
                      {game.title}
                    </h2>
                    <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-slate-400 sm:text-xs">
                      {game.subtitle}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-700/60">
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 sm:text-[10px]">
                      {game.demo ? 'Kredi Demo' : 'Para Reale'}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md border border-slate-600 px-2 py-1 text-[10px] font-semibold text-slate-200 transition-colors group-hover:bg-slate-200 group-hover:text-slate-950">
                      <span>Luaj</span>
                      <Play size={10} fill="currentColor" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {filteredGames.length === 0 && (
            <div className="my-12 flex flex-col items-center justify-center text-center p-8 rounded-2xl border border-[#523769] bg-[#221334]/60">
              <Search size={32} className="text-purple-400 mb-2" />
              <p className="text-sm font-bold text-white">Nuk u gjet asnjë lojë me këtë emër.</p>
              <button
                type="button"
                onClick={() => { setActiveTab('all'); setSearchQuery(''); }}
                className="mt-3 rounded-xl bg-[#7F00FF] px-4 py-2 text-xs font-bold text-white"
              >
                Pastro filtrat
              </button>
            </div>
          )}

          <div className="mt-8 rounded-lg border border-slate-700/70 bg-[#151d2b] p-4 text-center text-xs text-slate-400">
            <p>
              {t("Lojërat e kazinosë përdorin të njëjtin bilanc me sportbastet. Fitimet shtohen menjëherë në llogarinë tuaj.")}
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (gameId && hiddenGames.includes(gameId)) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-[#0d1420] text-slate-100">
        <Header />
        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center p-6 text-center">
          <div className="rounded-3xl border border-purple-500/30 bg-[#241239]/90 p-8 shadow-2xl backdrop-blur-md">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/20 text-rose-300">
              <EyeOff size={28} />
            </div>
            <h2 className="text-lg font-bold text-white">{t("Kjo lojë është çaktivizuar")}</h2>
            <p className="mt-2 text-xs text-purple-200/70">
              {t("Administratori e ka fshehur përkohësisht këtë lojë nga platforma.")}
            </p>
            <Link
              to="/casino"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#7F00FF] to-[#a85cff] px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-purple-950/50 hover:brightness-110"
            >
              <ArrowLeft size={14} />
              <span>{t("Kthehu te Kazinoja")}</span>
            </Link>
          </div>
        </main>
      </div>
    );
  }

  if (gameId === DEMO_GAME.id) {
    return <CasinoFullscreen key={DEMO_GAME.id} title={DEMO_GAME.title} onExit={() => navigate('/casino')}>
      <div className="flex h-full min-h-0 flex-col bg-black">
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-300/30 bg-[#17130d] px-3 py-2 text-center text-xs font-bold text-amber-100">
          <span className="rounded-sm bg-amber-300 px-1.5 py-0.5 text-[9px] font-black text-black">DEMO</span>
          <span>{t('Kredi virtuale · Nuk përdor bilancin e llogarisë')}</span>
        </div>
        <iframe
          title="Prophecy of Ra Demo"
          src="/app/casino-original/prophecy-ra-demo/src/index.html"
          allow="autoplay; fullscreen"
          className="min-h-0 w-full flex-1 border-0 bg-black"
        />
      </div>
    </CasinoFullscreen>;
  }

  const game = GAMES.find((g) => g.id === gameId);
  if (!game) return <Navigate to="/casino" replace />;

  return <CasinoFullscreen key={game.id} title={game.title} onExit={exitGame}>
    <Suspense fallback={<div role="status" className="p-6 text-sm text-white">{t('common.loading')}</div>}>
      <CasinoOriginalWallet game={game.id}/>
    </Suspense>
  </CasinoFullscreen>;
}
