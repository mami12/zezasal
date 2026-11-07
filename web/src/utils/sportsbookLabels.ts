import { translateFito24MarketLabel } from '../i18n/fito24MarketLabels';
import { translateZizobetMarketLabel } from '../i18n/zizobetMarketLabels';
import { repairDisplayText } from './repairDisplayText';

export type Translate = ((key: string) => string) & { lang?: 'al' | 'en' };

/* ------------------------------------------------------------------ */
/* Emra të shkurtër për outcomes                                       */
/* ------------------------------------------------------------------ */

/**
 * Map i emrave të shkurtër. Përdoret përpara se emri të kalojë në përkthim.
 * Shkurton "3 or more" → "3+", "1 (Vendas)" → "1", etj.
 */
const SHORT_OUTCOME_NAMES: Record<string, string> = {
  // 1X2 — vetëm 1, X, 2 pa kllapa dhe pa fjalë
  '1 (vendas)': '1',
  '1 (home)': '1',
  'x (barazim)': 'X',
  'x (draw)': 'X',
  '2 (udhetues)': '2',
  '2 (udhëtues)': '2',
  '2 (away)': '2',
  'vendas': '1',
  'barazim': 'X',
  'udhetues': '2',
  'udhëtues': '2',
  'home': '1',
  'draw': 'X',
  'away': '2',
  '1': '1',
  'x': 'X',
  '2': '2',
  '1x': '1X',
  '12': '12',
  'x2': 'X2',
  '1x (1x)': '1X',
  '12 (12)': '12',
  'x2 (x2)': 'X2',
  'home or draw': '1X',
  'home or away': '12',
  'draw or away': 'X2',
  
  // Golat — "X or more" → "X+"
  '1 or more': '1+',
  '2 or more': '2+',
  '3 or more': '3+',
  '4 or more': '4+',
  '5 or more': '5+',
  '6 or more': '6+',
  '7 or more': '7+',
  '8 or more': '8+',
  '9 or more': '9+',
  '10 or more': '10+',
  '11 or more': '11+',
  '12 or more': '12+',
  
  // Golat — "X or less" → "X-"
  '1 or less': '1-',
  '2 or less': '2-',
  '3 or less': '3-',
  '4 or less': '4-',
  '5 or less': '5-',
  
  // Golat — "X-Y" format
  'no goal': 'Pa Gol',
  'no goal 2': 'Pa Gol 2',
  'no goal 3': 'Pa Gol 3',
  
  // Tjera
  'none': 'Asnjë',
  'neither': 'Asnjë',
};

/**
 * Shkurton emrin e outcome-it:
 *  - "3 or more" → "3+"
 *  - "3 or less" → "3-"
 *  - "1 (Vendas)" → "1"
 *  - "X (Barazim)" → "X"
 */
export function shortOutcomeName(name?: string): string {
  if (!name) return '';
  const clean = String(name).trim();
  const lower = clean.toLowerCase();

  // 1. Kontrollo map-in e drejtpërdrejtë
  if (SHORT_OUTCOME_NAMES[lower]) return SHORT_OUTCOME_NAMES[lower];

  // 2. "X or more" → "X+"
  const orMore = clean.match(/^(\d+)\s+or\s+more$/i);
  if (orMore) return `${orMore[1]}+`;

  // 3. "X or less" → "X-"
  const orLess = clean.match(/^(\d+)\s+or\s+less$/i);
  if (orLess) return `${orLess[1]}-`;

  // 4. "X or fewer" → "X-"
  const orFewer = clean.match(/^(\d+)\s+or\s+fewer$/i);
  if (orFewer) return `${orFewer[1]}-`;

  // 5. Hiq kllapat: "1 (Vendas)" → "1", "X (Barazim)" → "X"
  const withoutParens = clean.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (withoutParens && withoutParens !== clean) {
    const lowerStripped = withoutParens.toLowerCase();
    if (SHORT_OUTCOME_NAMES[lowerStripped]) return SHORT_OUTCOME_NAMES[lowerStripped];
    // Extra parentheses may contain the betting minute/period; preserve them.
    return clean;
  }

  return clean;
}

/* ------------------------------------------------------------------ */
/* Ndihmës                                                            */
/* ------------------------------------------------------------------ */

const normalized = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();



/** Result + BTTS is a six-outcome correlated market, not ordinary GG/NG. */
export function isResultBttsMarket(name: string | undefined): boolean {
  const s = String(name ?? '').toLowerCase();
  const result = /\b(?:result|1\s*x\s*2|winner)\b/.test(s);
  const btts = /\bbtts\b|both\s+teams?\s+(?:to\s+)?score|both\s+score|\bgg\s*[/&-]\s*ng\b/.test(s);
  return result && btts && !/\b(?:corners?|cards?|handicap|double chance)\b/.test(s);
}

/** An existing provider market combining BTTS (GG/NG) with a goal total.
 * Categorization only: never create synthetic odds or change feed selections.
 */
export function isBttsGoalsComboMarket(name: string | undefined): boolean {
  const value = String(name ?? '').toLowerCase();
  if (/\b(?:corners?|cards?|handicap)\b/.test(value)) return false;
  const hasBtts = /\bbtts\b|\bgg\s*[/+&-]\s*ng\b|\bboth\s+teams?\s+(?:to\s+)?score\b|\bboth\s+score\b/.test(value);
  const hasGoalsTotal = /\b(?:total\s+goals?|goals?\s+total|over\s*[/&+-]?\s*under|under\s*[/&+-]?\s*over|over\s+\d|under\s+\d|[ou]\s*2[.,]5)\b/.test(value);
  return hasBtts && hasGoalsTotal;
}

/** Existing provider result + goals-total, or total + BTTS markets. */
export function isResultTotalMarket(name: string | undefined): boolean {
  return /^\s*(?:full\s*time\.?\s*)?result\s+and\s+total\s*$/i.test(String(name ?? ''));
}
export function isTotalBttsMarket(name: string | undefined): boolean {
  return /^\s*(?:full\s*time\.?\s*)?total\s+and\s+(?:both\s+teams?\s+(?:to\s+)?score|btts)\s*$/i.test(String(name ?? ''));
}
export function isFirstHalfResultBtts(name: string | undefined): boolean {
  return /^\s*(?:1st|first)\s+half\.\s*result\s+and\s+both\s+teams?\s+(?:to\s+)?score\s*$/i.test(String(name ?? ''));
}
export function isAnyMixedMarket(name: string | undefined): boolean {
  return isResultBttsMarket(name) || isResultTotalMarket(name) || isTotalBttsMarket(name) || isBttsGoalsComboMarket(name);
}

export function parseResultBttsOutcome(
  value: string | undefined,
  homeTeam = '',
  awayTeam = '',
): { result: '1' | 'X' | '2'; bothScore: boolean } | null {
  let raw = String(value ?? '').trim();
  if (!raw) return null;
  const nilWin = raw.match(/^(.+?)\s+to\s+nil$/i);
  if (nilWin) {
    const winner = nilWin[1].trim().toLowerCase();
    if (winner === homeTeam.trim().toLowerCase() || ['1', 'home'].includes(winner)) return { result: '1', bothScore: false };
    if (winner === awayTeam.trim().toLowerCase() || ['2', 'away'].includes(winner)) return { result: '2', bothScore: false };
    return null;
  }
  raw = raw.replace(/\band\s+both\s+(?:teams?\s+)?to\s+score\b/gi, ' And Yes');
  // Some feeds write the complete condition instead of a compact "X/No".
  // "Both Teams Not to Score and Draw" means X + BTTS No, which is 0-0.
  raw = raw
    .replace(/^(both\s+teams?\s+(?:not\s+to\s+score|to\s+score))\s*(?:and\b|&|\+|\/)\s*/i,
      (_match, clause: string) => (/not/i.test(clause) ? 'No/' : 'Yes/'))
    .replace(/\s*(?:and\b|&|\+|\/)\s*(both\s+teams?\s+(?:not\s+to\s+score|to\s+score))$/i,
      (_match, clause: string) => '/' + (/not/i.test(clause) ? 'No' : 'Yes'));
  raw = raw.replace(/^\s*(?:match\s+)?result\s*[:=]?\s*/i, '')
    .replace(/\b(?:both\s+teams?\s+(?:to\s+)?score|both\s+score|btts)\b\s*[:=]?\s*/gi, '')
    .replace(/^\(|\)$/g, '').trim();
  const norm = (v: string) => v.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const parts = raw.split(/\s*(?:\/|\+|&|\||:|,|;|-|\band\b|\bwith\b)\s*/i)
    .map(norm).filter(Boolean);
  if (parts.length !== 2) return null;
  const readResult = (part: string): '1' | 'X' | '2' | null => {
    if (['1', 'home', 'home win', 'w1', 'vendas'].includes(part) || (!!homeTeam && part === norm(homeTeam))) return '1';
    if (['x', 'draw', 'tie', 'barazim'].includes(part)) return 'X';
    if (['2', 'away', 'away win', 'w2', 'udhetues'].includes(part) || (!!awayTeam && part === norm(awayTeam))) return '2';
    return null;
  };
  const readBtts = (part: string): boolean | null => {
    if (['yes', 'po', 'gg', 'both score'].includes(part)) return true;
    if (['no', 'jo', 'ng', 'nil', 'no goal', 'no goals', 'both not score'].includes(part)) return false;
    return null;
  };
  const forwardResult = readResult(parts[0]);
  const forwardBtts = readBtts(parts[1]);
  if (forwardResult !== null && forwardBtts !== null) {
    return { result: forwardResult, bothScore: forwardBtts };
  }
  const reverseResult = readResult(parts[1]);
  const reverseBtts = readBtts(parts[0]);
  return reverseResult !== null && reverseBtts !== null
    ? { result: reverseResult, bothScore: reverseBtts }
    : null;
}

/**
 * Display the six valid Result + BTTS outcomes as whether each team scores
 * (home/away), followed by the full-time 1X2 result.
 * Examples: X + No => Jo/Jo&X (0-0), 1 + No => Po/Jo&1.
 * This is presentation only: the feed's original outcome ID/price is unchanged.
 */
export function formatResultBttsOutcome(
  outcomeName: string | undefined,
  matchName?: string,
  outcomeCode?: string,
  lang: 'al' | 'en' = 'al',
): string | null {
  const teams = String(matchName ?? '').split(/\s+(?:vs\.?|v)\s+/i);
  const home = teams.length === 2 ? teams[0] : '';
  const away = teams.length === 2 ? teams[1] : '';
  const fromName = parseResultBttsOutcome(outcomeName, home, away);
  const fromCode = parseResultBttsOutcome(outcomeCode, home, away);
  // Contradictory provider labels must not silently become a different bet.
  if (fromName && fromCode &&
      (fromName.result !== fromCode.result || fromName.bothScore !== fromCode.bothScore)) return null;
  const combined = fromName ?? fromCode;
  if (!combined) return null;

  return combined.result + ' & ' + (lang === 'en' ? combined.bothScore ? 'Yes' : 'No' : combined.bothScore ? 'Po' : 'Jo');
}

/** Decode HT/FT only with the corresponding market context. Outcome IDs remain untouched. */
export function isHalfTimeFullTimeMarket(name: string | undefined): boolean {
  const value = normalized(name);
  return /^(?:ht ft|htft|half time full time|halftime fulltime|half time fulltime|half time match result|half time full time result|first half full time|1st half full time|first half fulltime|1st half fulltime|pjesa e pare ndeshja|pjesa e pare koha e rregullt)$/.test(value);
}

/**
 * The bookmaker may send "Arsenal / Draw", "Home/Draw", "HD" or "1/X".
 * Convert labels for display only, using the actual fixture to identify the teams.
 * Unknown values stay as-is so we never represent a different bet.
 */
export function parseHalfTimeFullTimeOutcome(
  value: string | undefined,
  matchName?: string,
  code?: string,
): string | null {
  const fixture = String(matchName ?? '').split(/\s+vs?\.?\s+/i);
  const homeTeam = fixture.length === 2 ? normalized(fixture[0]) : '';
  const awayTeam = fixture.length === 2 ? normalized(fixture[1]) : '';

  const canonical = (part: string): '1' | 'X' | '2' | null => {
    const s = normalized(part);
    if (['1', 'h', 'home', 'home team', 'vendas', 'w1'].includes(s)) return '1';
    if (['x', 'd', 'draw', 'tie', 'barazim', 'wx'].includes(s)) return 'X';
    if (['2', 'a', 'away', 'away team', 'vizitor', 'udhetues', 'w2'].includes(s)) return '2';
    if (homeTeam && s === homeTeam) return '1';
    if (awayTeam && s === awayTeam) return '2';
    return null;
  };

  const fromText = (text: string | undefined): string | null => {
    const raw = String(text ?? '').trim();
    const compact = raw.toUpperCase().replace(/\s+/g, '');
    if (/^[HDAX12]{2}$/.test(compact)) {
      const a = canonical(compact[0]);
      const b = canonical(compact[1]);
      return a && b ? a + '/' + b : null;
    }
    const parts = raw.split(/\s*(?:\/|\||→|–|—|\s+-\s+)\s*/);
    if (parts.length !== 2) return null;
    const a = canonical(parts[0]);
    const b = canonical(parts[1]);
    return a && b ? a + '/' + b : null;
  };

  const fromName = fromText(value);
  const fromCode = fromText(code);
  // A conflicting provider code must not silently replace a descriptive bet selection.
  if (fromName && fromCode && fromName !== fromCode) return null;
  return fromName ?? fromCode;
}

/** A market's numerical line is NOT necessarily a minute; require explicit time context. */
const hasMinuteContext = (name: string | undefined): boolean =>
  /\bminutes?\b|\bmins?\b|\bminut(?:a|e|ën|es|ës)?\b/i.test(String(name ?? ''));

export function formatMarketLine(marketName: string | undefined, marketLine: string | undefined): string {
  const value = String(marketLine ?? '').trim();
  if (!value || /^#\d+$/.test(value)) return '';
  if (!hasMinuteContext(marketName)) return value;
  const range = value.match(/^(\d{1,3})\s*[-–]\s*(\d{1,3})$/);
  if (range) return range[1] + "'–" + range[2] + "'";
  return /^\d{1,3}$/.test(value) ? value + "'" : value;
}

/**
 * The market number is displayed in the market heading / line column.
 * Never guess a market number from an outcome alone: "1 2.5" could mean
 * something different without the matching provider market context.
 */
export function ordinalMarketNumber(marketName?: string, marketLine?: string): string | null {
  const name = String(marketName ?? '').trim();
  const line = String(marketLine ?? '').trim();
  const numeric = /^\d+(?:[.,]\d+)?$/;
  if (numeric.test(line)) return line;

  // Some feeds embed the line in the market title instead of market.line.
  const trailing = name.match(/(?:^|[\s:#])(\d+(?:[.,]\d+)?)(?:st|nd|rd|th)?\s*$/i);
  if (trailing) return trailing[1];
  const leadingOrdinal = name.match(/(?:^|\s)(\d+(?:[.,]\d+)?)(?:st|nd|rd|th)?\s+(?:goal|corner)s?\b/i);
  return leadingOrdinal?.[1] ?? null;
}

const equalMarketNumber = (a: string, b: string): boolean => {
  const canonical = (value: string): string => {
    const [integer, fractional = ''] = value.replace(',', '.').split('.');
    const whole = integer.replace(/^0+(?=\d)/, '');
    const decimals = fractional.replace(/0+$/, '');
    return decimals ? whole + '.' + decimals : whole;
  };
  return canonical(a) === canonical(b);
};

/**
 * Normalize only a 1/X/2 selection with the EXACT numeric market line alongside it.
 * Handles any nonnegative integer or decimal (0, 9, 2.5, 2,5, 1000.25, etc).
 * Do not rewrite scores, standalone totals, or unrelated provider outcome codes.
 */
export function formatOrdinalOutcomeLabel(
  outcomeName: string | undefined,
  marketName: string | undefined,
  marketLine: string | undefined,
  matchName?: string,
): string | null {
  if (isHalfTimeFullTimeMarket(marketName) || isResultBttsMarket(marketName)) return null;
  const line = ordinalMarketNumber(marketName, marketLine);
  if (line === null) return null;
  const raw = compactOutcomeTeams(String(outcomeName ?? ''), matchName);
  const separator = String.raw`(?:\s+|\s*[/,;|:]\s*)`;
  // A hyphen belongs to an exact score (1-0), so never interpret it as a separator.
  const resultFirst = raw.match(new RegExp('^([1X2])' + separator + '(\\d+(?:[.,]\\d+)?)(?:st|nd|rd|th)?$', 'i'));
  if (resultFirst && equalMarketNumber(resultFirst[2], line)) return resultFirst[1].toUpperCase();
  const lineFirst = raw.match(new RegExp('^(\\d+(?:[.,]\\d+)?)(?:st|nd|rd|th)?' + separator + '([1X2])$', 'i'));
  if (lineFirst && equalMarketNumber(lineFirst[1], line)) return lineFirst[2].toUpperCase();
  return /^[1X2]$/i.test(raw) ? raw.toUpperCase() : null;
}

/** Scoring-time markets may carry the minute in market.line, not outcome.name.
 * Display the provider's exact minute on each odds button without changing the bet.
 */
export function formatOddsButtonLabel(
  outcomeName: string | undefined,
  marketName: string | undefined,
  marketLine: string | undefined,
  t: Translate,
  matchName?: string,
  outcomeCode?: string,
): string {
  const outcome = formatOrdinalOutcomeLabel(outcomeName, marketName, marketLine, matchName)
    ?? translateOutcomeName(outcomeName, t, marketName, matchName, outcomeCode);
  const rawMarket = String(marketName ?? '').trim();
  const rawLine = String(marketLine ?? '').trim();
  const timeScoring = /\btime\s+of\s+scoring\b|\btime\s+of\s+(?:the\s+)?(?:first|last|next)\s+goal\b|\bgoal\s+(?:before|after|in|during|until|by|within|between)\b|\b(?:to\s+score|scores?|scoring)\s+(?:before|after|in|during|until|by|within|between)\b/i.test(rawMarket);
  if (!timeScoring) return outcome;
  const translatedMarket = translateMarketName(rawMarket, t);
  const formattedLine = formatMarketLine(rawMarket, rawLine);
  const numericLine = rawLine.match(/^\d{1,3}$/)?.[0];
  // Only interpret a line as a minute for a scoring-time market.
  const minute = numericLine ? numericLine + "'" : formattedLine;
  const description = minute && (!numericLine || !new RegExp('(?:^|\\D)' + numericLine + '(?:\\D|$)').test(translatedMarket))
    ? translatedMarket + ' · ' + (/\bminute\b|\bminut/i.test(rawMarket) ? minute : 'min. ' + minute)
    : translatedMarket;
  if (!description) return outcome;
  if (!outcome || outcome === description) return description;
  return description + ' · ' + outcome;
}

/** Translate the displayed label without changing the stored provider contract. */
export function formatMarketSelectionLabel(
  marketName: string | undefined,
  marketLine: string | undefined,
  t: Translate,
): string {
  const label = translateMarketName(marketName, t);
  const rawLine = String(marketLine ?? '').trim();
  if (!rawLine || /^#\d+$/.test(rawLine)) return label;
  const shownNumbers = label.match(/-?\d+(?:[.,]\d+)?/g) ?? [];
  if (shownNumbers.some(n => n.replace(',', '.') === rawLine.replace(',', '.'))) return label;
  return label + ' (' + rawLine + ')';
}

/** Keep any unfamiliar qualifier verbatim rather than changing the bet's meaning. */
function translateScoringQualifier(qualifier: string): string {
  const value = qualifier.trim().replace(/^[\s:;,.–-]+/, '').trim();
  if (!value) return '';
  if (/^in\s+(?:the\s+)?(?:1st|first)\s+half$/i.test(value)) return 'në pjesën e parë';
  if (/^in\s+(?:the\s+)?(?:2nd|second)\s+half$/i.test(value)) return 'në pjesën e dytë';
  if (/^in\s+(?:the\s+)?(?:both|each)\s+halves$/i.test(value)) return 'në të dyja pjesët';
  const first = value.match(/^in\s+(?:the\s+)?first\s+(\d{1,3})\s+minutes?$/i);
  if (first) return 'në ' + first[1] + ' minutat e para';
  const inMinute = value.match(/^in\s+(?:the\s+)?(?:(\d{1,3})(?:st|nd|rd|th)?\s+)?minute(?:\s+(\d{1,3}))?$/i);
  if (inMinute) return 'në minutën' + (inMinute[1] || inMinute[2] ? ' ' + (inMinute[1] || inMinute[2]) : '');
  const inMinutes = value.match(/^in\s+minutes?\s+(\d{1,3})\s*[-–]\s*(\d{1,3})$/i);
  if (inMinutes) return 'nga minuta ' + inMinutes[1] + ' deri në ' + inMinutes[2];
  const between = value.match(/^between\s+minutes?\s+(\d{1,3})\s+(?:and|to)\s+(\d{1,3})$/i);
  if (between) return 'ndërmjet minutave ' + between[1] + ' dhe ' + between[2];
  const before = value.match(/^before\s+(?:the\s+)?(?:minute\s*)?(\d{1,3})(?:st|nd|rd|th)?(?:\s+minute)?$/i);
  if (before) return 'para minutës ' + before[1];
  if (/^before\s+(?:the\s+)?minute$/i.test(value)) return 'para minutës';
  const until = value.match(/^(?:until|by|up\s+to)\s+(?:the\s+)?(?:minute\s*)?(\d{1,3})(?:st|nd|rd|th)?(?:\s+minute)?$/i);
  if (until) return 'deri në minutën ' + until[1];
  if (/^(?:until|by|up\s+to)\s+(?:the\s+)?minute$/i.test(value)) return 'deri në minutën';
  const within = value.match(/^within\s+(?:the\s+)?(?:first\s+)?(\d{1,3})\s+minutes?$/i);
  if (within) return 'brenda ' + within[1] + ' minutave';
  return value;
}

function translateQualifiedScoringMarket(raw: string, t: Translate): string | null {
  const btts = raw.match(/^(both\s+teams?\s+(?:to\s+)?score|both\s+score|btts)\b(.*)$/i);
  if (btts) {
    const extra = translateProviderPhrases(translateScoringQualifier(btts[2]), t);
    return t('markets.both_teams_score') + (extra ? ' ' + extra : '');
  }
  const goal = raw.match(/^(?:(?:a|the)\s+)?(next\s+goal|goals?)\s+(in|during|before|until|by|up\s+to|within|between)\b(.*)$/i);
  if (goal) {
    const subject = goal[1].toLowerCase().startsWith('next') ? 'Goli i radhës' : 'Gol';
    return subject + ' ' + translateScoringQualifier(goal[2] + goal[3]);
  }
  const team = raw.match(/^(.+?)\s+(not\s+to\s+score|will\s+not\s+score|does\s+not\s+score|to\s+score|will\s+score|scores?)(?:\s+(?:a\s+)?goal)?(?:\s+(in|before|until|by|up\s+to|within|between)\b(.*))?$/i);
  if (team && !/^(?:both|first|last)\s+teams?$/i.test(team[1].trim())) {
    const extra = team[3] ? translateScoringQualifier(team[3] + (team[4] ?? '')) : '';
    const subject=/^home team$/i.test(team[1])?'Skuadra vendase':/^away team$/i.test(team[1])?'Skuadra udhëtuese':/^player$/i.test(team[1])?'Lojtari':team[1].trim();
    return subject + (/^(?:not|will not|does not)/i.test(team[2]) ? ' nuk shënon gol' : ' shënon gol') + (extra ? ' ' + extra : '');
  }
  return null;
}

function translateExactGoalsLabel(value: string) {
  const exactGoals = value.match(
    /^(.*?)\bexact\s+(?:number|amount)\s+of\s+(?:the\s+)?(?:goals?|golat)\s+(?:scored|made)(?:\s+by\s+(.*))?$/i,
  );
  if (!exactGoals) return null;
  const team = (exactGoals[1] || exactGoals[2] || '').replace(/[\s:,-]+$/, '').trim();
  return team
    ? `Numri i saktë i golave të shënuar nga ${team}`
    : 'Numri i saktë i golave të shënuar';
}

/* ------------------------------------------------------------------ */
/* Përkthimi i market-eve                                             */
/* ------------------------------------------------------------------ */

export function translateMarketName(name: string | undefined, t: Translate): string {
  const raw = repairDisplayText(name).trim().replace(/\[([\d\s:.,+–-]+)\]/g,'($1)');
  if (!raw) return '';
  // Provider titles are already English. Do not pass them through any of the
  // Albanian phrase replacements when the selected translator is English.
  if (t.lang === 'en') return raw;
  const named=raw.match(/^(.+?) · (.+)$/);
  if(named)return translateMarketName(named[1],t)+' · '+named[2];
  const namedCount=raw.match(/^(.+?) to score (exactly )?(\d+)(\+| or more)?(?: goals?)?$/i);
  if(namedCount&&!/^player$/i.test(namedCount[1])){
    const subject=/^home team$/i.test(namedCount[1])?'Skuadra vendase':/^away team$/i.test(namedCount[1])?'Skuadra udhëtuese':namedCount[1];
    return subject+' shënon '+(namedCount[2]?'saktësisht ':'')+namedCount[3]+(namedCount[4]?' ose më shumë':'')+(namedCount[3]==='1'&&!namedCount[4]?' gol':' gola');
  }
  const nativeCombo=raw.match(/^(Outcome|Double Chance) And (Both To Score|Total Goals)(?:\s+(\d+(?:\.\d+)?))?$/i);
  if(nativeCombo)return (/^outcome$/i.test(nativeCombo[1])?'Rezultati':t('markets.double_chance'))+' & '+(/^both/i.test(nativeCombo[2])?t('markets.both_teams_score'):t('markets.totals'))+(nativeCombo[3]?' '+nativeCombo[3]:'');
  if(/^anytime\s+goalscorers?$/i.test(raw))return 'Shënues goli gjatë ndeshjes';
  // Combined contracts are translated by their conditions below. Provider alias
  // tables must not shorten them or replace the selected dictionary wording.
  const zizobetLabel=!(isResultBttsMarket(raw)||isResultTotalMarket(raw)||isTotalBttsMarket(raw)||isBttsGoalsComboMarket(raw))?translateZizobetMarketLabel(raw):null;
  if(zizobetLabel)return zizobetLabel;
  const exactWin=raw.match(/^Team ([12]) Will Win and Score Exact (\d+) Goals?$/i);
  if(exactWin)return `Ekipi ${exactWin[1]} fiton dhe shënon saktësisht ${exactWin[2]} gola`;
  if(/^Outcome$/i.test(raw))return 'Rezultati (1X2)';
  if (isHalfTimeFullTimeMarket(raw)) return t('markets.halftime_fulltime');
  const builder = raw.match(/^bet\s+builder\s*:\s*(.*)$/i);
  if (builder) return 'Kombinim ndeshjeje: ' + translateMarketName(builder[1], t);
  const combination = translateCombinationOutcome(raw, t);
  if (combination) return combination;
  // Read period qualifiers before classifying the contract so a first-half
  // total can never be displayed as a full-match total.
  const period = raw.match(/^(?:(1st|first|2nd|second)\s+half|half[ -]?time|extra\s+time)\s*[.:–-]?\s+(.+)$/i);
  if (period) {
    const first = /^(?:1st|first|half)/i.test(period[0]);
    const title = /^extra/i.test(period[0]) ? 'Zgjatjet' : first ? 'Pjesa e parë' : 'Pjesa e dytë';
    return title + ': ' + translateMarketName(period[2], t);
  }
  if (isFirstHalfResultBtts(raw)) return 'Pjesa e parë: Rezultati & ' + t('markets.both_teams_score');
  if (isResultTotalMarket(raw)) return 'Rezultati & Totali i golave';
  if (isTotalBttsMarket(raw) || isBttsGoalsComboMarket(raw)) return t('markets.both_teams_score') + ' & Totali i golave';
  if (isResultBttsMarket(raw)) return 'Rezultati & ' + t('markets.both_teams_score');
  if (/^time\s+of\s+scoring(?:\s|$)/i.test(raw)) return 'Koha e shënimit të golit';
  if (/^time\s+of\s+(?:the\s+)?first\s+goal/i.test(raw)) return 'Koha e golit të parë';
  if (/^time\s+of\s+(?:the\s+)?last\s+goal/i.test(raw)) return 'Koha e golit të fundit';
  if (/^first\s+goal\s+time$/i.test(raw)) return 'Koha e golit të parë';
  if (/^last\s+goal\s+time$/i.test(raw)) return 'Koha e golit të fundit';
  if (/^next\s+goal\s+time$/i.test(raw)) return 'Koha e golit të radhës';
  if (/^goal\s+after\s+(?:the\s+)?(?:minute\s*)?\d+/i.test(raw)) return raw.replace(/^goal\s+after\s+(?:the\s+)?(?:minute\s*)?(\d+)/i, 'Gol pas minutës $1');
  if (/^goal\s+before\s+(?:the\s+)?(?:minute\s*)?\d+/i.test(raw)) return raw.replace(/^goal\s+before\s+(?:the\s+)?(?:minute\s*)?(\d+)/i, 'Gol para minutës $1');

  if (/^(both teams to score|both teams score|both score|btts|gg ng)$/.test(normalized(raw))) return t('markets.both_teams_score');
  const fitoLabel = translateFito24MarketLabel(raw);
  // Archived translations can contain a typo in a threshold or minute. Never
  // display a different numeric contract simply because an alias was supplied.
  const numbers = (value: string) => (value.match(/\d+(?:[.,]\d+)?/g) ?? []).map(number => Number(number.replace(',', '.')));
  if (fitoLabel && JSON.stringify(numbers(raw)) === JSON.stringify(numbers(fitoLabel))) return fitoLabel;

  const exactKey = `markets.${raw}`;
  const exactTranslation = t(exactKey);
  if (exactTranslation !== exactKey) return exactTranslation;
  const exactGoalsLabel = translateExactGoalsLabel(raw);
  if (exactGoalsLabel) return exactGoalsLabel;
  const scoringLabel = translateQualifiedScoringMarket(raw, t);
  if (scoringLabel) return scoringLabel;
  const value = normalized(raw);

  const line = raw.match(/\d+(?:[.,]\d+)?/)?.[0];
  const withLine = (label: string) => line ? `${label} ${line}` : label;
  const groupedMarket = value.match(/^(?:(yellow|red) )?(corners?|cards?|goals?) (result|total|double chance|over under)$/);
  if (groupedMarket) {
    const [, color, kind, subtype] = groupedMarket;
    const subject = color === 'yellow' ? 'kartonëve të verdhë'
      : color === 'red' ? 'kartonëve të kuq'
      : kind.startsWith('corner') ? 'këndeve'
      : kind.startsWith('card') ? 'kartonëve'
      : 'golave';
    const object = kind.startsWith('corner') ? 'këndet'
      : kind.startsWith('card') ? color === 'yellow' ? 'kartonët e verdhë' : color === 'red' ? 'kartonët e kuq' : 'kartonët'
      : 'golat';
    if (subtype === 'result') return `Rezultati i ${subject}`;
    if (subtype === 'total') return withLine(`Totali i ${subject}`);
    if (subtype === 'double chance') return `Shans i dyfishtë për ${object}`;
    return withLine(`Lart / Poshtë ${subject}`);
  }

  if (/^(?:match winner|match result) 2 way$/.test(value)) return 'Fituesi i ndeshjes';
  if (/^(match winner|full time result|fulltime result|match result|1x2)(?: (?:1x2|3 way))?$/.test(value)) return t('markets.match_result');
  if (/^(both teams to score|both teams score|both score|btts|gg ng|gg\/ng)$/.test(value)) return t('markets.both_teams_score');
  if (/^(?:anytime goalscorer|anytime goal scorer)s?$/.test(value)) return 'Shënues goli gjatë ndeshjes';
  if (/^first (?:goalscorer|goal scorer)s?$/.test(value)) return 'Shënuesi i golit të parë';
  if (/^last (?:goalscorer|goal scorer)s?$/.test(value)) return 'Shënuesi i golit të fundit';
  if (/^(?:home|away) team to win$/.test(value)) return value.startsWith('home') ? 'Fiton ekipi vendas' : 'Fiton ekipi udhëtues';
  if (/^double chance$/.test(value)) return t('markets.double_chance');
  if (/^(over under|under over|total goals over under|total over under|goals over under)(?: \d+(?: \d+)?)?$/.test(value)) return withLine(t('markets.over_under'));
  if (/^(over|under|lart|poshte) \d/.test(value)) {
    return `${/^(over|lart)/.test(value) ? t('outcomes.over') : t('outcomes.under')} ${line}`;
  }
  if (/^(total goals|total goal|goals total|goal total|goals?)(?: \d+(?: \d+)?)?$/.test(value)) return withLine(t('markets.totals'));
  if (/^(total corners|corners total|corner total|corners?)(?: \d+(?: \d+)?)?$/.test(value)) return withLine(t('markets.corners'));
  if (/^(total cards|cards total|card total|yellow cards|red cards|cards?)(?: \d+(?: \d+)?)?$/.test(value)) {
    const cardType = value.startsWith('yellow') ? 'Të verdha' : value.startsWith('red') ? 'Të kuqe' : t('markets.cards');
    return withLine(cardType);
  }
  if (/^correct score$/i.test(raw)) return t('markets.correct_score');
  if (/^(odd even|odd even goals)$/.test(value)) return t('markets.odd_even');
  if (/^(next goal|last goal|first goal)(?: \d+)?$/.test(value)) {
    const title = /^last/.test(value) ? 'Goli i fundit' : /^first/.test(value) ? 'Goli i parë' : t('markets.next_goal');
    return line ? `${title} ${line}` : title;
  }
  if (/^(halftime fulltime|half time full time|half time fulltime)/.test(value)) return t('markets.halftime_fulltime');
  if (/^(1st half result|first half result)/.test(value)) return t('markets.first_half_result');
  if (/^(2nd half result|second half result)/.test(value)) return t('markets.second_half_result');
  if (/^(handicap|asian handicap|fora)( |$)/.test(value)) return t('markets.handicap');
  if (/^cols? ?-?\d+$/.test(value)) return t('markets.match_result');

  return translateProviderPhrases(raw, t);
}

/** Translate known contract phrases literally; unknown proper names remain intact. */
function translateProviderPhrases(raw: string, t: Translate, names: string[]=[]): string {
  const protectedNames=new Map<string,string>();
  for(const name of [...new Set(names.filter(Boolean))].sort((a,b)=>b.length-a.length)){
    const token=String.fromCharCode(0xE100+protectedNames.size);
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    raw=raw.replace(new RegExp(escaped,'gi'),match=>{protectedNames.set(token,match);return token;});
  }
  const phrases: Array<[RegExp, string]> = [
    [/\bbet\s+builder\b/gi, 'Kombinim ndeshjeje'],
    [/\bboth\s+teams?\s+(?:not\s+to|will\s+not)\s+score\b/gi, 'Të paktën njëra skuadër nuk shënon'],
    [/\bbtts\b/gi, t('markets.both_teams_score')],
    [/\b(?:gg\s*\/\s*ng|g\s*\/\s*g)\b/gi, t('markets.both_teams_score')],
    [/\b(?:1st|first)\s+half\b/gi, 'Pjesa e parë'],
    [/\b(?:2nd|second)\s+half\b/gi, 'Pjesa e dytë'],
    [/\bhalf[\s/-]*time\b/gi, 'Pjesa e parë'],
    [/\bfull[\s/-]*time\b/gi, 'Koha e rregullt'],
    [/\bmatch\s+winner\b/gi, t('markets.match_result')],
    [/\b(?:match\s+)?result\b/gi, 'Rezultati'],
    [/\bwinner\b/gi, 'Fituesi'],
    [/\bcorrect\s+score\b/gi, t('markets.correct_score')],
    [/\bdouble\s+chance\b/gi, t('markets.double_chance')],
    [/\bfirst\s+team\s+to\s+score\b/gi, 'Ekipi që shënon i pari'],
    [/\blast\s+team\s+to\s+score\b/gi, 'Ekipi që shënon i fundit'],
    [/\bhighest\s+scoring\s+half\b/gi, 'Pjesa me më shumë gola'],
    [/\bexact\s+(?:number\s+of\s+)?goals?\b/gi, 'Numri i saktë i golave'],
    [/\b(?:goal\s+)?range\b/gi, 'Intervali i golave'],
    [/\bdraw\s+no\s+bet\b/gi, t('outcomes.draw_no_bet')],
    [/\bboth\s+teams?\s+(?:to\s+)?score\b/gi, t('markets.both_teams_score')],
    [/\bboth\s+(?:to\s+)?score\b/gi, t('markets.both_teams_score')],
    [/\b(?:first|1st)\s+goal\s+time\b/gi, 'Koha e golit të parë'],
    [/\blast\s+goal\s+time\b/gi, 'Koha e golit të fundit'],
    [/\bnext\s+goal\s+time\b/gi, 'Koha e golit të radhës'],
    [/\bgoal\s+in\s+minute\s*(\d+)\b/gi, 'Shënon gol në minutën $1'],
    [/\bgoal\s+in\s+(\d+)(?:th|st|nd|rd)?\s+minute\b/gi, 'Shënon gol në minutën $1'],
    [/\bgoal\s+before\s+(\d+)(?::00)?(?:'|\s*min)?\b/gi, 'Gol para minutës $1'],
    [/\bnext\s+goal\s+in\s+minute\s*(\d+)\b/gi, 'Goli i radhës në minutën $1'],
    [/\bgoal\s+in\s+minutes\b/gi, 'Shënon gol në minutat'],
    [/\bgoal\s+in\s+minute\b/gi, 'Shënon gol në minutën'],
    [/\bminute\b/gi, 'minutën'],
    [/\bminutes\b/gi, 'minutat'],
    [/\banytime\s+goal\s*scorers?\b/gi, 'Shënues goli gjatë ndeshjes'],
    [/\bfirst\s+goal\s*scorers?\b/gi, 'Shënuesi i golit të parë'],
    [/\blast\s+goal\s*scorers?\b/gi, 'Shënuesi i golit të fundit'],
    [/\bhome\s+team\s+to\s+win\b/gi, 'Fiton ekipi vendas'],
    [/\baway\s+team\s+to\s+win\b/gi, 'Fiton ekipi udhëtues'],
    [/\bhome\s+team\s+(?:total\s+)?goals?\b/gi, 'Golat e ekipit vendas'],
    [/\baway\s+team\s+(?:total\s+)?goals?\b/gi, 'Golat e ekipit udhëtues'],
    [/\bhome\s+team\s+(?:over\s*\/?\s*under|total)\b/gi, 'Golat e ekipit vendas: Lart / Poshtë'],
    [/\baway\s+team\s+(?:over\s*\/?\s*under|total)\b/gi, 'Golat e ekipit udhëtues: Lart / Poshtë'],
    [/\basian\s+corners?\b/gi, 'Këndet aziatike'],
    [/\basian\s+handicap\b/gi, 'Handikap aziatik'],
    [/\bcorners?\s+handicap\b/gi, 'Handikap i këndeve'],
    [/\bcards?\s+handicap\b/gi, 'Handikap i kartonëve'],
    [/\bplayers?\s+to\s+score\b/gi, 'Lojtari që shënon'],
    [/\bto\s+be\s+booked\b/gi, 'merr karton'],
    [/\bto\s+receive\s+(?:a\s+)?red\s+card\b/gi, 'merr karton të kuq'],
    [/\bto\s+receive\s+(?:a\s+)?yellow\s+card\b/gi, 'merr karton të verdhë'],
    [/\bto\s+receive\s+(?:a\s+)?card\b/gi, 'merr karton'],
    [/\bshots?\s+on\s+target\b/gi, 'goditje në portë'],
    [/\bshots?\s+off\s+target\b/gi, 'goditje jashtë porte'],
    [/\btotal\s+shots?\b/gi, 'Totali i goditjeve'],
    [/\bteams?\s+to\s+score\b/gi, 'Ekipi që shënon'],
    [/\bboth\s+halves\b/gi, 'Të dyja pjesët'],
    [/\beach\s+half\b/gi, 'secilën pjesë'],
    [/\beither\s+half\b/gi, 'njërën nga pjesët'],
    [/\bincluding\s+(?:extra\s+time|overtime)\b/gi, 'përfshirë zgjatjet'],
    [/\bextra\s+time\b/gi, 'Koha shtesë'],
    [/\bregular\s+time\b/gi, 'Koha e rregullt'],
    [/\bto\s+qualify\b/gi, 'Kualifikohet'],
    [/\bqualification\b/gi, 'Kualifikimi'],
    [/\bwithin\s+the\s+regular\s+time\b/gi, 'gjatë kohës së rregullt'],
    [/\b(?:till|until)\s+(?:the\s+)?(\d+)(?:st|nd|rd|th)?\s+minute\s+of\s+the\s+match\b/gi, 'deri në minutën $1 të ndeshjes'],
    [/\btotal\s+goals?\b|\bgoals?\s+total\b/gi, t('markets.totals')],
    [/\btotal\s+corners?\b|\bcorners?\s+total\b/gi, t('markets.corners')],
    [/\btotal\s+cards?\b|\bcards?\s+total\b/gi, t('markets.cards')],
    [/\byellow\s+cards?\b/gi, 'Kartonat e verdhë'],
    [/\bred\s+cards?\b/gi, 'Kartonat e kuq'],
    [/\bcorners?\b/gi, 'Goditjet këndore'],
    [/\bcards?\b/gi, 'Kartonat'],
    [/\bgoals\b/gi, 'gola'],
    [/\bgoal\b/gi, 'gol'],
    [/\bover\s*\/\s*under\b|\bover\s+under\b|\bunder\s+over\b/gi, t('markets.over_under')],
    [/\bover\b/gi, t('outcomes.over')],
    [/\bunder\b/gi, t('outcomes.under')],
    [/\bodd\s*\/\s*even\b|\bodd\s+even\b/gi, t('markets.odd_even')],
    [/\bodd\b/gi, t('outcomes.odd')],
    [/\beven\b/gi, t('outcomes.even')],
    [/\bhome\s+team\b/gi, 'Ekipi vendas'],
    [/\baway\s+team\b/gi, 'Ekipi udhëtues'],
    [/\bhome\b/gi, 'Vendas'],
    [/\baway\b/gi, 'Udhëtues'],
    [/\bteam\b/gi, 'Ekipi'],
    [/\basian\b/gi, 'Aziatik'],
    [/\bhandicap\b/gi, 'Handikap'],
    [/\bfirst\b/gi, 'I pari'],
    [/\blast\b/gi, 'I fundit'],
    [/\bnext\b/gi, 'i radhës'],
    [/\bscore\b/gi, 'Shënimi'],
    [/\bwinning\b/gi, 'Fitues'],
    [/\bmargin\b/gi, 'Diferenca'],
    [/\bclean\s+sheet\b/gi, 'Pa pësuar gol'],
    [/\bto\s+nil\b/gi, 'pa pësuar gol'],
    [/\bpenalty\b/gi, 'Penallti'],
    [/\bpenalties\b/gi, 'Penalltitë'],
    [/\bpoints?\b/gi, 'Pikë'],
    [/\bsets?\b/gi, 'Sete'],
    [/\bgames?\b/gi, 'Lojë'],
    [/\bperiods?\b/gi, 'Periudha'],
    [/\bquarters?\b/gi, 'Çerekët'],
    [/\bovertime\b/gi, 'Koha shtesë'],
    [/\bshots?\b/gi, 'Goditje'],
    [/\bfouls?\b/gi, 'Faulle'],
    [/\boffsides?\b/gi, 'Pozicione jashtë loje'],
    [/\bbookings?\b/gi, 'Kartonët'],
    [/\bplayers?\b/gi, 'Lojtari'],
    [/\bscorers?\b/gi, 'Shënuesit'],
    [/\bwin\b/gi, 'Fitore'],
    [/\bmatch\b/gi, 'Ndeshja'],
    [/\btotal\b/gi, 'Totali'],
    [/\byes\b/gi, 'Po'],
    [/\bno\b/gi, 'Jo'],
    [/\band\b/gi, 'dhe'],
    [/\bwith\b/gi, 'me'],
    [/\bor\b/gi, 'ose'],
    [/\bnot\b/gi, 'nuk'],
    [/\bto\b/gi, 'për të'],
  ];

  let result = phrases.reduce((label, [pattern, replacement]) => label.replace(pattern, replacement), raw)
    .replace(/\s+/g, ' ')
    .trim();

  for(const[token,name]of protectedNames)result=result.split(token).join(name);

  return result;
}

/** Shorten fixture teams and result words in displayed selections only. */
export function compactOutcomeTeams(label: string, matchName?: string): string {
  let result = String(label ?? '').trim();
  if (!result) return result;
  const fixture = String(matchName ?? '').split(/\s+(?:vs\.?|v)\s+/i);
  const home = fixture.length === 2 ? fixture[0].trim() : '';
  const away = fixture.length === 2 ? fixture[1].trim() : '';
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const teams = [[home, '1'], [away, '2']].filter(([team]) => !!team)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [team, number] of teams) {
    result = result.replace(new RegExp('(^|[^\\p{L}\\p{N}])' + escapeRegex(team) + '(?!\\s+(?:Women|Ladies|Reserves?|Youth|U[0-9]{2}|II|III)\\b)(?=$|[^\\p{L}\\p{N}])', 'giu'),
      (_whole, prefix: string) => prefix + number);
  }
  return result
    .replace(/\bW1\b/gi, '1').replace(/\bW2\b/gi, '2')
    .replace(/\b(?:home\s+team|home|vendas(?:i)?|vend[aë]s(?:i)?)\b/gi, '1')
    .replace(/\b(?:away\s+team|away|udhetues(?:i)?|udh[eë]tues(?:i)?|vizitor(?:i)?)\b/gi, '2')
    .replace(/\b(?:draw|tie|barazim(?:i)?)\b/gi, 'X')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Read the text of an existing combination for display only. Every leg must
 * be recognized before compacting it; this never creates or settles a bet.
 */
function translateCombinationOutcome(raw: string, t: Translate, matchName?: string): string | null {
  const compactGg = raw.match(/^(G\s*\/\s*G|GG|NG|N\s*\/\s*G)\s*&\s*([+-])\s*(\d+(?:[.,]\d+)?)$/i);
  if (compactGg) return t(/^n/i.test(compactGg[1]) ? 'outcomes.no' : 'outcomes.yes') + ' + ' +
    t(compactGg[2] === '+' ? 'outcomes.over' : 'outcomes.under') + ' ' + compactGg[3].replace(',', '.');
  const parts = raw.split(/\s*(?:\+|&|\band\b|\bwith\b)\s*/i).filter(Boolean);
  if (parts.length < 2 || parts.length > 5) return null;
  const translated = parts.map(part => {
    const candidate = part.trim().replace(/^(?:1X2|DC|TOTAL)\s+/i, '');
    const btts = candidate.match(/^(?:(?:both\s+teams?\s+(?:to\s+)?score|btts)\s*[:=]?\s*)?(yes|no|po|jo|gg|ng|nil)$/i);
    if (btts) return t(/^(yes|po|gg)$/i.test(btts[1]) ? 'outcomes.yes' : 'outcomes.no');
    const total = candidate.match(/^(over|under|lart|poshtë|poshte|mbi|nën|nen)\s+(\d+(?:[.,]\d+)?)$/i);
    if (total) return t(/^(over|lart|mbi)$/i.test(total[1]) ? 'outcomes.over' : 'outcomes.under') + ' ' + total[2].replace(',', '.');
    const result = compactOutcomeTeams(candidate, matchName).toUpperCase();
    if (/^(?:1|X|2|1X|12|X2)$/.test(result)) return result;
    return null;
  });
  return translated.every(part => part !== null) ? translated.join(' + ') : null;
}

/** English display keeps unknown provider text intact. Only recognized contract
 * selections are compacted, using the same identifiers/line context as Albanian. */
function englishOutcomeName(raw: string, t: Translate, marketName?: string, matchName?: string, outcomeCode?: string): string {
  if (isHalfTimeFullTimeMarket(marketName)) return parseHalfTimeFullTimeOutcome(raw, matchName, outcomeCode) ?? raw;
  if (isResultBttsMarket(marketName)) {
    return formatResultBttsOutcome(raw, matchName, outcomeCode, 'en')
      ?? translateCombinationOutcome(raw, t, matchName) ?? raw.replace(/\bnil\b/gi, 'No');
  }
  if (isResultTotalMarket(marketName)) {
    const mixed = raw.match(/^(.+?)\s+and\s+(over|under)\s+(\d+(?:[.,]\d+)?)$/i);
    if (mixed) {
      const result = compactOutcomeTeams(mixed[1], matchName);
      if (/^[1x2]$/i.test(result)) return result.toUpperCase() + ' & ' +
        t(/^over$/i.test(mixed[2]) ? 'outcomes.over' : 'outcomes.under') + ' ' + mixed[3].replace(',', '.');
    }
  }
  if (isTotalBttsMarket(marketName)) {
    const mixed = raw.match(/^(over|under)\s+(\d+(?:[.,]\d+)?)\s+and\s+(yes|no)$/i);
    if (mixed) return t(/^over$/i.test(mixed[1]) ? 'outcomes.over' : 'outcomes.under') + ' ' +
      mixed[2].replace(',', '.') + ' & ' + t(/^yes$/i.test(mixed[3]) ? 'outcomes.yes' : 'outcomes.no');
  }
  const combined = translateCombinationOutcome(raw, t, matchName);
  if (combined) return combined;
  const compact = compactOutcomeTeams(raw, matchName);
  if (/^(?:1|x|2|1x|12|x2)$/i.test(compact)) return compact.toUpperCase();
  const short = shortOutcomeName(raw);
  if (/^(?:1|x|2|1x|12|x2|\d+[+-])$/i.test(short)) return short.toUpperCase();
  const plainBtts = raw.match(/^(?:both teams? (?:to )?score|both score|btts)\s*[:=]?\s*(yes|no|po|jo)$/i);
  if (plainBtts) return t(/^(yes|po)$/i.test(plainBtts[1]) ? 'outcomes.yes' : 'outcomes.no');
  if (/^(?:yes|po|gg|g)$/i.test(raw)) return t('outcomes.yes');
  if (/^(?:no|jo|ng|nil)$/i.test(raw)) return t('outcomes.no');
  if (/^(?:over|o|lart|mbi)$/i.test(raw)) return t('outcomes.over');
  if (/^(?:under|u|poshtë|poshte|nën|nen)$/i.test(raw)) return t('outcomes.under');
  const total = raw.match(/^(over|under|lart|poshtë|poshte|mbi|nën|nen)\s+(\d+(?:[.,]\d+)?)$/i);
  if (total) return t(/^(?:over|lart|mbi)$/i.test(total[1]) ? 'outcomes.over' : 'outcomes.under') + ' ' + total[2];
  if (/^(?:odd|tek)$/i.test(raw)) return t('outcomes.odd');
  if (/^(?:even|çift|cift)$/i.test(raw)) return t('outcomes.even');
  if (/^(?:w1|h)$/i.test(raw)) return '1';
  if (/^(?:wx|d)$/i.test(raw)) return 'X';
  if (/^(?:w2|a)$/i.test(raw)) return '2';
  return raw;
}

/* ------------------------------------------------------------------ */
/* Përkthimi i outcomes                                               */
/* ------------------------------------------------------------------ */

export function translateOutcomeName(name: string | undefined, t: Translate, marketName?: string, matchName?: string, outcomeCode?: string) {
  const raw = repairDisplayText(name).trim().replace(/\[([\d\s:.,+–-]+)\]/g,'($1)');
  if (!raw && !outcomeCode) return '';
  if (t.lang === 'en') return englishOutcomeName(raw, t, marketName, matchName, outcomeCode);
  const playerName=String(marketName??'').split(' · ')[1]??String(marketName??'').match(/^(.+?) (?:to score|shots on target|total shots|assists|to be yellow carded)\b/i)?.[1];
  if(playerName&&normalized(raw)===normalized(playerName))return raw;
  const protectedNames=[...String(matchName??'').split(/\s+(?:vs\.?|v)\s+/i),...(playerName?[playerName]:[])];
  const fallback=(value:string)=>translateProviderPhrases(value,t,protectedNames);
  const noGoal=raw.match(/^no goals?(?: (\d+))?$/i);
  if(noGoal&&!/both.*score|btts|gg\s*[/&]\s*ng/i.test(marketName??''))return 'Pa gol'+(noGoal[1]?' (goli nr. '+noGoal[1]+')':'');
  if (/^nil$/i.test(raw)) return /both.*score|btts/i.test(marketName??'')?'Jo':'Pa gol';
  const plainBtts = raw.match(/^(?:both teams? (?:to )?score|both score|btts)\s*[:=]?\s*(yes|no|po|jo)$/i);
  if (plainBtts) return /^(yes|po)$/i.test(plainBtts[1]) ? t('outcomes.yes') : t('outcomes.no');
  if (isHalfTimeFullTimeMarket(marketName)) {
    return parseHalfTimeFullTimeOutcome(raw, matchName, outcomeCode) ?? fallback(raw);
  }
  if (isResultTotalMarket(marketName)) {
    const candidate = raw.match(/^(.+?)\s+and\s+(over|under)\s+(\d+(?:[.,]\d+)?)$/i);
    if (candidate) {
      const teamResult = compactOutcomeTeams(candidate[1], matchName);
      if (/^(1|x|2)$/i.test(teamResult)) {
        return teamResult.toUpperCase() + ' & ' + t(/^over$/i.test(candidate[2]) ? 'outcomes.over' : 'outcomes.under') + ' ' + candidate[3].replace(',', '.');
      }
    }
    return translateCombinationOutcome(raw, t, matchName) ?? fallback(compactOutcomeTeams(raw, matchName));
  }
  if (isTotalBttsMarket(marketName)) {
    const candidate = raw.match(/^(over|under)\s+(\d+(?:[.,]\d+)?)\s+and\s+(yes|no)$/i);
    if (candidate) {
      return t(/^over$/i.test(candidate[1]) ? 'outcomes.over' : 'outcomes.under') + ' ' +
        candidate[2].replace(',', '.') + ' & ' + t(/^yes$/i.test(candidate[3]) ? 'outcomes.yes' : 'outcomes.no');
    }
    return translateCombinationOutcome(raw, t, matchName) ?? fallback(compactOutcomeTeams(raw, matchName));
  }
  if (isResultBttsMarket(marketName)) {
    // Explicit home/away Po/Jo + 1X2 result. Never infer an unknown selection.
    return formatResultBttsOutcome(raw, matchName, outcomeCode)
      ?? fallback(raw.replace(/\bnil\b/gi, 'Jo'));
  }
  if (!raw) return '';

  const combination = translateCombinationOutcome(raw, t, matchName);
  if (combination) return combination;

  // Fixture teams and 1X2 words are shortened in every displayed outcome.
  const compact = compactOutcomeTeams(raw, matchName);
  if (compact !== raw) {
    const firstGoal = compact.match(/^(?:first goal|first team to score|first goalscorer)\s*[:\-]?\s*([12X])$/i);
    if (firstGoal) return 'Goli i parë: ' + firstGoal[1];
    const lastGoal = compact.match(/^(?:last goal|last team to score)\s*[:\-]?\s*([12X])$/i);
    if (lastGoal) return 'Goli i fundit: ' + lastGoal[1];
    const teamScores = compact.match(/^(?:team to score|team scores?|scoring team)\s*[:\-]?\s*([12X])$/i);
    if (teamScores) return 'Ekipi që shënon: ' + teamScores[1];
    const scoring = compact.match(/^([12])\s+(?:to score|will score|scores?)(?:\s+(?:a\s+)?goal)?$/i);
    if (scoring) return scoring[1] + ' shënon gol';
    const noScoring = compact.match(/^([12])\s+(?:not to score|will not score|does not score)$/i);
    if (noScoring) return noScoring[1] + ' nuk shënon gol';
    const scoresFirst = compact.match(/^([12])\s+(?:to score first|scores first)$/i);
    if (scoresFirst) return 'Goli i parë: ' + scoresFirst[1];
    return fallback(compact);
  }

  const qualifiedScoring = translateQualifiedScoringMarket(raw, t);
  if (qualifiedScoring) return qualifiedScoring;
  const beforeMinute = raw.match(/^(?:before|prior to)\s+(?:the\s+)?(?:minute\s*)?(\d{1,3})(?:st|nd|rd|th)?(?:\s+minute)?$/i);
  if (beforeMinute) return 'Para minutës ' + beforeMinute[1];
  const afterMinute = raw.match(/^after\s+(?:the\s+)?(?:minute\s*)?(\d{1,3})(?:st|nd|rd|th)?(?:\s+minute)?$/i);
  if (afterMinute) return 'Pas minutës ' + afterMinute[1];
  const exactMinute = raw.match(/^(?:minute|min\.?|at\s+minute)\s*(\d{1,3})$/i);
  if (exactMinute) return 'Minuta ' + exactMinute[1];

  // 0. SHKURTO emrin para përkthimit
  const short = shortOutcomeName(raw);
  const shortLower = short.toLowerCase();

  // Nëse shkurtimi e ktheu në diçka si "1", "X", "2", "1X", "12", "X2", "3+", ktheje direkt
  if (/^(1|x|2)$/i.test(short)) return short.toUpperCase();
  if (/^(1x|12|x2)$/i.test(short)) return short.toUpperCase();
  if (/^\d+\+$/.test(short)) return short; // "3+" → "3+"
  if (/^\d+-$/.test(short)) return short; // "3-" → "3-"

  // 1. Kontrollo për exact goals
  const exactGoalsLabel = translateExactGoalsLabel(raw);
  if (exactGoalsLabel) return exactGoalsLabel;
  const value = normalized(raw);

  if (/^(1|home|home team|home win|homewin|1 home|w1|h|vendas)$/i.test(value)) return '1';
  if (/^(x|draw|tie|x draw|barazim|wx|d)$/i.test(value)) return 'X';
  if (/^(2|away|away team|away win|awaywin|2 away|w2|a|udhetues)$/i.test(value)) return '2';
  if (/^(1x|home or draw|home draw)$/i.test(value)) return '1X';
  if (/^(12|home or away|home away)$/i.test(value)) return '12';
  if (/^(x2|draw or away|draw away)$/i.test(value)) return 'X2';
  if (/^(over|o|lart|mbi)$/.test(value)) return t('outcomes.over');
  if (/^(under|u|poshte|nen)$/.test(value)) return t('outcomes.under');
  if (/^(yes|gg|g|goal|both teams to score|gg ng|g ng)$/.test(value)) {
    return /\bboth\s+teams\b|\bbtts\b|\bgg\b|\bng\b/i.test(marketName ?? '') ? t('outcomes.btts_yes') : t('outcomes.yes');
  }
  if (/^(no|ng|n g|no goal|no both teams to score|jo gol|nuk shenojne)$/.test(value)) {
    return /\bboth\s+teams\b|\bbtts\b|\bgg\b|\bng\b/i.test(marketName ?? '') ? t('outcomes.btts_no') : t('outcomes.no');
  }
  if (/^(odd|tek|odd number)$/.test(value)) return t('outcomes.odd');
  if (/^(even|cift|even number)$/.test(value)) return t('outcomes.even');
  if (/^draw no bet$/.test(value)) return t('outcomes.draw_no_bet');
  if (/^(neither|none|no one|neither team|asnjera|asnjëra)$/.test(value)) return 'Asnjëra';

  const line = raw.match(/(\d+(?:[.,]\d+)?)/)?.[1];
  if (/^(over|lart|mbi)\s+\d+(?:[.,]\d+)?$/i.test(raw)) return `${t('outcomes.over')} ${line}`;
  if (/^(under|poshte|nën|nen)\s+\d+(?:[.,]\d+)?$/i.test(raw)) return `${t('outcomes.under')} ${line}`;
  const btts = raw.match(/^(?:both teams? (?:to )?score|both score|btts)\s*[:=]?\s*(yes|no|po|jo)$/i);
  if (btts) return /^(yes|po)$/i.test(btts[1]) ? t('outcomes.yes') : t('outcomes.no');
  if (/^(?:both teams? to score|both score|btts|gg\s*\/?\s*ng)$/i.test(raw)) return t('markets.both_teams_score');
  if (/^(?:no\s*goal|jo[\s-]*gol|nuk\s*sh[eë]nojne)$/i.test(raw)) return t('outcomes.no_goal');
  if (/^(?:a\s+)?goal$/i.test(raw)) return t('outcomes.goal');

  // 2. Nëse shkurtimi ndryshoi diçka, kthe shkurtimin
  if (short !== raw) return short;

  return fallback(raw);
}

export function formatBuilderSelection(legs: {market:string;outcome:string;line?:string}[]|undefined,t:Translate):string|null {
 if(!legs||legs.length!==2)return null;
 const order=['1X2','DC','BTTS','TOTAL'];
 const sorted=[...legs].sort((a,b)=>order.indexOf(a.market)-order.indexOf(b.market));
 return translateCombinationOutcome(sorted.map(l=>l.market+' '+l.outcome+(l.line?' '+l.line:'')).join(' + '),t);
}
export function formatTicketSelection(
  outcomeName: string | undefined,
  marketName: string | undefined,
  matchName: string | undefined,
  t: Translate,
  outcomeCode?: string,
  marketLine?: string,
) {
  const rawOutcome = String(outcomeName ?? '').trim();
  if(/^bet builder\s*:/i.test(String(marketName??''))){
    const combined=translateCombinationOutcome(rawOutcome,t,matchName);
    if(combined)return combined;
  }
  const numericOutcome = formatOrdinalOutcomeLabel(rawOutcome, marketName, marketLine, matchName);
  if (numericOutcome !== null) return numericOutcome;
  if (isHalfTimeFullTimeMarket(marketName)) return translateOutcomeName(rawOutcome, t, marketName, matchName);
  if (isResultBttsMarket(marketName)) return translateOutcomeName(rawOutcome, t, marketName, matchName, outcomeCode);
  const market = normalized(marketName);
  const resultMarket = /(?:^| )(?:1x2|moneyline|match winner|winner|full time result|fulltime result|match result|1st half result|first half result|2nd half result|second half result)(?: |$)/.test(market);
  if (!resultMarket) return translateOutcomeName(rawOutcome, t, marketName, matchName, outcomeCode);

  const outcome = normalized(rawOutcome);
  const teams = String(matchName ?? '').split(/\s+(?:vs\.?|v)\s+/i).map(normalized);
  const [home, away] = teams;
  if (/^(?:x|draw|tie|barazim)$/.test(outcome)) return 'X';
  if (/^(?:1|home|home team|home win|homewin|w1|vendas)$/.test(outcome) || (home && outcome === home)) return '1';
  if (/^(?:2|away|away team|away win|awaywin|w2|udhetues)$/.test(outcome) || (away && outcome === away)) return '2';
  return translateOutcomeName(rawOutcome, t, marketName);
}

export function translateTicketType(type: string | undefined, t: Translate) {
  if (type === 'SINGLE') return t('betslip.single');
  if (type === 'COMBO') return t('betslip.combo');
  if (type === 'SYSTEM') return t('betslip.system');
  return type ?? '';
}

export function translateTicketStatus(status: string | undefined, t: Translate) {
  if (!status) return '';
  const key = `tickets.${status.toLowerCase()}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

/** Known timeline descriptions are display text, never settlement input.
 * Protect fixture names before translating phrases (e.g. "Red Star").
 */
export function translateMatchEventText(text: string | undefined, homeTeam = '', awayTeam = '', lang: 'al' | 'en' = 'al'): string {
  if (lang === 'en') return repairDisplayText(text);
  const names = [homeTeam, awayTeam].map(repairDisplayText).filter(Boolean).sort((a, b) => b.length - a.length);
  let value = repairDisplayText(text);
  names.forEach((name, index) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    value = value.replace(new RegExp(escaped, 'gi'), '\uE000' + index + '\uE001');
  });
  const phrases: Array<[RegExp, string]> = [
    [/\bdangerous\s+attack\b/gi, 'Sulm i rrezikshëm'],
    [/\b(?:yellow[ -]red|second\s+yellow)\s+card\b/gi, 'Karton i dytë i verdhë'],
    [/\byellow\s+card\b/gi, 'Karton i verdhë'],
    [/\bred\s+card\b/gi, 'Karton i kuq'],
    [/\bown\s+goal\b/gi, 'Autogol'],
    [/\bgoal\s+kick\b/gi, 'Rivënie nga porta'],
    [/\bfree\s+kick\b/gi, 'Goditje dënimi'],
    [/\bthrow[ -]in\b/gi, 'Rivënie anësore'],
    [/\bkick[ -]off\b/gi, 'Fillimi i lojës'],
    [/\bhalf[ -]?time\b/gi, 'Pushimi i ndeshjes'],
    [/\bfull[ -]?time\b/gi, 'Përfundimi i ndeshjes'],
    [/\b(?:first|1st)\s+half\b/gi, 'Pjesa e parë'],
    [/\b(?:second|2nd)\s+half\b/gi, 'Pjesa e dytë'],
    [/\bextra\s+time\b/gi, 'Koha shtesë'],
    [/\bpenalty\s+missed\b/gi, 'Penallti e humbur'],
    [/\bpenalty\s+scored\b/gi, 'Penallti e shënuar'],
    [/\bpenalt(?:y|ies)\b/gi, 'Penallti'],
    [/\bsubstitution\b/gi, 'Zëvendësim'],
    [/\boffside\b/gi, 'Pozicion jashtë loje'],
    [/\bcorners?\b/gi, 'Goditje këndore'],
    [/\bgoals?\b/gi, 'Gol'],
    [/\battacks?\b/gi, 'Sulm'],
    [/\bsaves?\b/gi, 'Pritje'],
    [/\bfouls?\b/gi, 'Faull'],
  ];
  value = phrases.reduce((label, [pattern, replacement]) => label.replace(pattern, replacement), value);
  return value.replace(/\uE000(\d+)\uE001/g, (_match, index) => names[Number(index)] ?? '');
}
