/**
 * Lightweight user-activity tracking.
 *
 * Purpose: the app must not keep calling the API when nobody is using it. We
 * listen to cheap, passive DOM events plus tab visibility and expose
 * `isUserActive()` so every polling owner can skip its request while the tab is
 * hidden or the player has been idle. The tracker itself never calls the
 * network and never writes to the server on every event.
 *
 * It also records what the player actually clicked or opened (the last casino
 * game and the last lobby route), so a later request can carry that context
 * instead of a blind periodic poll.
 */

const IDLE_AFTER_MS = 120_000;
const MAX_EVENTS = 25;

export type UserActivityEvent = {
  kind: 'click' | 'view';
  label: string;
  at: number;
};

let installed = false;
let lastActivity = Date.now();
let events: UserActivityEvent[] = [];

const bump = () => {
  lastActivity = Date.now();
};

const remember = (kind: UserActivityEvent['kind'], label: string) => {
  bump();
  events = [...events, { kind, label, at: Date.now() }].slice(-MAX_EVENTS);
  try {
    sessionStorage.setItem('activity:last', JSON.stringify(events[events.length - 1]));
  } catch {
    /* storage can be disabled; tracking still works in memory */
  }
};

/** Installs passive listeners once. Safe to call from every consumer. */
export function installUserActivityTracking() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const options: AddEventListenerOptions = { passive: true, capture: true };
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    window.addEventListener(type, bump, options);
  }
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'visible') bump();
    },
    options,
  );
}

/** True only when the tab is visible and the player was active recently. */
export function isUserActive() {
  if (typeof document === 'undefined') return false;
  if (document.visibilityState !== 'visible') return false;
  return Date.now() - lastActivity < IDLE_AFTER_MS;
}

/** Records that the player opened a specific casino game. */
export function noteGameView(gameId: string) {
  remember('view', `casino:${gameId}`);
}

/** Records an explicit player action, e.g. launching or leaving a game. */
export function noteUserAction(label: string) {
  remember('click', label);
}

export function recentUserActivity(): UserActivityEvent[] {
  return events.slice();
}