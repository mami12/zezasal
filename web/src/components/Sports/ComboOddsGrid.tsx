import type { Match, Market } from '../../types';
import { filterDecidedOutcomes } from '../../utils/marketExpiry';
import OddsButton from './OddsButton';

/** Visual packing only: every button keeps its original contract and price. */
export default function ComboOddsGrid({ markets, match }: { markets: Market[]; match: Match }) {
  const seen = new Set<string>();
  const choices = markets.flatMap(market => filterDecidedOutcomes(market.outcomes ?? [], market, match)
    .filter(outcome => {
      const key = JSON.stringify([market.id, outcome.id]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(outcome => ({ market, outcome })));

  if (!choices.length) return null;
  return (
    <div data-combo-odds-grid className="grid grid-cols-2 gap-px bg-tertiary/80 lg:grid-cols-3 2xl:grid-cols-4">
      {choices.map(({ market, outcome }) => (
        <div key={JSON.stringify([market.id, outcome.id])}
          className="min-w-0 bg-[#252e3b] [&_button]:h-full [&_button]:min-h-[44px] [&_button]:w-full [&_button]:rounded-none [&_button]:px-2 [&_button>span:first-child]:line-clamp-none">
          <OddsButton match={match} market={market} outcome={outcome} isWide showRawLabel />
        </div>
      ))}
    </div>
  );
}
