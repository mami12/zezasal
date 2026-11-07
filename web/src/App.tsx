import {lazy,Suspense} from 'react';
import {LiveFeedProvider} from './api/liveFeed';
import { useLanguage } from './context/LanguageContext';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { BetslipProvider } from './context/BetslipContext';
import LoginPage from './pages/LoginPage';
import SportsbookPage from './pages/SportsbookPage';
const AdminPage=lazy(()=>import('./pages/AdminPage'));
const ManagerPage=lazy(()=>import('./pages/ManagerPage'));
const AgentPage=lazy(()=>import('./pages/AgentPage'));
const MyBetsPage=lazy(()=>import('./pages/MyBetsPage'));
const TransactionHistoryPage=lazy(()=>import('./pages/TransactionHistoryPage'));
const CasinoPage=lazy(()=>import('./pages/CasinoPage'));
function PageLoading(){const{t}=useLanguage();return <div role="status" className="p-8 text-sm text-text-secondary">{t('common.loading')}</div>;}

const ProtectedRoute = ({ children, requireAdmin = false, requireManager = false, requireAgent = false, allowAnyRole = false }: { children: JSX.Element, requireAdmin?: boolean, requireManager?: boolean, requireAgent?: boolean, allowAnyRole?: boolean }) => {
  const { t } = useLanguage();
  const { user, isAuthenticated, isLoading } = useAuth();
  
  // Wait for auth check to complete before deciding where to redirect
  if (isLoading) {
    return (
      <div className="min-h-screen bg-primary flex items-center justify-center">
        <div className="flex items-center gap-3 text-text-secondary">
          <span className="w-4 h-4 rounded-full bg-accent-green animate-ping"></span>
          <span>{t("Duke u ngarkuar...")}</span>
        </div>
      </div>
    );
  }
  
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role === 'AGENT' && !requireAgent) return <Navigate to="/agent" replace />;
  if (requireAgent && user?.role !== 'AGENT') return <Navigate to="/" replace />;
  
  if (requireAdmin && user?.role !== 'ADMIN') return <Navigate to="/" replace />;
  if (requireManager && user?.role !== 'MANAGER') return <Navigate to="/" replace />;
  
  // Route players to sportsbook, admins to admin, managers to manager
  if (!requireAdmin && !requireManager && !allowAnyRole) {
    if (user?.role === 'ADMIN') return <Navigate to="/admin" replace />;
    if (user?.role === 'MANAGER') return <Navigate to="/manager" replace />;
  }

  return children;
};

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<ProtectedRoute><SportsbookPage /></ProtectedRoute>} />
      <Route path="/match/:id" element={<ProtectedRoute><SportsbookPage /></ProtectedRoute>} />
      <Route path="/casino" element={<ProtectedRoute allowAnyRole><CasinoPage /></ProtectedRoute>} />
      <Route path="/casino/:gameId" element={<ProtectedRoute allowAnyRole><CasinoPage /></ProtectedRoute>} />
      <Route path="/my-bets" element={<ProtectedRoute><MyBetsPage /></ProtectedRoute>} />
      <Route path="/transactions" element={<ProtectedRoute allowAnyRole><TransactionHistoryPage /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute requireAdmin><AdminPage /></ProtectedRoute>} />
      <Route path="/manager" element={<ProtectedRoute requireManager><ManagerPage /></ProtectedRoute>} />
      <Route path="/agent" element={<ProtectedRoute requireAgent><AgentPage /></ProtectedRoute>} />
      {/* Unknown URLs must never render an empty page */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

/**
 * The app is built with vite `base: '/app/'` and served by the backend under /app,
 * so the router must be told the same base; without it react-router sees "/app" as
 * the path, matches no route and renders nothing. BASE_URL comes from vite ('/app/'),
 * so this stays in sync with whatever base the build uses.
 */
import { FavoritesProvider } from './context/FavoritesContext';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export default function App() {
  return (
    <BrowserRouter basename={BASE}>
      <LanguageProvider>
        <AuthProvider>
          <LiveFeedProvider><FavoritesProvider>
            <BetslipProvider>
              <Suspense fallback={<PageLoading/>}><AppRoutes /></Suspense>
            </BetslipProvider>
          </FavoritesProvider></LiveFeedProvider>
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  );
}
