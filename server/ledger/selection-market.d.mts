export interface MarketSelectionIdentity {
  outcomeId?: string;
  matchId?: string | number;
  match_id?: string | number;
  marketId?: string;
  marketKey?: string;
  market_key?: string;
  line?: string | number | null;
  marketLine?: string;
  period?: number;
  builderLegs?: MarketSelectionIdentity[];
}
export function selectionMarketIdentity(selection: MarketSelectionIdentity): string | null;
export function toggleMarketSelection<T extends MarketSelectionIdentity & { outcomeId: string }>(previous: T[], selection: T): T[];
export function assertDistinctSelectionMarkets(selections: MarketSelectionIdentity[]): void;
