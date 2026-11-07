import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { User } from '../types';
import { apiClient, invalidateAuthRequests } from '../api/client';
import { installUserActivityTracking, isUserActive } from '../utils/userActivity';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  login: (u: string, p: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const session = useRef(0);
  const latestRead = useRef(0);
  const mounted = useRef(true);

  const refreshUser = useCallback(async () => {
    const version = session.current;
    const read = ++latestRead.current;
    const token = localStorage.getItem('token');
    const current = () => mounted.current && session.current === version && latestRead.current === read;
    if (!token) {
      if (current()) { setUser(null); setIsLoading(false); }
      return;
    }
    try {
      const res = await apiClient.get('/auth/me');
      if (current() && localStorage.getItem('token') === token) {
        setUser(res.data);
      }
    } catch (error: any) {
      if (current() && localStorage.getItem('token') === token &&
          [401, 403].includes(Number(error.response?.status))) {
        localStorage.removeItem('token');
        setUser(null);
      }
      // Network failures/5xx do not establish that an account is invalid.
      // Keep the last confirmed identity and balance until a later refresh.
    } finally {
      if (current()) setIsLoading(false);
    }
  }, []);

  const invalidateSession = useCallback(() => {
    session.current += 1;
    latestRead.current += 1;
    invalidateAuthRequests();
    return session.current;
  }, []);

  useEffect(() => {
    mounted.current = true;
    installUserActivityTracking();
    void refreshUser();
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || (event.key !== null && event.key !== 'token')) return;
      invalidateSession();
      setUser(null);
      setIsLoading(!!localStorage.getItem('token'));
      void refreshUser();
    };
    window.addEventListener('storage', onStorage);
    const refreshActive=()=>{if(localStorage.getItem('token')&&document.visibilityState!=='hidden')void refreshUser();};
    // The 30s poll runs only while the player is really on the page: a hidden tab
    // or an idle session makes no API call at all.
    const pollActive=()=>{if(localStorage.getItem('token')&&isUserActive())void refreshUser();};
    const timer=window.setInterval(pollActive,30000);
    window.addEventListener('focus',refreshActive);
    window.addEventListener('finance:reset',refreshActive);
    document.addEventListener('visibilitychange',refreshActive);
    return () => {
      mounted.current = false;
      session.current += 1;
      latestRead.current += 1;
      window.removeEventListener('storage', onStorage);
      window.clearInterval(timer);
      window.removeEventListener('focus',refreshActive);
      window.removeEventListener('finance:reset',refreshActive);
      document.removeEventListener('visibilitychange',refreshActive);
    };
  }, [refreshUser, invalidateSession]);

  const login = useCallback(async (u: string, p: string) => {
    const version = invalidateSession();
    try {
      const res = await apiClient.post('/auth/login', { username: u, password: p });
      if (!mounted.current || session.current !== version) return;
      localStorage.setItem('token', res.data.token);
      // The login endpoint returns a freshly loaded public user. This remains
      // useful if the following balance refresh has a temporary network error.
      if (res.data.user) setUser(res.data.user);
      await refreshUser();
    } finally {
      if (mounted.current && session.current === version) setIsLoading(false);
    }
  }, [invalidateSession, refreshUser]);

  const logout = useCallback(() => {
    invalidateSession();
    localStorage.removeItem('token');
    setUser(null);
    setIsLoading(false);
  }, [invalidateSession]);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isAdmin: user?.role === 'ADMIN',
      isLoading,
      login, logout, refreshUser
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
