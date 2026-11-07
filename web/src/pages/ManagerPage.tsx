import { useState, useEffect } from 'react';
import Header from '../components/Layout/Header';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../api/client';
import { User, Ticket } from '../types';
import SystemTicketSummary from '../components/Betslip/SystemTicketSummary';
import { Plus, ShieldAlert, CheckCircle, Ban, ArrowDownRight, ArrowUpRight, Trash2, Edit3, RotateCcw, Users as UsersIcon, Ticket as TicketIcon, ChevronDown, ChevronUp, Search, Wallet, BarChart3, RefreshCw, X } from 'lucide-react';
import FinancialChart from '../components/Finance/FinancialChart';
import CasinoFinanceCenter from '../components/Finance/CasinoFinanceCenter';
import { formatMarketSelectionLabel, formatTicketSelection, translateTicketStatus, translateTicketType } from '../utils/sportsbookLabels';
import { formatOdds } from '../utils/formatOdds';

interface PlayerFinancial {
  id: string;
  totalStake: number;
  wonPayouts: number;
  lostStake: number;
  commission: number;
  sportCommission: number;
  casinoCommission: number;
  commissionByTier: { single: number; double: number; multi: number; casino: number };
  commissionRates: { single: number; double: number; multi: number; casino: number };
  netDifference: number;
}

interface ManagerFinancial {
  balance: number;
  playerBalance: number;
  totalStake: number;
  wonPayouts: number;
  lostStake: number;
  commission: number;
  sportCommission: number;
  casinoCommission: number;
  commissionRates: { single: number; double: number; multi: number; casino: number };
  netDifference: number;
}

interface FinancialState {
  manager: ManagerFinancial;
  players: PlayerFinancial[];
}

export default function ManagerPage() {
  const { t, lang } = useLanguage();
  const locale = lang === 'en' ? 'en-GB' : 'sq-AL';
  const { refreshUser } = useAuth();
  const [tab, setTab] = useState<'users' | 'tickets' | 'finance'>('users');
  const [searchUser, setSearchUser] = useState('');
  const [userStatus, setUserStatus] = useState<'ALL' | 'ACTIVE' | 'FROZEN' | 'BANNED'>('ALL');
  const [showFinancialDetails, setShowFinancialDetails] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [financials, setFinancials] = useState<FinancialState | null>(null);
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBalanceModal, setShowBalanceModal] = useState<'deposit' | 'withdraw' | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [financeUserId,setFinanceUserId] = useState('');
  const [amount, setAmount] = useState('');

  // Create form
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [initialBalance, setInitialBalance] = useState('100');

  // Edit form
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');

  const fetchUsers = async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      const [usersRes, statsRes] = await Promise.all([
        apiClient.get('/manager/users'),
        apiClient.get('/manager/stats'),
      ]);
      setUsers(usersRes.data);
      setFinancials(statsRes.data.financials);
    } catch (e) {
      console.error(e);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const fetchTickets = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/manager/tickets');
      setTickets(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'users') {
      void fetchUsers();
      const refreshTimer = window.setInterval(() => void fetchUsers(false), 30000);
      return () => window.clearInterval(refreshTimer);
    }
    if (tab === 'tickets') void fetchTickets();
  }, [tab]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/manager/users', {
        username,
        password,
        initialBalance: parseFloat(initialBalance) || 0
      });
      setShowCreateModal(false);
      setUsername('');
      setPassword('');
      setInitialBalance('100');
      fetchUsers();
      alert(t('admin.user_created'));
    } catch (e: any) {
      alert(t(e.response?.data?.error || t('admin.create_failed')));
    }
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    try {
      const data: any = {};
      if (editUsername && editUsername !== selectedUser.username) data.username = editUsername;
      if (editPassword) data.password = editPassword;
      if (Object.keys(data).length > 0) {
        await apiClient.patch(`/manager/users/${selectedUser.id}`, data);
      }
      setShowEditModal(false);
      setSelectedUser(null);
      setEditUsername('');
      setEditPassword('');
      fetchUsers();
      alert(t('admin.user_updated'));
    } catch (e: any) {
      alert(t(e.response?.data?.error || t('admin.update_failed')));
    }
  };

  const handleDeleteUser = async (userId: string, username: string) => {
    if (!confirm(`${t('Fshij llogarinë')} "${username}"? ${t('Bilanci i mbetur kalon te llogaria jote. Historiku i lojtarit pastrohet në pastrimin mujor pas datës 2; detyrimet në pritje ruhen.')}`)) return;
    try {
      await apiClient.delete(`/manager/users/${userId}`);
      alert(t('admin.user_deleted'));
    } catch (e: any) {
      alert(t(e.response?.data?.error || t('admin.delete_failed')));
    } finally {
      await refreshUser();
      void fetchUsers();
    }
  };

  const handleStatusChange = async (userId: string, newStatus: string) => {
    try {
      await apiClient.patch(`/manager/users/${userId}/status`, { status: newStatus });
      fetchUsers();
    } catch (e: any) {
      alert(t(e.response?.data?.error || t('admin.status_failed')));
    }
  };

  const handleBalanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !amount) return;
    try {
      const val = parseFloat(amount);
      if (showBalanceModal === 'deposit') {
        await apiClient.post(`/manager/users/${selectedUser.id}/deposit`, { amount: val });
      } else {
        await apiClient.post(`/manager/users/${selectedUser.id}/withdraw`, { amount: val });
      }
      setShowBalanceModal(null);
      setSelectedUser(null);
      setAmount('');
      fetchUsers();
      alert(t('admin.balance_updated'));
    } catch (e: any) {
      alert(t(e.response?.data?.error || t('admin.transaction_failed')));
    }
  };

  const handleRevertTicket = async (ticketId: string) => {
    if (!confirm(t('manager.confirm_revert'))) return;
    try {
      const res = await apiClient.post(`/manager/tickets/${ticketId}/revert`);
      alert(`${t('manager.ticket_reverted')} ${res.data.refunded.toFixed(2)} ${t('Lëk')}`);
      fetchTickets();
      fetchUsers(false);
    } catch (e: any) {
      alert(t(e.response?.data?.error || t('manager.revert_failed')));
    }
  };

  const filteredUsers = users.filter(u =>
    (userStatus === 'ALL' || u.status === userStatus) &&
    u.username.toLocaleLowerCase().includes(searchUser.trim().toLocaleLowerCase())
  );

  const openEditModal = (u: User) => {
    setSelectedUser(u);
    setEditUsername(u.username);
    setEditPassword('');
    setShowEditModal(true);
  };

  return (
    <div className="min-h-[100dvh] bg-primary flex flex-col">
      <Header />
      <div className="border-b border-tertiary bg-secondary px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-7xl flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white">{t("Paneli i menaxherit")}</h1>
            <p className="mt-1 text-xs sm:text-sm text-text-secondary">{t("Lojtarët, bilancet dhe skedinat në një vend")}</p>
          </div>
          <button
            type="button"
            onClick={() => tab === 'users' ? void fetchUsers() : void fetchTickets()}
            className="inline-flex items-center gap-2 rounded-xl border border-tertiary bg-primary px-3 py-2.5 text-sm font-bold text-white hover:bg-tertiary"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> {" " + t("Rifresko")}</button>
        </div>
      </div>
      <div className="bg-secondary/95 border-b border-tertiary px-3 sm:px-6">
        <div className="mx-auto max-w-7xl flex gap-2 sm:gap-4 overflow-x-auto py-2.5">
          <button 
            onClick={() => setTab('users')}
            className={`flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              tab === 'users' 
                ? 'bg-accent-green text-primary shadow-sm' 
                : 'text-text-secondary hover:text-white hover:bg-tertiary/60'
            }`}
          >
            <UsersIcon size={16} /> <span>{t('manager.my_users')}</span>
          </button>
          <button 
            onClick={() => setTab('tickets')}
            className={`flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              tab === 'tickets' 
                ? 'bg-accent-green text-primary shadow-sm' 
                : 'text-text-secondary hover:text-white hover:bg-tertiary/60'
            }`}
          >
            <TicketIcon size={16} /> <span>{t('manager.tickets')}</span>
          </button>
          <button type="button" onClick={() => {setFinanceUserId('');setTab('finance');}}
            className={'flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs sm:text-sm font-bold '+(tab==='finance'?'bg-accent-green text-primary':'text-text-secondary hover:text-white')}>
            <Wallet size={16}/> {" " + t("Financat Sport + Kazino")}</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'finance' ? (
          <CasinoFinanceCenter role="manager" initialUserId={financeUserId}/>
        ) : tab === 'users' ? (
          <div className="p-4 sm:p-6 max-w-7xl mx-auto">
            {financials?.manager && (
              <div className="mb-6 space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-tertiary bg-secondary p-4">
                    <div className="flex items-center gap-2 text-xs text-text-secondary"><UsersIcon size={15} /> {" " + t("Lojtarë gjithsej")}</div>
                    <div className="mt-2 text-2xl font-black text-white">{users.length}</div>
                  </div>
                  <div className="rounded-xl border border-tertiary bg-secondary p-4">
                    <div className="flex items-center gap-2 text-xs text-text-secondary"><CheckCircle size={15} /> {" " + t("Llogari aktive")}</div>
                    <div className="mt-2 text-2xl font-black text-white">{users.filter(u => u.status === 'ACTIVE').length}</div>
                  </div>
                  <div className="rounded-xl border border-tertiary bg-secondary p-4">
                    <div className="flex items-center gap-2 text-xs text-text-secondary"><Wallet size={15} /> {" " + t("Komisioni i sporteve")}</div>
                    <div className="mt-2 text-lg sm:text-xl font-black text-white">{(financials.manager.sportCommission ?? 0).toFixed(2)} {" " + t("Lëk")}</div>
                  </div>
                  <div className="rounded-xl border border-tertiary bg-secondary p-4">
                    <div className="flex items-center gap-2 text-xs text-text-secondary"><BarChart3 size={15} /> {" " + t("Komisioni i slot machine")}</div>
                    <div className="mt-2 text-lg sm:text-xl font-black text-white">{(financials.manager.casinoCommission ?? 0).toFixed(2)} {" " + t("Lëk")}</div>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-text-secondary">{t("Komisionet janë vetëm raport; llogaritjet bëhen veçmas, pa ndryshuar bilancin.")}</p>
                <button
                  type="button"
                  onClick={() => setShowFinancialDetails(open => !open)}
                  aria-expanded={showFinancialDetails}
                  className="flex w-full items-center justify-between rounded-xl border border-tertiary bg-secondary px-4 py-3 text-left text-sm font-bold text-white hover:bg-tertiary/60"
                >
                  <span className="flex items-center gap-2"><BarChart3 size={17} className="text-accent-green" /> {" " + t("Raporti financiar i detajuar")}</span>
                  {showFinancialDetails ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
                {showFinancialDetails && <div className="space-y-4">
                <div className={`rounded-xl border p-5 ${financials.manager.netDifference >= 0 ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-rose-500/30 bg-rose-500/10'}`}>
                  <div className="text-sm text-text-secondary">{t("Pozicioni financiar")}</div>
                  <div className={`mt-1 text-2xl font-black ${financials.manager.netDifference >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {financials.manager.netDifference >= 0 ? '+' : ''}{financials.manager.netDifference.toFixed(2)} {" " + t("Lëk") + " "}{t(financials.manager.netDifference >= 0 ? 'në PLUS' : 'në MINUS')}
                  </div>
                  <div className="mt-1 text-xs text-text-secondary">{t("Diferenca = baste të mbyllura − pagesat reale të fitimeve")}</div>
                </div>
                <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
                  {([
                    [t("Komisioni i sporteve"), financials.manager.sportCommission],
                    [t("Fonde të luajtura"), financials.manager.totalStake],
                    ['Fitime të paguara', financials.manager.wonPayouts],
                    ['Humbje të lojtarëve', financials.manager.lostStake],
                    [t("Bilanci i lojtarëve"), financials.manager.playerBalance],
                    [t("Komisioni i slot machine"), financials.manager.casinoCommission],
                  ] as const).map(([label, value]) => (
                    <div key={label} className={`rounded-xl border bg-secondary p-4 ${label === t('Komisioni i sporteve') ? 'border-amber-500/30' : 'border-tertiary'}`}>
                      <div className="text-xs text-text-secondary">{t(label)}</div>
                      <div className={`mt-1 text-lg font-bold ${label === t('Komisioni i sporteve') ? 'text-amber-300' : 'text-white'}`}>{Number(value).toFixed(2)} {" " + t("Lëk")}</div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-tertiary bg-secondary px-4 py-3 text-xs text-text-secondary">
                  <span className="font-semibold text-white">{t("Komisionet janë vetëm raport; llogaritjet bëhen veçmas, pa ndryshuar bilancin.")}</span>
                  <span>{t("1 zgjedhje") + " "}<b className="text-accent-yellow">{financials.manager.commissionRates.single}%</b></span>
                  <span>{t("2 zgjedhje") + " "}<b className="text-accent-yellow">{financials.manager.commissionRates.double}%</b></span>
                  <span>{t("3+ zgjedhje") + " "}<b className="text-accent-yellow">{financials.manager.commissionRates.multi}%</b></span>
                  <span>{t("Slot machine") + " "}<b className="text-accent-yellow">{financials.manager.commissionRates.casino}%</b></span>
                </div>
                <FinancialChart
                  title={t("Grafiku financiar")}
                  description="Përmbledhje e aktivitetit dhe bilancit aktual të llogarive të tua."
                  items={[
                    { label: 'Fonde të luajtura', value: financials.manager.totalStake, color: 'bg-sky-400' },
                    { label: 'Pagesa fituese', value: financials.manager.wonPayouts, color: 'bg-emerald-400' },
                    { label: 'Humbje të lojtarëve', value: financials.manager.lostStake, color: 'bg-rose-400' },
                    { label: 'Komisioni i sporteve', value: financials.manager.sportCommission, color: 'bg-amber-400' },
                    { label: 'Bilanci i lojtarëve', value: financials.manager.playerBalance, color: 'bg-violet-400' },
                    { label: 'Komisioni i slot machine', value: financials.manager.casinoCommission, color: 'bg-cyan-400' },
                    { label: 'Diferenca neto', value: financials.manager.netDifference, color: 'bg-fuchsia-400' },
                  ]}
                />
                </div>}
              </div>
            )}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4 sm:mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white">{t('manager.my_users')}</h2>
                <p className="text-text-secondary text-sm">{t('manager.manage_your_users')}</p>
              </div>
              <button 
                onClick={() => setShowCreateModal(true)}
                className="bg-accent-green hover:bg-emerald-600 text-primary px-4 py-2.5 rounded-lg font-bold flex items-center gap-2 transition"
              >
                <Plus size={18} /> {t('admin.create_player')}
              </button>
            </div>

            <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-tertiary bg-secondary p-3 sm:flex-row sm:items-center">
              <label className="relative flex-1">
                <span className="sr-only">{t("Kërko lojtarin")}</span>
                <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  type="search"
                  value={searchUser}
                  onChange={event => setSearchUser(event.target.value)}
                  placeholder={t("Kërko lojtar sipas emrit...")}
                  className="w-full rounded-xl border border-tertiary bg-primary py-3 pl-10 pr-3 text-sm text-white placeholder:text-text-secondary focus:border-accent-green focus:outline-none"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                {t("Statusi")}<select
                  value={userStatus}
                  onChange={event => setUserStatus(event.target.value as typeof userStatus)}
                  className="min-w-40 rounded-xl border border-tertiary bg-primary px-3 py-3 text-sm text-white focus:border-accent-green focus:outline-none"
                >
                  <option value="ALL">{t("Të gjithë")}</option>
                  <option value="ACTIVE">{t("Aktivë")}</option>
                  <option value="FROZEN">{t("Të ngrirë")}</option>
                  <option value="BANNED">{t("Të bllokuar")}</option>
                </select>
              </label>
              <span className="text-xs text-text-secondary">{t("Shfaqur:") + " "}{filteredUsers.length}</span>
            </div>
            <div className="bg-secondary rounded-xl border border-tertiary shadow-xl overflow-hidden">
              {loading ? (
                <div className="p-12 text-center text-text-secondary">{t('admin.loading_accounts')}</div>
              ) : filteredUsers.length === 0 ? (
                <div className="p-12 text-center text-text-secondary">{users.length === 0 ? t('manager.no_users') : t('Nuk u gjet asnjë lojtar me këta filtra.')}</div>
              ) : (
                <>
                <div className="grid gap-3 p-3 lg:hidden">
                  {filteredUsers.map(u => {
                    const finance = financials?.players.find(p => p.id === u.id);
                    return (
                      <article key={u.id} className="rounded-xl border border-tertiary bg-primary p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="break-words font-bold text-white">{u.username}</div>
                            <div className="mt-1 text-xs text-text-secondary">{t("Bilanci i lojtarit")}</div>
                            <div className="text-lg font-black text-white">{u.balance.toFixed(2)} {u.currency || t("Lëk")}</div>
                          </div>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${u.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-400' : u.status === 'FROZEN' ? 'bg-amber-500/15 text-amber-400' : 'bg-rose-500/15 text-rose-400'}`}>
                            {t(u.status === 'ACTIVE' ? 'Aktiv' : u.status === 'FROZEN' ? 'I ngrirë' : 'I bllokuar')}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 rounded-lg bg-secondary p-3 text-xs">
                          <div><span className="block text-text-secondary">{t("Fonde të luajtura")}</span><strong className="mt-1 block text-white">{(finance?.totalStake ?? 0).toFixed(2)} {" " + t("Lëk")}</strong></div>
                          <div><span className="block text-text-secondary">{t("Komisioni i sporteve")}</span><strong className="mt-1 block text-amber-300">{(finance?.sportCommission ?? 0).toFixed(2)} {t("Lëk")}</strong></div>
                          <div><span className="block text-text-secondary">{t("Komisioni i slot machine")}</span><strong className="mt-1 block text-cyan-300">{(finance?.casinoCommission ?? 0).toFixed(2)} {t("Lëk")}</strong></div>
                        </div>
                        <button type="button" onClick={()=>{setFinanceUserId(u.id);setTab('finance');}} className="w-full rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-sm font-bold text-emerald-300">{t("Financat Sport + Kazino")}</button>
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => { setSelectedUser(u); setShowBalanceModal('deposit'); }} className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 py-2.5 text-xs font-bold text-emerald-400"><ArrowUpRight size={15} /> {t('admin.deposit')}</button>
                          <button type="button" onClick={() => { setSelectedUser(u); setShowBalanceModal('withdraw'); }} className="flex items-center justify-center gap-1.5 rounded-lg bg-amber-500/15 py-2.5 text-xs font-bold text-amber-400"><ArrowDownRight size={15} /> {t('admin.withdraw')}</button>
                          <button type="button" onClick={() => openEditModal(u)} className="flex items-center justify-center gap-1.5 rounded-lg bg-accent-blue/15 py-2.5 text-xs font-bold text-accent-blue"><Edit3 size={15} /> {" " + t("Ndrysho")}</button>
                          <button type="button" onClick={() => handleStatusChange(u.id, u.status === 'ACTIVE' ? 'FROZEN' : 'ACTIVE')} className="flex items-center justify-center gap-1.5 rounded-lg bg-tertiary py-2.5 text-xs font-bold text-white">{t(u.status === 'ACTIVE' ? 'Ngrij' : 'Aktivizo')}</button>
                        </div>
                        <div className="flex justify-end gap-4 border-t border-tertiary pt-3">
                          {u.status !== 'BANNED' && <button type="button" onClick={() => handleStatusChange(u.id, 'BANNED')} className="text-xs font-bold text-rose-400">{t("Blloko")}</button>}
                          <button type="button" onClick={() => handleDeleteUser(u.id, u.username)} className="flex items-center gap-1 text-xs font-bold text-rose-400"><Trash2 size={13} /> {" " + t("Fshi")}</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
                <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[1050px] text-left text-text-primary text-sm">
                  <thead className="bg-tertiary/60 uppercase text-xs text-text-secondary">
                    <tr>
                      <th className="p-4">{t('admin.username')}</th>
                      <th className="p-4">{t('admin.status')}</th>
                      <th className="p-4">{t('admin.balance')}</th>
                      <th className="p-4 text-right">{t("Fonde të luajtura")}</th>
                      <th className="p-4 text-right">{t("Fitime / humbje")}</th>
                      <th className="p-4 text-right">{t("Komision / diferencë")}</th>
                      <th className="p-4 text-right">{t('admin.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-tertiary">
                    {filteredUsers.map(u => (
                      <tr key={u.id} className="hover:bg-primary/40 transition">
                        <td className="p-4 font-semibold text-white flex items-center gap-2">
                          <span className="w-8 h-8 rounded-full bg-accent-blue/20 text-accent-blue flex items-center justify-center font-bold text-xs uppercase">
                            {u.username.substring(0, 2)}
                          </span>
                          {u.username}
                        </td>
                        <td className="p-4">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 ${
                            u.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400' :
                            u.status === 'FROZEN' ? 'bg-amber-500/20 text-amber-400' : 'bg-rose-500/20 text-rose-400'
                          }`}>
                            {u.status === 'ACTIVE' && <CheckCircle size={12} />}
                            {u.status === 'FROZEN' && <ShieldAlert size={12} />}
                            {u.status === 'BANNED' && <Ban size={12} />}
                            {t(u.status === 'ACTIVE' ? 'Aktiv' : u.status === 'FROZEN' ? 'I ngrirë' : u.status === 'BANNED' ? 'I bllokuar' : u.status)}
                          </span>
                        </td>
                        <td className="p-4 text-base font-bold text-white">
                          {u.balance.toFixed(2)} {u.currency || t("Lëk")}
                        </td>
                        {(() => {
                          const finance = financials?.players.find((player) => player.id === u.id);
                          return (
                            <>
                              <td className="p-4 text-right text-white">{(finance?.totalStake ?? 0).toFixed(2)} {" " + t("Lëk")}</td>
                              <td className="p-4 text-right text-white">
                                <div>{(finance?.wonPayouts ?? 0).toFixed(2)} {" " + t("Lëk fitime")}</div>
                                <div className="text-xs text-text-secondary">{(finance?.lostStake ?? 0).toFixed(2)} {" " + t("Lëk humbje")}</div>
                              </td>
                              <td className="p-4 text-right">
                                <div className="font-semibold text-white">{t("Komisioni i sporteve")}: {(finance?.sportCommission ?? 0).toFixed(2)} {t("Lëk")}</div>
                                <div className="mt-1 text-xs text-cyan-300">{t("Komisioni i slot machine")}: {(finance?.casinoCommission ?? 0).toFixed(2)} {t("Lëk")}</div>
                                <div className="mt-1 space-y-0.5 text-[11px] text-text-secondary">
                                  <div>{finance?.commissionRates.single ?? financials?.manager.commissionRates.single ?? 3}{t("% teke:") + " "}{(finance?.commissionByTier.single ?? 0).toFixed(2)} {" " + t("Lëk")}</div>
                                  <div>{finance?.commissionRates.double ?? financials?.manager.commissionRates.double ?? 5}{t("% dyshe:") + " "}{(finance?.commissionByTier.double ?? 0).toFixed(2)} {" " + t("Lëk")}</div>
                                  <div>{finance?.commissionRates.multi ?? financials?.manager.commissionRates.multi ?? 7}% 3+: {(finance?.commissionByTier.multi ?? 0).toFixed(2)} {" " + t("Lëk")}</div>
                                </div>
                                <div className={`text-xs font-semibold ${(finance?.netDifference ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {(finance?.netDifference ?? 0) >= 0 ? '+' : ''}{(finance?.netDifference ?? 0).toFixed(2)} {" " + t("Lëk")}</div>
                              </td>
                            </>
                          );
                        })()}
                        <td className="p-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button type="button" onClick={()=>{setFinanceUserId(u.id);setTab('finance');}} className="rounded-lg bg-emerald-500/15 px-2 py-1.5 text-xs font-bold text-emerald-300">{t("Financat")}</button>
                            <button 
                              onClick={() => { setSelectedUser(u); setShowBalanceModal('deposit'); }}
                              className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg text-xs font-semibold flex items-center gap-1"
                              title={t('admin.add_money')}
                            >
                              <ArrowUpRight size={14} /> {t('admin.deposit')}
                            </button>
                            <button 
                              onClick={() => { setSelectedUser(u); setShowBalanceModal('withdraw'); }}
                              className="p-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-lg text-xs font-semibold flex items-center gap-1"
                              title={t('admin.withdraw_money')}
                            >
                              <ArrowDownRight size={14} /> {t('admin.withdraw')}
                            </button>
                            <button 
                              onClick={() => openEditModal(u)}
                              className="p-1.5 bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue rounded-lg text-xs font-semibold flex items-center gap-1"
                              title={t('admin.edit_user')}
                            >
                              <Edit3 size={14} />
                            </button>
                            {u.status === 'ACTIVE' ? (
                              <button 
                                onClick={() => handleStatusChange(u.id, 'FROZEN')}
                                className="px-2 py-1 bg-tertiary hover:bg-amber-500/20 text-text-secondary hover:text-amber-400 rounded-lg text-xs font-semibold"
                              >
                                {t('admin.freeze')}
                              </button>
                            ) : (
                              <button 
                                onClick={() => handleStatusChange(u.id, 'ACTIVE')}
                                className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded-lg text-xs font-semibold"
                              >
                                {t('admin.activate')}
                              </button>
                            )}
                            {u.status !== 'BANNED' && (
                              <button 
                                onClick={() => handleStatusChange(u.id, 'BANNED')}
                                className="px-2 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg text-xs font-semibold"
                              >
                                {t('admin.ban')}
                              </button>
                            )}
                            <button 
                              onClick={() => handleDeleteUser(u.id, u.username)}
                              className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg text-xs font-semibold"
                              title={t('admin.delete_user')}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="p-4 sm:p-6 max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4 sm:mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white">{t('manager.tickets')}</h2>
                <p className="text-text-secondary text-sm">{t('manager.manage_tickets')}</p>
              </div>
              <button 
                onClick={fetchTickets}
                className="px-4 py-2 bg-tertiary hover:bg-tertiary/80 text-white rounded-lg text-sm font-semibold transition"
              >
                {t('admin.refresh_bets')}
              </button>
            </div>

            <div className="bg-secondary rounded-xl border border-tertiary shadow-xl overflow-hidden">
              {loading ? (
                <div className="p-12 text-center text-text-secondary">{t('admin.loading_tickets')}</div>
              ) : tickets.length === 0 ? (
                <div className="p-12 text-center text-text-secondary">{t('admin.no_tickets')}</div>
              ) : (
                <div className="divide-y divide-tertiary">
                  {tickets.map(ticket => {
                    const expanded = expandedTicketId === ticket.id;
                    return (
                    <div key={ticket.id} className="p-4 hover:bg-primary/30 transition">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className={`p-2.5 rounded-xl flex items-center justify-center ${
                            ticket.status === 'WON' ? 'bg-emerald-500/20 text-emerald-400' :
                            ticket.status === 'LOST' ? 'bg-rose-500/20 text-rose-400' :
                            ticket.status === 'REVERTED' ? 'bg-purple-500/20 text-purple-400' : 'bg-amber-500/20 text-amber-400'
                          }`}>
                            {ticket.status === 'WON' && <CheckCircle size={20} />}
                            {ticket.status === 'LOST' && <Ban size={20} />}
                            {ticket.status === 'REVERTED' && <RotateCcw size={20} />}
                            {ticket.status === 'PENDING' && <ShieldAlert size={20} />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-base">{t("Skedina #")}{ticket.id.substring(0, 8)}</span>
                              {ticket.bookingCode && (
                                <span className="text-xs bg-accent-blue/20 text-accent-blue font-mono px-2 py-0.5 rounded font-bold">{t('admin.code')}: {ticket.bookingCode}</span>
                              )}
                              <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                                ticket.status === 'WON' ? 'bg-emerald-500/20 text-emerald-400' :
                                ticket.status === 'LOST' ? 'bg-rose-500/20 text-rose-400' :
                                ticket.status === 'REVERTED' ? 'bg-purple-500/20 text-purple-400' : 'bg-amber-500/20 text-amber-400'
                              }`}>{translateTicketStatus(ticket.status, t)}</span>
                            </div>
                            <div className="text-xs text-text-secondary mt-1">
                              <span>{t("Përdoruesi:") + " "}<strong className="text-white">{ticket.user?.username || 'Vizitor'}</strong></span>
                              <span> &bull; {new Date(ticket.placedAt).toLocaleString(locale)}</span>
                              <span> &bull; {t('tickets.type')}: {translateTicketType(ticket.ticketType, t)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="text-xs text-text-secondary">{t('Shuma / Fitimi i mundshëm')}{ticket.potentialPayoutIsEstimated ? ' · '+t('i rindërtuar') : ''}</div>
                            <div className="text-sm font-bold text-white">
                              {ticket.stake.toFixed(2)} {" " + t("Lëk →") + " "}<span className="text-accent-green">{ticket.potentialPayout.toFixed(2)} {" " + t("Lëk")}</span>
                            </div>
                            {ticket.potentialPayoutIsEstimated && <div className="text-xs text-text-secondary" title={t('Vlerë e rindërtuar nga shuma dhe koeficienti i ruajtur; shuma origjinale nuk ishte ruajtur.')}>{t('Vlerë e rindërtuar nga shuma dhe koeficienti i ruajtur.')}</div>}
                            {ticket.actualPayout != null && (ticket.status !== 'PENDING' || ticket.actualPayout > 0) && <div className="text-xs text-text-secondary">{t('Fitimi real')}: {ticket.actualPayout.toFixed(2)} {t('Lëk')}</div>}
                          </div>
                          {ticket.status === 'PENDING' && (
                            <button
                              onClick={() => handleRevertTicket(ticket.id)}
                              className="px-3 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded-lg text-xs font-bold flex items-center gap-1.5 transition"
                            >
                              <RotateCcw size={14} /> {t('manager.revert')}
                            </button>
                          )}
                          <button
                            onClick={() => setExpandedTicketId(expanded ? null : ticket.id)}
                            className="p-2 bg-tertiary hover:bg-tertiary/80 text-text-secondary hover:text-white rounded-lg transition"
                            title={t("Shfaq ndeshjet dhe zgjedhjet")}
                          >
                            {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                          </button>
                        </div>
                      </div>
                      {expanded && (
                        <div className="mt-4 pt-4 border-t border-tertiary/60 grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div className="md:col-span-2"><SystemTicketSummary ticket={ticket} /></div>
                          {ticket.lines.map((line) => (
                            <div key={line.id} className="rounded-lg border border-tertiary bg-primary p-3 text-xs">
                              <div className="text-text-secondary">{line.matchName}</div>
                              <div className="mt-1 font-semibold text-white">{formatMarketSelectionLabel(line.marketName, line.marketLine, t)}: <span className="text-accent-green">{formatTicketSelection(line.outcomeName, line.marketName, line.matchName, t)}</span></div>
                              <div className="mt-1 flex justify-between text-text-secondary">
                                <span>{t("Kuota") + " "}<b className="text-white">{formatOdds(line.oddsAtPlacement)}</b></span>
                                <span className={line.status === 'WON' ? 'text-emerald-400' : line.status === 'LOST' ? 'text-rose-400' : 'text-amber-400'}>{translateTicketStatus(line.status, t)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );})}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* CREATE USER MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-secondary border border-tertiary rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-2">{t('admin.create_player_account')}</h3>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-text-secondary uppercase block mb-1.5">{t('admin.username')}</label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)} required className="w-full bg-primary border border-tertiary rounded-lg p-3 text-white focus:outline-none focus:border-accent-green" />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-secondary uppercase block mb-1.5">{t('auth.password')}</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full bg-primary border border-tertiary rounded-lg p-3 text-white focus:outline-none focus:border-accent-green" />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-secondary uppercase block mb-1.5">{t('admin.initial_balance')}</label>
                <input type="number" value={initialBalance} onChange={e => setInitialBalance(e.target.value)} min="0" step="0.01" required className="w-full bg-primary border border-tertiary rounded-lg p-3 text-white focus:outline-none focus:border-accent-green" />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowCreateModal(false)} className="flex-1 py-3 bg-tertiary hover:bg-tertiary/80 text-white rounded-lg font-semibold text-sm transition">{t('common.cancel')}</button>
                <button type="submit" className="flex-1 py-3 bg-accent-green hover:bg-emerald-600 text-primary rounded-lg font-bold text-sm transition">{t('admin.create_account')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT USER MODAL */}
      {showEditModal && selectedUser && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-secondary border border-tertiary rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-2">{t('admin.edit_user')}: {selectedUser.username}</h3>
            <form onSubmit={handleEditUser} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-text-secondary uppercase block mb-1.5">{t('admin.username')}</label>
                <input type="text" value={editUsername} onChange={e => setEditUsername(e.target.value)} required className="w-full bg-primary border border-tertiary rounded-lg p-3 text-white focus:outline-none focus:border-accent-green" />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-secondary uppercase block mb-1.5">{t('auth.password')} ({t('admin.leave_blank')})</label>
                <input type="password" value={editPassword} onChange={e => setEditPassword(e.target.value)} placeholder={t('admin.leave_blank')} className="w-full bg-primary border border-tertiary rounded-lg p-3 text-white focus:outline-none focus:border-accent-green" />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowEditModal(false)} className="flex-1 py-3 bg-tertiary hover:bg-tertiary/80 text-white rounded-lg font-semibold text-sm transition">{t('common.cancel')}</button>
                <button type="submit" className="flex-1 py-3 bg-accent-green hover:bg-emerald-600 text-primary rounded-lg font-bold text-sm transition">{t('common.save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* BALANCE MODAL */}
      {showBalanceModal && selectedUser && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-secondary border border-tertiary rounded-2xl max-w-sm w-full p-6 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-2 capitalize">{t(`admin.${showBalanceModal}_funds`)}</h3>
            <p className="text-sm text-text-secondary mb-4">
              {t('admin.player')}: <strong className="text-white">{selectedUser.username}</strong> | {t('admin.current_balance')}: <strong className="text-accent-green">{selectedUser.balance.toFixed(2)} {" " + t("Lëk")}</strong>
            </p>
            <form onSubmit={handleBalanceSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-text-secondary uppercase block mb-1.5">{t('admin.amount')}</label>
                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} min="1" step="0.01" required autoFocus className="w-full bg-primary border border-tertiary rounded-lg p-3 text-white focus:outline-none focus:border-accent-green text-lg font-bold" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowBalanceModal(null)} className="flex-1 py-2.5 bg-tertiary hover:bg-tertiary/80 text-white rounded-lg font-semibold text-sm transition">{t('common.cancel')}</button>
                <button type="submit" className={`flex-1 py-2.5 rounded-lg font-bold text-sm transition ${showBalanceModal === 'deposit' ? 'bg-accent-green hover:bg-emerald-600 text-primary' : 'bg-amber-500 hover:bg-amber-600 text-primary'}`}>{t(`admin.confirm_${showBalanceModal}`)}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
