import type { Market } from '../types';
import { isSameGameComboLine } from '../../../server/ledger/combo-policy.mjs';

/** Same-event joint contracts only. Ordinary multiple-event tickets are separate. */
export function isComboMarket(market: Pick<Market,'name'> | string): boolean {
  const name = typeof market === 'string' ? market : market.name;
  return isSameGameComboLine({name}) ||
    /\b(?:outcome|double chance)\s+(?:and|&|\+)\s+(?:both\s+(?:teams?\s+)?(?:to\s+)?score|total(?:\s+goals?)?)\b/i.test(name) ||
    /\bwill\s+win\s+(?:and|&)\s+score\s+exact\b/i.test(name);
}
