import { config } from './config.mjs';
import { liveClock } from './minute.mjs';
import { fetchMatchPages } from './match-pages.mjs';
import { buildCompetitionPolicy, competitionDecision } from './football-competitions.mjs';

const BASE = config.gateway;
const QS = () => `l=${encodeURIComponent(config.lang)}&p=${encodeURIComponent(config.partnerId)}`;

async function request(path, body) {
  const url = `${BASE}/${path}?${QS()}`;
  const init =
    body === undefined
      ? { method: 'GET' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
      const json = await res.json();
      return json.result;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export const apiGet = (path) => request(path);
export const apiPost = (path, body = {}) => request(path, body);

/* ------------------------------------------------------------------ filters
 * The football sport feed also carries synthetic rows (CyberFIFA, eReplays,
 * Replays, Short Football, long-term outrights ...) and `isEsport` is false
 * even for those, so slug/name patterns are required.
 */

const BLOCKED_SPORT_TYPES = new Set(['esport', 'polybet']);
const BLOCKED_CATEGORY_SLUGS = new Set([
  'cyberfifa', 'ereplays', 'replays', 'short-football', 'cyber-leagues', 'cybersport',
  'cyber-football', 'virtual-football', 'crypto', 'crypto-live', 'computer-games',
  'fifa', 'vsport', 'express', 'special-1', 'special-2',
]);
const BLOCKED_CATEGORY_RE = /^(cyber|e-?replays?$|virtual|crypto|computer|vsport|express|special[-_]?\d)/i;
const BLOCKED_TOURNAMENT_RE =
  /(\(2x4 min\)|esportsbattle|h2h gg|ehighlights|penalty shootout|highlights|long-term bets|outrights|singles only|simulat|virtual|cyber|short football|fantasy|bet ?by|instant|micro ?league)/i;
const SYNTHETIC_TEAM_RE = /\((v|replays?|franchise|highlights|sim|virtual)\)$/i;
// "(w)" / "(women)" are real women's teams, so they are excluded from this check
const NICKNAME_TEAM_RE = /\s\((?!w\)|women\))[a-z0-9_]{2,14}\)$/i;

let catalogCache = { at: 0, value: null };

export async function loadCatalog(maxAgeMs = 600000) {
  if (catalogCache.value && Date.now() - catalogCache.at < maxAgeMs) return catalogCache.value;

  const [sports, categories, tournaments] = await Promise.all([
    apiPost('sports/get-many', {}),
    apiPost('categories/get-many', {}),
    apiPost('tournaments/get-many', {}),
  ]);

  const value = {
    sports: new Map(sports.items.map((s) => [s.sport.id, s.sport])),
    categories: new Map(
      categories.items.map((c) => [
        c.category.id,
        {
          id: c.category.id,
          slug: c.category.slug,
          name: c.category.name,
          sportType: c.category.sport?.sportType ?? 'unknown',
          isEsport: c.category.sport?.isEsport ?? false,
        },
      ]),
    ),
    tournaments: new Map(
      tournaments.items.map((t) => [
        t.tournament.id,
        {
          id: t.tournament.id,
          categoryId: t.tournament.categoryId ?? t.tournament.category?.id,
          isEsport: t.tournament.isEsport === true,
          name: t.tournament.name,
          slug: t.tournament.slug,
          sportId: t.tournament.sportId,
          categorySlug: t.tournament.category?.slug ?? '',
        },
      ]),
    ),
  };

  value.competitionPolicy = buildCompetitionPolicy(value.tournaments, value.categories);
  catalogCache = { at: Date.now(), value };
  return value;
}

/** true = keep (real football), false = synthetic / esport / replay feed */
export function isRealFootball(match, catalog) {
  const sport = match.sport ?? catalog.sports.get(match.sportId) ?? {};
  const category = catalog.categories.get(match.categoryId) ?? {};
  const tournament = catalog.tournaments.get(match.tournamentId) ?? {};
  const categorySlug = category.slug ?? match.category?.slug ?? '';
  const sportType = sport.sportType ?? category.sportType ?? 'unknown';

  if (match.sportId !== config.footballSportId) return false;
  if (match.sportTag && match.sportTag !== 'football') return false;
  if (sport.isEsport === true) return false;
  if (BLOCKED_SPORT_TYPES.has(sportType)) return false;
  if (BLOCKED_CATEGORY_SLUGS.has(categorySlug) || BLOCKED_CATEGORY_RE.test(categorySlug)) return false;
  if (BLOCKED_TOURNAMENT_RE.test(tournament.name ?? '')) return false;
  if (process.env.FOOTBALL_TOP_TIERS_ONLY !== 'false') {
    const decision = catalog.competitionPolicy?.get(match.tournamentId)
      ?? competitionDecision(match.tournament ?? tournament, category);
    if (!decision.allowed) return false;
  }

  const competitors = match.competitors ?? [];
  const home = match.homeTeam?.name ?? competitors[0]?.name;
  const away = match.awayTeam?.name ?? competitors[1]?.name;
  if (competitors.length < 2) return false; // outright / long-term market
  if (!home || !away || home === away) return false;
  if (SYNTHETIC_TEAM_RE.test(home) || SYNTHETIC_TEAM_RE.test(away)) return false;
  if (NICKNAME_TEAM_RE.test(home) || NICKNAME_TEAM_RE.test(away)) return false; // "Porto (mani)"

  return true;
}

function toRow(match, catalog) {
  const sport = match.sport ?? catalog.sports.get(match.sportId) ?? {};
  const category = catalog.categories.get(match.categoryId) ?? {};
  const tournament = catalog.tournaments.get(match.tournamentId) ?? {};
  const competitors = match.competitors ?? [];
  const home = match.homeTeam?.name ?? competitors[0]?.name ?? '';
  const away = match.awayTeam?.name ?? competitors[1]?.name ?? '';
  const startAt = new Date((match.startAt ?? 0) * 1000);
  const service = String(match.service ?? '').toUpperCase();
  const clock = service === 'LIVE' ? liveClock(startAt) : { minute: null, phase: 'pre', status: 'scheduled' };

  return {
    match_id: match.id,
    sport_id: match.sportId,
    sport_tag: match.sportTag ?? sport.tag ?? null,
    category_id: match.categoryId ?? null,
    category_slug: category.slug ?? match.category?.slug ?? null,
    category_name: category.name ?? null,
    tournament_id: match.tournamentId ?? null,
    tournament_slug: tournament.slug ?? match.tournament?.slug ?? null,
    tournament_name: tournament.name ?? null,
    home,
    away,
    service,
    start_at: startAt,
    is_hot: match.isHot === true,
    is_real: true,
    live_minute: clock.minute,
    phase: clock.phase,
    status: clock.status,
    raw: match,
  };
}

/** Every real football match from the public feed (live + prematch). */
export async function fetchRealFootball() {
  const catalog = await loadCatalog();
  const { items, received, complete } = await fetchMatchPages(page => apiPost('matches/get-many', {
    sportIds: [config.footballSportId], ...page,
  }), { pageSize: config.matchPageLimit });

  const rows = [];
  let skipped = 0;
  for (const m of items) {
    if (isRealFootball(m, catalog)) rows.push(toRow(m, catalog));
    else skipped++;
  }
  return { rows, received, skipped, complete };
}

