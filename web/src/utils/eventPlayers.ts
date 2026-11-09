import type { MatchEvent } from '../types';

/** Retain already observed actor labels across header/REST/socket refreshes.
 * Never carry an actor to another event, or revive a removed incident.
 * Only the same provider event ID, team, type and provider minute can inherit it.
 */
const identity = (event: MatchEvent): string | null => {
  const id = String(event.id ?? '').trim();
  if (!id || !Number.isFinite(event.minute)) return null;
  return JSON.stringify([event.matchId, id, event.type, event.team, event.minute]);
};

export function retainEventPlayerNames(incoming: MatchEvent[], previous: MatchEvent[]): MatchEvent[] {
  const known = new Map<string, string | null>();
  for (const event of previous) {
    const key = identity(event);
    const player = String(event.player ?? '').trim();
    if (!key || !player) continue;
    if (known.has(key) && known.get(key) !== player) known.set(key, null);
    else if (!known.has(key)) known.set(key, player);
  }
  return incoming.map(event => {
    if (event.player?.trim()) return event;
    const key = identity(event), player = key ? known.get(key) : null;
    return player ? { ...event, player } : event;
  });
}
