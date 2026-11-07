/**
 * Offer policy is controlled by explicit provider suspension and admin settings,
 * never by a market title, translation, regex or a synthetic replacement name.
 * Native market identity and rules are frozen when the wager is accepted.
 */
export const isHandicapOfferMarket = market => market?.explicitlyExcluded === true;
export const isEarlyPayoutOfferMarket = market => /1x2\s*\(xup\)|early\s*payout/i.test(String(market?.name ?? market?.market_name ?? '')) || String(market?.native_market_id ?? market?.nativeMarketId ?? '') === '27073';
export const isExcludedOfferMarket = market => isHandicapOfferMarket(market) || isEarlyPayoutOfferMarket(market);
