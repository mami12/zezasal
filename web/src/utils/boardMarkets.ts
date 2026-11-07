import {
  getBoardTotalLine,
  findBoardOutcome,
  selectBoardMarkets as selectBoardMarketsSource,
} from '../../../server/board-markets.mjs';

/** The server projection also returns the next-goal market. Declaring it here keeps
 * the front page honest: that column only appears when the provider really sent
 * the market with usable odds. */
export type BoardSelection = {
  primary: any;
  primaryType: '1X2' | 'DC' | 'BTTS';
  total: any;
  totalLine: number | null;
  nextGoal: any;
};

export { getBoardTotalLine, findBoardOutcome };

export function selectBoardMarkets(
  markets: any[],
  visible: (market: any) => boolean,
  suspended: (market: any) => boolean,
  teams?: any,
): BoardSelection {
  return selectBoardMarketsSource(markets, visible, suspended, teams) as BoardSelection;
}
