import type { Match } from '../types';
const ordinal = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
/** Server-owned listing positions, never kickoff, score, price or browser arrival. */
export function compareMatchDisplay(a: Match, b: Match): number {
  return Number(b.status === 'LIVE') - Number(a.status === 'LIVE')
    || (a.status==='LIVE'?0:ordinal(a.listingPriority)-ordinal(b.listingPriority))
    || ordinal(a.competitionOrder) - ordinal(b.competitionOrder)
    || String(a.tournament?.id ?? a.tournamentId ?? '').localeCompare(String(b.tournament?.id ?? b.tournamentId ?? ''), 'en', { numeric: true })
    || ordinal(a.displayOrder) - ordinal(b.displayOrder)
    || String(a.id).localeCompare(String(b.id), 'en', { numeric: true });
}
