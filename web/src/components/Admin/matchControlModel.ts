import type { Match, Outcome } from '../../types';

export type AdminOverride = { kind: string; ref: string; suspended?: boolean | null; price?: number | null };
export type ControlDialog =
  | { kind: 'odds'; match: Match; market: NonNullable<Match['markets']>[number]; outcome: Outcome }
  | { kind: 'adjust'; match: Match; title: string; outcomes: Outcome[]; scope: 'match' | 'market' | 'outcome'; id: string }
  | { kind: 'settle'; match: Match };

export const MAX_ADMIN_ODDS = 9_999_999_999.9999;
export const searchText = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const competitionKey = (match: Match) => String(match.tournament?.id ?? match.tournament?.name ?? '');
export const matchStatus = (match: Match): string => !match.status || String(match.status) === 'UPCOMING' ? 'PREMATCH' : match.status;
export const statusLabel = (match: Match, lang: string = 'al') => lang === 'en'
  ? ({ LIVE: 'Live', ENDED: 'Finished', CANCELLED: 'Cancelled', PREMATCH: 'Prematch' }[matchStatus(match)] ?? 'Prematch')
  : ({ LIVE: 'Në lojë', ENDED: 'Përfunduar', CANCELLED: 'Anuluar', PREMATCH: 'Para ndeshjes' }[matchStatus(match)] ?? 'Para ndeshjes');
export const fixtureName = (match: Match) => `${match.homeTeam} vs ${match.awayTeam}`;
export const eligibleOutcomes = (outcomes: Outcome[]) => outcomes.filter(outcome => Number.isFinite(Number(outcome.odds)) && Number(outcome.odds) > 1 && Number(outcome.odds) <= MAX_ADMIN_ODDS);
export function previewAdjustments(outcomes: Outcome[], percentage: number) {
  return eligibleOutcomes(outcomes).map(outcome => {
    const previous = Number(outcome.odds);
    const next = Number((previous * (1 + percentage / 100)).toFixed(3));
    return { outcome, previous, next, valid: Number.isFinite(next) && next > 1 && next <= MAX_ADMIN_ODDS };
  });
}
