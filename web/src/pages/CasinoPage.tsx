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
      <div className="flex min-h-[100dvh] flex-col bg-gradient-to-b from-[#160b24] via-[#10081a] to-[#0c0514] text-white">
        <Header />
        <main className="mx-auto w-full max-w-[1360px] flex-1 px-3 pb-16 pt-5 sm:px-6">
          {/* Top Bar Navigation & Controls */}
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <Link
              to="/"
              className="group inline-flex items-center gap-2.5 rounded-full border border-purple-500/30 bg-[#25133c]/80 px-5 py-2.5 text-xs font-bold text-purple-200 shadow-lg shadow-purple-950/40 backdrop-blur-xl transition-all duration-300 hover:border-purple-400 hover:bg-[#381c5a] hover:text-white hover:shadow-purple-700/25 active:scale-95 self-start"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-500/20 text-purple-300 transition-all duration-300 group-hover:bg-purple-500/40 group-hover:text-white group-hover:-translate-x-0.5">
                <ArrowLeft size={14} />
              </div>
              <span className="tracking-wide">{t("Kthehu te sporti")}</span>
            </Link>

            {/* Category Tabs */}
            <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-full border border-purple-500/30 bg-[#1e0f2f]/80 backdrop-blur-xl shadow-lg shadow-purple-950/30">
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={`rounded-full px-4 py-2 text-xs font-bold transition-all ${
                  activeTab === 'all'
                    ? 'bg-gradient-to-r from-[#7F00FF] to-[#a85cff] text-white shadow-md shadow-purple-900/50'
                    : 'text-purple-200/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                Të gjitha ({ALL_GAMES.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('popular')}
                className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-all ${
                  activeTab === 'popular'
                    ? 'bg-gradient-to-r from-[#7F00FF] to-[#a85cff] text-white shadow-md shadow-purple-900/50'
                    : 'text-purple-200/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Flame size={14} className="text-amber-400" />
                <span>Popullore</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('fruits')}
                className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-all ${
                  activeTab === 'fruits'
                    ? 'bg-gradient-to-r from-[#7F00FF] to-[#a85cff] text-white shadow-md shadow-purple-900/50'
                    : 'text-purple-200/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Cherry size={14} className="text-rose-400" />
                <span>Fruta & Hot</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('slots')}
                className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-all ${
                  activeTab === 'slots'
                    ? 'bg-gradient-to-r from-[#7F00FF] to-[#a85cff] text-white shadow-md shadow-purple-900/50'
                    : 'text-purple-200/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                <BookOpen size={14} className="text-amber-300" />
                <span>Aventurë & Slots</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('demo')}
                className={`rounded-full px-4 py-2 text-xs font-bold transition-all ${
                  activeTab === 'demo'
                    ? 'bg-gradient-to-r from-[#7F00FF] to-[#a85cff] text-white shadow-md shadow-purple-900/50'
                    : 'text-purple-200/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                Demo
              </button>
            </div>

            {/* Search Input */}
            <div className="relative min-w-[220px] sm:w-64">
              <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-300/70" />
              <input
                type="text"
                placeholder="Kërko lojën..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-full border border-purple-500/30 bg-[#1e0f2f]/80 py-2.5 pl-10 pr-4 text-xs font-semibold text-white placeholder-purple-300/50 shadow-md backdrop-blur-xl transition-all focus:border-purple-400 focus:bg-[#25133c] focus:outline-none focus:ring-1 focus:ring-purple-400"
              />
            </div>
          </div>

          {/* Modern Games Grid */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">
            {filteredGames.map((game) => (
              <Link
                key={game.id}
                to={`/casino/${game.id}`}
                onClick={() => { void requestCasinoLandscape(); }}
                className="group relative flex flex-col overflow-hidden rounded-3xl border border-purple-500/20 bg-gradient-to-b from-[#241239]/90 to-[#140a20]/95 shadow-xl shadow-purple-950/40 backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:border-purple-400/60 hover:shadow-2xl hover:shadow-purple-900/40"
              >
                {/* Visual Image Container with 16/10 aspect */}
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-black/40">
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
                <div className="flex flex-1 flex-col justify-between border-t border-purple-500/20 bg-[#140a20]/95 p-4">
                  <div className="mb-3">
                    <h2 className="truncate text-sm font-black text-white group-hover:text-amber-300 transition-colors sm:text-base">
                      {game.title}
                    </h2>
                    <p className="mt-0.5 truncate text-[11px] font-medium text-purple-200/70">
                      {game.subtitle}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-purple-500/15">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300/80">
                      {game.demo ? 'Kredi Demo' : 'Para Reale'}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-500/20 border border-purple-400/30 px-3 py-1 text-[11px] font-extrabold text-purple-200 group-hover:border-amber-400 group-hover:bg-amber-400 group-hover:text-black transition-all duration-300">
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

          <div className="mt-8 rounded-2xl border border-purple-500/20 bg-[#1e102f]/60 p-4 text-center text-xs text-purple-300/80 backdrop-blur-md">
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
      <div className="flex min-h-[100dvh] flex-col bg-gradient-to-b from-[#160b24] via-[#10081a] to-[#0c0514] text-white">
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
