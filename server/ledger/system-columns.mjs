/** Pure system-ticket arithmetic. No database, feed, or browser state. */
export const MAX_SYSTEM_COLUMNS = 24;
export const MAX_SYSTEM_MATCHES = 20;
export const MIN_SYSTEM_STAKE = 100;

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };

export function moneyCents(value) {
  if (!['number', 'string'].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) {
    fail('Shuma duhet të ketë maksimumi dy shifra pas presjes.');
  }
  const [whole, fraction = ''] = String(value).split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) fail('Shuma është shumë e madhe.');
  return cents;
}

/** The minimum applies once to the whole slip, including when a column is below 100. */
export function splitSystemStake(totalStake, columnCount) {
  const cents = moneyCents(totalStake);
  if (cents < MIN_SYSTEM_STAKE * 100) fail(`Shuma minimale totale është ${MIN_SYSTEM_STAKE} Lek.`);
  if (cents > 10000000000) fail('Shuma totale është shumë e madhe.');
  if (!Number.isInteger(columnCount) || columnCount < 2 || columnCount > MAX_SYSTEM_COLUMNS) {
    fail(`Numër i pavlefshëm kolonash (2–${MAX_SYSTEM_COLUMNS}).`);
  }
  const base = Math.floor(cents / columnCount), remainder = cents % columnCount;
  return Array.from({ length: columnCount }, (_, i) => (base + (i < remainder ? 1 : 0)) / 100);
}

/** Group order and option order follow first appearance, matching the visible slip. */
export function buildSystemColumns(selections, {
  matchIdOf = selection => selection?.matchId,
  selectionIdOf = selection => selection?.outcomeId,
  maxColumns = MAX_SYSTEM_COLUMNS,
  maxMatches = MAX_SYSTEM_MATCHES,
} = {}) {
  if (!Array.isArray(selections) || selections.length < 2 || selections.length > MAX_SYSTEM_COLUMNS * MAX_SYSTEM_MATCHES) {
    fail('Bileta e sistemit ka zgjedhje të pavlefshme.');
  }
  const groups = new Map(), seen = new Set();
  for (const selection of selections) {
    const matchId = String(matchIdOf(selection) ?? ''), id = String(selectionIdOf(selection) ?? '');
    if (!id || !matchId) fail('Zgjedhja nuk u identifikua.');
    if (seen.has(id)) fail('Zgjedhje të përsëritura.');
    seen.add(id);
    if (!groups.has(matchId)) groups.set(matchId, []);
    groups.get(matchId).push(selection);
  }
  if (groups.size > maxMatches) fail(`Lejohen maksimumi ${maxMatches} ndeshje për kolonë.`);
  let count = 1;
  for (const group of groups.values()) {
    count *= group.length;
    // Reject before allocating any Cartesian product.
    if (count > maxColumns) fail(`Lejohen maksimumi ${maxColumns} kolona.`);
  }
  if (count < 2) fail('Sistemi kërkon të paktën dy zgjedhje nga e njëjta ndeshje.');
  let columns = [[]];
  for (const group of groups.values()) columns = columns.flatMap(column => group.map(selection => [...column, selection]));
  return columns;
}

/** Match the four decimal places persisted by app_ticket_line before pricing. */
export function frozenSelectionPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 1 || price > 9999999999.9999) fail('Koeficienti është i pavlefshëm.');
  const [whole, fraction = ''] = String(price).split('.');
  let units = BigInt(whole) * 10000n + BigInt(fraction.slice(0, 4).padEnd(4, '0'));
  if (fraction.length > 4 && fraction[4] >= '5') units += 1n;
  if (units > 99999999999999n) fail('Koeficienti është shumë i madh.');
  return Number(units) / 10000;
}

/** Exact decimal multiplication, then one half-up rounding to the nearest cent. */
export function systemColumnPayout(stake, prices) {
  let numerator = BigInt(moneyCents(stake)), denominator = 1n;
  for (const value of prices) {
    const fixed = frozenSelectionPrice(value).toFixed(4);
    numerator *= BigInt(fixed.replace('.', ''));
    denominator *= 10000n;
  }
  const cents = (numerator * 2n + denominator) / (2n * denominator);
  if (cents > 99999999999999n) fail('Pagesa e mundshme është shumë e madhe.');
  return Number(cents) / 100;
}
