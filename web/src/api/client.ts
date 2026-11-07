import axios from 'axios';
import {localizeApiError} from '../utils/userError';

/**
 * The app is served by our backend under /app, so its API lives at /app/api
 * (the backend mounts the same router there - see server/ledger/routes.mjs).
 */
export const apiClient = axios.create({
  baseURL: '/app/api',
});

let authSession = 0;
type SessionRequest = { faqjaAuthSession?: number };
// Login/logout invalidate requests sent by the previous account, even if a
// server issues the same token again for a rapid login to that account.
export function invalidateAuthRequests() { authSession += 1; }

apiClient.interceptors.request.use(config => {
  (config as SessionRequest).faqjaAuthSession = authSession;
  const token = localStorage.getItem('token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  res => res,
  error => {
    const request = error.config;
    const url = String(request?.url ?? '').split('?')[0];
    const authorization = String(request?.headers?.get?.('Authorization') ?? request?.headers?.Authorization ?? '');
    const token = localStorage.getItem('token');
    // AuthContext owns ordered /auth/me responses and failed login attempts.
    // Other endpoints may expire only the session that actually sent them.
    if (error.response?.status === 401 && !/^\/?auth\/(?:me|login)$/.test(url) &&
        token && authorization === `Bearer ${token}` && request?.faqjaAuthSession === authSession) {
      localStorage.removeItem('token');
      // the whole app lives under /app, so the login route does too
      if (!window.location.pathname.startsWith('/app/login')) {
        window.location.href = '/app/login';
      }
    }
    return Promise.reject(localizeApiError(error,localStorage.getItem('lang')==='en'?'en':'al'));
  }
);
