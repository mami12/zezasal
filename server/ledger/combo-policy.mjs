import { isResultBttsMarket } from './result-btts.mjs';
import { isResultTotalMarket, isTotalBttsMarket } from './mixed-combos.mjs';

/** Shared by the API and browser: same-match joint contracts only. */
export function isSameGameComboLine(line) {
  if (Array.isArray(line.builderLegs) || Array.isArray(line.builder_legs)) return true;
  const name = String(line.marketName ?? line.market_name ?? line.name ?? '').trim();
  return /\b(?:outcome|double chance)\s+(?:and|&|\+)\s+(?:both\s+(?:teams?\s+)?(?:to\s+)?score|total(?:\s+goals?)?)\b/i.test(name) ||
    /\bwill\s+win\s+(?:and|&)\s+score\s+exact\b/i.test(name) || /^bet builder\b/i.test(name) || isResultBttsMarket(name) ||
    isResultTotalMarket(name) || isTotalBttsMarket(name) ||
    /(?:result|1\s*x\s*2|double\s+chance|total(?:\s+goals?)?|goals?|btts|both\s+teams?\s+(?:to\s+)?score|g\s*\/\s*g)\s*(?:\band\b|&|\+|\/|\bwith\b)\s*(?:result|1\s*x\s*2|double\s+chance|total(?:\s+goals?)?|goals?|btts|both\s+teams?\s+(?:to\s+)?score|g\s*\/\s*g)/i.test(name);
}
