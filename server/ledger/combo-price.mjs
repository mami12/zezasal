import { frozenSelectionPrice } from './system-columns.mjs';

export const COMBO_PRICE_LIMIT = 1000;

/** Freeze source prices at 4dp, then offer/accept/settle the combo at 2dp. */
export function multipliedComboPrice(parts) {
  if (!Array.isArray(parts) || parts.length !== 2) return null;
  const prices = parts.map(p => Number(p.outcome?.odds ?? p.price));
  if (prices.some(p => !Number.isFinite(p) || p <= 1 || p > COMBO_PRICE_LIMIT)) return null;
  const units = prices.map(p => BigInt(frozenSelectionPrice(p).toFixed(4).replace('.','')));
  const product = Number((units[0] * units[1] + 500000n) / 1000000n) / 100;
  return product > 1 && product <= COMBO_PRICE_LIMIT ? product : null;
}
