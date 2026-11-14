import type { Match, Market, Outcome } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { marketLineValue, marketSelectionLabel } from '../../utils/marketCatalog';
import { filterDecidedOutcomes } from '../../utils/marketExpiry';
import OddsButton from './OddsButton';

/** A provider can quote a numeric line in market.line, market.name or in each
 * outcome's original label/code. This is display-only: never alter its IDs.
 */
function quoteLine(market: Market, outcome: Outcome): string {
  // Individual outcome terms win over the parent market's fallback line.
  // One provider market can publish several different quoted thresholds.
  for (const value of [outcome.name, outcome.code]) {
    const raw = String(value ?? '');
    const explicit = raw.match(/\b(?:over|under|lart|mbi|poshte|poshtë|nen|nën)\s*(\d+(?:[.,]\d+)?)/i);
    if (explicit) return explicit[1].replace(',', '.');
    // e.g. native X/2&P_2.5. Read the quoted number, not a presumed direction.
    const compact = raw.match(/(?:[&+]|\s)(?:P_|L_|[+-])\s*(\d+[.,]\d+)\b/i);
    if (compact) return compact[1].replace(',', '.');
  }
  const line = String(marketLineValue(market) || market.specifier || '').trim().replace(',', '.');
  return /^\d+(?:\.\d+)?$/.test(line) ? line : '';
}

function quoteDirection(market: Market, outcome: Outcome): 'Over' | 'Under' | '' {
  for (const value of [outcome.name, outcome.code, market.name]) {
    const raw = String(value ?? '').toLowerCase();
    const over = /\b(?:over|lart|mbi)\b/.test(raw);
    const under = /\b(?:under|poshte|poshtë|nen|nën)\b/.test(raw);
    if (over !== under) return over ? 'Over' : 'Under';
  }
  // Encoded P_/L_ is not interpreted here: never guess an unknown contract.
  return '';
}

/** Show the actual quoted total next to the choice, even for compact X/1, 1X etc. */
function visibleChoice(market: Market, outcome: Outcome, match: Match, lang: 'al' | 'en'): string {
  const base = marketSelectionLabel(String(outcome.name || outcome.code || ''), lang,
    market.name, `${match.homeTeam} vs ${match.awayTeam}`, outcome.code, market.line || market.specifier);
  const line = quoteLine(market, outcome);
  // Zizobet-style compact combo terms are represented by P_ (Under)
  // and L_ (Over). Decode only within an explicitly named total/goal combo.
  if (/\b(?:total|goals?)\b/i.test(market.name)) {
    for (const text of [outcome.name, outcome.code]) {
      const compact = String(text ?? '').match(/^(.+?)\s*[&+]\s*([PL])_\s*(\d+(?:[.,]\d+)?)$/i);
      if (compact) {
        const choice = marketSelectionLabel(compact[1].trim(), lang, market.name,
          `${match.homeTeam} vs ${match.awayTeam}`);
        return `${choice} · ${compact[2].toUpperCase() === 'L' ? 'Over' : 'Under'} ${compact[3].replace(',', '.')}`;
      }
    }
  }
  if (!line) return base;
  // A correctly translated original offer may already contain its threshold.
  const existingNumbers = (base.match(/\d+(?:[.,]\d+)?/g) ?? []).map(n => n.replace(',', '.'));
  if (existingNumbers.includes(line)) return base;
  const direction = quoteDirection(market, outcome);
  // If the outcome already says "Under" or "Over", append only the missing
  // number instead of displaying e.g. "X/1 & Under · Under 2.5".
  if (direction && new RegExp('\\b' + direction + '\\s*
}

/** Visual grouping only. Keep the original market/outcome/quote intact. */
export default function ComboOddsGrid({ markets, match }: { markets: Market[]; match: Match }) {
  const { lang } = useLanguage();
  const seen = new Set<string>();
  const choices = markets.flatMap(market => filterDecidedOutcomes(market.outcomes ?? [], market, match)
    .filter(outcome => {
      const key = JSON.stringify([market.id, outcome.id]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(outcome => ({ market, outcome, line: quoteLine(market, outcome) })));

  if (!choices.length) return null;
  const groups = new Map<string, typeof choices>();
  for (const choice of choices) {
    const list = groups.get(choice.line) ?? [];
    list.push(choice);
    groups.set(choice.line, list);
  }
  const sortedGroups = [...groups.entries()].sort(([a], [b]) =>
    a && b ? Number(a) - Number(b) : a ? -1 : b ? 1 : 0);

  return (
    <div className="divide-y divide-tertiary/70" data-combo-quote-groups>
      {sortedGroups.map(([line, entries]) => (
        <div key={line || 'unquoted'}>
          {line && (
            <div data-combo-quoted-line={line}
              className="flex items-center gap-2 bg-[#354152] px-2.5 py-1.5 text-xs font-semibold text-slate-100">
              <span>{lang === 'al' ? 'Kufiri' : 'Line'}</span>
              <span className="rounded-sm bg-[#202a37] px-2 py-0.5 font-mono text-amber-200">{line}</span>
            </div>
          )}
          <div data-combo-odds-grid className="grid grid-cols-2 gap-px bg-tertiary/80 lg:grid-cols-3 2xl:grid-cols-4">
            {entries.map(({ market, outcome }) => (
              <div key={JSON.stringify([market.id, outcome.id])}
                className="min-w-0 bg-[#252e3b] [&_button]:h-full [&_button]:min-h-[44px] [&_button]:w-full [&_button]:rounded-none [&_button]:px-2 [&_button>span:first-child]:line-clamp-none">
                <OddsButton match={match} market={market} outcome={outcome} isWide showRawLabel
                  displayLabel={outcome.id.startsWith('BB|') ? undefined : visibleChoice(market, outcome, match, lang)} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
, 'i').test(base)) {
    return `${base} ${line}`;
  }
  if (direction && /\b(?:over|under|lart|mbi|poshte|poshtë|nen|nën)\b/i.test(base)) {
    return `${base} · ${line}`;
  }
  return `${base} · ${direction ? direction + ' ' : ''}${line}`;
}

/** Visual grouping only. Keep the original market/outcome/quote intact. */
export default function ComboOddsGrid({ markets, match }: { markets: Market[]; match: Match }) {
  const { lang } = useLanguage();
  const seen = new Set<string>();
  const choices = markets.flatMap(market => filterDecidedOutcomes(market.outcomes ?? [], market, match)
    .filter(outcome => {
      const key = JSON.stringify([market.id, outcome.id]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(outcome => ({ market, outcome, line: quoteLine(market, outcome) })));

  if (!choices.length) return null;
  const groups = new Map<string, typeof choices>();
  for (const choice of choices) {
    const list = groups.get(choice.line) ?? [];
    list.push(choice);
    groups.set(choice.line, list);
  }
  const sortedGroups = [...groups.entries()].sort(([a], [b]) =>
    a && b ? Number(a) - Number(b) : a ? -1 : b ? 1 : 0);

  return (
    <div className="divide-y divide-tertiary/70" data-combo-quote-groups>
      {sortedGroups.map(([line, entries]) => (
        <div key={line || 'unquoted'}>
          {line && (
            <div data-combo-quoted-line={line}
              className="flex items-center gap-2 bg-[#354152] px-2.5 py-1.5 text-xs font-semibold text-slate-100">
              <span>{lang === 'al' ? 'Kufiri' : 'Line'}</span>
              <span className="rounded-sm bg-[#202a37] px-2 py-0.5 font-mono text-amber-200">{line}</span>
            </div>
          )}
          <div data-combo-odds-grid className="grid grid-cols-2 gap-px bg-tertiary/80 lg:grid-cols-3 2xl:grid-cols-4">
            {entries.map(({ market, outcome }) => (
              <div key={JSON.stringify([market.id, outcome.id])}
                className="min-w-0 bg-[#252e3b] [&_button]:h-full [&_button]:min-h-[44px] [&_button]:w-full [&_button]:rounded-none [&_button]:px-2 [&_button>span:first-child]:line-clamp-none">
                <OddsButton match={match} market={market} outcome={outcome} isWide showRawLabel
                  displayLabel={outcome.id.startsWith('BB|') ? undefined : visibleChoice(market, outcome, match, lang)} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
