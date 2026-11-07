import type { BetSelection } from '../types';

/**
 * The badge reports distinct MATCHES, not selections/markets or generated
 * ticket columns. Two market picks on one match still display 1.
 */
export const countBetslipMatches = (selections: Pick<BetSelection, 'matchId'>[]): number =>
  new Set(selections.map(selection => String(selection.matchId))).size;
