/** Reconcile source snapshots, never browser arrival order. A goal correction may
 * legitimately lower a score, so compare timestamps rather than goal counts. */
export interface MatchFacts {
  displayOrder?: number;
  competitionOrder?: number;
  listingStale?: boolean;
  updatedAt?: string;
  snapshotAt?: string;
  scoreAt?: string | null;
  clockAt?: string | null;
  phaseAt?: string | null;
  status?: string;
  currentMinute?: number;
  currentSecond?: number;
  period?: string | null;
  homeScore?: number;
  awayScore?: number;
  corners?: { home: number; away: number } | null;
  cards?: { home: number; away: number } | null;
  shots?: { home: number; away: number } | null;
  shotsOnTarget?: { home: number; away: number } | null;
  fouls?: { home: number; away: number } | null;
  marketCount?: number;
  isSuspended?: boolean;
  homeTeam?: string;
  awayTeam?: string;
}

export const timestamp = (value: unknown): number => {
  if (typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const snapshotTime = (value: MatchFacts): number =>
  timestamp(value.snapshotAt) || timestamp(value.updatedAt);

const defined = <T extends object>(value: T): Partial<T> => Object.fromEntries(
  Object.entries(value).filter(([, item]) => item !== undefined),
) as Partial<T>;

const sourceOrder = (previous: MatchFacts, incoming: MatchFacts, field: 'scoreAt' | 'phaseAt'): [number, number] => {
  const before = timestamp(previous[field]), after = timestamp(incoming[field]);
  if (before && !after) return [before, -1];
  if (!before && after) return [-1, after];
  return [before || snapshotTime(previous), after || snapshotTime(incoming)];
};

/** Score, clock and other facts have independent freshness. A stats-only frame
 * cannot make its retained score newer, or erase the provider's clock anchor. */
export function mergeMatchFacts<T extends MatchFacts>(previous: T | undefined, incoming: T): T {
  if (!previous) return defined(incoming) as T;
  const next = { ...previous } as T;
  const groups: [string[], number, number][] = [
    [['homeScore', 'awayScore', 'scoreAt'], ...sourceOrder(previous, incoming, 'scoreAt')],
    [['currentMinute', 'currentSecond', 'clockAt'],
      timestamp(previous.clockAt) || snapshotTime(previous), timestamp(incoming.clockAt) || snapshotTime(incoming)],
    [['status', 'period', 'phaseAt'], ...sourceOrder(previous, incoming, 'phaseAt')],
    [['corners', 'cards', 'shots', 'shotsOnTarget', 'fouls', 'marketCount', 'isSuspended', 'homeTeam', 'awayTeam', 'displayOrder', 'competitionOrder', 'listingStale'],
      snapshotTime(previous), snapshotTime(incoming)],
  ];
  for (const [keys, before, after] of groups) {
    if (after < before) continue;
    if (after === before && snapshotTime(incoming) < snapshotTime(previous)) continue;
    for (const key of keys) if ((incoming as any)[key] !== undefined) (next as any)[key] = (incoming as any)[key];
  }
  // Repeated snapshots of one clock anchor contain a newer extrapolated second.
  if (timestamp(incoming.clockAt) === timestamp(previous.clockAt) && snapshotTime(incoming) < snapshotTime(previous)) {
    next.currentMinute = previous.currentMinute;
    next.currentSecond = previous.currentSecond;
  }
  if (snapshotTime(incoming) >= snapshotTime(previous)) {
    if (incoming.updatedAt !== undefined) next.updatedAt = incoming.updatedAt;
    if (incoming.snapshotAt !== undefined) next.snapshotAt = incoming.snapshotAt;
  }
  return next;
}

/** Merge an old REST row with the independently refreshed shared facts. */
export function liveMatch<T extends MatchFacts>(match: T, patch?: MatchFacts): T {
  return patch ? { ...match, ...mergeMatchFacts<MatchFacts>(match, patch) } : match;
}
