/**
 * Offer policy is controlled by explicit provider suspension and admin settings,
 * never by a market title, translation, regex or a synthetic replacement name.
 * Native market identity and rules are frozen when the wager is accepted.
 */
export const isHandicapOfferMarket = market => market?.explicitlyExcluded === true;
export const isEarlyPayoutOfferMarket = () => false;
export const isExcludedOfferMarket = isHandicapOfferMarket;
