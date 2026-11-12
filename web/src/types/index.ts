export interface User {
  id: string;
  username: string;
  role: 'ADMIN' | 'AGENT' | 'MANAGER' | 'PLAYER';
  status: 'ACTIVE' | 'FROZEN' | 'BANNED';
  balance: number;
  currency: string;
  managerId?: string | null;
  agentId?: string | null;
  manager?: { id: string; username: string } | null;
  _count?: { managedUsers: number };
  createdAt?: string;
}

export interface Sport {
  id: number;
  name: string;
  slug: string;
  iconName: string;
  sortOrder: number;
  isActive: boolean;
  categories?: Category[];
}

export interface Category {
  id: number;
  sportId: number;
  name: string;
  slug: string;
  countryCode?: string;
  sortOrder: number;
  tournaments?: Tournament[];
}

export interface Tournament {
  id: number;
  categoryId: number;
  name: string;
  slug: string;
  sortOrder: number;
}

export interface Match {
  /** Whether selected LIVE/PREMATCH fixture has received all provider markets. */
  fullMarketsReady?: boolean;
  isHidden?: boolean;
  events?:MatchEvent[];
  supplementalEvents?:MatchEvent[];
  id: string;
  displayOrder?: number;
  listingPriority?:number;
  protectedPrematch?:boolean;
  competitionOrder?: number;
  listingStale?: boolean;
  tournamentId: number;
  homeTeam: string;
  awayTeam: string;
  status: 'PREMATCH' | 'LIVE' | 'ENDED' | 'CANCELLED';
  startTime: string;
  homeScore?: number;
  awayScore?: number;
  /** Timestamp of provider-confirmed score, null if score is only a placeholder. */
  scoreAt?: string | null;
  clockAt?: string | null;
  phaseAt?: string | null;
  updatedAt?: string;
  snapshotAt?: string;
  currentMinute?: number;
  currentSecond?: number;
  isSuspended: boolean;
  isSimulated?: boolean;
  tournament?: Tournament & { category?: Category & { sport?: Sport } };
  markets?: Market[];
  /** the feed's own phase, e.g. "2nd Half" or "Break Time" */
  period?: string | null;
  /** where the minute comes from: the feed clock, drift, or the kickoff-based estimate */
  liveMinuteSource?: 'feed' | 'feed+drift' | 'derived' | null;
  /** live counters the feed reports with the match (shown in the market panel) */
  corners?: { home: number; away: number } | null;
  cards?: { home: number; away: number } | null;
  shots?: { home: number; away: number } | null;
  shotsOnTarget?: { home: number; away: number } | null;
  fouls?: { home: number; away: number } | null;
  goalIntervals?: { label: string; from: number; to: number; home: number; away: number }[] | null;
  watchUrl?: string | null;
}

export interface Market {
  comboLegs?: {market:string;outcome:string;line?:string}[];
  id: string;
  /** Original market group identifier (e.g. g6379), separate from generic marketType. */
  extId?: string;
  matchId: string;
  marketType: string;
  name: string;
  specifier?: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'SETTLED';
  sortOrder: number;
  outcomes?: Outcome[];
  /** the feed's own line for this market ("" when the market has none) */
  line?: string;
  isBase?: boolean;
  period?: number;
  /** Real price identities for the constituent legs of a synthetic Bet Builder. */
  builderLegs?: { marketId: string; outcomeId: string; odds?: number; priceValidUntil?:number|null;quoteSnapshotAt?:number }[];
  builderQuotedAt?: string;
}

export interface Outcome {
  id: string;
  marketId: string;
  name: string;
  /** Provider's original outcome key; needed for six-way Result + BTTS combinations. */
  code?: string;
  odds: number;
  quotedAt?: string | null;
  priceUpdatedAt?:string|null;
  priceValidUntil?:number|null;
  quoteSuspended?:boolean;
  isWinner?: boolean;
  status: 'ACTIVE' | 'SUSPENDED' | 'SETTLED' | 'VOID';
  /** Real provider/admin lock, independent from server risk policy. */
  feedSuspended?: boolean;
  /** Reversible auto-suspension from the server's live risk rules. */
  riskSuspended?: boolean;
  /** The server's live facts have irreversibly completed this contract. */
  decided?: boolean;

}

export interface BetSelection {
  outcomeId: string;
  matchId: string;
  marketId: string;
  outcomeName: string;
  /** The provider's untouched outcome code, used only to disambiguate combined labels. */
  outcomeCode?: string;
  marketName: string;
  marketType?: string;
  marketLine?: string;
  matchName: string;
  odds: number;
  builderLegs?: { marketId: string; outcomeId: string;priceValidUntil?:number|null;quoteSnapshotAt?:number }[];
  priceValidUntil?:number|null;
  quoteSnapshotAt?:number;
  comboLegs?: { market: string; outcome: string; line?: string }[];
  period?: number;
  matchSnapshot?: { status: string;homeTeam?:string;awayTeam?:string; homeScore?: number; awayScore?: number; scoreAt?: string | null; period?: string | null; currentMinute?: number };
}

export interface TicketLine {
  id: string;
  ticketId: string;
  matchId: string;
  marketId: string;
  outcomeId: string;
  outcomeName: string;
  /** Original provider code accompanying a saved ticket line. */
  outcomeCode?: string;
  /** Provider line included in settled tickets and their printable receipts. */
  marketLine?: string;
  marketName: string;
  matchName: string;
  oddsAtPlacement: number;
  status: 'PENDING' | 'WON' | 'LOST' | 'VOID';
}

export interface Ticket {
  id: string;
  userId?: string;
  bookingCode?: string;
  ticketType: 'SINGLE' | 'COMBO' | 'SYSTEM';
  systemType?: string;
  stake: number;
  totalOdds: number;
  potentialPayout: number;
  actualPayout?: number|null;
  potentialPayoutIsEstimated?: boolean;
  remainingPotentialPayout?: number;
  system?: {
    batchId: string;
    columnCount: number;
    columns: Ticket[];
    minColumnPayout: number;
    maxColumnPayout: number;
    paidOut: number;
    refunded: number;
    pendingColumns: number;
  };
  status: 'PENDING' | 'WON' | 'LOST' | 'CANCELLED' | 'VOID' | 'REVERTED';
  placedAt: string;
  settledAt?: string;
  lines: TicketLine[];
  user?: { username: string };
}

export interface PitchState {
  matchId: string;
  ballX: number;
  ballY: number;
  possessionTeam: 'home' | 'away' | null;
  eventText: string;
  homeStats: { possession: number|null; shots: number|null; shotsOnTarget: number|null; fouls:number|null; corners: number|null; yellow: number|null; red: number|null };
  awayStats: { possession: number|null; shots: number|null; shotsOnTarget: number|null; fouls:number|null; corners: number|null; yellow: number|null; red: number|null };
}

export interface MatchEvent {
  id?:string;
  /** Verified scorer from the provider or a matched supplementary feed. */
  player?: string;
  source?: string;
  onTarget?: boolean;
  minuteLabel?:string;
  matchId: string;
  type: string;
  minute: number;
  team: 'home' | 'away';
  text: string;
}

export interface OddsDelta {
  outcomeId: string;
  newOdds: number;
  direction: 'up' | 'down';
  at?: number;
  priceValidUntil?:number|null;
  quoteSuspended?:boolean;
  changed?: boolean;
}
