import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { Menu, X, LogOut, Shield, Users, Ticket, Receipt, Coins } from 'lucide-react';
import LanguagePicker from './LanguagePicker';

interface Props {
  /** small screens only: opens the sports / leagues drawer (the desktop rail is always there) */
  onToggleNav?: () => void;
}

/**
 * The top bar, from a wide desktop down to a phone. The account actions that need room
 * (admin panel, my bets, logout) move into a menu below `md`, so nothing is cut off and the
 * balance stays visible while a bet is being placed.
 */
export default function Header({ onToggleNav }: Props) {
  const { user, logout } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const go = (path: string) => {
    setMenuOpen(false);
    navigate(path);
  };

  const isActive = (path: string) => location.pathname === path;

  const links = (
    <>
      {user?.role !== 'AGENT' && (
        <button
          type="button"
          onClick={() => go('/casino')}
          className={'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all ' +
            (location.pathname.startsWith('/casino')
              ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-black shadow-md shadow-amber-950/40'
              : 'text-purple-200 hover:bg-white/10 hover:text-white')}
        >
          <Coins size={14} /> <span>{t('nav.casino')}</span>
        </button>
      )}
      {user?.role === 'AGENT' && (
        <button
          type="button"
          onClick={() => go('/agent')}
          className="flex items-center gap-1.5 rounded-xl bg-purple-500/20 px-3 py-1.5 text-xs font-bold text-purple-200 border border-purple-400/30 hover:bg-purple-500/30"
        >
          <Users size={14} />{lang === 'en' ? 'Agent panel' : 'Paneli i agjentit'}
        </button>
      )}
      {user?.role === 'ADMIN' && (
        <button
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
            isActive('/admin')
              ? 'bg-gradient-to-r from-[#7F00FF] to-[#a85cff] text-white border border-purple-400/40 shadow-md shadow-purple-950/40'
              : 'text-purple-200 hover:text-white hover:bg-white/10'
          }`}
          onClick={() => go('/admin')}
        >
          <Shield size={14} />
          <span>{t('nav.admin')}</span>
        </button>
      )}
      {user?.role === 'MANAGER' && (
        <button
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
            isActive('/manager')
              ? 'bg-gradient-to-r from-[#7F00FF] to-[#a85cff] text-white border border-purple-400/40 shadow-md shadow-purple-950/40'
              : 'text-purple-200 hover:text-white hover:bg-white/10'
          }`}
          onClick={() => go('/manager')}
        >
          <Users size={14} />
          <span>{t('manager.my_users')}</span>
        </button>
      )}
      {(user?.role === 'ADMIN' || user?.role === 'MANAGER') && (
        <button
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
            isActive('/transactions')
              ? 'bg-gradient-to-r from-[#7F00FF] to-[#a85cff] text-white border border-purple-400/40 shadow-md shadow-purple-950/40'
              : 'text-purple-200 hover:text-white hover:bg-white/10'
          }`}
          onClick={() => go('/transactions')}
        >
          <Receipt size={14} />
          <span>{t('nav.transactions')}</span>
        </button>
      )}
      {user?.role === 'PLAYER' && (
        <button
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
            isActive('/my-bets')
              ? 'bg-gradient-to-r from-[#7F00FF] to-[#a85cff] text-white border border-purple-400/40 shadow-md shadow-purple-950/40'
              : 'text-purple-200 hover:text-white hover:bg-white/10'
          }`}
          onClick={() => go('/my-bets')}
        >
          <Ticket size={14} />
          <span>{t('nav.myBets')}</span>
        </button>
      )}
      {user?.role === 'PLAYER' && (
        <button
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
            isActive('/transactions')
              ? 'bg-gradient-to-r from-[#7F00FF] to-[#a85cff] text-white border border-purple-400/40 shadow-md shadow-purple-950/40'
              : 'text-purple-200 hover:text-white hover:bg-white/10'
          }`}
          onClick={() => go('/transactions')}
        >
          <Receipt size={14} />
          <span>{t('nav.transactions')}</span>
        </button>
      )}
    </>
  );

  return (
    <header className="zshop-header shrink-0 z-20 border-b border-[#62417d] bg-gradient-to-r from-[#251334] to-[#3c1b56]">
      <div className="flex h-14 items-center justify-between gap-1 px-3 sm:h-[62px] sm:gap-2 sm:px-5">
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          {onToggleNav && (
            <button
              onClick={onToggleNav}
              className="rounded-xl border border-[#70558a] bg-[#20132d] p-1.5 text-purple-200 transition hover:border-purple-400/50 hover:text-white lg:hidden sm:p-2"
              aria-label={t('nav.sports')}
            >
              <Menu size={18} />
            </button>
          )}
          <button type="button" onClick={() => navigate('/')}
            aria-label={t('common.home_page')}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
              location.pathname === '/'
                ? 'bg-white/15 text-white shadow-sm'
                : 'text-purple-200 hover:text-white hover:bg-white/10'
            }`}>
            {user?.role === 'AGENT' ? (lang === 'en' ? 'My network' : 'Rrjeti im') : t('nav.sports')}
          </button>
        </div>

        <div className="flex min-w-0 items-center gap-1 sm:gap-3">
          <LanguagePicker />
          {user && (
            <>
              {/* Desktop links */}
              <div className="hidden md:flex items-center gap-1.5">
                {links}
              </div>

              <div className="flex min-w-0 items-center gap-2 rounded-xl border border-purple-500/20 bg-[#1e102f]/80 px-2.5 py-1 text-right leading-tight backdrop-blur-md sm:px-3 sm:py-1.5" aria-label={t('nav.account_balance')}>
                <div className="flex flex-col">
                  <span className="max-w-[76px] truncate text-[10px] font-semibold text-purple-200 sm:max-w-[180px] sm:text-xs">
                    {user.username || t('admin.balance')}
                  </span>
                  <span className="whitespace-nowrap text-xs font-extrabold tabular-nums text-amber-300 sm:text-sm">
                    {user.balance.toFixed(2)} <span className="text-[10px] font-semibold text-amber-200/80">{lang === 'en' ? 'ALL' : 'Lek'}</span>
                  </span>
                </div>
              </div>

              <button
                onClick={() => {
                  logout();
                  navigate('/login');
                }}
                className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-rose-300 hover:text-rose-100 hover:bg-rose-500/20 border border-transparent hover:border-rose-500/30 transition-all"
                title={t('nav.logout')}
              >
                <LogOut size={14} />
                <span>{t('nav.logout')}</span>
              </button>

              {/* Mobile hamburger menu toggle */}
              <button
                className="md:hidden p-1.5 rounded-xl text-purple-200 hover:text-white hover:bg-white/10 transition sm:p-2"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={t('nav.account_menu')}
                aria-expanded={menuOpen}
              >
                {menuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      {menuOpen && user && (
        <div className="md:hidden border-t border-[#62417d] bg-[#241339]/95 backdrop-blur-md px-4 py-3 space-y-2 animate-in slide-in-from-top-2 duration-150">
          <div className="text-[10px] font-black uppercase tracking-wider text-purple-300 mb-1">
            {{ ADMIN: t('admin.administrator'), AGENT: lang === 'en' ? 'Agent' : 'Agjent', MANAGER: t('admin.manager'), PLAYER: t('admin.player') }[user.role]} &bull; {user.username}
          </div>
          <div className="flex flex-col space-y-1">
            {links}
          </div>
          <div className="pt-2 border-t border-[#62417d]/60">
            <button
              className="flex items-center gap-2 w-full text-left py-2 px-3 rounded-xl text-xs font-bold text-rose-300 hover:bg-rose-500/20 transition"
              onClick={() => {
                setMenuOpen(false);
                logout();
                navigate('/login');
              }}
            >
              <LogOut size={15} />
              <span>{t('nav.logout')}</span>
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
