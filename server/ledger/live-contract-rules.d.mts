/** First-half First Corner market, including the distinct NONE outcome. */
export type FirstHalfCornerContract = {
  version: 1;
  kind: 'half-first-event';
  event: 'corner';
  half: 1;
  side: 'home' | 'away' | 'none';
};
export declare function parseFirstHalfCorner(line: {
  market_name?: string;
  marketName?: string;
  name?: string;
  outcome_name?: string;
  outcomeName?: string;
  outcome_key?: string;
  outcomeKey?: string;
}): FirstHalfCornerContract | null;
