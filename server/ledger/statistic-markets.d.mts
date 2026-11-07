export interface StatisticMarketContract {
  stat: 'shotsOnTarget' | 'shots' | 'fouls' | null;
  scope: 'home' | 'away' | 'total' | 'result';
  supported: boolean;
  line: number | null;
}
export function isStatisticMarket(line: unknown): boolean;
export function statisticMarketContract(line: unknown): StatisticMarketContract | null;
export function hasStatisticEvidence(line: unknown, result: unknown): boolean;
export function gradeStatisticLine(line: unknown, result: unknown): 'WON' | 'LOST' | 'VOID';
