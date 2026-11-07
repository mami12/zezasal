import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { User, Lock, ArrowRight } from 'lucide-react';
import LanguagePicker from '../components/Layout/LanguagePicker';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(username, password);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.message || t('auth.login_failed'));
    }
  };

  return (
    <div className="min-h-[100dvh] bg-primary flex items-center justify-center px-3 py-8">
      <div className="w-full max-w-[420px] border border-tertiary bg-secondary">
        <div className="flex justify-end px-5 pt-4"><LanguagePicker /></div>
        <form onSubmit={handleLogin} className="space-y-4 px-5 py-6 sm:px-6">
          {error && (
            <div role="alert" className="border-l-2 border-accent-red bg-accent-red/10 px-3 py-2.5 text-xs font-semibold text-rose-300">
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="login-username" className="block text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
              {t('auth.username')}
            </label>
            <div className="relative">
              <User size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                placeholder={t('auth.username')}
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full border border-tertiary bg-primary py-3 pl-10 pr-3 text-sm text-white placeholder:text-text-muted focus:border-accent-blue focus:outline-none"
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="login-password" className="block text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
              {t('auth.password')}
            </label>
            <div className="relative">
              <Lock size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                placeholder={t('auth.password')}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full border border-tertiary bg-primary py-3 pl-10 pr-3 text-sm text-white placeholder:text-text-muted focus:border-accent-blue focus:outline-none"
                required
              />
            </div>
          </div>
          <button type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#7F00FF] to-[#9d5bf0] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-purple-950/50 transition-all hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-blue">
            {t('auth.login_btn')} <ArrowRight size={16}/>
          </button>
        </form>
      </div>
    </div>
  );
}
