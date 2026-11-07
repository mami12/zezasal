import { useLanguage } from './LanguageContext';
import React, { createContext, useContext, useState, useEffect } from 'react';
import { useLiveFeed } from '../api/liveFeed';
import { Bell, BellRing, Star, X, Zap } from 'lucide-react';

export interface MatchAlertNotification {
  id: string;
  matchId: string;
  type: 'goal' | 'card' | 'penalty' | 'period' | 'general';
  title: string;
  message: string;
  timestamp: number;
}

interface FavoritesContextType {
  favorites: string[];
  toggleFavorite: (matchId: string) => void;
  isFavorite: (matchId: string) => boolean;
  alerts: string[];
  toggleAlert: (matchId: string) => void;
  isAlertEnabled: (matchId: string) => boolean;
  notifications: MatchAlertNotification[];
  dismissNotification: (id: string) => void;
  clearAllNotifications: () => void;
}

const FavoritesContext = createContext<FavoritesContextType>({} as FavoritesContextType);

function savedMatchIds(key: string): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(saved)
      ? [...new Set(saved.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
      : [];
  } catch {
    return [];
  }
}

export const FavoritesProvider = ({ children }: { children: React.ReactNode }) => {
  const { t } = useLanguage();
  const [favorites, setFavorites] = useState<string[]>(() => savedMatchIds('app_favorite_matches'));

  const [alerts, setAlerts] = useState<string[]>(() => savedMatchIds('app_alert_matches'));

  const [notifications, setNotifications] = useState<MatchAlertNotification[]>([]);
  const [lastSeenScores, setLastSeenScores] = useState<Record<string, { home: number; away: number; period?: string }>>({});
  const { livePatches } = useLiveFeed();

  // Save favorites to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('app_favorite_matches', JSON.stringify(favorites));
    } catch (e) {
      console.error(e);
    }
  }, [favorites]);

  // Save alerts to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('app_alert_matches', JSON.stringify(alerts));
    } catch (e) {
      console.error(e);
    }
  }, [alerts]);

  const toggleFavorite = (matchId: string) => {
    setFavorites(prev => {
      const exists = prev.includes(matchId);
      if (exists) {
        return prev.filter(id => id !== matchId);
      } else {
        // Also automatically enable notifications for favorited match if not already
        if (!alerts.includes(matchId)) {
          setAlerts(a => [...a, matchId]);
        }
        return [...prev, matchId];
      }
    });
  };

  const isFavorite = (matchId: string) => favorites.includes(matchId);

  const toggleAlert = (matchId: string) => {
    setAlerts(prev => {
      const exists = prev.includes(matchId);
      return exists ? prev.filter(id => id !== matchId) : [...prev, matchId];
    });
  };

  const isAlertEnabled = (matchId: string) => alerts.includes(matchId);

  const dismissNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const clearAllNotifications = () => {
    setNotifications([]);
  };

  // Play subtle synthesized audio chime on alert
  const playAlertSound = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch {
      // Audio autoplay might be blocked, ignore safely
    }
  };

  // Monitor live patches for goal / card events on favorited/alerted matches
  useEffect(() => {
    if (!livePatches || Object.keys(livePatches).length === 0) return;

    const monitoredIds = new Set(alerts);
    if (monitoredIds.size === 0) return;

    monitoredIds.forEach(matchId => {
      const patch = livePatches[matchId];
      if (!patch) return;

      const currentHome = Number(patch.homeScore ?? NaN);
      const currentAway = Number(patch.awayScore ?? NaN);
      const prev = lastSeenScores[matchId];

      if (prev && Number.isFinite(currentHome) && Number.isFinite(currentAway)) {
        if (currentHome > prev.home || currentAway > prev.away) {
          const scoringTeam = currentHome > prev.home ? (patch.homeTeam || 'Vendasit') : (patch.awayTeam || 'Mysafirët');
          const newNotif: MatchAlertNotification = {
            id: `${matchId}-goal-${Date.now()}`,
            matchId,
            type: 'goal',
            title: '⚽ GOOOL!',
            message: `${scoringTeam} shënoi! Rezultati: ${currentHome} - ${currentAway}`,
            timestamp: Date.now(),
          };

          setNotifications(curr => [newNotif, ...curr.slice(0, 4)]);
          playAlertSound();
        }
      }

      if (Number.isFinite(currentHome) && Number.isFinite(currentAway)) {
        setLastSeenScores(prevScores => ({
          ...prevScores,
          [matchId]: { home: currentHome, away: currentAway, period: patch.currentMinute ? `${patch.currentMinute}'` : '' }
        }));
      }
    });
  }, [livePatches, favorites, alerts]);

  return (
    <FavoritesContext.Provider
      value={{
        favorites,
        toggleFavorite,
        isFavorite,
        alerts,
        toggleAlert,
        isAlertEnabled,
        notifications,
        dismissNotification,
        clearAllNotifications
      }}
    >
      {children}

      {/* Live Toast Notifications Banner Overlay */}
      {notifications.length > 0 && (
        <div className="fixed top-4 right-4 z-[9999] max-w-sm w-full space-y-2 pointer-events-none px-3 sm:px-0">
          {notifications.map(notif => (
            <div
              key={notif.id}
              className="pointer-events-auto bg-secondary/95 backdrop-blur-md border border-accent-green/40 shadow-2xl shadow-accent-green/20 rounded-2xl p-3.5 flex items-start gap-3 animate-slide-down transition-all"
            >
              <div className="w-9 h-9 rounded-xl bg-accent-green/20 border border-accent-green/40 flex items-center justify-center shrink-0 text-accent-green text-base">
                {notif.type === 'goal' ? '⚽' : notif.type === 'card' ? '🟨' : '🔔'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-black text-accent-green tracking-wide">{notif.title}</span>
                  <span className="text-[10px] text-text-secondary font-mono">{t("Tani")}</span>
                </div>
                <p className="text-xs font-bold text-white mt-0.5 line-clamp-2">{notif.message}</p>
              </div>
              <button
                onClick={() => dismissNotification(notif.id)}
                className="text-text-secondary hover:text-white p-1 rounded-lg hover:bg-white/10 transition"
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </FavoritesContext.Provider>
  );
};

export const useFavorites = () => useContext(FavoritesContext);
