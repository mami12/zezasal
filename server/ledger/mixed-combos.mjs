/** Provider-defined correlated full-time markets. Never fabricate an odd or a selection. */
export const isResultTotalMarket = (name = '') => /^\s*(?:full\s*time\.?\s*)?result\s+and\s+total\s*$/i.test(name);
export const isTotalBttsMarket = (name = '') =>
  /^\s*(?:full\s*time\.?\s*)?total\s+and\s+(?:both\s+teams?\s+(?:to\s+)?score|btts)\s*$/i.test(name);
export const isFirstHalfResultBtts = (name = '') =>
  /^\s*(?:1st|first)\s+half\.\s*result\s+and\s+both\s+teams?\s+(?:to\s+)?score\s*$/i.test(name);

const fold = (value) => String(value ?? '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const resultOf = (part, home, away) => {
  const p = fold(part);
  if (['1', 'home', 'home win', 'w1'].includes(p) || (fold(home) && p === fold(home))) return '1';
  if (['x', 'draw', 'tie'].includes(p)) return 'X';
  if (['2', 'away', 'away win', 'w2'].includes(p) || (fold(away) && p === fold(away))) return '2';
  return null;
};
const totalOf = (part) => {
  const m = String(part ?? '').trim().match(/^(over|under)\s*(\d+(?:[.,]\d+)?)$/i);
  if (!m) return null;
  return { side: m[1].toLowerCase(), line: Number(m[2].replace(',', '.')) };
};
const bttsOf = (part) => {
  const p = fold(part);
  if (['yes', 'gg', 'po'].includes(p)) return true;
  if (['no', 'ng', 'nil', 'jo'].includes(p)) return false;
  return null;
};
export function parseResultTotal(value, home = '', away = '') {
  const raw = String(value ?? '').trim();
  const m = raw.match(/^(.+?)\s+and\s+(.+)$/i);
  if (!m) return null;
  const result = resultOf(m[1], home, away);
  const total = totalOf(m[2]);
  return result !== null && total ? { result, ...total } : null;
}
export function parseTotalBtts(value) {
  const m = String(value ?? '').trim().match(/^(.+?)\s+and\s+(.+)$/i);
  if (!m) return null;
  const total = totalOf(m[1]);
  const btts = bttsOf(m[2]);
  return total && btts !== null ? { ...total, btts } : null;
}
export function gradeMixedTotal(marketName, selection, homeScore, awayScore) {
  const home = Number(homeScore), away = Number(awayScore);
  if (!selection || !Number.isFinite(home) || !Number.isFinite(away)) return 'VOID';
  const total = home + away;
  if (total === selection.line) return 'VOID';
  const totalWins = selection.side === 'over' ? total > selection.line : total < selection.line;
  const result = home > away ? '1' : home < away ? '2' : 'X';
  const second = isResultTotalMarket(marketName)
    ? selection.result === result
    : selection.btts === (home > 0 && away > 0);
  return totalWins && second ? 'WON' : 'LOST';
}
