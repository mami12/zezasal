import type { BetSelection } from '../types';
import { frozenSelectionPrice, systemColumnPayout } from '../../../server/ledger/system-columns.mjs';

export const MAX_BETSLIP_COLUMNS = 24;
export const MIN_TOTAL_STAKE_CENTS = 10000;

/** Parse money without rounding a user's input or silently accepting partial text. */
export function stakeToCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function splitStakeCents(totalCents: number, count: number): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 || !Number.isInteger(count) || count < 1 || count > MAX_BETSLIP_COLUMNS) return [];
  const base = Math.floor(totalCents / count);
  const remainder = totalCents % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

/** Count before expansion so a large slip cannot allocate an exponential array. */
export function buildBetslipColumns(selections: BetSelection[]) {
  const groups = new Map<string, BetSelection[]>();
  for (const selection of selections) {
    const group = groups.get(selection.matchId);
    if (group) group.push(selection);
    else groups.set(selection.matchId, [selection]);
  }
  const automaticSystem = [...groups.values()].some(group => group.length > 1);
  let columnCount = selections.length ? 1 : 0;
  for (const group of groups.values()) {
    // Saturate the count as soon as it exceeds the accepted bound.
    if (columnCount > Math.floor(MAX_BETSLIP_COLUMNS / group.length)) {
      return { columns: [] as BetSelection[][], columnCount: MAX_BETSLIP_COLUMNS + 1, overflow: true, automaticSystem };
    }
    columnCount *= group.length;
  }
  const columns = selections.length ? [...groups.values()].reduce<BetSelection[][]>((acc, group) =>
    acc.flatMap(column => group.map(selection => [...column, selection])), [[]]) : [];
  return { columns, columnCount, overflow: false, automaticSystem };
}

export function previewColumnPayouts(columns: BetSelection[][], stakeCents: number[]) {
  return columns.map((column, index) => {
    const stake = (stakeCents[index] ?? 0) / 100;
    try {
      const prices = column.map(selection => frozenSelectionPrice(selection.odds));
      const odds = prices.reduce((product, price) => product * price, 1);
      return { odds, stake, payout: systemColumnPayout(stake, prices), invalid: false };
    } catch {
      // An oversized or invalid quote cannot be presented as a finite payout.
      return { odds: 0, stake, payout: 0, invalid: true };
    }
  });
}
