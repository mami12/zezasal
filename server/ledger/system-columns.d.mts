export const MAX_SYSTEM_COLUMNS: number;
export const MAX_SYSTEM_MATCHES: number;
export const MIN_SYSTEM_STAKE: number;
export function moneyCents(value: string | number): number;
export function splitSystemStake(totalStake: string | number, columnCount: number): number[];
export function buildSystemColumns<T>(selections: T[], options?: {
  matchIdOf?: (selection: T) => unknown;
  selectionIdOf?: (selection: T) => unknown;
  maxColumns?: number;
  maxMatches?: number;
}): T[][];
export function frozenSelectionPrice(value: number | string): number;
export function systemColumnPayout(stake: number | string, prices: (number | string)[]): number;
