import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutGrid, CircleUserRound, Receipt, MessagesSquare,
  Settings, LogOut, Wallet, X, Bell, Ticket, Coins, Shield, Users
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useBetslip } from '../../context/BetslipContext';
import { useFavorites } from '../../context/FavoritesContext';
import { countBetslipMatches } from '../../utils/betslipMatchCount';
import LanguagePicker from './LanguagePicker';
import { useLanguage } from '../../context/LanguageContext';

type Panel = 'account' | 'notifications' | null;

interface Props {
  onOpenLeagues: () => void;
  onOpenBetslip: () => void;
}

/**
 * Reference-style mobile-only top bar. Real login name and real betslip state,
 * never a hardcoded sample name or static yellow badge.
 */
export default function MobileSportsHeader({ onOpenLeagues, onOpenBetslip }: Props) {
  const { user, logout } = useAuth();
  const {t, lang} = useLanguage();
  const { selections } = useBetslip();
  const { notifications, clearAllNotifications, dismissNotification } = useFavorites();
  const navigate = useNavigate();
  const [panel, setPanel] = useState<Panel>(null);
  const matchCount = countBetslipMatches(selections);

  const toggle = (next: Panel) => setPanel(current => current === next ? null : next);
  const go = (path: string) => { setPanel(null); navigate(path); };

  return (
    <div data-mobile-sports-header className="relative z-30 shrink-0 md:hidden">
      <header className="flex h-[53px] items-center justify-between border-b border-[#62417d] bg-gradient-to-r from-[#251334] to-[#3c1b56] text-white">
        <div className="flex min-w-0 items-center gap-1">
          <button type="button" aria-label={t('sports.open_leagues')} onClick={() => {setPanel(null);onOpenLeagues();}}
            className="flex h-[53px] w-[43px] shrink-0 items-center justify-center border-r border-[#62417d] text-white transition hover:bg-[#ffffff10]">
            <LayoutGrid size={27} strokeWidth={2.5}/>
          </button>
          <button type="button" onClick={() => toggle('account')}
            aria-label={`${t('nav.profile')}: ${user?.username ?? t('nav.user')}`}
            aria-expanded={panel === 'account'}
            className="flex min-w-0 items-center gap-1 px-1 py-1 text-left hover:text-amber-200">
            <CircleUserRound size={25} strokeWidth={2} className="shrink-0 text-white"/>
            <span className="max-w-[38px] truncate text-[12px] font-bold leading-tight min-[390px]:max-w-[82px]">
              {user?.username ?? ''}
            </span>
          </button>
        </div>
        <div className="flex h-full shrink-0 items-center gap-0.5 pr-1">
          <LanguagePicker />
          <button type="button" onClick={() => {setPanel(null);onOpenBetslip();}}
            aria-label={`${t('betslip.betslip')}: ${matchCount}`}
            title={t('betslip.open')}
            className="relative flex h-11 w-9 items-center justify-center rounded hover:bg-[#ffffff12]">
            <Receipt size={25} strokeWidth={2.1}/>
            <span aria-live="polite" className="absolute right-0 top-0 flex min-h-[19px] min-w-[19px] items-center justify-center rounded-full bg-[#e2a600] px-[3px] text-[11px] font-black leading-none text-white">
              {matchCount}
            </span>
          </button>
          <button type="button" aria-label={`${t('nav.notifications')} (${notifications.length})`}
            aria-expanded={panel === 'notifications'} onClick={() => toggle('notifications')}
            title={t('nav.match_notifications')}
            className="relative flex h-11 w-8 items-center justify-center rounded hover:bg-[#ffffff12]">
            <MessagesSquare size={23} fill="#ffffff" stroke="#ffffff" strokeWidth={1.8}/>
            {notifications.length > 0 && (
              <span className="absolute right-0 top-0 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[#e2a600] px-0.5 text-[9px] font-bold text-white">
                {notifications.length}
              </span>
            )}
          </button>
          <button type="button" aria-label={t('nav.account_settings')} aria-expanded={panel === 'account'}
            onClick={() => toggle('account')} title={t('nav.settings')}
            className="flex h-11 w-8 items-center justify-center rounded hover:bg-[#ffffff12]">
            <Settings size={23} fill="#ffffff" stroke="#ffffff" strokeWidth={1.8}/>
          </button>
        </div>
      </header>

      {panel && (
        <>
          <button type="button" aria-label={t('common.close_panel')} onClick={() => setPanel(null)}
            className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm" />
          <div className="sports-account-panel absolute inset-x-2 top-[53px] z-40 rounded-b-2xl border border-[#62417d] bg-[#241339]/95 p-3 shadow-2xl backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between gap-2 border-b border-[#62417d]/60 pb-2">
              <h3 className="text-sm font-bold text-white">
                {panel === 'account' ? (user?.username ?? t('nav.account')) : t('nav.match_notifications')}
              </h3>
              <button type="button" aria-label={t('common.close')} onClick={() => setPanel(null)} className="p-1 text-white hover:text-purple-300"><X size={17}/></button>
            </div>
            {panel === 'notifications' ? (
              <div className="max-h-[55vh] space-y-2 overflow-y-auto text-xs text-purple-200">
                {notifications.length === 0 ? <p className="py-3 text-purple-300/70">{t('nav.no_notifications')}</p> :
                  <>
                    <button type="button" onClick={clearAllNotifications} className="mb-1 text-amber-300 hover:text-white">{t('nav.clear_notifications')}</button>
                    {notifications.map(item => (
                      <div key={item.id} className="flex items-start gap-2 border-b border-[#523769] pb-2">
                        <button type="button" onClick={() => go(`/match/${item.matchId}`)}
                          className="min-w-0 flex-1 text-left">
                          <span className="block font-bold text-white">{item.title}</span>
                          <span>{item.message}</span>
                        </button>
                        <button type="button" aria-label={t('nav.dismiss_notification')} onClick={() => dismissNotification(item.id)} className="p-1"><X size={15}/></button>
                      </div>
                    ))}
                  </>
                }
              </div>
            ) : (
              <div className="space-y-1 text-sm text-white">
                <div className="mb-2 flex items-center gap-2 rounded-xl border border-amber-400/20 bg-[#1a0e2a] px-3 py-2 text-xs">
                  <Wallet size={16} className="text-amber-400"/>
                  <span className="text-purple-200">{t('admin.balance')}</span>
                  <strong className="ml-auto text-amber-300">{user?.balance.toFixed(2) ?? '0.00'} {lang === 'en' ? 'ALL' : 'Lek'}</strong>
                </div>
                {user?.role !== 'AGENT' && (
                  <button type="button" onClick={() => go('/casino')}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-amber-300 hover:bg-[#341d50]"><Coins size={16}/> {t('nav.casino')}</button>
                )}
                <button type="button" onClick={() => go('/my-bets')}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-[#341d50]"><Ticket size={16}/> {t('nav.myBets')}</button>
                <button type="button" onClick={() => go('/transactions')}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-[#341d50]"><Bell size={16}/> {t('nav.transactions')}</button>
                {user?.role === 'ADMIN' && (
                  <button type="button" onClick={() => go('/admin')}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-emerald-400 hover:bg-[#341d50]"><Shield size={16}/> {t('nav.admin')}</button>
                )}
                {user?.role === 'MANAGER' && (
                  <button type="button" onClick={() => go('/manager')}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-emerald-400 hover:bg-[#341d50]"><Users size={16}/> {t('manager.my_users')}</button>
                )}
                <button type="button" onClick={() => {setPanel(null);logout();navigate('/login');}}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-rose-300 hover:bg-[#341d50]"><LogOut size={16}/> {t('nav.logout')}</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
