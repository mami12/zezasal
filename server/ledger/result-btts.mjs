/**
 * "Result and Both Teams to Score" is one correlated selection, NOT a plain
 * BTTS or 1X2 bet. Never guess from an unrecognised provider outcome.
 */
export function isResultBttsMarket(name = '') {
  const s = String(name).toLowerCase();
  const result = /\b(?:result|1\s*x\s*2|winner)\b/.test(s);
  const btts = /\bbtts\b|both\s+teams?\s+(?:to\s+)?score|both\s+score|\bgg\s*[/&-]\s*ng\b/.test(s);
  return result && btts && !/\b(?:corners?|cards?|handicap|double chance)\b/.test(s);
}

const fold = (value) => String(value ?? '')
  .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** "1/No", "Home & Yes", "X + GG", "No/Draw", etc. */
export function parseResultBttsOutcome(value, homeTeam = '', awayTeam = '') {
  let text = String(value ?? '').trim();
  if (!text) return null;
  // Provider's 'Lyon To Nil' means Lyon wins while conceding no goals.
  const nilWin = text.match(/^(.+?)\s+to\s+nil$/i);
  if (nilWin) {
    const winner = fold(nilWin[1]);
    if (winner === fold(homeTeam) || ['1', 'home'].includes(winner)) return { result: '1', bothScore: false };
    if (winner === fold(awayTeam) || ['2', 'away'].includes(winner)) return { result: '2', bothScore: false };
    return null;
  }
  text = text.replace(/\band\s+both\s+to\s+score\b/gi, ' And Yes')
    .replace(/\band\s+both\s+teams?\s+to\s+score\b/gi, ' And Yes');
  // Parse unambiguous full phrases too, without guessing from a plain BTTS No.
  text = text
    .replace(/^(both\s+teams?\s+(?:not\s+to\s+score|to\s+score))\s*(?:and\b|&|\+|\/)\s*/i,
      (_match, clause) => (/not/i.test(clause) ? 'No/' : 'Yes/'))
    .replace(/\s*(?:and\b|&|\+|\/)\s*(both\s+teams?\s+(?:not\s+to\s+score|to\s+score))$/i,
      (_match, clause) => '/' + (/not/i.test(clause) ? 'No' : 'Yes'));
  text = text.replace(/^\s*(?:match\s+)?result\s*[:=]?\s*/i, '')
    .replace(/\b(?:both\s+teams?\s+(?:to\s+)?score|both\s+score|btts)\b\s*[:=]?\s*/gi, '')
    .replace(/^\(|\)$/g, '').trim();

  const parts = text.split(/\s*(?:\/|\+|&|\||:|,|;|-|\band\b|\bwith\b)\s*/i)
    .map(fold).filter(Boolean);
  if (parts.length !== 2) return null;

  const resultPart = (part) => {
    if (['1', 'home', 'home win', 'w1', 'vendas'].includes(part) || (fold(homeTeam) && part === fold(homeTeam))) return '1';
    if (['x', 'draw', 'tie', 'barazim'].includes(part)) return 'X';
    if (['2', 'away', 'away win', 'w2', 'udhetues'].includes(part) || (fold(awayTeam) && part === fold(awayTeam))) return '2';
    return null;
  };
  const bttsPart = (part) => {
    if (['yes', 'po', 'gg', 'both score'].includes(part)) return true;
    if (['no', 'jo', 'ng', 'nil', 'no goal', 'no goals', 'both not score'].includes(part)) return false;
    return null;
  };

  const forwardResult = resultPart(parts[0]);
  const forwardBtts = bttsPart(parts[1]);
  if (forwardResult !== null && forwardBtts !== null) return { result: forwardResult, bothScore: forwardBtts };
  const reverseResult = resultPart(parts[1]);
  const reverseBtts = bttsPart(parts[0]);
  return reverseResult !== null && reverseBtts !== null
    ? { result: reverseResult, bothScore: reverseBtts }
    : null;
}

/** Result-based grading for a fully decoded provider combination. */
export function gradeResultBtts(selection, homeScore, awayScore) {
  const home = Number(homeScore);
  const away = Number(awayScore);
  if (!selection || !Number.isFinite(home) || !Number.isFinite(away)) return 'VOID';
  const result = home > away ? '1' : home < away ? '2' : 'X';
  const bothScore = home > 0 && away > 0;
  return selection.result === result && selection.bothScore === bothScore ? 'WON' : 'LOST';
}
